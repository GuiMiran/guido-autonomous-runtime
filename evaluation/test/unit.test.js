'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { executeCandidate, validateRequest, canonical, digest, sha256 } = require('..');

const IMAGE = `node@sha256:${'a'.repeat(64)}`;
function fixture() {
  const payload = { candidateSource: 'module.exports = input => input.x + 1;', input: { x: 41 } };
  const request = { schemaVersion: 1, purpose: 'isolated-evaluation', requestId: 'unit-1',
    candidateSha256: sha256(payload.candidateSource), inputSha256: digest(payload.input),
    image: IMAGE, limits: { timeoutMs: 1000, maxOutputBytes: 1024 } };
  const approval = { schemaVersion: 1, requestHash: digest(request), approvedBy: 'trusted-test-host',
    expiresAt: new Date(Date.now() + 60000).toISOString() };
  return { payload, request, approval };
}
function docker(overrides = {}) {
  const calls = []; let stage;
  const client = async (args, limits) => {
    calls.push({ args, limits });
    if (args[0] === 'create') {
      stage = args[args.indexOf('--mount') + 1].split('source=')[1].split(',target=')[0];
      assert.deepEqual(fs.readdirSync(stage).sort(), ['candidate.cjs', 'entry.cjs', 'input.json']);
      for (const name of fs.readdirSync(stage)) assert.equal(fs.statSync(path.join(stage, name)).mode & 0o777, 0o444);
    }
    const defaults = { version: { code: 0, stdout: '28.0.0', stderr: '' },
      create: { code: 0, stdout: 'b'.repeat(64), stderr: '' },
      start: { code: 0, stdout: '{"value":42}', stderr: 'PRIVATE_DIAGNOSTIC' },
      inspect: { code: 0, stdout: JSON.stringify({ Running: false, ExitCode: 0, OOMKilled: false }), stderr: '' },
      rm: { code: 0, stdout: '', stderr: '' } };
    const value = overrides[args[0]] || defaults[args[0]];
    if (typeof value === 'function') return value(args);
    return value;
  };
  return { client, calls, get stage() { return stage; } };
}
async function run(overrides = {}, options = { enabled: true }) {
  const f = fixture(), fake = docker(overrides);
  const receipt = await executeCandidate(f.request, f.approval, f.payload, options, { client: fake.client });
  return { receipt, fake, ...f };
}

test('canonical request hashes ignore object key ordering and reject non-JSON values', () => {
  assert.equal(digest({ b: 2, a: [null, true] }), digest({ a: [null, true], b: 2 }));
  for (const value of [undefined, Infinity, NaN, new Date()]) assert.throws(() => canonical(value));
});
test('valid approval binds the exact request and payload', () => {
  const f = fixture(); assert.equal(validateRequest(f.request, f.approval, f.payload).requestHash, digest(f.request));
});
test('denial paths never invoke Docker', async t => {
  const mutations = {
    'missing approval': f => { f.approval = null; },
    'expired approval': f => { f.approval.expiresAt = '2000-01-01T00:00:00Z'; },
    'approval too long lived': f => { f.approval.expiresAt = new Date(Date.now() + 172800000).toISOString(); },
    'approval hash mismatch': f => { f.approval.requestHash = '0'.repeat(64); },
    'empty approver': f => { f.approval.approvedBy = ' '; },
    'source changed': f => { f.payload.candidateSource += ' '; },
    'input changed': f => { f.payload.input.x = 40; },
    'mutable image tag': f => { f.request.image = 'node:24'; },
    'additional mount field': f => { f.request.mounts = ['/']; },
    'additional environment': f => { f.payload.env = { TOKEN: 'secret' }; },
    'timeout ceiling': f => { f.request.limits.timeoutMs = 30001; },
    'output ceiling': f => { f.request.limits.maxOutputBytes = 65537; },
    'non-JSON input': f => { f.payload.input = NaN; }
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const f = fixture(); mutate(f); let calls = 0;
    const receipt = await executeCandidate(f.request, f.approval, f.payload, { enabled: true }, { client: () => { calls++; } });
    assert.equal(receipt.status, 'DENIED'); assert.equal(calls, 0);
  });
});
test('execution is disabled by default, with no host fallback', async () => {
  const { receipt, fake } = await run({}, {}); assert.equal(receipt.status, 'UNAVAILABLE'); assert.equal(fake.calls.length, 0);
});
test('missing Docker returns UNAVAILABLE without staging or fallback', async () => {
  const { receipt, fake } = await run({ version: { code: null, reason: 'UNAVAILABLE' } });
  assert.equal(receipt.status, 'UNAVAILABLE'); assert.deepEqual(fake.calls.map(c => c.args[0]), ['version']); assert.equal(fake.stage, undefined);
});
test('successful execution stages only payload, enforces policy and cleans up', async () => {
  const { receipt, fake, request } = await run();
  assert.equal(receipt.status, 'COMPLETED'); assert.equal(receipt.output, 42); assert.equal(receipt.outputHash, digest(42));
  assert.equal(receipt.requestHash, digest(request)); assert.equal(receipt.cleanupConfirmed, true);
  const args = fake.calls.find(c => c.args[0] === 'create').args;
  for (const flag of ['--pull=never', '--network=none', '--read-only', '--user=65534:65534', '--cap-drop=ALL',
    '--security-opt=no-new-privileges=true', '--ipc=none', '--pids-limit=32', '--memory=128m', '--memory-swap=128m',
    '--cpus=0.5', '--ulimit=nofile=64:64', '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m', '--env=NODE_OPTIONS=']) assert.ok(args.includes(flag), flag);
  assert.equal(args.filter(a => a === '--mount').length, 1);
  assert.ok(args[args.indexOf('--mount') + 1].endsWith(',target=/candidate,readonly'));
  assert.deepEqual(args.slice(-2), [IMAGE, '/candidate/entry.cjs']);
  assert.equal(fs.existsSync(fake.stage), false);
  const name = args[args.indexOf('--name') + 1]; assert.match(name, /^guido-eval-[a-f0-9-]+$/);
  assert.deepEqual(fake.calls.at(-1).args, ['rm', '--force', name]);
  assert.deepEqual(fake.calls.find(c => c.args[0] === 'start').limits, { timeoutMs: 1000, maxBytes: 1024 });
  assert.equal(JSON.stringify(receipt).includes('PRIVATE_DIAGNOSTIC'), false);
});
test('container outcomes, infrastructure failures and cleanup are distinct', async t => {
  const state = (ExitCode, OOMKilled = false) => ({ code: 0, stdout: JSON.stringify({ Running: false, ExitCode, OOMKilled }) });
  const cases = [
    ['candidate exits nonzero', { start: { code: 65, stdout: '' }, inspect: state(65) }, 'CANDIDATE_ERROR'],
    ['OOM', { start: { code: 137 }, inspect: state(137, true) }, 'RESOURCE_LIMIT'],
    ['wall timeout', { start: { code: null, reason: 'TIMEOUT' } }, 'TIMEOUT'],
    ['output bound', { start: { code: null, reason: 'OUTPUT_LIMIT' } }, 'OUTPUT_LIMIT'],
    ['malformed output', { start: { code: 0, stdout: 'PRIVATE_RAW_OUTPUT' } }, 'CANDIDATE_ERROR'],
    ['extra output fields', { start: { code: 0, stdout: '{"value":42,"extra":1}' } }, 'CANDIDATE_ERROR'],
    ['missing image/create failure', { create: { code: 1, stdout: '', stderr: 'no image' } }, 'INFRA_ERROR'],
    ['invalid inspection', { inspect: { code: 0, stdout: '{}' } }, 'INFRA_ERROR'],
    ['Docker client failure', { start: { code: 1, stdout: '{"value":42}' } }, 'INFRA_ERROR'],
    ['cleanup failure', { rm: { code: 1, stderr: 'permission denied' } }, 'INFRA_ERROR']
  ];
  for (const [name, overrides, status] of cases) await t.test(name, async () => {
    const { receipt, fake } = await run(overrides);
    assert.equal(receipt.status, status); assert.equal('output' in receipt, false);
    assert.equal(receipt.cleanupConfirmed, name !== 'cleanup failure'); assert.equal(fs.existsSync(fake.stage), false);
    assert.equal(JSON.stringify(receipt).includes('PRIVATE_RAW_OUTPUT'), false);
  });
});
test('already absent exact container is confirmed, unrelated removal errors are not', async () => {
  const { receipt } = await run({ rm: args => ({ code: 1, stderr: `Error: No such container: ${args[2]}` }) });
  assert.equal(receipt.status, 'COMPLETED'); assert.equal(receipt.cleanupConfirmed, true);
});
