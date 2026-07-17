import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { maskPhone } from '../services/redact';

const router = express.Router();

/**
 * POST /inbound
 *
 * Inbound voice calls are handled entirely by VocalBridge — each persona's VB
 * agent has its own phone number. If a SignalWire webhook is still pointed
 * here by accident, hang up silently: the caller is likely a scammer dialing
 * the old number, and announcing the tooling would blow the persona. The log
 * line below is the operator's signal that a webhook still points here.
 */
router.post('/', (req: Request, res: Response) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  console.log(`[Inbound] Received legacy webhook from ${maskPhone(req.body.From)} — inbound calls should go to VB directly`);
  res.type('text/xml');
  res.send(twiml.toString());
});

export = router;
