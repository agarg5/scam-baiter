import 'dotenv/config';
import type { Persona, ConversationTurn, ConversationLog, Direction } from '../types';

const VB_API_KEY = process.env.VOCAL_BRIDGE_API_KEY;
const VB_API_URL = (process.env.VOCAL_BRIDGE_API_URL || 'https://vocalbridgeai.com').replace(/\/$/, '');

interface VBCallResult {
  call_id: string;
  destination: string;
  status: string;
  room_name?: string;
  livekit_url?: string;
}

interface VBLogEntry {
  session_id: string;
  status: string;
  created_at: string;
  duration_seconds?: number;
  phone_number?: string;
  participant_name?: string;
  transcript?: Array<{ role: string; text: string; timestamp?: number }>;
}

interface VBTokenResponse {
  url: string;
  token: string;
  room_name: string;
  participant_identity: string;
  expires_in: number;
  agent_mode?: string;
  livekit_url?: string;
}

/**
 * Resolves the VB agent ID for a given persona. Each persona maps to a
 * separate VB agent, stored as VOCALBRIDGE_AGENT_<PERSONA_ID> in the
 * environment, or as the persona's `vbAgentId` field.
 */
function resolveAgentId(persona: Persona): string {
  if (persona.vbAgentId) return persona.vbAgentId;

  const envKey = `VOCALBRIDGE_AGENT_${persona.id.toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;

  const fallback = process.env.VOCALBRIDGE_DEFAULT_AGENT_ID;
  if (fallback) return fallback;

  throw new Error(
    `No VB agent ID for persona "${persona.id}". ` +
    `Set ${envKey} or persona.vbAgentId, or set VOCALBRIDGE_DEFAULT_AGENT_ID as a fallback.`
  );
}

function headers(agentId: string): Record<string, string> {
  if (!VB_API_KEY) {
    throw new Error('VOCAL_BRIDGE_API_KEY is not set');
  }
  return {
    'X-API-Key': VB_API_KEY,
    'X-Agent-Id': agentId,
    'Content-Type': 'application/json',
  };
}

/**
 * Place an outbound phone call through Vocal Bridge. The VB agent (identified
 * by the persona's agent mapping) dials the number, runs the conversation with
 * its configured prompt, and streams the transcript.
 */
async function placeCall(
  phoneNumber: string,
  persona: Persona,
  participantName?: string
): Promise<VBCallResult> {
  const agentId = resolveAgentId(persona);

  const body: Record<string, string> = { phone_number: phoneNumber };
  if (participantName) body.participant_name = participantName;

  const res = await fetch(`${VB_API_URL}/api/v1/calls`, {
    method: 'POST',
    headers: headers(agentId),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`VB placeCall failed (${res.status}): ${detail}`);
  }

  return res.json() as Promise<VBCallResult>;
}

/**
 * Generate a short-lived connection token for a VB voice session. Used when
 * a client (e.g. a web dashboard) wants to connect to the agent via WebRTC.
 */
async function generateToken(
  persona: Persona,
  participantName = 'User'
): Promise<VBTokenResponse> {
  const agentId = resolveAgentId(persona);

  const res = await fetch(`${VB_API_URL}/api/v1/token`, {
    method: 'POST',
    headers: headers(agentId),
    body: JSON.stringify({ participant_name: participantName }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`VB generateToken failed (${res.status}): ${detail}`);
  }

  return res.json() as Promise<VBTokenResponse>;
}

/**
 * Fetch recent call logs from Vocal Bridge for a given agent/persona.
 */
async function getCallLogs(
  persona: Persona,
  opts: { limit?: number; status?: string } = {}
): Promise<VBLogEntry[]> {
  const agentId = resolveAgentId(persona);
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', String(opts.status));
  const qs = params.toString() ? `?${params}` : '';

  const res = await fetch(`${VB_API_URL}/api/v1/logs${qs}`, {
    headers: headers(agentId),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`VB getCallLogs failed (${res.status}): ${detail}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return (data.logs || data.sessions || []) as VBLogEntry[];
}

/**
 * Fetch the transcript and details for a single call session.
 */
async function getCallTranscript(
  sessionId: string,
  persona: Persona
): Promise<VBLogEntry> {
  const agentId = resolveAgentId(persona);

  const res = await fetch(`${VB_API_URL}/api/v1/logs/${encodeURIComponent(sessionId)}`, {
    headers: headers(agentId),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`VB getCallTranscript failed (${res.status}): ${detail}`);
  }

  return res.json() as Promise<VBLogEntry>;
}

/**
 * Convert a VB log entry into our local ConversationLog format so the
 * dashboard and log reader work unchanged.
 */
function toConversationLog(
  entry: VBLogEntry,
  persona: Persona,
  direction: Direction = 'outbound'
): ConversationLog {
  const transcript: ConversationTurn[] = (entry.transcript || []).map((t) => ({
    speaker: t.role === 'user' ? 'scammer' : 'agent',
    text: t.text,
    timestamp: t.timestamp
      ? new Date(t.timestamp).toISOString()
      : new Date().toISOString(),
  }));

  return {
    id: entry.session_id,
    timestamp: entry.created_at || new Date().toISOString(),
    direction,
    scammerNumber: entry.phone_number || 'unknown',
    ourNumber: undefined,
    duration_seconds: entry.duration_seconds || 0,
    transcript,
    persona: persona.id,
  };
}

export {
  placeCall,
  generateToken,
  getCallLogs,
  getCallTranscript,
  resolveAgentId,
  toConversationLog,
};
export type { VBCallResult, VBLogEntry, VBTokenResponse };
