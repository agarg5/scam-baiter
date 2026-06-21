import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import WebSocket, { RawData } from 'ws';
import { createElevenLabsBridge } from './services/elevenlabs';
import { createConversationLog, ConversationLogger } from './services/logger';
import { getPersona } from './prompts/personas';
import { validateSignalWireSignature, validateStreamToken } from './services/security';
import inboundRouter from './routes/inbound';
import outboundRouter from './routes/outbound';
import smsRouter from './routes/sms';
import dashboardRouter from './routes/dashboard';
import type { Direction } from './types';

const VOICE_PROVIDER = process.env.VOICE_PROVIDER || 'elevenlabs';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/inbound', validateSignalWireSignature, inboundRouter);
app.use('/api/call', outboundRouter);
app.use('/outbound-twiml', validateSignalWireSignature, (req: Request, res: Response, next: NextFunction) => {
  req.url = '/twiml';
  outboundRouter(req, res, next);
});
app.use('/sms', validateSignalWireSignature, smsRouter);
app.use('/dashboard', dashboardRouter);

// Health check
app.get('/', (_req: Request, res: Response) => res.json({ status: 'ok', service: 'scam-baiter', voiceProvider: VOICE_PROVIDER }));

// Call status callback (Twilio fires this on call state changes)
app.post('/call-status', validateSignalWireSignature, (req: Request, res: Response) => {
  console.log(`[Status] Call ${req.body.CallSid}: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

// ── HTTP + WebSocket Server ───────────────────────────────────────────────────

const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

// The WebSocket media-stream bridge is only needed in ElevenLabs mode.
// In VocalBridge mode, VB handles the entire voice/telephony pipeline and
// audio never touches this server, so we skip the WebSocket setup.
if (VOICE_PROVIDER === 'elevenlabs') {
  const wss = new WebSocket.Server({ server, path: '/media-stream' });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const params = new URLSearchParams((req.url || '').replace('/media-stream', '').replace('?', ''));
    const direction = (params.get('direction') as Direction) || 'inbound';
    const personaFromQuery = params.get('persona');

    if (!validateStreamToken(params.get('token'))) {
      console.warn('[WS] Rejected media-stream connection: bad or missing token');
      ws.close(1008, 'unauthorized');
      return;
    }

    console.log(`[WS] New media stream connection (${direction})`);

    let callSid: string | null = null;
    let callerNumber: string | null = null;
    let conversationLogger: ConversationLogger | null = null;

    let bridgeCreated = false;
    const messageBuffer: RawData[] = [];

    const originalOnMessage = (rawData: RawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.event === 'start' && !bridgeCreated) {
          callSid = msg.start.callSid;
          callerNumber = msg.start.customParameters?.callerNumber || 'unknown';
          const personaId = msg.start.customParameters?.persona || personaFromQuery || process.env.DEFAULT_PERSONA || 'tyler';
          const persona = getPersona(personaId);

          conversationLogger = createConversationLog({
            direction,
            scammerNumber: callerNumber as string,
            ourNumber: process.env.SIGNALWIRE_PHONE_NUMBER,
            persona: persona.id,
          });

          console.log(`[WS] Call started: ${callSid} (persona=${persona.id})`);

          createElevenLabsBridge(ws, {
            callSid: callSid as string,
            streamSid: msg.start.streamSid,
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

          messageBuffer.forEach((buffered) => {
            ws.emit('message', buffered);
          });
          messageBuffer.length = 0;

          ws.emit('message', rawData);
          return;
        }

        if (!bridgeCreated) {
          messageBuffer.push(rawData);
        }
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

  console.log('[Server] ElevenLabs mode — WebSocket media-stream bridge enabled');
} else {
  console.log('[Server] VocalBridge mode — voice handled by VB, WebSocket bridge disabled');
}

server.listen(PORT, () => {
  console.log(`\n🎭 Scam Baiter running on port ${PORT} (voice: ${VOICE_PROVIDER})`);
  console.log(`   Outbound API:     POST /api/call`);
  console.log(`   SMS webhook:      POST /sms`);
  console.log(`   Dashboard:        GET  /dashboard`);
  if (VOICE_PROVIDER === 'elevenlabs') {
    console.log(`   Inbound webhook:  POST /inbound`);
    console.log(`   Media stream WS:  wss://your-host/media-stream`);
  } else {
    console.log(`   Inbound calls handled by VocalBridge — configure VB phone numbers`);
  }
  console.log('');
});
