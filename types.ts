// Shared domain types.

/** A single character the bot plays on a call. One per file in prompts/. */
export interface Persona {
  /** URL-safe key used in ?persona=… and the API. */
  id: string;
  /** Display name. */
  name: string;
  /** One-liner for dashboards / logs. */
  description: string;
  /**
   * Vocal Bridge agent UUID that runs this persona's voice calls.
   * Can also be set via the VOCALBRIDGE_AGENT_<ID> env var.
   */
  vbAgentId?: string;
  /** Inbound prompt (they call us). */
  systemPrompt: string;
  /** Outbound prompt (we call them) — usually adds an opener. */
  outboundPrompt: string;
}

/** The dashboard-facing subset of a persona (no prompt bodies). */
export type PersonaSummary = Pick<Persona, 'id' | 'name' | 'description'>;

export type Speaker = 'scammer' | 'agent';

export interface ConversationTurn {
  speaker: Speaker;
  text: string;
  timestamp: string;
}

export interface ConversationLog {
  id: string;
  timestamp: string;
  direction: string;
  scammerNumber: string;
  ourNumber?: string;
  duration_seconds: number;
  transcript: ConversationTurn[];
  persona: string;
}

export type Direction = 'inbound' | 'outbound';
