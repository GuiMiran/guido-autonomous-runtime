import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRepositoryContext, repositoryList, composeRepositoryGoal } from '../src/repository-catalog.js';

const fixture = async () => ({
  ok: true,
  arrayBuffer: async () => Buffer.from('# SPECTRA\nBR-001: no mutations allowed').buffer.slice(
    Buffer.from('# SPECTRA\nBR-001: no mutations allowed').byteOffset,
    Buffer.from('# SPECTRA\nBR-001: no mutations allowed').byteOffset + Buffer.from('# SPECTRA\nBR-001: no mutations allowed').byteLength
  )
});
test('catalog exposes curated, pinned public repositories', () => {
  const list = repositoryList();
  assert.equal(list.length, 6);
  assert.ok(list.every(x => /^[a-f0-9]{40}$/.test(x.revision)));
  assert.ok(list.some(x => x.id === 'GastroFlow'));
  assert.ok(list.some(x => x.id === 'guido-governance'));
});
test('unapproved repository is rejected with zero network calls', async () => {
  let calls = 0;
  await assert.rejects(loadRepositoryContext('random/repo', { fetchImpl: () => { calls++; } }), /NOT_ALLOWLISTED/);
  assert.equal(calls, 0);
});
test('allowed snapshot fetches only pinned GitHub files and returns hashes', async () => {
  const urls = [];
  const content = Buffer.from('RULE-001: all code changes require review');
  const source = await loadRepositoryContext('vialibre-spectra', {
    fetchImpl: async (url, opts) => {
      urls.push(url);
      assert.equal(opts.redirect, 'error');
      return { ok: true, arrayBuffer: async () => Uint8Array.from(content).buffer };
    }
  });
  assert.equal(urls.length, 2);
  assert.ok(urls.every(x => x.includes('/ce0a5d39013560012d6d01ad64d65dd986b10fab/')));
  assert.equal(source.evidence.length, 2);
  assert.match(composeRepositoryGoal('Review railway UI specs', source), /UNTRUSTED REPOSITORY DOCUMENTS/);
});
test('fail closed when source exceeds the content limit', async () => {
  await assert.rejects(
    loadRepositoryContext('spectra', {
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(13000).buffer })
    }), /SOURCE_TOO_LARGE/
  );
});
test('fail closed when GitHub source is unavailable', async () => {
  await assert.rejects(
    loadRepositoryContext('GastroFlow', { fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /SOURCE_UNAVAILABLE/
  );
});

test('governance entry is pinned, hashed, explicit and still untrusted prompt data', async () => {
  const urls = [];
  const content = Buffer.from('GUIDO ownership: reference only, never tool authority.');
  const source = await loadRepositoryContext('guido-governance', {
    fetchImpl: async url => {
      urls.push(url);
      return { ok: true, arrayBuffer: async () => Uint8Array.from(content).buffer };
    }
  });
  assert.equal(source.revision, 'f5a1342413fd2bed8a5df3ff0044d7c38737b71d');
  assert.deepEqual(source.evidence.map(e => e.path), [
    'docs/ecosystem/agent-entry.md', 'docs/ecosystem/components.json'
  ]);
  assert.ok(urls.every(url => url.startsWith(
    'https://raw.githubusercontent.com/GuiMiran/spectra/f5a1342413fd2bed8a5df3ff0044d7c38737b71d/docs/ecosystem/'
  )));
  assert.ok(source.evidence.every(e => /^[a-f0-9]{64}$/.test(e.sha256)));
  const goal = composeRepositoryGoal('Identify the owner of a cross-repository proposal', source);
  assert.match(goal, /UNTRUSTED REPOSITORY DOCUMENTS/);
  assert.match(goal, /partial excerpts/);
  assert.match(goal, /Do not claim tests ran or code changed/);
});
