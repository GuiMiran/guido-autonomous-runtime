import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelInference } from '../src/inference.js';
import { createApp } from '../src/server.js';
import { composeRepositoryGoal } from '../src/repository-catalog.js';

const token = 'minimum-24-char-test-token-only';
test('native Ollama adapter sets a single CPU thread, low context and output cap', async () => {
  let observed;
  const inference = createModelInference({
    modelProvider: 'ollama', model: 'qwen2.5:0.5b',
    modelUrl: 'http://guido-model.railway.internal:11434/api/generate',
    fetchImpl: async (url, options) => {
      observed = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ response: 'Verified evidence first.' }) };
    }
  });
  assert.equal(await inference('Review one SPECTRA spec.'), 'Verified evidence first.');
  assert.equal(observed.body.options.num_thread, 1);
  assert.equal(observed.body.options.num_ctx, 1536);
  assert.equal(observed.body.options.num_predict, 128);
  assert.equal(observed.body.stream, false);
  assert.equal(observed.options.headers.authorization, undefined);
});
test('native inference rejects empty or excessively long content', async () => {
  const infer = createModelInference({
    modelProvider: 'ollama',
    fetchImpl: async () => ({ ok: true, json: async () => ({ response: '' }) })
  });
  await assert.rejects(infer('Some plan'), /EMPTY_MODEL_RESPONSE/);
  await assert.rejects(infer('z'.repeat(3001)), /MODEL_INPUT_OUT_OF_BOUNDS/);
});
test('repo evidence prompt stays bounded and explicitly marks partial excerpts', () => {
  const prompt = composeRepositoryGoal(
    'Review CobrarServicio and report gaps.',
    { context: 'FILE .spectra/00-vision.md\nCobrarServicio: pago suficiente, ticket, cambio.\n' + 'A'.repeat(9000) }
  );
  assert.ok(prompt.length <= 2900);
  assert.match(prompt, /CobrarServicio/);
  assert.match(prompt, /REMAINDER OMITTED/);
  assert.match(prompt, /partial excerpts/);
});
test('idempotency key survives process restarts and rejects mismatched payload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guido-idempotent-'));
  const opts = {
    token, statePath: join(dir, 'tasks.jsonl'), auditPath: join(dir, 'audit.jsonl'),
    inference: async () => 'A review plan'
  };
  const app = createApp(opts);
  const addr = await app.start(0);
  const url = 'http://127.0.0.1:' + addr.port + '/v1/tasks';
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'idempotency-key': 'gastroflow-smoke-v1' };
  const submit = (goal) => fetch(url, { method: 'POST', headers, body: JSON.stringify({goal}) });
  let id;
  try {
    const first = await submit('Analyze GastroFlow');
    assert.equal(first.status, 202);
    id = (await first.json()).id;
    const again = await submit('Analyze GastroFlow');
    assert.equal(again.status, 200);
    assert.equal((await again.json()).id, id);
    const conflict = await submit('Different request');
    assert.equal(conflict.status, 409);
  } finally {
    await new Promise(ok => app.server.close(ok));
  }
  const restarted = createApp(opts);
  const next = await restarted.start(0);
  try {
    const again = await fetch('http://127.0.0.1:' + next.port + '/v1/tasks', {
      method: 'POST', headers, body: JSON.stringify({goal:'Analyze GastroFlow'})
    });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).id, id);
  } finally { await new Promise(ok => restarted.server.close(ok)); }
});
test('source retrieval failures get a distinct code, without invoking inference', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guido-source-fail-'));
  let inferenceCalled = false;
  const app = createApp({
    token, statePath: join(dir, 'tasks.jsonl'), auditPath: join(dir, 'audit.jsonl'),
    repositoryLoader: async () => { throw new Error('network error with sensitive details'); },
    inference: async () => { inferenceCalled = true; return 'wrong'; }
  });
  const addr = await app.start(0);
  try {
    const response = await fetch('http://127.0.0.1:' + addr.port + '/v1/tasks', {
      method: 'POST',
      headers: { authorization:'Bearer '+token, 'content-type':'application/json' },
      body: JSON.stringify({ goal:'Review',repository:'GastroFlow' })
    });
    const { id } = await response.json();
    await app.tick();
    assert.equal(app.getTask(id).errorCode, 'SOURCE_READ_FAILED');
    assert.equal(inferenceCalled, false);
    assert.doesNotMatch(JSON.stringify(app.getTask(id)), /sensitive details/);
  } finally { await new Promise(ok => app.server.close(ok)); }
});
