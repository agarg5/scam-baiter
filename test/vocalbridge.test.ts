import { test } from 'node:test';
import assert from 'node:assert';
import type { Persona, ConversationLog } from '../types';

// Set env vars before loading the module
process.env.VOCALBRIDGE_AGENT_TYLER = 'test-agent-tyler-uuid';
process.env.VOCALBRIDGE_DEFAULT_AGENT_ID = 'test-default-agent-uuid';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveAgentId, toConversationLog } = require('../services/vocalbridge') as typeof import('../services/vocalbridge');

const tyler: Persona = {
  id: 'tyler',
  name: 'Tyler Bennett',
  description: 'Test persona',
  voiceId: null,
  systemPrompt: 'test prompt',
  outboundPrompt: 'test outbound',
};

const custom: Persona = {
  id: 'custom',
  name: 'Custom',
  description: 'Custom persona with vbAgentId',
  voiceId: null,
  vbAgentId: 'inline-agent-uuid',
  systemPrompt: 'test',
  outboundPrompt: 'test',
};

test('resolveAgentId returns persona vbAgentId when set', () => {
  assert.strictEqual(resolveAgentId(custom), 'inline-agent-uuid');
});

test('resolveAgentId falls back to VOCALBRIDGE_AGENT_<ID> env var', () => {
  assert.strictEqual(resolveAgentId(tyler), 'test-agent-tyler-uuid');
});

test('resolveAgentId falls back to VOCALBRIDGE_DEFAULT_AGENT_ID', () => {
  const unknown: Persona = {
    id: 'unknown',
    name: 'Unknown',
    description: '',
    voiceId: null,
    systemPrompt: '',
    outboundPrompt: '',
  };
  assert.strictEqual(resolveAgentId(unknown), 'test-default-agent-uuid');
});

test('resolveAgentId throws when no mapping exists', () => {
  delete process.env.VOCALBRIDGE_DEFAULT_AGENT_ID;
  const orphan: Persona = {
    id: 'orphan',
    name: 'Orphan',
    description: '',
    voiceId: null,
    systemPrompt: '',
    outboundPrompt: '',
  };
  assert.throws(() => resolveAgentId(orphan), /No VB agent ID/);
  // Restore for other tests
  process.env.VOCALBRIDGE_DEFAULT_AGENT_ID = 'test-default-agent-uuid';
});

test('toConversationLog converts VB log entry to local format', () => {
  const vbEntry = {
    session_id: 'sess-123',
    status: 'completed',
    created_at: '2026-06-21T12:00:00Z',
    duration_seconds: 120,
    phone_number: '+15551234567',
    transcript: [
      { role: 'user', text: 'Hello?', timestamp: 1719000000000 },
      { role: 'agent', text: 'Uh, who is this?', timestamp: 1719000005000 },
    ],
  };

  const log: ConversationLog = toConversationLog(vbEntry, tyler, 'outbound');

  assert.strictEqual(log.id, 'sess-123');
  assert.strictEqual(log.persona, 'tyler');
  assert.strictEqual(log.direction, 'outbound');
  assert.strictEqual(log.scammerNumber, '+15551234567');
  assert.strictEqual(log.duration_seconds, 120);
  assert.strictEqual(log.transcript.length, 2);
  assert.strictEqual(log.transcript[0].speaker, 'scammer');
  assert.strictEqual(log.transcript[1].speaker, 'agent');
});
