require('dotenv').config();
const WebSocket = require('ws');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

/**
 * Creates a WebSocket connection to ElevenLabs Conversational AI and bridges it
 * with the Twilio Media Stream WebSocket.
 *
 * @param {WebSocket} twilioWs - The WebSocket connection from Twilio
 * @param {object} opts - Options
 * @param {string} opts.callSid - Twilio call SID
 * @param {string} opts.streamSid - Twilio stream SID
 * @param {string} opts.agentId - ElevenLabs agent ID (defaults to env var)
 * @param {function} opts.onTranscript - Called with { speaker, text } on transcript events
 * @param {function} opts.onEnd - Called when the conversation ends
 */
function createElevenLabsBridge(twilioWs, opts = {}) {
  const {
    callSid,
    agentId = ELEVENLABS_AGENT_ID,
    onTranscript,
    onEnd,
  } = opts;

  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
  const headers = ELEVENLABS_API_KEY
    ? { 'xi-api-key': ELEVENLABS_API_KEY }
    : {};

  const elWs = new WebSocket(wsUrl, { headers });

  let streamSid = null;
  let isClosed = false;

  function safeClose() {
    if (!isClosed) {
      isClosed = true;
      if (elWs.readyState === WebSocket.OPEN) elWs.close();
      if (onEnd) onEnd();
    }
  }

  elWs.on('open', () => {
    console.log(`[ElevenLabs] Connected for call ${callSid}`);
  });

  elWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

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
  twilioWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

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

module.exports = { createElevenLabsBridge };
