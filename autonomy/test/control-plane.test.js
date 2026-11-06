import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { decide } from '../src/policy.js';

const token = 'test-only-token-at-least-24-characters';
const boot = async (inference = async () => 'Proposed plan: verify independently.') => {
  const dir = mkdtempSync(join(tmpdir(), 'guido-autonomy-'));
  const app = createApp({ token, inference, statePath: join(dir, 'tasks.jsonl'), auditPath: join(dir, 'audit.jsonl') });
  const addr = await app.start(0);
  return { app, dir, url: 'http://127.0.0.1:' + addr.port };
};
const request = (url, path, options = {}) => fetch(url + path, {
  ...options, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...options.headers }
});
test('policy is fail closed, including privilege escalation and unknown tools', () => {
  assert.equal(decide('shell.execute', { ownerAuthenticated: true }).allowed, false);
  assert.equal(decide('policy.modify', { ownerAuthenticated: true }).allowed, false);
  assert.equal(decide('unknown.tool', { ownerAuthenticated: true }).allowed, false);
  assert.equal(decide('task.submit', { ownerAuthenticated: false }).allowed, false);
  assert.equal(decide('task.submit', { ownerAuthenticated: true }).allowed, true);
});
test('unauthenticated clients cannot submit work', async () => {
  const { app, url } = await boot();
  try {
    const res = await fetch(url + '/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'test' }) });
    assert.equal(res.status, 401);
  } finally { app.server.close(); }
});
test('task is persisted, planned, and audited without tools', async () => {
  const { app, url, dir } = await boot();
  try {
    const res = await request(url, '/v1/tasks', { method: 'POST', body: JSON.stringify({ goal: 'Inspect safe test coverage' }) });
    assert.equal(res.status, 202);
    const { id } = await res.json();
    await app.tick();
    const item = await (await request(url, '/v1/tasks/' + id)).json();
    assert.equal(item.status, 'completed');
    assert.match(item.plan, /verify independently/);
    const audit = readFileSync(join(dir, 'audit.jsonl'), 'utf8');
    assert.match(audit, /task.completed/);
    assert.doesNotMatch(audit, /Inspect safe test coverage/);
  } finally { app.server.close(); }
});
test('model failures do not become verified success', async () => {
  const { app, url } = await boot(async () => { throw new Error('secret upstream failure'); });
  try {
    const { id } = await (await request(url, '/v1/tasks', { method: 'POST', body: JSON.stringify({ goal: 'Check failures' }) })).json();
    await app.tick();
    const item = await (await request(url, '/v1/tasks/' + id)).json();
    assert.equal(item.status, 'failed');
    assert.equal(item.errorCode, 'INFERENCE_FAILED');
    assert.doesNotMatch(JSON.stringify(item), /secret upstream/);
  } finally { app.server.close(); }
});
