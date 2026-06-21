import express, { Request, Response } from 'express';
import twilio from 'twilio';

const router = express.Router();

/**
 * POST /inbound
 *
 * Inbound voice calls are handled entirely by VocalBridge — each persona's VB
 * agent has its own phone number. If a SignalWire webhook is still pointed
 * here by accident, we return a brief LaML message telling the caller to
 * update their config.
 */
router.post('/', (req: Request, res: Response) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('This number is now handled by Vocal Bridge. Please update your webhook configuration.');
  twiml.hangup();
  console.log(`[Inbound] Received legacy webhook from ${req.body.From} — inbound calls should go to VB directly`);
  res.type('text/xml');
  res.send(twiml.toString());
});

export = router;
