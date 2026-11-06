import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

const token = 'test-token-should-never-be-used-live';
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'guido-repo-agent-'));
  const prompts = [];
  const app = createApp({
    token, statePath: join(dir, 'tasks.jsonl'), auditPath: join(dir, 'audit.jsonl'),
    repositoryLoader: async id => ({
      repository: id, revision: 'a'.repeat(40),
      evidence: [{ path: '.spectra/00-vision.md', sha256: 'b'.repeat(64), bytes: 11 }],
      context: 'INVARIANT: do not merge without tests'
    }),
    inference: async prompt => { prompts.push(prompt); return 'Read-only assessment: verify INV-001'; }
  });
  const address = await app.start(0);
  const base = 'http://127.0.0.1:' + address.port;
  const headers = { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' };
  return { dir, prompts, app, base, headers };
}
test('repository task uses allowlisted context, audit evidence, and never executes it', async () => {
  const { dir, prompts, app, base, headers } = await boot();
  try {
    const created = await fetch(base + '/v1/tasks', {
      method: 'POST', headers,
      body: JSON.stringify({ goal: 'Review SPECTRA invariants', repository: 'GastroFlow' })
    });
    assert.equal(created.status, 202);
    const { id } = await created.json();
    await app.tick();
    const item = await (await fetch(base + '/v1/tasks/' + id, { headers })).json();
    assert.equal(item.status, 'completed');
    assert.equal(item.repository, 'GastroFlow');
    assert.match(prompts[0], /INVARIANT: do not merge without tests/);
    assert.match(prompts[0], /UNTRUSTED REPOSITORY DOCUMENTS/);
    const audit = readFileSync(join(dir, 'audit.jsonl'), 'utf8');
    assert.match(audit, /repository.read/);
    assert.match(audit, /a{40}/);
  } finally { app.server.close(); }
});
test('rejects unallowlisted repo before queueing and requires owner auth to list', async () => {
  const { app, base, headers } = await boot();
  try {
    const invalid = await fetch(base + '/v1/tasks', {
      method: 'POST', headers,
      body: JSON.stringify({ goal: 'Read repo', repository: 'someone/unknown' })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'REPOSITORY_NOT_ALLOWLISTED');
    const unauthed = await fetch(base + '/v1/repositories');
    assert.equal(unauthed.status, 401);
    const approved = await (await fetch(base + '/v1/repositories', { headers })).json();
    assert.ok(approved.repositories.some(r => r.id === 'GastroFlow'));
  } finally { app.server.close(); }
});
test('unavailable source fails instead of inventing evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guido-failclosed-'));
  let called = false;
  const app = createApp({
    token, statePath: join(dir, 'tasks.jsonl'), auditPath: join(dir, 'audit.jsonl'),
    repositoryLoader: async () => { throw new Error('private source inaccessible'); },
    inference: async () => { called = true; return 'should not happen'; }
  });
  const a = await app.start(0);
  const url = 'http://127.0.0.1:' + a.port;
  try {
    const response = await fetch(url + '/v1/tasks', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Review', repository: 'spectra' })
    });
    const { id } = await response.json();
    await app.tick();
    assert.equal(app.getTask(id).status, 'failed');
    assert.equal(called, false);
    assert.doesNotMatch(JSON.stringify(app.getTask(id)), /private source inaccessible/);
  } finally { app.server.close(); }
});
