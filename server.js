require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createElevenLabsBridge } = require('./services/elevenlabs');
const { createConversationLog } = require('./services/logger');
const { getPersona } = require('./prompts/personas');
const { validateSignalWireSignature, validateStreamToken } = require('./services/security');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

const inboundRouter = require('./routes/inbound');
const outboundRouter = require('./routes/outbound');
const smsRouter = require('./routes/sms');
const dashboardRouter = require('./routes/dashboard');

app.use('/inbound', validateSignalWireSignature, inboundRouter);
app.use('/api/call', outboundRouter);
app.use('/outbound-twiml', validateSignalWireSignature, (req, res, next) => {
  req.url = '/twiml';
  outboundRouter(req, res, next);
});
app.use('/sms', validateSignalWireSignature, smsRouter);
app.use('/dashboard', dashboardRouter);

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'scam-baiter' }));

// Call status callback (Twilio fires this on call state changes)
app.post('/call-status', validateSignalWireSignature, (req, res) => {
  console.log(`[Status] Call ${req.body.CallSid}: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

// ── HTTP + WebSocket Server ───────────────────────────────────────────────────

const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/media-stream' });

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url.replace('/media-stream', '').replace('?', ''));
  const direction = params.get('direction') || 'inbound';
  const personaFromQuery = params.get('persona');

  if (!validateStreamToken(params.get('token'))) {
    console.warn('[WS] Rejected media-stream connection: bad or missing token');
    ws.close(1008, 'unauthorized');
    return;
  }

  console.log(`[WS] New media stream connection (${direction})`);

  let callSid = null;
  let callerNumber = null;
  let conversationLogger = null;

  // We need the callSid from the first Twilio 'start' event before we
  // can create the ElevenLabs bridge, so we buffer audio until then.
  let bridgeCreated = false;
  let elBridge = null;
  const messageBuffer = [];

  // Intercept messages to capture callSid from 'start' event
  const originalOnMessage = (rawData) => {
    try {
      const msg = JSON.parse(rawData);

      if (msg.event === 'start' && !bridgeCreated) {
        callSid = msg.start.callSid;
        callerNumber = msg.start.customParameters?.callerNumber || 'unknown';
        const personaId = msg.start.customParameters?.persona || personaFromQuery || process.env.DEFAULT_PERSONA || 'tyler';
        const persona = getPersona(personaId);
        const streamSid = msg.start.streamSid;

        conversationLogger = createConversationLog({
          direction,
          scammerNumber: callerNumber,
          ourNumber: process.env.SIGNALWIRE_PHONE_NUMBER,
          persona: persona.id,
        });

        console.log(`[WS] Call started: ${callSid} (persona=${persona.id})`);

        elBridge = createElevenLabsBridge(ws, {
          callSid,
          streamSid,
          persona,
          direction,
          onTranscript: (turn) => {
            console.log(`[${turn.speaker.toUpperCase()}] ${turn.text}`);
            if (conversationLogger) conversationLogger.addTurn(turn);
          },
          onEnd: () => {
            if (conversationLogger) {
              conversationLogger.save();
              conversationLogger = null;
            }
          },
        });

        bridgeCreated = true;

        // Replay buffered messages into the bridge's own message handler
        messageBuffer.forEach((buffered) => {
          ws.emit('message', buffered);
        });
        messageBuffer.length = 0;

        // Re-emit the start event so the bridge sees it
        ws.emit('message', rawData);
        return;
      }

      if (!bridgeCreated) {
        messageBuffer.push(rawData);
      }
      // Once bridge is created, messages flow directly via the bridge's own listener
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  ws.on('message', originalOnMessage);

  ws.on('close', () => {
    console.log(`[WS] Connection closed for call ${callSid}`);
    if (conversationLogger) {
      conversationLogger.save();
      conversationLogger = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🎭 Scam Baiter running on port ${PORT}`);
  console.log(`   Inbound webhook:  POST /inbound`);
  console.log(`   Outbound API:     POST /api/call`);
  console.log(`   SMS webhook:      POST /sms`);
  console.log(`   Media stream WS:  wss://your-host/media-stream\n`);
});
