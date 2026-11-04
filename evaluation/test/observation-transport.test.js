'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { attachObservationTransport } = require('../observation-transport');

function client() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    killed: false, kill() { this.killed = true; },
  });
  return child;
}
const receive = bytes => JSON.parse(bytes).finish ? { observation: { trusted: true } } : { reply: { ok: true } };

test('joins split frames and only releases verifier observation after clean exit', async () => {
  const c = client(), replies = [];
  c.stdin.on('data', x => replies.push(String(x)));
  const done = attachObservationTransport(c, receive);
  c.stdout.write('{"fin');
  c.stdout.write('ish":false}\n{"finish":true}\n');
  c.emit('close', 0);
  assert.deepEqual(await done, { status: 'COMPLETED', observation: { trusted: true } });
  assert.deepEqual(replies, ['{"ok":true}\n']);
});

test('drops observation for trailing data, missing finish, or failed exit', async () => {
  for (const [stdout, code] of [['{"finish":true}\nx', 0], ['{}\n', 0], ['{"finish":true}\n', 1]]) {
    const c = client(), done = attachObservationTransport(c, receive);
    c.stdout.write(stdout);
    c.emit('close', code);
    assert.deepEqual(await done, { status: 'PROTOCOL_ERROR' });
  }
});

test('bounds pending frame and combined stdout/stderr', async () => {
  const c = client(), done = attachObservationTransport(c, receive);
  c.stdout.write(Buffer.alloc(4097));
  assert.deepEqual(await done, { status: 'PROTOCOL_ERROR' });
  assert.ok(c.killed);
  const d = client(), capped = attachObservationTransport(d, receive, { maxOutputBytes: 1024 });
  d.stdout.write(Buffer.alloc(600));
  d.stderr.write(Buffer.alloc(425));
  assert.deepEqual(await capped, { status: 'OUTPUT_LIMIT' });
});
