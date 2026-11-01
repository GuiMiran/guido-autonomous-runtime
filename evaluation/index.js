'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('JSON data required.');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const digest = value => sha256(canonical(value));
const exact = (value, keys) => value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const HASH = /^[a-f0-9]{64}$/;
const IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;

function validateRequest(request, approval, payload, now = Date.now()) {
  if (!exact(request, ['schemaVersion', 'purpose', 'requestId', 'candidateSha256', 'inputSha256', 'image', 'limits']) ||
      request.schemaVersion !== 1 || request.purpose !== 'isolated-evaluation' ||
      typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(request.requestId) ||
      typeof request.candidateSha256 !== 'string' || !HASH.test(request.candidateSha256) ||
      typeof request.inputSha256 !== 'string' || !HASH.test(request.inputSha256) || typeof request.image !== 'string' || !IMAGE.test(request.image) ||
      !exact(request.limits, ['timeoutMs', 'maxOutputBytes']) ||
      !Number.isInteger(request.limits.timeoutMs) || request.limits.timeoutMs < 100 || request.limits.timeoutMs > 30000 ||
      !Number.isInteger(request.limits.maxOutputBytes) || request.limits.maxOutputBytes < 1024 || request.limits.maxOutputBytes > 65536) {
    throw new Error('Invalid execution request.');
  }
  if (!exact(approval, ['schemaVersion', 'requestHash', 'approvedBy', 'expiresAt']) || approval.schemaVersion !== 1 ||
      approval.requestHash !== digest(request) || typeof approval.approvedBy !== 'string' || !approval.approvedBy.trim() ||
      approval.approvedBy.length > 120 || typeof approval.expiresAt !== 'string' || !Number.isFinite(Date.parse(approval.expiresAt)) ||
      Date.parse(approval.expiresAt) <= now || Date.parse(approval.expiresAt) > now + 86400000) throw new Error('Invalid host approval.');
  if (!exact(payload, ['candidateSource', 'input']) || typeof payload.candidateSource !== 'string' || !payload.candidateSource.trim() ||
      Buffer.byteLength(payload.candidateSource) > 65536 || sha256(payload.candidateSource) !== request.candidateSha256 ||
      Buffer.byteLength(canonical(payload.input)) > 65536 || digest(payload.input) !== request.inputSha256) {
    throw new Error('Payload digest mismatch.');
  }
  return { requestHash: digest(request), inputText: canonical(payload.input) };
}

function runClient(args, { timeoutMs = 5000, maxBytes = 65536 } = {}) {
  return new Promise(resolve => {
    const stdout = [], stderr = [];
    let bytes = 0, reason = null, settled = false;
    const child = spawn('docker', args, { shell: false, env: { PATH: process.env.PATH || '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = code => {
      if (settled) return; settled = true; clearTimeout(timer);
      // Decode once: pipe chunks can split a multi-byte UTF-8 character.
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), reason });
    };
    const stop = why => { reason = reason || why; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { stop('OUTPUT_LIMIT'); return; }
      (key === 'stdout' ? stdout : stderr).push(chunk);
    });
    child.on('error', () => { reason = 'UNAVAILABLE'; finish(null); });
    child.on('close', finish);
  });
}

function createArgs(request, stage, name) {
  if (/[\n,]/.test(stage)) throw new Error('Unsafe temporary mount path.');
  return ['create', '--name', name, '--pull=never', '--network=none', '--read-only', '--user=65534:65534',
    '--cap-drop=ALL', '--security-opt=no-new-privileges=true', '--ipc=none', '--pids-limit=32',
    '--memory=128m', '--memory-swap=128m', '--cpus=0.5', '--ulimit=nofile=64:64',
    '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m', '--mount', `type=bind,source=${stage},target=/candidate,readonly`,
    '--workdir=/candidate', '--env=NODE_OPTIONS=', '--entrypoint=/usr/local/bin/node', request.image, '/candidate/entry.cjs'];
}

const ENTRY = `'use strict';
const fs = require('node:fs');
const run = require('/candidate/candidate.cjs');
if (typeof run !== 'function') process.exit(65);
Promise.resolve().then(() => run(JSON.parse(fs.readFileSync('/candidate/input.json', 'utf8'))))
  .then(value => { if (value === undefined) process.exit(65); process.stdout.write(JSON.stringify({value})); })
  .catch(() => { process.exitCode = 65; });
`;

async function executeCandidate(request, approval, payload, options = {}, dependencies = {}) {
  let requestHash;
  let validated;
  try {
    request = JSON.parse(canonical(request)); approval = JSON.parse(canonical(approval)); payload = JSON.parse(canonical(payload));
    validated = validateRequest(request, approval, payload); requestHash = validated.requestHash;
  }
  catch { return { schemaVersion: 1, status: 'DENIED', requestHash: null }; }
  const base = { schemaVersion: 1, requestHash, image: request.image };
  if (options.enabled !== true) return { ...base, status: 'UNAVAILABLE' };
  const client = dependencies.client || runClient; // Trusted host seam for unit tests, never candidate-controlled.
  let stage, name, result = { ...base, status: 'INFRA_ERROR' }, cleanupConfirmed = false;
  try {
    const available = await client(['version', '--format', '{{.Server.Version}}']);
    if (available.code !== 0 || available.reason) return { ...base, status: 'UNAVAILABLE' };
    stage = fs.mkdtempSync(path.join(os.tmpdir(), 'guido-candidate-')); fs.chmodSync(stage, 0o755);
    fs.writeFileSync(path.join(stage, 'candidate.cjs'), payload.candidateSource, { mode: 0o444, flag: 'wx' });
    fs.writeFileSync(path.join(stage, 'input.json'), validated.inputText, { mode: 0o444, flag: 'wx' });
    fs.writeFileSync(path.join(stage, 'entry.cjs'), ENTRY, { mode: 0o444, flag: 'wx' });
    name = `guido-eval-${crypto.randomUUID()}`;
    const created = await client(createArgs(request, stage, name));
    if (created.code !== 0 || created.reason || !/^[a-f0-9]{64}\s*$/.test(created.stdout)) {
      result = { ...base, status: 'INFRA_ERROR' };
    } else {
      const ran = await client(['start', '--attach', name], { timeoutMs: request.limits.timeoutMs, maxBytes: request.limits.maxOutputBytes });
      if (ran.reason) result = { ...base, status: ['TIMEOUT', 'OUTPUT_LIMIT'].includes(ran.reason) ? ran.reason : 'INFRA_ERROR' };
      else {
        const inspection = await client(['inspect', '--format', '{{json .State}}', name]);
        const state = inspection.code === 0 && !inspection.reason ? JSON.parse(inspection.stdout) : null;
        if (!state || state.Running !== false || !Number.isInteger(state.ExitCode) || state.ExitCode < 0 || typeof state.OOMKilled !== 'boolean') {
          result = { ...base, status: 'INFRA_ERROR' };
        } else if (state.OOMKilled) result = { ...base, status: 'RESOURCE_LIMIT' };
        else if (state.ExitCode !== 0) result = { ...base, status: 'CANDIDATE_ERROR' };
        else if (ran.code !== 0) result = { ...base, status: 'INFRA_ERROR' };
        else {
          try {
            const parsed = JSON.parse(ran.stdout);
            if (!exact(parsed, ['value'])) throw new Error('Invalid output.');
            const outputHash = digest(parsed.value);
            result = { ...base, status: 'COMPLETED', output: parsed.value, outputHash };
          } catch { result = { ...base, status: 'CANDIDATE_ERROR' }; }
        }
      }
    }
  } catch { result = { ...base, status: 'INFRA_ERROR' }; }
  finally {
    if (name) {
      try {
        const removed = await client(['rm', '--force', name]);
        cleanupConfirmed = removed.code === 0 || (removed.code === 1 && !removed.reason &&
          (removed.stderr.includes(`No such container: ${name}`) || removed.stderr.includes(`No such object: ${name}`)));
      } catch { cleanupConfirmed = false; }
    }
    if (stage) {
      try { fs.rmSync(stage, { recursive: true, force: true }); }
      catch { cleanupConfirmed = false; result = { ...base, status: 'INFRA_ERROR' }; }
    }
  }
  if (name && !cleanupConfirmed) return { ...base, status: 'INFRA_ERROR', cleanupConfirmed: false };
  return { ...result, cleanupConfirmed };
}

module.exports = { executeCandidate, validateRequest, createArgs, canonical, digest, sha256 };
