import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { streamToken } from '../services/security';

const router = express.Router();

/**
 * POST /inbound
 * SignalWire webhook for incoming calls. Returns LaML (compatible with TwiML)
 * that connects the call to a Media Stream WebSocket.
 */
router.post('/', (req: Request, res: Response) => {
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
