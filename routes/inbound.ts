import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { streamToken } from '../services/security';

const VOICE_PROVIDER = process.env.VOICE_PROVIDER || 'elevenlabs';
const router = express.Router();

/**
 * POST /inbound
 *
 * In ElevenLabs mode: SignalWire webhook for incoming calls. Returns LaML that
 * connects the call to a Media Stream WebSocket.
 *
 * In VocalBridge mode: inbound calls are handled entirely by VB (scammer dials
 * a VB-provisioned number → VB agent answers). This endpoint returns a brief
 * message explaining that setup, in case the webhook is still pointed here.
 */
router.post('/', (req: Request, res: Response) => {
  if (VOICE_PROVIDER === 'vocalbridge') {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('This number is now handled by Vocal Bridge. Please update your webhook configuration.');
    twiml.hangup();
    console.log(`[Inbound/VB] Received inbound webhook from ${req.body.From} — VB should handle this directly`);
    res.type('text/xml');
    res.send(twiml.toString());
    return;
  }

  // Legacy ElevenLabs path
  const host = req.headers.host;
  const persona = (req.query.persona as string) || process.env.DEFAULT_PERSONA || 'tyler';
  const twiml = new twilio.twiml.VoiceResponse();

  twiml.pause({ length: 1 });

  const token = streamToken();
  const tokenQs = token ? `&token=${encodeURIComponent(token)}` : '';

  const connect = twiml.connect();
  const stream = connect.stream({
    url: `wss://${host}/media-stream?persona=${encodeURIComponent(persona)}${tokenQs}`,
    name: 'scam-baiter-stream',
  });
  stream.parameter({ name: 'persona', value: persona });

  console.log(`[Inbound] Call from ${req.body.From} (persona=${persona}) — connecting to ElevenLabs`);

  res.type('text/xml');
  res.send(twiml.toString());
});

export = router;
