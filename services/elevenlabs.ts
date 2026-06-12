import 'dotenv/config';
import WebSocket, { RawData } from 'ws';
import type { Persona, ConversationTurn, Direction } from '../types';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

export interface BridgeOptions {
  /** Twilio call SID */
  callSid?: string;
  /** Twilio stream SID */
  streamSid?: string;
  /** ElevenLabs agent ID (defaults to env var) */
  agentId?: string;
  /** Persona module ({ systemPrompt, outboundPrompt, voiceId }) */
  persona?: Persona;
  /** 'inbound' or 'outbound' (selects which prompt to use) */
  direction?: Direction;
  /** Called with { speaker, text } on transcript events */
  onTranscript?: (turn: ConversationTurn) => void;
  /** Called when the conversation ends */
  onEnd?: () => void;
}

interface ConfigOverride {
  agent?: { prompt: { prompt: string } };
  tts?: { voice_id: string };
}

/**
 * Creates a WebSocket connection to ElevenLabs Conversational AI and bridges it
 * with the Twilio Media Stream WebSocket.
 */
function createElevenLabsBridge(twilioWs: WebSocket, opts: BridgeOptions = {}): { elWs: WebSocket } {
  const {
    callSid,
    agentId = ELEVENLABS_AGENT_ID,
    persona,
    direction = 'inbound',
    onTranscript,
    onEnd,
  } = opts;

  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
  const headers = ELEVENLABS_API_KEY
    ? { 'xi-api-key': ELEVENLABS_API_KEY }
    : {};

  const elWs = new WebSocket(wsUrl, { headers });

  let streamSid: string | null = null;
  let isClosed = false;

  function safeClose(): void {
    if (!isClosed) {
      isClosed = true;
      if (elWs.readyState === WebSocket.OPEN) elWs.close();
      if (onEnd) onEnd();
    }
  }

  elWs.on('open', () => {
    console.log(`[ElevenLabs] Connected for call ${callSid}`);

    // Send the persona's prompt and voice as a config override so the agent
    // plays the persona we selected for THIS call, rather than whatever static
    // prompt/voice is configured in the ElevenLabs dashboard. For overrides to
    // take effect, the agent's Security settings must allow overriding the
    // system prompt, first message, and voice (see README).
    const overrides: ConfigOverride = {};
    if (persona) {
      const prompt = direction === 'outbound'
        ? (persona.outboundPrompt || persona.systemPrompt)
        : persona.systemPrompt;

      if (prompt) {
        overrides.agent = { prompt: { prompt } };
      }
      if (persona.voiceId) {
        overrides.tts = { voice_id: persona.voiceId };
      }
    }

    if (overrides.agent || overrides.tts) {
      elWs.send(JSON.stringify({
        type: 'conversation_initiation_client_data',
        conversation_config_override: overrides,
      }));
      console.log(`[ElevenLabs] Sent persona override (${persona?.id || 'unknown'}, ${direction})`);
    }
  });

  elWs.on('message', (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'conversation_initiation_metadata':
          console.log(`[ElevenLabs] Conversation initiated: ${msg.conversation_initiation_metadata_event?.conversation_id}`);
          break;

        case 'audio':
          // Forward audio from ElevenLabs to Twilio
          if (streamSid && msg.audio_event?.audio_base_64) {
            const twilioMsg = {
              event: 'media',
              streamSid,
              media: { payload: msg.audio_event.audio_base_64 },
            };
            if (twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.send(JSON.stringify(twilioMsg));
            }
          }
          break;

        case 'interruption':
          // Clear buffered audio in Twilio
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
          }
          break;

        case 'transcript':
          if (onTranscript && msg.transcript_event) {
            const { speaker_type, transcript: text } = msg.transcript_event;
            // speaker_type is 'user' (scammer) or 'agent' (Margaret)
            onTranscript({
              speaker: speaker_type === 'user' ? 'scammer' : 'agent',
              text,
              timestamp: new Date().toISOString(),
            });
          }
          break;

        case 'agent_response':
          // Logged via transcript events
          break;

        case 'error':
          console.error(`[ElevenLabs] Error:`, msg);
          break;
      }
    } catch (err) {
      console.error('[ElevenLabs] Failed to parse message:', err);
    }
  });

  elWs.on('close', () => {
    console.log(`[ElevenLabs] Connection closed for call ${callSid}`);
    safeClose();
  });

  elWs.on('error', (err) => {
    console.error(`[ElevenLabs] WebSocket error:`, err);
    safeClose();
  });

  // Handle incoming Twilio messages and forward audio to ElevenLabs
  twilioWs.on('message', (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.event) {
        case 'start':
          streamSid = msg.start.streamSid;
          console.log(`[Twilio] Stream started: ${streamSid}`);
          break;

        case 'media':
          // Forward audio from Twilio to ElevenLabs
          if (elWs.readyState === WebSocket.OPEN && msg.media?.payload) {
            const elMsg = {
              user_audio_chunk: msg.media.payload,
            };
            elWs.send(JSON.stringify(elMsg));
          }
          break;

        case 'stop':
          console.log(`[Twilio] Stream stopped`);
          safeClose();
          break;
      }
    } catch (err) {
      console.error('[Twilio] Failed to parse message:', err);
    }
  });

  twilioWs.on('close', () => {
    console.log(`[Twilio] WebSocket closed for call ${callSid}`);
    safeClose();
  });

  twilioWs.on('error', (err) => {
    console.error(`[Twilio] WebSocket error:`, err);
    safeClose();
  });

  return { elWs };
}

export { createElevenLabsBridge };
