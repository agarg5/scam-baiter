import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ConversationLog, ConversationTurn } from '../types';

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs', 'conversations');

// Ensure the log directory exists at startup
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export interface ConversationLogger {
  log: ConversationLog;
  addTurn(turn: ConversationTurn): void;
  save(): string;
}

interface CreateLogOptions {
  direction: string;
  scammerNumber: string;
  ourNumber?: string;
  persona?: string;
}

/**
 * Creates a new conversation log entry and returns a logger object.
 */
function createConversationLog({
  direction,
  scammerNumber,
  ourNumber,
  persona = 'margaret',
}: CreateLogOptions): ConversationLogger {
  const id = uuidv4();
  const startTime = new Date();
  const transcript: ConversationTurn[] = [];

  const log: ConversationLog = {
    id,
    timestamp: startTime.toISOString(),
    direction,
    scammerNumber,
    ourNumber,
    duration_seconds: 0,
    transcript,
    persona,
  };

  function addTurn({ speaker, text, timestamp }: ConversationTurn): void {
    transcript.push({ speaker, text, timestamp: timestamp || new Date().toISOString() });
  }

  function save(): string {
    const endTime = new Date();
    log.duration_seconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    const filename = `${startTime.toISOString().replace(/[:.]/g, '-')}_${id.slice(0, 8)}.json`;
    const filepath = path.join(LOGS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(log, null, 2));
    console.log(`[Logger] Saved conversation log: ${filename}`);
    return filepath;
  }

  return { log, addTurn, save };
}

/**
 * Persist an already-built ConversationLog verbatim, preserving its
 * duration_seconds, timestamp, and transcript (unlike createConversationLog,
 * which derives duration from wall-clock time at save).
 *
 * The filename is derived deterministically from the log id, so re-writing the
 * same log (e.g. re-running the VocalBridge sync) overwrites the existing file
 * instead of creating a duplicate.
 */
function writeConversationLog(log: ConversationLog): string {
  const safeId = String(log.id).replace(/[^a-zA-Z0-9_-]/g, '-');
  const filename = `vb-${safeId}.json`;
  const filepath = path.join(LOGS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(log, null, 2));
  console.log(`[Logger] Wrote conversation log: ${filename}`);
  return filepath;
}

export { createConversationLog, writeConversationLog };
