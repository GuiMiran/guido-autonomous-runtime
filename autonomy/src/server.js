import http from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decide } from './policy.js';
import { createModelInference } from './inference.js';
import { repositoryList, loadRepositoryContext, composeRepositoryGoal, REPOSITORIES } from './repository-catalog.js';

const MAX_BYTES = 8192;
const MAX_QUEUE = 100;
const digest = s => createHash('sha256').update(s).digest('hex');
const writeLine = (path, item) => appendFileSync(path, JSON.stringify(item) + '\n', { mode: 0o600 });
const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
};
const sameToken = (given, expected) => {
  if (!given || !expected) return false;
  const a = Buffer.from(digest(given), 'hex'), b = Buffer.from(digest(expected), 'hex');
  return timingSafeEqual(a, b);
};
const readBody = async req => {
  let chunks = [], size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
function loadTasks(path) {
  const tasks = new Map();
  if (!existsSync(path)) return tasks;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === 'task') tasks.set(event.task.id, event.task);
    if (event.type === 'update' && tasks.has(event.id)) {
      tasks.set(event.id, { ...tasks.get(event.id), ...event.patch });
    }
  }
  // A crash may interrupt an inference call. Requeue safely: planning has no external effects.
  for (const task of tasks.values()) if (task.status === 'running') task.status = 'queued';
  return tasks;
}
export function createApp(config) {
  const token = config.token;
  if (!token || token.length < 24) throw new Error('GUIDO_API_TOKEN must be at least 24 characters');
  const statePath = resolve(config.statePath ?? './data/tasks.jsonl');
  const auditPath = resolve(config.auditPath ?? './data/audit.jsonl');
  mkdirSync(dirname(statePath), { recursive: true });
  mkdirSync(dirname(auditPath), { recursive: true });
  const tasks = loadTasks(statePath);
  const audit = (event, details = {}) => writeLine(auditPath, { id: randomUUID(), at: new Date().toISOString(), event, ...details });
  let busy = false;
  const update = (id, patch) => {
    tasks.set(id, { ...tasks.get(id), ...patch });
    writeLine(statePath, { type: 'update', id, patch });
  };
  const repositoryLoader = config.repositoryLoader ?? loadRepositoryContext;
  const inference = config.inference ?? createModelInference({
    modelUrl: config.modelUrl,
    modelToken: config.modelToken,
    model: config.model,
    modelProvider: config.modelProvider,
    fetchImpl: config.modelFetch,
    timeoutMs: config.modelTimeoutMs
  });
  async function tick() {
    if (busy) return;
    const task = [...tasks.values()].find(t => t.status === 'queued');
    if (!task) return;
    busy = true;
    update(task.id, { status: 'running', updatedAt: new Date().toISOString() });
    audit('task.running', { taskId: task.id });
    try {
      let source = null;
      if (task.repository) {
        try {
          source = await repositoryLoader(task.repository);
          update(task.id, { sourceRevision: source.revision, evidence: source.evidence });
          audit('repository.read', { taskId: task.id, repository: source.repository, revision: source.revision, evidence: source.evidence });
        } catch {
          update(task.id, { status: 'failed', errorCode: 'SOURCE_READ_FAILED', updatedAt: new Date().toISOString() });
          audit('task.failed', { taskId: task.id, errorCode: 'SOURCE_READ_FAILED' });
          return;
        }
      }
      const prompt = source ? composeRepositoryGoal(task.goal, source) : task.goal;
      try {
        const plan = await inference(prompt);
        update(task.id, { status: 'completed', plan, updatedAt: new Date().toISOString() });
        audit('task.completed', { taskId: task.id, planSha256: digest(plan) });
      } catch {
        update(task.id, { status: 'failed', errorCode: 'INFERENCE_FAILED', updatedAt: new Date().toISOString() });
        audit('task.failed', { taskId: task.id, errorCode: 'INFERENCE_FAILED' });
      }
    } finally { busy = false; }
  }
  const handler = async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
    const provided = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!sameToken(provided, token)) {
      audit('auth.denied', { path: pathname });
      return json(res, 401, { error: 'UNAUTHENTICATED' });
    }
    if (pathname === '/v1/repositories' && req.method === 'GET') {
      return json(res, 200, { repositories: repositoryList() });
    }
    if (pathname === '/v1/tasks' && req.method === 'GET') {
      const policy = decide('task.list', { ownerAuthenticated: true });
      if (!policy.allowed) return json(res, 403, { error: policy.reason });
      return json(res, 200, { tasks: [...tasks.values()].map(({ goal, plan, ...t }) => t) });
    }
    const match = /^\/v1\/tasks\/([0-9a-f-]{36})$/.exec(pathname);
    if (match && req.method === 'GET') {
      const policy = decide('task.read', { ownerAuthenticated: true });
      if (!policy.allowed) return json(res, 403, { error: policy.reason });
      const task = tasks.get(match[1]);
      return task ? json(res, 200, task) : json(res, 404, { error: 'NOT_FOUND' });
    }
    if (pathname === '/v1/tasks' && req.method === 'POST') {
      if (!decide('task.submit', { ownerAuthenticated: true }).allowed) return json(res, 403, { error: 'DENIED' });
      let body;
      try { body = await readBody(req); } catch { return json(res, 400, { error: 'INVALID_BODY' }); }
      if (!body || typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 4000)
        return json(res, 400, { error: 'INVALID_GOAL' });
      if (body.repository !== undefined && (typeof body.repository !== 'string' || !Object.hasOwn(REPOSITORIES, body.repository)))
        return json(res, 400, { error: 'REPOSITORY_NOT_ALLOWLISTED' });
      const key = req.headers['idempotency-key'];
      if (key !== undefined && (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key)))
        return json(res, 400, { error: 'INVALID_IDEMPOTENCY_KEY' });
      if (key !== undefined) {
        const existing = [...tasks.values()].find(t => t.idempotencyKey === key);
        if (existing) {
          if (existing.goal !== body.goal.trim() || (existing.repository ?? null) !== (body.repository ?? null))
            return json(res, 409, { error: 'IDEMPOTENCY_CONFLICT' });
          return json(res, 200, { id: existing.id, status: existing.status, reused: true });
        }
      }
      if ([...tasks.values()].filter(t => ['queued','running'].includes(t.status)).length >= MAX_QUEUE)
        return json(res, 429, { error: 'QUEUE_FULL' });
      const now = new Date().toISOString();
      const task = { id: randomUUID(), goal: body.goal.trim(), ...(body.repository ? { repository: body.repository } : {}), ...(key ? { idempotencyKey: key } : {}), status: 'queued', createdAt: now, updatedAt: now };
      tasks.set(task.id, task);
      writeLine(statePath, { type: 'task', task });
      audit('task.submitted', { taskId: task.id, goalSha256: digest(task.goal) });
      return json(res, 202, { id: task.id, status: task.status });
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  };
  const server = http.createServer((req, res) => { handler(req, res).catch(() => json(res, 500, { error: 'INTERNAL_ERROR' })); });
  const start = async (port = 8787, host = '127.0.0.1') => {
    await new Promise(resolveReady => server.listen(port, host, resolveReady));
    const interval = setInterval(() => tick().catch(() => {}), 1000);
    interval.unref();
    server.on('close', () => clearInterval(interval));
    return server.address();
  };
  return { server, start, tick, getTask: id => tasks.get(id) };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const app = createApp({
    token: process.env.GUIDO_API_TOKEN,
    modelUrl: process.env.GUIDO_MODEL_URL,
    modelToken: process.env.GUIDO_MODEL_TOKEN,
    model: process.env.GUIDO_MODEL,
    modelProvider: process.env.GUIDO_MODEL_PROVIDER,
    statePath: process.env.GUIDO_STATE_PATH,
    auditPath: process.env.GUIDO_AUDIT_PATH
  });
  app.start(Number(process.env.PORT ?? 8787), process.env.HOST ?? '127.0.0.1').then(addr => {
    process.stdout.write('GUIDO control plane listening on ' + JSON.stringify(addr) + '\n');
  });
}
