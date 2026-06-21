import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { client } from '../services/client';
import { getPersona, listPersonas } from '../prompts/personas';
import { requireApiKey, streamToken } from '../services/security';
import { createConversationLog } from '../services/logger';
import * as vocalbridge from '../services/vocalbridge';

const VOICE_PROVIDER = process.env.VOICE_PROVIDER || 'elevenlabs';
const router = express.Router();

/**
 * GET /api/call/personas
 * Returns the list of available personas for the dashboard / CLI tooling.
 */
router.get('/personas', (_req: Request, res: Response) => {
  res.json({ personas: listPersonas() });
});

/**
 * POST /api/call
 * Body: { phoneNumber: "+1234567890", persona: "tyler" (optional) }
 *
 * Initiates an outbound call. In VocalBridge mode, the call goes through VB's
 * managed telephony. In ElevenLabs mode, it goes through SignalWire + the
 * WebSocket bridge.
 */
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const { phoneNumber, persona } = req.body as { phoneNumber?: string; persona?: string };

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  const chosen = getPersona(persona);

  if (VOICE_PROVIDER === 'vocalbridge') {
    try {
      const result = await vocalbridge.placeCall(phoneNumber, chosen);

      const logger = createConversationLog({
        direction: 'outbound',
        scammerNumber: phoneNumber,
        persona: chosen.id,
      });
      // Save an initial log entry; the full transcript will be available
      // via VB's API and can be synced later with GET /api/call/sync.
      logger.save();

      console.log(`[Outbound/VB] Call to ${phoneNumber} as ${chosen.id}, call_id: ${result.call_id}`);
      res.json({
        success: true,
        callId: result.call_id,
        to: phoneNumber,
        persona: chosen.id,
        provider: 'vocalbridge',
        status: result.status,
      });
    } catch (err) {
      console.error('[Outbound/VB] Failed to initiate call:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  } else {
    // Legacy ElevenLabs + SignalWire path
    const host = req.headers.host;
    try {
      const call = await client.calls.create({
        to: phoneNumber,
        from: process.env.SIGNALWIRE_PHONE_NUMBER,
        url: `https://${host}/outbound-twiml?persona=${encodeURIComponent(chosen.id)}`,
        statusCallback: `https://${host}/call-status`,
        statusCallbackMethod: 'POST',
      });

      console.log(`[Outbound] Initiated call to ${phoneNumber} as ${chosen.id}, SID: ${call.sid}`);
      res.json({ success: true, callSid: call.sid, to: phoneNumber, persona: chosen.id });
    } catch (err) {
      console.error('[Outbound] Failed to initiate call:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

/**
 * GET /api/call/sync
 * Sync call logs from VocalBridge into the local logs directory so the
 * dashboard can display them. Only available in VocalBridge mode.
 */
router.get('/sync', requireApiKey, async (req: Request, res: Response) => {
  if (VOICE_PROVIDER !== 'vocalbridge') {
    return res.status(400).json({ error: 'Sync is only available in VocalBridge mode' });
  }

  const personaId = (req.query.persona as string) || process.env.DEFAULT_PERSONA || 'tyler';
  const chosen = getPersona(personaId);

  try {
    const logs = await vocalbridge.getCallLogs(chosen, {
      limit: Number(req.query.limit) || 20,
    });

    let synced = 0;
    for (const entry of logs) {
      try {
        const detail = await vocalbridge.getCallTranscript(entry.session_id, chosen);
        const log = vocalbridge.toConversationLog(detail, chosen);
        const logger = createConversationLog({
          direction: log.direction,
          scammerNumber: log.scammerNumber,
          persona: chosen.id,
        });
        for (const turn of log.transcript) {
          logger.addTurn(turn);
        }
        logger.save();
        synced++;
      } catch (err) {
        console.warn(`[Sync] Skipping session ${entry.session_id}:`, (err as Error).message);
      }
    }

    res.json({ synced, total: logs.length, persona: chosen.id });
  } catch (err) {
    console.error('[Sync] Failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /outbound-twiml  (ElevenLabs mode only)
 * Fetched by SignalWire once the outbound call connects. Returns LaML to start
 * a Media Stream, with the persona id attached as a custom stream parameter so
 * the WebSocket handler knows which persona to log.
 */
router.post('/twiml', (req: Request, res: Response) => {
  const host = req.headers.host;
  const persona = (req.query.persona as string) || 'tyler';
  const twiml = new twilio.twiml.VoiceResponse();

  const token = streamToken();
  const tokenQs = token ? `&token=${encodeURIComponent(token)}` : '';

  const connect = twiml.connect();
  const stream = connect.stream({
    url: `wss://${host}/media-stream?direction=outbound&persona=${encodeURIComponent(persona)}${tokenQs}`,
    name: 'scam-baiter-outbound-stream',
  });
  stream.parameter({ name: 'persona', value: persona });

  console.log(`[Outbound] LaML delivered (persona=${persona})`);

  res.type('text/xml');
  res.send(twiml.toString());
});

export = router;
