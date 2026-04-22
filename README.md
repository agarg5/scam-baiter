# Scam Baiter

An open-source voice bot that wastes scammers' time. Pick up a spam call, let the bot handle it, and let the scammer burn minutes talking to "Tyler" or "Margaret" while you get your afternoon back.

Built on **SignalWire** (Twilio-compatible telephony) + **ElevenLabs Conversational AI** (voice agent) + **OpenAI GPT-4o** (SMS replies).

- 📞 Inbound and outbound calls
- 💬 SMS replies
- 🎭 Pluggable personas — drop a `.js` file into `prompts/` and it's live
- 📋 Batch dialer — feed it a list of numbers
- 📝 Full transcripts saved per call

## Architecture

```
Scammer ──► SignalWire number ──► POST /inbound ──► LaML <Connect><Stream>
                                                            │
                                                            ▼
                                             WebSocket /media-stream
                                                            │
                                                            ▼
                                          ElevenLabs Conversational AI
                                                 (persona prompt)
```

Outbound reverses it: `POST /api/call { phoneNumber, persona }` → SignalWire dials the number → same WebSocket bridge.

## Quick start

```bash
git clone https://github.com/agarg5/scam-baiter.git
cd scam-baiter
npm install
cp .env.example .env    # fill in credentials
npm start
```

In a second terminal, expose your server to the internet:

```bash
cloudflared tunnel --url http://localhost:8000
# or: ngrok http 8000
```

Then point SignalWire webhooks at the public URL:
- **Voice webhook**: `https://YOUR-TUNNEL/inbound`
- **SMS webhook**: `https://YOUR-TUNNEL/sms`

Call your SignalWire number and the default persona (Tyler) will answer.

## Setup details

### 1. SignalWire
1. Sign up at [signalwire.com](https://signalwire.com) and note your **Space URL** (e.g. `yourname.signalwire.com`).
2. Buy a phone number with **Voice + SMS** capability.
3. In Project Settings → API Tokens, create a token. Copy **Project ID** and **API Token**.
4. Fill the `SIGNALWIRE_*` values in `.env`.

### 2. ElevenLabs Conversational AI
1. Go to [elevenlabs.io/app/conversational-ai](https://elevenlabs.io/app/conversational-ai) and create an agent.
2. **LLM**: GPT-4o (or Claude — both work).
3. **Voice**: pick one that matches your persona. For Tyler, use a natural young-adult male voice; for Margaret, a warm elderly female voice.
4. **First message**: leave empty — the persona prompt handles the opener.
5. **System prompt**: paste the persona's system prompt (e.g. contents of `prompts/tyler.js`'s `SYSTEM_PROMPT`). Enable **Override personality** so the stock agent persona doesn't leak through.
6. **Audio**: set both input and output to `ulaw_8000` — SignalWire media streams are μ-law 8kHz.
7. Copy the **Agent ID** → `ELEVENLABS_AGENT_ID`.
8. Create an API key (Profile → API Keys) → `ELEVENLABS_API_KEY`.

### 3. OpenAI
Get an API key at [platform.openai.com](https://platform.openai.com) → `OPENAI_API_KEY`. Used for SMS replies.

## Personas

A persona is a single character the bot plays on a call — a name, a voice, and a system prompt that defines how they talk, what fake info they'll leak, and how they stall. Each persona is one file in `prompts/`; the server auto-loads every file in that directory at startup, so adding a new one is a one-file operation.

### Shipped personas

| id | character | when to use |
|---|---|---|
| `tyler` *(default)* | 26-year-old marketing guy in SF, distractible, too polite to hang up | Pretexts aimed at working-age adults: Amazon fraud, IRS, document/package scams, Indian-consulate |
| `margaret` | 78-year-old retired schoolteacher in Columbus OH, lonely, bad with phones | Classic "elder scam" pretexts: tech support, Medicare, sweepstakes, romance |

Switch the default with `DEFAULT_PERSONA=margaret` in `.env`, or pick per-call (see below).

### How each persona is structured

Every persona module exports the same shape:

```js
// prompts/tyler.js
module.exports = {
  id: 'tyler',                              // URL-safe key used everywhere
  name: 'Tyler Bennett',                    // display name
  description: 'Distractible millennial.',  // one-liner for dashboards / logs
  voiceId: 'loWZgmt1ZsitHiWYOGDJ',          // ElevenLabs voice id, or null
  systemPrompt: `...`,                      // inbound prompt (they call us)
  outboundPrompt: `...` + systemPrompt,     // outbound prompt (we call them) — usually adds an opener
};
```

`voiceId` should point at a voice you've added to your ElevenLabs voice library. Match the voice to the character — a twentysomething voice for Tyler, a grandma voice for Margaret. If `voiceId` is `null`, the agent uses whatever voice is configured in the ElevenLabs dashboard.

### Adding a new persona

1. Copy an existing file: `cp prompts/tyler.js prompts/sandra.js`.
2. Rewrite the prompt for your character — use the structure below.
3. (Optional) Add a voice: find a voice on [voices.elevenlabs.io](https://voices.elevenlabs.io), add it to your library, paste the voice id into `voiceId`.
4. Restart the server. Verify with `curl http://localhost:8000/api/call/personas`.

That's the whole workflow. No registration, no routes, no config.

### What a good persona prompt contains

Structure the prompt in clearly-labeled sections — LLMs follow section headers well. The Tyler prompt is the canonical example. At minimum include:

- **Identity & backstory**: name, age, location, job, family, daily-life detail. Enough texture that the agent has answers when the scammer asks small-talk questions ("where do you work?", "who else lives with you?").
- **Anti-AI reflex**: an explicit rule for what to say when someone asks "are you a bot?" / "is this a recording?" Never admit. Have a reflexive normal-person response ready.
- **Forbidden phrases**: list the customer-service tics you want the model to avoid ("how can I help you", "happy to help", "is there anything else"). Without this, assistant-shaped training leaks through.
- **Pushback before compliance**: scammers need friction. First time they ask for ANY info, make the persona push back with a skeptical question ("how did you get my number?", "can I call you back at the official line?"). Only fumble the fake info out on the second or third ask.
- **Fake identity set**: hard-coded fake name, DOB, address, email, etc. that the persona is allowed to leak. Give concrete values so the model doesn't make up something different each call.
- **Stall library**: believable distractions ("my roommate just walked in", "my cat jumped on the keyboard", "someone's at the door"). These are your primary time-wasting mechanic.
- **Format constraints**: 1-2 sentence turns, natural filler ("uh", "hold on"), disfluencies. Monologues sound robotic and get cut off by the TTS.
- **Never go silent rule**: LLMs sometimes emit empty responses when uncertain. Explicitly require an audible filler every turn — even "uh, hold on a sec" beats dead air.
- **End-call rule**: when, if ever, is the persona allowed to hang up? Usually: abusive callers only.

### Persona-writing tips (from what actually works)

- **Confusion, not refusal.** Scammers bail if you stonewall. Fumble, mishear, apologize, drop the phone — don't argue.
- **Drip info, never dump.** A good persona burns 30-60 seconds per piece of info, not 5. Restarts, digit-swaps, "wait, sorry, let me start over" — every fumble is wasted scammer time.
- **Pick a voice that matches.** Prompt can say Tyler is 26 all day — if the voice sounds 55, scammers get suspicious.
- **Pressure-test with the included adversarial grader.** The simulation harness (kept private) pits the baiter against a scripted scammer and GPT-4o-scores the transcript on character consistency, PII leakage, and engagement. Iterate the prompt until the numbers go up.

### Selecting a persona per call

- **Outbound**: `POST /api/call` body `{ "phoneNumber": "+1...", "persona": "margaret" }`
- **Inbound**: set the SignalWire voice webhook to `…/inbound?persona=margaret`
- **SMS**: set the SignalWire SMS webhook to `…/sms?persona=margaret`
- **Default** for any call without an explicit persona: `DEFAULT_PERSONA=margaret` in `.env`
- **List** all available: `GET /api/call/personas`

## Batch dialing

Feed the bot a list of numbers:

```bash
# scripts/numbers.txt (one per line, optional persona override)
+14155551234
+18005550199   margaret

# then run:
npm run batch -- scripts/numbers.txt --persona tyler --delay 30 --host https://your-tunnel.trycloudflare.com
```

Flags:
- `--persona` — default persona for lines without one (fallback: `DEFAULT_PERSONA` env)
- `--delay` — seconds between calls (default 30)
- `--host` — public URL of the running server (fallback: `PUBLIC_HOST` env, then `localhost`)

## API reference

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/inbound` | SignalWire voice webhook (returns LaML) |
| `POST` | `/sms` | SignalWire SMS webhook |
| `POST` | `/api/call` | Place an outbound call: `{ phoneNumber, persona? }` |
| `GET`  | `/api/call/personas` | List available personas |
| `POST` | `/outbound-twiml` | Internal — fetched by SignalWire after call connects |
| `POST` | `/call-status` | Internal — call status callbacks |
| `GET`  | `/` | Health check |

WebSocket: `wss://HOST/media-stream?direction=inbound|outbound&persona=<id>`

## Conversation logs

Every call is saved to `logs/conversations/` as JSON:

```json
{
  "id": "uuid",
  "timestamp": "2026-04-21T...",
  "direction": "inbound",
  "scammerNumber": "+15551234567",
  "ourNumber": "+1...",
  "duration_seconds": 342,
  "persona": "tyler",
  "transcript": [
    {"speaker": "scammer", "text": "...", "timestamp": "..."},
    {"speaker": "agent", "text": "...", "timestamp": "..."}
  ]
}
```

## Deployment

Needs WebSocket support. Known-good:
- **Railway** — `railway up`, set env vars, done
- **Fly.io** — `fly deploy`
- **Render** — enable WebSocket in service settings

Remember to update the SignalWire voice/SMS webhooks to the deployed host.

## Legal & ethical

- **Call recording laws vary by jurisdiction.** Many U.S. states (and most of Europe) require two-party consent. This project records transcripts and — depending on your SignalWire settings — audio. You are responsible for complying with the laws where you and the other party are located.
- **Use only against unsolicited scam callers.** Don't dial random numbers. Don't impersonate real people. Don't harass.
- **The personas are fiction.** Any resemblance to real people is coincidental.

## Contributing

PRs welcome, especially:
- new personas (add to `prompts/`)
- new channels (WhatsApp? Telegram?)
- a web dashboard for browsing logs
- agent tools (hang-up, transfer-to-human, text-a-human)

Open an issue before large changes so we can talk through scope.

## License

MIT
