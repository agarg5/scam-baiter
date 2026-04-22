#!/usr/bin/env node
/**
 * Batch dialer — calls every number in a list, spaced by a delay.
 *
 * Usage:
 *   node scripts/batch-call.js <path-to-list> [--persona tyler] [--delay 30] [--host https://foo.ngrok.io]
 *
 * List file format: one number per line. Blank lines and lines starting with
 * `#` are ignored. A line can optionally override the persona like:
 *
 *   +14155551234
 *   +18005550199   margaret   # trailing comment
 *   # this is a comment
 *
 * The script POSTs to the running server's /api/call endpoint, so the server
 * must be up and publicly reachable (cloudflared / ngrok / deployed).
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('--')) {
  console.error('Usage: node scripts/batch-call.js <list-file> [--persona X] [--delay N] [--host URL]');
  process.exit(1);
}

const listPath = path.resolve(args[0]);
const flags = Object.fromEntries(
  args.slice(1).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const defaultPersona = flags.persona || process.env.DEFAULT_PERSONA || 'tyler';
const delaySec = parseInt(flags.delay || '30', 10);
const host = flags.host || process.env.PUBLIC_HOST || `http://localhost:${process.env.PORT || 8000}`;

function parseList(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const entries = [];
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

async function placeCall({ phoneNumber, persona }) {
  const res = await fetch(`${host}/api/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, persona }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const entries = parseList(listPath);
  console.log(`[batch] Loaded ${entries.length} numbers from ${listPath}`);
  console.log(`[batch] Host: ${host}  Delay: ${delaySec}s  Default persona: ${defaultPersona}`);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    console.log(`\n[batch] (${i + 1}/${entries.length}) → ${entry.phoneNumber} as ${entry.persona}`);
    try {
      const r = await placeCall(entry);
      console.log(`[batch]   OK callSid=${r.callSid}`);
    } catch (err) {
      console.error(`[batch]   FAIL: ${err.message}`);
    }
    if (i < entries.length - 1) {
      console.log(`[batch]   sleeping ${delaySec}s…`);
      await sleep(delaySec * 1000);
    }
  }
  console.log('\n[batch] Done.');
})();
