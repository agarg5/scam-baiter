const { test } = require('node:test');
const assert = require('node:assert');

// Configure secrets BEFORE requiring the module (it reads env at load time).
process.env.API_SECRET = 'top-secret-key';
delete process.env.WS_TOKEN; // exercise the "unset = allow" path
const { requireApiKey, validateStreamToken, safeEqual } = require('../services/security');

function mockReqRes(headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const req = { get: (h) => lower[h.toLowerCase()] };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return { req, res };
}

test('safeEqual is true for equal strings, false otherwise', () => {
  assert.strictEqual(safeEqual('abc', 'abc'), true);
  assert.strictEqual(safeEqual('abc', 'abd'), false);
  assert.strictEqual(safeEqual('abc', 'abcd'), false);
});

test('requireApiKey rejects a missing key', () => {
  const { req, res } = mockReqRes();
  let nexted = false;
  requireApiKey(req, res, () => { nexted = true; });
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 401);
});

test('requireApiKey accepts the correct X-Api-Key header', () => {
  const { req, res } = mockReqRes({ 'X-Api-Key': 'top-secret-key' });
  let nexted = false;
  requireApiKey(req, res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
});

test('requireApiKey accepts a Bearer token', () => {
  const { req, res } = mockReqRes({ Authorization: 'Bearer top-secret-key' });
  let nexted = false;
  requireApiKey(req, res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
});

test('validateStreamToken allows any connection when WS_TOKEN is unset', () => {
  assert.strictEqual(validateStreamToken(undefined), true);
  assert.strictEqual(validateStreamToken('anything'), true);
});
