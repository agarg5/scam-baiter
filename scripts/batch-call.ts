#!/usr/bin/env node
/**
 * Batch dialer — calls every number in a list, spaced by a delay.
 *
 * Usage:
 *   node dist/scripts/batch-call.js <path-to-list> [--persona tyler] [--delay 30]
 *
 * List file format: one number per line. Blank lines and lines starting with
 * `#` are ignored. A line can optionally override the persona like:
 *
 *   +14155551234
 *   +18005550199   margaret   # trailing comment
 *   # this is a comment
 *
 * Calls go directly through VocalBridge's REST API — the server does not need
 * to be running.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

export interface CallEntry {
  phoneNumber: string;
  persona: string;
}

/**
 * Parse a numbers list file into call entries. Blank lines and `#` comments are
 * ignored; an optional second token on a line overrides the persona.
 * Exported so it can be unit-tested.
 */
function parseList(file: string, defaultPersona = 'tyler'): CallEntry[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const entries: CallEntry[] = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [number, persona] = line.split(/\s+/);
    if (!/^\+?\d{7,15}$/.test(number)) {
      console.warn(`[batch] Skipping invalid number: "${number}"`);
      continue;
    }
    entries.push({ phoneNumber: number.startsWith('+') ? number : `+${number}`, persona: persona || defaultPersona });
  }
  return entries;
}

async function placeCallViaVB({ phoneNumber, persona }: CallEntry): Promise<Record<string, unknown>> {
  const vb = await import('../services/vocalbridge');
  const { getPersona } = await import('../prompts/personas');
  const chosen = getPersona(persona);
  const result = await vb.placeCall(phoneNumber, chosen);
  return result as unknown as Record<string, unknown>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith('--')) {
    console.error('Usage: node dist/scripts/batch-call.js <list-file> [--persona X] [--delay N]');
    process.exit(1);
  }

  const listPath = path.resolve(args[0]);
  const flags = Object.fromEntries(
    args.slice(1).reduce<[string, string][]>((acc, a, i, arr) => {
      if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
      return acc;
    }, [])
  );

  const defaultPersona = flags.persona || process.env.DEFAULT_PERSONA || 'tyler';
  const delaySec = parseInt(flags.delay || '30', 10);

  const entries = parseList(listPath, defaultPersona);
  console.log(`[batch] Loaded ${entries.length} numbers from ${listPath}`);
  console.log(`[batch] Delay: ${delaySec}s  Default persona: ${defaultPersona}`);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    console.log(`\n[batch] (${i + 1}/${entries.length}) → ${entry.phoneNumber} as ${entry.persona}`);
    try {
      const r = await placeCallViaVB(entry);
      console.log(`[batch]   OK`, JSON.stringify(r));
    } catch (err) {
      console.error(`[batch]   FAIL: ${(err as Error).message}`);
    }
    if (i < entries.length - 1) {
      console.log(`[batch]   sleeping ${delaySec}s…`);
      await sleep(delaySec * 1000);
    }
  }
  console.log('\n[batch] Done.');
}

export { parseList };

if (require.main === module) {
  main();
}
