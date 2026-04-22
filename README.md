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

Each persona is a single file in `prompts/` that exports the character. To add a new one, copy `prompts/tyler.js` and edit:

```js
// prompts/sandra.js
module.exports = {
  id: 'sandra',                            // URL-safe key
  name: 'Sandra Alvarez',
  description: 'Confused new retiree in Miami who just inherited her mother\'s iPad.',
  voiceId: 'your_elevenlabs_voice_id',     // or null to use the agent's default
  systemPrompt: `You are Sandra...`,
  outboundPrompt: `You just answered...` + systemPrompt,
};
```

That's it — the server picks it up on next start. List available personas:

```bash
curl http://localhost:8000/api/call/personas
```

Select a persona per call:
- **Outbound**: `POST /api/call` body `{ "phoneNumber": "+1...", "persona": "sandra" }`
- **Inbound**: set the SignalWire webhook URL to `…/inbound?persona=sandra`
- **SMS**: set the SignalWire SMS webhook URL to `…/sms?persona=sandra`
- **Default**: set `DEFAULT_PERSONA=sandra` in `.env`

### Persona-writing tips (from what actually works)

- **Confusion, not refusal.** Scammers bail if you stonewall. Fumble, mishear, drop the phone.
- **Drip personal info** — never hand over a clean, correct answer. Start, restart, get a digit wrong.
- **Cover the "are you a bot?" question.** Every prompt must have a reflexive human response to that. Never admit.
- **1-2 sentence turns.** Monologues get cut off and sound robotic.
- **Disfluencies:** "uh", "hold on", self-corrections, natural pauses.

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
