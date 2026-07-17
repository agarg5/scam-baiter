import 'dotenv/config';
import type { Persona, ConversationTurn, ConversationLog, Direction } from '../types';

const VB_API_KEY = process.env.VOCAL_BRIDGE_API_KEY;
const VB_API_URL = (process.env.VOCAL_BRIDGE_API_URL || 'https://vocalbridgeai.com').replace(/\/$/, '');
const VB_TIMEOUT_MS = Number(process.env.VOCAL_BRIDGE_TIMEOUT_MS) || 15000;

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

/**
 * Single VB HTTP entry point: auth headers, a deadline that covers the FULL
 * request (headers AND body — a provider that returns 200 then stalls the body
 * would otherwise hang the caller forever), and uniform error reporting.
 */
async function vbRequest<T>(
  path: string,
  agentId: string,
  init: RequestInit = {},
  label = path
): Promise<T> {
  if (!VB_API_KEY) {
    throw new Error('VOCAL_BRIDGE_API_KEY is not set');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VB_TIMEOUT_MS);
  try {
    const res = await fetch(`${VB_API_URL}${path}`, {
      ...init,
      headers: {
        'X-API-Key': VB_API_KEY,
        'X-Agent-Id': agentId,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`VB ${label} failed (${res.status}): ${bodyText}`);
    }
    return JSON.parse(bodyText) as T;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`VB ${label} timed out after ${VB_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Persona ids may contain characters that are invalid in env var names
 * (e.g. "irs-agent"), so non-alphanumerics map to underscores.
 */
function envKeyFor(persona: Persona): string {
  return `VOCALBRIDGE_AGENT_${persona.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/**
 * Resolves the VB agent ID for a given persona. Each persona maps to a
 * separate VB agent, stored as VOCALBRIDGE_AGENT_<PERSONA_ID> in the
 * environment, or as the persona's `vbAgentId` field.
 *
 * A VB agent has exactly one prompt, but our personas distinguish inbound
 * (systemPrompt) from outbound (outboundPrompt, which adds an opener). To keep
 * that behavior, an optional VOCALBRIDGE_AGENT_<PERSONA_ID>_OUTBOUND var can
 * point outbound calls at a second agent configured with the outbound prompt;
 * without it, both directions use the same agent.
 */
function resolveAgentId(persona: Persona, direction?: Direction): string {
  const envKey = envKeyFor(persona);

  if (direction === 'outbound') {
    const outbound = process.env[`${envKey}_OUTBOUND`];
    if (outbound) return outbound;
  }

  if (persona.vbAgentId) return persona.vbAgentId;

  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;

  const fallback = process.env.VOCALBRIDGE_DEFAULT_AGENT_ID;
  if (fallback) return fallback;

  throw new Error(
    `No VB agent ID for persona "${persona.id}". ` +
    `Set ${envKey} or persona.vbAgentId, or set VOCALBRIDGE_DEFAULT_AGENT_ID as a fallback.`
  );
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
  const agentId = resolveAgentId(persona, 'outbound');

  const body: Record<string, string> = { phone_number: phoneNumber };
  if (participantName) body.participant_name = participantName;

  return vbRequest<VBCallResult>('/api/v1/calls', agentId, {
    method: 'POST',
    body: JSON.stringify(body),
  }, 'placeCall');
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

  const data = await vbRequest<Record<string, unknown>>(`/api/v1/logs${qs}`, agentId, {}, 'getCallLogs');
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
  return vbRequest<VBLogEntry>(
    `/api/v1/logs/${encodeURIComponent(sessionId)}`,
    agentId,
    {},
    'getCallTranscript'
  );
}

/**
 * VB transcript timestamps arrive as bare numbers with no documented unit.
 * Values below 1e12 can only be epoch seconds (1e12 ms is 2001, and no VB call
 * predates the service), so scale them; larger values are already ms.
 */
function turnTimestamp(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return new Date().toISOString();
  return new Date(ts < 1e12 ? ts * 1000 : ts).toISOString();
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
    timestamp: turnTimestamp(t.timestamp),
  }));

  return {
    id: entry.session_id,
    timestamp: entry.created_at || new Date().toISOString(),
    direction,
    scammerNumber: entry.phone_number || 'unknown',
    ourNumber: undefined,
    duration_seconds: entry.duration_seconds || 0,
    status: entry.status,
    transcript,
    persona: persona.id,
  };
}

export {
  placeCall,
  getCallLogs,
  getCallTranscript,
  resolveAgentId,
  toConversationLog,
};
export type { VBCallResult, VBLogEntry };
