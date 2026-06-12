import { test } from 'node:test';
import assert from 'node:assert';
import { getPersona, listPersonas, PERSONAS } from '../prompts/personas';

test('ships at least the two documented personas', () => {
  assert.ok(PERSONAS.tyler, 'tyler persona should load');
  assert.ok(PERSONAS.margaret, 'margaret persona should load');
});

test('getPersona returns the requested persona', () => {
  assert.strictEqual(getPersona('margaret').id, 'margaret');
});

test('getPersona falls back for unknown ids instead of returning undefined', () => {
  const p = getPersona('does-not-exist');
  assert.ok(p && p.id, 'should return some valid persona');
});

test('every persona exposes the fields the bridge depends on', () => {
  for (const p of Object.values(PERSONAS)) {
    assert.ok(p.id, 'id');
    assert.ok(p.systemPrompt, `${p.id} systemPrompt`);
    assert.ok(p.outboundPrompt, `${p.id} outboundPrompt`);
  }
});

test('listPersonas returns summary objects without prompt bodies', () => {
  const list = listPersonas();
  assert.ok(Array.isArray(list));
  for (const item of list) {
    assert.ok(item.id && item.name);
    assert.strictEqual((item as Record<string, unknown>).systemPrompt, undefined, 'should not leak full prompt');
  }
});
