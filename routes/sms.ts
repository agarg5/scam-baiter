import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { generateSmsReply } from '../services/openai';
import { getHistory, appendTurn } from '../services/smsStore';

const router = express.Router();

/**
 * POST /sms
 * SignalWire webhook for incoming SMS. Replies via GPT-4o using the selected
 * persona (default env DEFAULT_PERSONA, override with ?persona=... on the webhook).
 * Conversation history is persisted to disk so it survives restarts.
 */
router.post('/', async (req: Request, res: Response) => {
  const { From: from, Body: body } = req.body as { From: string; Body: string };
  const persona = (req.query.persona as string) || process.env.DEFAULT_PERSONA || 'tyler';

  console.log(`[SMS] ${from} (${persona}): ${body}`);

  const history = getHistory(from);

  try {
    const reply = await generateSmsReply(body, history, persona);

    appendTurn(from, persona, body, reply);

    console.log(`[SMS] → ${from}: ${reply}`);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    console.error('[SMS] Error generating reply:', err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Sorry, my phone's being weird, can you resend?");
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

export = router;
