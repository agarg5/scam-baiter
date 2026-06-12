import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { client } from '../services/client';
import { getPersona, listPersonas } from '../prompts/personas';
import { requireApiKey, streamToken } from '../services/security';

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
 * Initiates a SignalWire outbound call to the given number, then connects it
 * to ElevenLabs via the same media-stream WebSocket bridge.
 */
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const { phoneNumber, persona } = req.body as { phoneNumber?: string; persona?: string };

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  const chosen = getPersona(persona);
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
});

/**
 * POST /outbound-twiml
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
