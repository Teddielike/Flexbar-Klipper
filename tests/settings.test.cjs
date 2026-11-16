'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { UUID } = require('../src/core');
const plugin = path.resolve(__dirname, `../${UUID}.plugin`);

function settings(modelValue, bridge = {}) {
  const source = fs.readFileSync(path.join(plugin, 'ui/settings.vue'), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const sandbox = { module: { exports: {} }, setInterval, clearInterval };
  vm.runInNewContext(script.replace('export default', 'module.exports ='), sandbox);
  const options = sandbox.module.exports;
  const ctx = { ...options.data(), modelValue, ui: text => text, $i18n: { locale: 'de' },
    $fd: { getConfig: async () => ({}), setConfig: async () => ({ status: 'success' }),
      sendToBackend: async () => ({ ok: true }), showSnackbarMessage() {}, ...bridge } };
  for (const [name, method] of Object.entries(options.methods)) ctx[name] = method.bind(ctx);
  options.created.call(ctx);
  return { ctx, mount: () => options.mounted.call(ctx) };
}

test('manifest has a resolvable global settings page and a 120-pixel emergency stop default', () => {
  const manifest = require(path.join(plugin, 'manifest.json'));
  assert.equal(manifest.keyLibrary.children.find(key => key.cid === UUID + '.estop').style.width, 120);
  assert.equal(manifest.configPage, 'settings');
  const short = fs.readFileSync(path.join(plugin, `ui/${manifest.configPage}.vue`), 'utf8');
  assert.equal(fs.readFileSync(path.join(plugin, `ui/${UUID}.${manifest.configPage}.vue`), 'utf8'), short);
});

test('every settings/key CID resolves to the plugin UUID with FlexDesigner three-part routing', () => {
  const manifest = require(path.join(plugin, 'manifest.json'));
  assert.equal(UUID.split('.').length, 3);
  const cids = [UUID + '.' + manifest.configPage, ...manifest.keyLibrary.children.map(key => key.cid)];
  for (const cid of cids) {
    const parts = cid.split('.');
    assert.equal(parts.slice(0, 3).join('.'), manifest.uuid, cid);
    const subID = parts.slice(3).join('.');
    assert.ok(fs.existsSync(path.join(plugin, 'ui', subID + '.vue')), cid);
  }
});

test('a fresh or empty printer configuration immediately has an editable first printer', async () => {
  for (const config of [{}, { printers: [] }, { printers: [null] }]) {
    const original = JSON.stringify(config);
    const { ctx, mount } = settings({ config });
    await mount();
    assert.equal(ctx.loading, false);
    assert.equal(ctx.cfg.printers.length, 1);
    assert.equal(ctx.cfg.printers[0].id, 'printer1');
    assert.equal(ctx.open, 0);
    ctx.add();
    assert.equal(ctx.cfg.printers[1].id, 'printer2');
    assert.equal(ctx.open, 1);
    assert.equal(JSON.stringify(config), original, 'initialization and editing must not mutate host data');
  }
});

test('settings tolerate a missing or late host model and load saved configuration via the UI bridge', async () => {
  const stored = { printers: [{ id: 'p', host: 'printer.local', apiKey: 'keep-secret' }], otherOption: 'keep' };
  for (const model of [null, undefined, {}, { config: null }]) {
    const { ctx, mount } = settings(model, { getConfig: async () => stored });
    assert.equal(ctx.loading, true);
    await mount();
    assert.equal(ctx.loading, false);
    assert.equal(ctx.cfg.printers[0].host, 'printer.local');
    ctx.cfg.printers[0].host = 'edited.local';
    assert.equal(stored.printers[0].host, 'printer.local');
    assert.equal(ctx.cfg.otherOption, 'keep');
  }
});

test('settings accept immutable host configuration and preserve credentials and unknown fields when saving', async () => {
  const config = Object.freeze({ printers: Object.freeze([Object.freeze({ id: 'p', host: 'printer.local', apiKey: 'secret' })]), other: 42 });
  let saved, reloaded;
  const { ctx } = settings(Object.freeze({ config }), {
    setConfig: async data => { saved = data; return { status: 'success' }; },
    sendToBackend: async data => { reloaded = data; return { ok: true }; },
  });
  ctx.cfg.printers[0].host = 'new.local';
  await ctx.save();
  assert.equal(saved.printers[0].apiKey, 'secret');
  assert.equal(saved.printers[0].host, 'new.local');
  assert.equal(saved.other, 42);
  assert.equal(reloaded.action, 'reloadConfig');
  assert.equal(ctx.notice.type, 'success');
  assert.equal(ctx.saving, false);
});

test('settings display load and save failures instead of silently failing', async () => {
  const failedLoad = settings(null, { getConfig: async () => { throw new Error('Unavailable'); } });
  await failedLoad.mount();
  assert.equal(failedLoad.ctx.notice.type, 'warning');
  assert.equal(failedLoad.ctx.loading, false);
  let reloads = 0;
  const { ctx } = settings({ config: {} }, {
    setConfig: async () => ({ status: 'error', error: 'Disk full' }),
    sendToBackend: async () => { reloads++; },
  });
  await ctx.save();
  assert.equal(ctx.notice.type, 'error');
  assert.match(ctx.notice.text, /Disk full/);
  assert.equal(reloads, 0);
  const offline = settings({ config: {} }, { sendToBackend: async () => { throw new Error('Offline'); } });
  await offline.ctx.save();
  assert.equal(offline.ctx.notice.type, 'warning');
  assert.match(offline.ctx.notice.text, /gespeichert/);
});
