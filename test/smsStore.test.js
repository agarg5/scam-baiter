const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { getHistory, appendTurn, SMS_DIR } = require('../services/smsStore');

// Use a unique fake number so we never touch real conversation files.
const NUM = `+1999000${process.pid % 10000}`.padEnd(12, '0').slice(0, 12);
const FILE = path.join(SMS_DIR, `${NUM.replace(/[^\d+]/g, '')}.json`);

after(() => {
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
});

test('new number starts with empty history', () => {
  assert.deepStrictEqual(getHistory(NUM), []);
});

test('appendTurn records user+assistant and persists to disk', () => {
  appendTurn(NUM, 'tyler', 'hello there', 'uh, who is this?');
  const history = getHistory(NUM);
  assert.deepStrictEqual(history, [
    { role: 'user', content: 'hello there' },
    { role: 'assistant', content: 'uh, who is this?' },
  ]);

  assert.ok(fs.existsSync(FILE), 'history file should be written');
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.strictEqual(saved.persona, 'tyler');
  assert.strictEqual(saved.messages.length, 2);
});

test('history is capped at the most recent turns', () => {
  for (let i = 0; i < 40; i++) {
    appendTurn(NUM, 'tyler', `q${i}`, `a${i}`);
  }
  const history = getHistory(NUM);
  assert.ok(history.length <= 40, `expected <=40, got ${history.length}`);
  // The very first message should have been evicted.
  assert.notStrictEqual(history[0].content, 'hello there');
});
