'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHostLanguageReader } = require('../src/host-language');

test('host language uses FlexDesigner userData and caches only the path, not the language', async () => {
  let lookups = 0, language = 'de';
  const reader = createHostLanguageReader(async () => { lookups++; return path.resolve('fake-user-data'); }, async (file, encoding) => {
    assert.equal(file, path.resolve('fake-user-data/data/config.json'));
    assert.equal(encoding, 'utf8');
    return JSON.stringify({ common: { language } });
  });
  assert.equal(await reader.read(), 'de');
  language = 'en';
  assert.equal(await reader.read(), 'en');
  language = 'fr';
  assert.equal(await reader.read(), 'en');
  assert.equal(lookups, 1);
});

test('host language reports invalid/missing settings without guessing an OS language', async () => {
  for (const raw of ['{', '{}', '{"common":{"language":null}}', '{"common":{"language":""}}']) {
    const reader = createHostLanguageReader(async () => '/fake', async () => raw);
    await assert.rejects(reader.read());
  }
  const denied = createHostLanguageReader(async () => { throw new Error('Not supported'); });
  await assert.rejects(denied.read(), /Not supported/);
});

test('host language bounds SDK timeouts and recovers on the next check', async () => {
  let stalled = true;
  const reader = createHostLanguageReader(() => stalled ? new Promise(() => {}) : Promise.resolve('/fake'),
    async () => '{"common":{"language":"de"}}', 20);
  const first = reader.read();
  assert.equal(reader.read(), first, 'concurrent lookups share a promise');
  await assert.rejects(first, /timed out/);
  stalled = false;
  assert.equal(await reader.read(), 'de');
});

test('package, lockfile, manifest and backend use one version', () => {
  const fs = require('node:fs');
  const pkg = require('../package.json');
  assert.equal(require('../package-lock.json').version, pkg.version);
  assert.equal(require('../package-lock.json').packages[''].version, pkg.version);
  const { UUID } = require('../src/core');
  const manifest = require(`../${UUID}.plugin/manifest.json`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.uuid, UUID);
  for (const key of manifest.keyLibrary.children) assert.ok(key.cid.startsWith(UUID + '.'));
  const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
  assert.match(source, /const VERSION = require\('\.\.\/package\.json'\)\.version;/);
});
