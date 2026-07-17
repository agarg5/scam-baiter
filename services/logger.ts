import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ConversationLog } from '../types';

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs', 'conversations');

// Ensure the log directory exists at startup
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Persist an already-built ConversationLog verbatim, preserving its
 * duration_seconds, timestamp, and transcript.
 *
 * The filename is derived deterministically from the log id, so re-writing the
 * same log (e.g. re-running the VocalBridge sync) overwrites the existing file
 * instead of creating a duplicate. One exception: `direction` is not stored by
 * the provider — it's a label the operator supplies at sync time — so if the
 * file already exists its original direction wins, otherwise a later sync run
 * with a different ?direction= would silently relabel every prior call.
 */
async function writeConversationLog(log: ConversationLog): Promise<string> {
  const rawId = String(log.id);
  // VB session IDs are UUIDs and pass through verbatim (readable, one file per
  // session). For anything with characters that aren't filename-safe, fall back
  // to a hash of the full id — collision-free and free of path-traversal chars —
  // rather than lossy character replacement, which could map distinct ids to the
  // same file and silently overwrite a log.
  const safeId = /^[A-Za-z0-9_-]+$/.test(rawId)
    ? rawId
    : crypto.createHash('sha256').update(rawId).digest('hex').slice(0, 32);
  const filename = `vb-${safeId}.json`;
  const filepath = path.join(LOGS_DIR, filename);

  let toWrite = log;
  try {
    const existing = JSON.parse(await fs.promises.readFile(filepath, 'utf8')) as ConversationLog;
    if (existing.direction) toWrite = { ...log, direction: existing.direction };
  } catch {
    // No existing file (or unreadable) — write as-is.
  }

  // async so a multi-session sync doesn't block the event loop per file
  await fs.promises.writeFile(filepath, JSON.stringify(toWrite, null, 2));
  console.log(`[Logger] Wrote conversation log: ${filename}`);
  return filepath;
}

export { writeConversationLog };
