const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { generateSmsReply } = require('../services/openai');

// In-memory SMS conversation history per number (cleared on restart)
const smsHistory = new Map();

/**
 * POST /sms
 * SignalWire webhook for incoming SMS. Replies via GPT-4o using the selected
 * persona (default env DEFAULT_PERSONA, override with ?persona=... on the webhook).
 */
router.post('/', async (req, res) => {
  const { From: from, Body: body } = req.body;
  const persona = req.query.persona || process.env.DEFAULT_PERSONA || 'tyler';

  console.log(`[SMS] ${from} (${persona}): ${body}`);

  if (!smsHistory.has(from)) {
    smsHistory.set(from, []);
  }
  const history = smsHistory.get(from);

  try {
    const reply = await generateSmsReply(body, history, persona);

    history.push({ role: 'user', content: body });
    history.push({ role: 'assistant', content: reply });

    if (history.length > 40) {
      smsHistory.set(from, history.slice(-40));
    }

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

module.exports = router;
