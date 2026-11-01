'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { executeCandidate, digest, sha256 } = require('..');

const image = process.env.GUIDO_EVAL_IMAGE;
assert.match(image || '', /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/, 'An explicitly pinned local image is required; integration must not silently skip.');
execFileSync('docker', ['version'], { stdio: 'ignore', timeout: 10000 });
const containers = () => execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 10000 })
  .trim().split('\n').filter(name => name.startsWith('guido-eval-')).sort();
async function execute(source, input, limits = { timeoutMs: 10000, maxOutputBytes: 8192 }) {
  const before = containers();
  const stages = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('guido-candidate-')).sort();
  const request = { schemaVersion: 1, purpose: 'isolated-evaluation', requestId: `ci-${crypto.randomUUID()}`,
    candidateSha256: sha256(source), inputSha256: digest(input), image, limits };
  const approval = { schemaVersion: 1, requestHash: digest(request), approvedBy: 'synthetic-ci-fixture',
    expiresAt: new Date(Date.now() + 60000).toISOString() };
  const receipt = await executeCandidate(request, approval, { candidateSource: source, input }, { enabled: true });
  assert.deepEqual(containers(), before, 'No execution container survives the receipt.');
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('guido-candidate-')).sort(), stages, 'Staging files are removed.');
  assert.equal(receipt.cleanupConfirmed, true);
  assert.equal(receipt.requestHash, digest(request)); assert.equal(receipt.image, image);
  return receipt;
}
test('real Docker executes a synthetic candidate and binds output', async () => {
  const r = await execute('module.exports = x => x.a + x.b;', { a: 19, b: 23 });
  assert.equal(r.status, 'COMPLETED'); assert.equal(r.output, 42); assert.equal(r.outputHash, digest(42));
});
test('candidate cannot see host canary/environment, alter mounted/root files, or use host networking', async t => {
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guido-host-only-'));
  const canary = path.join(hostDir, 'canary.txt'); fs.writeFileSync(canary, crypto.randomUUID());
  const prior = process.env.GUIDO_HOST_ONLY_CANARY; process.env.GUIDO_HOST_ONLY_CANARY = 'host-only-secret';
  t.after(() => { fs.rmSync(hostDir, { recursive: true, force: true }); if (prior === undefined) delete process.env.GUIDO_HOST_ONLY_CANARY; else process.env.GUIDO_HOST_ONLY_CANARY = prior; });
  const source = `const fs=require('node:fs'),os=require('node:os');
module.exports = input => {
const read = p => {try {return fs.readFileSync(p,'utf8').trim()}catch {return null}};
const blocked = p => {try {fs.writeFileSync(p,'not-allowed');return false}catch{return true}};
const status=read('/proc/self/status');
return {uid:process.getuid(), files:fs.readdirSync('/candidate').sort(),
hostFileAbsent:!fs.existsSync(input.hostFile), hostSecretAbsent:process.env.GUIDO_HOST_ONLY_CANARY===undefined,
candidateReadOnly:blocked('/candidate/candidate.cjs'),rootReadOnly:blocked('/etc/guido-probe'),
interfaces:Object.keys(os.networkInterfaces()),noNewPrivileges:/NoNewPrivs:\\s+1/.test(status),
noCapabilities:/CapEff:\\s+0+/.test(status),memory:read('/sys/fs/cgroup/memory.max'),
pids:read('/sys/fs/cgroup/pids.max'),cpu:read('/sys/fs/cgroup/cpu.max')};};`;
  const r = await execute(source, { hostFile: canary }); assert.equal(r.status, 'COMPLETED');
  assert.equal(r.output.uid, 65534);
  assert.deepEqual(r.output.files, ['candidate.cjs', 'entry.cjs', 'input.json']);
  for (const key of ['hostFileAbsent', 'hostSecretAbsent', 'candidateReadOnly', 'rootReadOnly', 'noNewPrivileges', 'noCapabilities']) assert.equal(r.output[key], true, key);
  assert.ok(r.output.interfaces.every(name => name === 'lo'));
  assert.equal(r.output.memory, '134217728'); assert.equal(r.output.pids, '32');
  const [quota, period] = r.output.cpu.split(' ').map(Number); assert.equal(quota / period, 0.5);
});
test('candidate error is not infrastructure success', async () => {
  const r = await execute('module.exports = () => {throw Error("synthetic failure")};', null);
  assert.equal(r.status, 'CANDIDATE_ERROR'); assert.equal('output' in r, false);
});
test('UTF-8 output split across pipe chunks preserves the actual JSON value', async () => {
  const source = `module.exports = () => new Promise(() => {
const bytes=Buffer.from(JSON.stringify({value:'€'}));
process.stdout.write(bytes.subarray(0,11));
setTimeout(()=>{process.stdout.write(bytes.subarray(11));process.exit(0)},50);
});`;
  const r = await execute(source, null);
  assert.equal(r.status, 'COMPLETED'); assert.equal(r.output, '€'); assert.equal(r.outputHash, digest('€'));
});
test('wall timeout stops and removes a bounded busy-loop candidate', async () => {
  const r = await execute('module.exports = () => {while(true){}};', null, { timeoutMs: 1000, maxOutputBytes: 1024 });
  assert.equal(r.status, 'TIMEOUT');
});
test('output bound stops and removes a noisy synthetic candidate', async () => {
  const r = await execute('module.exports = () => {process.stdout.write("x".repeat(100000));return 1;};', null, { timeoutMs: 10000, maxOutputBytes: 1024 });
  assert.equal(r.status, 'OUTPUT_LIMIT');
});
