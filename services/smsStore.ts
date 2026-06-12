import fs from 'fs';
import path from 'path';
import type { ChatMessage } from './openai';

/**
 * File-backed SMS conversation history, keyed by phone number.
 *
 * SMS scams play out over days, so an in-memory map that resets on every
 * restart loses the thread mid-conversation. This persists each number's
 * history as JSON under logs/sms/ and keeps a small in-memory cache so the
 * hot path doesn't hit disk on every message.
 */

const SMS_DIR = path.join(__dirname, '..', '..', 'logs', 'sms');
const MAX_TURNS = 40; // keep the last N messages per number

if (!fs.existsSync(SMS_DIR)) {
  fs.mkdirSync(SMS_DIR, { recursive: true });
}

const cache = new Map<string, ChatMessage[]>();

// A phone number maps to one file; strip anything that isn't a digit or '+'.
function fileFor(number: string): string {
  const safe = String(number).replace(/[^\d+]/g, '') || 'unknown';
  return path.join(SMS_DIR, `${safe}.json`);
}

function getHistory(number: string): ChatMessage[] {
  const cached = cache.get(number);
  if (cached) return cached;

  let history: ChatMessage[] = [];
  const file = fileFor(number);
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed.messages)) history = parsed.messages;
    } catch (err) {
      console.error(`[smsStore] Could not read ${file}:`, (err as Error).message);
    }
  }
  cache.set(number, history);
  return history;
}

function appendTurn(
  number: string,
  persona: string,
  userText: string,
  assistantText: string
): ChatMessage[] {
  const history = getHistory(number);
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: assistantText });

  while (history.length > MAX_TURNS) history.shift();

  const file = fileFor(number);
  const record = {
    number,
    persona,
    updated: new Date().toISOString(),
    messages: history,
  };
  try {
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
  } catch (err) {
    console.error(`[smsStore] Could not write ${file}:`, (err as Error).message);
  }
  return history;
}

export { getHistory, appendTurn, SMS_DIR };
