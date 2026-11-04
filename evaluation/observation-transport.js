'use strict';

// Transport only. The approved executor owns Docker, timeout, kill, cleanup
// and receipt publication. The trusted host owns receive and reserved tests.
function attachObservationTransport(child, receive, { maxOutputBytes = 65536 } = {}) {
  if (!child.stdin || !child.stdout || !child.stderr || typeof receive !== 'function' ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 65536) {
    throw new Error('Invalid observation transport configuration.');
  }
  return new Promise(resolve => {
    let bytes = 0, pending = Buffer.alloc(0), finished = false, observation, settled = false;
    function settle(status) {
      if (settled) return;
      settled = true;
      if (status !== 'COMPLETED') {
        child.stdin.destroy();
        child.kill('SIGKILL');
      }
      resolve(status === 'COMPLETED' ? { status, observation } : { status });
    }
    function account(chunk) {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) settle('OUTPUT_LIMIT');
    }
    child.stdout.on('data', chunk => {
      if (settled) return;
      account(chunk);
      if (settled) return;
      try {
        const buffer = Buffer.concat([pending, chunk]);
        let start = 0, end;
        while ((end = buffer.indexOf(10, start)) !== -1) {
          if (finished || end - start < 1 || end - start > 4096) throw new Error('Invalid frame');
          const next = receive(buffer.subarray(start, end));
          if (next && Object.hasOwn(next, 'observation') && !Object.hasOwn(next, 'reply')) {
            observation = next.observation;
            finished = true;
            child.stdin.end();
          } else if (next && Object.hasOwn(next, 'reply')) {
            const reply = Buffer.from(JSON.stringify(next.reply) + '\n');
            if (reply.length > 4097 || !child.stdin.write(reply)) throw new Error('Reply limit or backpressure');
          } else throw new Error('Invalid verifier result');
          start = end + 1;
        }
        pending = buffer.subarray(start);
        if (pending.length > 4096 || (finished && pending.length)) throw new Error('Invalid trailing data');
      } catch { settle('PROTOCOL_ERROR'); }
    });
    child.stderr.on('data', chunk => { if (!settled) account(chunk); });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => settle('INFRA_ERROR'));
    child.on('error', () => settle('INFRA_ERROR'));
    child.on('close', code => settle(code === 0 && finished && !pending.length ? 'COMPLETED' : 'PROTOCOL_ERROR'));
  });
}

module.exports = { attachObservationTransport };
