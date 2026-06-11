const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseList } = require('../scripts/batch-call');

function writeTmp(contents) {
  const file = path.join(os.tmpdir(), `numbers-${process.pid}-${Math.floor(performance.now())}.txt`);
  fs.writeFileSync(file, contents);
  return file;
}

test('parses numbers, applies default persona, and adds +', () => {
  const file = writeTmp('14155551234\n+18005550199\n');
  const entries = parseList(file, 'tyler');
  fs.unlinkSync(file);
  assert.deepStrictEqual(entries, [
    { phoneNumber: '+14155551234', persona: 'tyler' },
    { phoneNumber: '+18005550199', persona: 'tyler' },
  ]);
});

test('per-line persona override wins over default', () => {
  const file = writeTmp('+18005550199   margaret\n');
  const entries = parseList(file, 'tyler');
  fs.unlinkSync(file);
  assert.strictEqual(entries[0].persona, 'margaret');
});

test('skips comments, blank lines, and invalid numbers', () => {
  const file = writeTmp('# header comment\n\nnot-a-number\n+14155551234  # trailing comment\n');
  const entries = parseList(file, 'tyler');
  fs.unlinkSync(file);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].phoneNumber, '+14155551234');
});
