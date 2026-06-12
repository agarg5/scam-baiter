import { test } from 'node:test';
import assert from 'node:assert';
import type { Request, Response } from 'express';

// Configure secrets BEFORE loading the module (it reads env at load time), so
// we require() it here rather than using a hoisted import.
process.env.API_SECRET = 'top-secret-key';
delete process.env.WS_TOKEN; // exercise the "unset = allow" path
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requireApiKey, validateStreamToken, safeEqual } = require('../services/security') as typeof import('../services/security');

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(obj: unknown): MockRes;
}

function mockReqRes(headers: Record<string, string> = {}): { req: Request; res: MockRes } {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const req = { get: (h: string) => lower[h.toLowerCase()] } as unknown as Request;
  const res: MockRes = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(obj: unknown) { this.body = obj; return this; },
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
  requireApiKey(req, res as unknown as Response, () => { nexted = true; });
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 401);
});

test('requireApiKey accepts the correct X-Api-Key header', () => {
  const { req, res } = mockReqRes({ 'X-Api-Key': 'top-secret-key' });
  let nexted = false;
  requireApiKey(req, res as unknown as Response, () => { nexted = true; });
  assert.strictEqual(nexted, true);
});

test('requireApiKey accepts a Bearer token', () => {
  const { req, res } = mockReqRes({ Authorization: 'Bearer top-secret-key' });
  let nexted = false;
  requireApiKey(req, res as unknown as Response, () => { nexted = true; });
  assert.strictEqual(nexted, true);
});

test('validateStreamToken allows any connection when WS_TOKEN is unset', () => {
  assert.strictEqual(validateStreamToken(undefined), true);
  assert.strictEqual(validateStreamToken('anything'), true);
});
