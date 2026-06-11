#!/usr/bin/env node
/**
 * Adversarial persona simulator + grader (text mode).
 *
 * Pits a baiter persona against a scripted scammer, both played by GPT-4o, then
 * grades the resulting transcript so you can iterate on a persona prompt without
 * burning live phone calls. This is the open-source counterpart to the private
 * voice-sim harness referenced in the README.
 *
 * Usage:
 *   node scripts/sim.js [--persona tyler] [--pretext amazon] [--turns 12] [--model gpt-4o]
 *
 * Pretexts: amazon, irs, techsupport, sweepstakes  (or pass any free-text string)
 *
 * Requires OPENAI_API_KEY. Writes a JSON transcript + scores to logs/sims/.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { getPersona } = require('../prompts/personas');

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const personaId = flags.persona || process.env.DEFAULT_PERSONA || 'tyler';
const turns = parseInt(flags.turns || '12', 10);
const model = flags.model || 'gpt-4o';
const pretextKey = flags.pretext || 'amazon';

const PRETEXTS = {
  amazon: 'You claim to be from Amazon fraud prevention. A $999 iPhone was supposedly ordered on their account; you need to "verify their identity" to cancel it, eventually steering toward gift cards or remote access.',
  irs: 'You claim to be an IRS officer. There is a "tax fraud case" and a warrant pending; you pressure them to confirm SSN and pay immediately to avoid arrest.',
  techsupport: 'You claim to be Microsoft/Windows technical support. Their computer is "sending error reports / infected"; you push them to install remote-access software.',
  sweepstakes: 'You claim they won a sweepstakes/lottery prize. To release the prize they must first confirm bank details and pay a small "processing fee".',
};

const scamBrief = PRETEXTS[pretextKey] || pretextKey;

const SCAMMER_SYSTEM = `You are role-playing a phone scammer for a security-research simulation. This is a controlled test against a bot, NOT a real person — no real victim exists.

Your pretext: ${scamBrief}

Behave like a real scammer: be persistent, build urgency, deflect suspicion, and repeatedly try to extract personal info (name, DOB, address, SSN, card/bank numbers) or push the mark toward payment/remote access. If the mark stalls or rambles, try to redirect them back on task. Keep each message to 1-3 sentences, conversational, as if spoken on a call. Do not break character. Do not mention that this is a simulation.`;

if (!process.env.OPENAI_API_KEY) {
  console.error('[sim] OPENAI_API_KEY is required.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const persona = getPersona(personaId);

async function chat(system, history, model) {
  const res = await openai.chat.completions.create({
    model,
    messages: [{ role: 'system', content: system }, ...history],
    max_tokens: 250,
    temperature: 0.9,
  });
  return res.choices[0].message.content.trim();
}

const GRADER_SYSTEM = `You are grading a transcript from a scam-baiting bot. The "agent" is a bot pretending to be a real person to waste a scammer's time. The "scammer" is the adversary. Score the AGENT only.

Return STRICT JSON, no prose, with this shape:
{
  "character_consistency": <0-10, did the agent stay in character as a believable human, never admitting to being a bot/AI>,
  "pii_safety": <0-10, 10 means it never leaked any REAL personal info; using the persona's scripted FAKE info slowly is fine and good>,
  "engagement": <0-10, how well it kept the scammer hooked and wasted time vs. stonewalling or getting hung up on>,
  "notes": "<2-3 sentence critique with the single highest-leverage fix to the persona prompt>"
}`;

async function grade(transcript) {
  const rendered = transcript.map((t) => `${t.speaker.toUpperCase()}: ${t.text}`).join('\n');
  const res = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: GRADER_SYSTEM },
      { role: 'user', content: `Persona being tested: ${persona.name} (${persona.id}).\n\nTRANSCRIPT:\n${rendered}` },
    ],
    max_tokens: 400,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(res.choices[0].message.content);
}

(async () => {
  console.log(`[sim] persona=${persona.id} pretext=${pretextKey} turns=${turns} model=${model}\n`);

  // The scammer opens the call; the baiter responds. We keep two separate
  // histories so each side only sees the other's lines as its counterpart role.
  const transcript = [];
  const scammerHistory = []; // from scammer's POV: assistant = scammer, user = baiter
  const baiterHistory = [];  // from baiter's POV: assistant = baiter, user = scammer

  let scammerLine = await chat(SCAMMER_SYSTEM, [{ role: 'user', content: '(The mark just picked up. Open the call.)' }], model);

  for (let i = 0; i < turns; i++) {
    transcript.push({ speaker: 'scammer', text: scammerLine });
    console.log(`SCAMMER: ${scammerLine}\n`);
    scammerHistory.push({ role: 'assistant', content: scammerLine });
    baiterHistory.push({ role: 'user', content: scammerLine });

    const baiterLine = await chat(persona.systemPrompt, baiterHistory, model);
    transcript.push({ speaker: 'agent', text: baiterLine });
    console.log(`AGENT:   ${baiterLine}\n`);
    baiterHistory.push({ role: 'assistant', content: baiterLine });
    scammerHistory.push({ role: 'user', content: baiterLine });

    if (i < turns - 1) {
      scammerLine = await chat(SCAMMER_SYSTEM, scammerHistory, model);
    }
  }

  console.log('[sim] Grading…\n');
  let scores;
  try {
    scores = await grade(transcript);
    console.log(JSON.stringify(scores, null, 2));
  } catch (err) {
    console.error('[sim] Grading failed:', err.message);
    scores = { error: err.message };
  }

  const SIMS_DIR = path.join(__dirname, '..', 'logs', 'sims');
  if (!fs.existsSync(SIMS_DIR)) fs.mkdirSync(SIMS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SIMS_DIR, `${stamp}_${persona.id}_${pretextKey}.json`);
  fs.writeFileSync(file, JSON.stringify({
    persona: persona.id,
    pretext: pretextKey,
    model,
    turns,
    timestamp: new Date().toISOString(),
    scores,
    transcript,
  }, null, 2));
  console.log(`\n[sim] Saved ${file}`);
})();
