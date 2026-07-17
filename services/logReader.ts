import fs from 'fs';
import path from 'path';
import type { ConversationLog } from '../types';

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs', 'conversations');

/** A stored conversation plus the file it came from. */
export type StoredConversation = ConversationLog & { file: string };

export interface PersonaStat {
  calls: number;
  seconds: number;
}

export interface DashboardStats {
  totalCalls: number;
  totalSeconds: number;
  byPersona: Record<string, PersonaStat>;
  byDirection: { inbound: number; outbound: number };
}

/**
 * Read every saved conversation log, newest first. Malformed files are skipped
 * rather than crashing the dashboard.
 */
function readConversations(): StoredConversation[] {
  if (!fs.existsSync(LOGS_DIR)) return [];

  const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.json'));
  const convos: StoredConversation[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, file), 'utf8')) as ConversationLog;
      convos.push({ file, ...data });
    } catch (err) {
      console.error(`[logReader] Skipping ${file}:`, (err as Error).message);
    }
  }
  convos.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return convos;
}

/**
 * Aggregate stats across all conversations: total time wasted, call counts,
 * and a per-persona breakdown.
 */
function computeStats(convos: StoredConversation[]): DashboardStats {
  const stats: DashboardStats = {
    totalCalls: convos.length,
    totalSeconds: 0,
    byPersona: {},
    byDirection: { inbound: 0, outbound: 0 },
  };

  for (const c of convos) {
    // Sessions that never connected (failed/no-answer: a non-completed status,
    // no transcript, no duration) wasted nobody's time — keep them out of the
    // headline numbers so a batch of unanswered dials doesn't inflate counts.
    const neverConnected =
      c.status && c.status !== 'completed' &&
      !(c.transcript && c.transcript.length) &&
      !Number(c.duration_seconds);
    if (neverConnected) {
      stats.totalCalls -= 1;
      continue;
    }

    const secs = Number(c.duration_seconds) || 0;
    stats.totalSeconds += secs;

    const p = c.persona || 'unknown';
    if (!stats.byPersona[p]) stats.byPersona[p] = { calls: 0, seconds: 0 };
    stats.byPersona[p].calls += 1;
    stats.byPersona[p].seconds += secs;

    if (c.direction === 'outbound') stats.byDirection.outbound += 1;
    else stats.byDirection.inbound += 1;
  }

  return stats;
}

export { readConversations, computeStats, LOGS_DIR };
