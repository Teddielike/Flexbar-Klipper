'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/core');
const { translate, normalizeLocale } = require('../src/i18n');
const { Moonraker } = require('../src/moonraker');
const { keys, messages, localizeUi } = require('../tools/localize-ui.cjs');
const root = path.resolve(__dirname, '..');
const online = (objects = {}, locale = 'en') => ({ online: true, klippy: 'ready', objects, locale, objectList: [] });

test('locale normalization, interpolation and fallback', () => {
  for (const value of ['de', 'de-DE', 'DE_at']) assert.equal(normalizeLocale(value), 'de');
  for (const value of ['en', 'en-GB', 'fr', '', null, {}]) assert.equal(normalizeLocale(value), 'en');
  assert.equal(translate('Fehler', 'de'), 'Fehler');
  assert.equal(translate('Fehler', 'fr'), 'Error');
  assert.equal(translate('Fehler: {error}', 'en', { error: 'MCU shutdown' }), 'Error: MCU shutdown');
  assert.equal(translate('unknown text', 'en'), 'unknown text');
});

test('runtime displays and confirmations follow the snapshot locale', () => {
  const snap = online({ print_stats: { state: 'printing' }, heater_bed: { temperature: 25, target: 0 } });
  assert.equal(core.renderKey('status', {}, snap).title, 'Printer\nPrinting');
  assert.equal(core.renderKey('bed', {}, snap).title, 'Build plate\n25° / off');
  assert.equal(core.renderKey('bed', { label: 'Mein Bett' }, snap).title, 'Mein Bett\n25° / off');
  assert.equal(core.renderKey('bed', { label: '' }, snap).title, '25° / off');
  assert.equal(core.renderKey('sensor', {}, snap).title, 'Sensor\nnot configured');
  assert.equal(core.renderKey('gcode', {}, snap, { busy: true }).title, 'G-code\nrunning…');
  assert.equal(core.renderKey('cancel', {}, snap, { armedUntil: Date.now() + 1000 }).title, 'Cancel?\ntap again');
  assert.equal(core.renderKey('estop', {}, { online: false, objects: {}, locale: 'en' }).title, 'E-STOP');
  const de = { ...snap, locale: 'de' };
  assert.equal(core.renderKey('status', {}, de).title, 'Drucker\nDruckt');
  assert.equal(core.renderKey('bed', {}, de).title, 'Druckbett\n25° / aus');
});

test('legacy heater labels follow the locale without changing custom labels or stored data', () => {
  for (const [kind, labels, de, en] of [
    ['bed', ['Bett', 'Bed', 'Druckbett', 'Build plate'], 'Druckbett', 'Build plate'],
    ['chamber', ['Kammer', 'Chamber', 'Bauraum', 'Build chamber'], 'Bauraum', 'Build chamber'],
  ]) {
    for (const label of labels) {
      const data = { label };
      assert.equal(core.keyLabel(kind, data, 'de'), de);
      assert.equal(core.keyLabel(kind, data, 'en'), en);
      assert.equal(data.label, label, 'rendering must not rewrite a profile');
      assert.match(core.renderKey(kind, data, online()).title, new RegExp('^' + en + '\\n'));
      assert.equal(core.renderKey(kind, data, { online: false, objects: {}, locale: 'en' }).title, en + '\nOffline');
      assert.equal(core.renderKey(kind, data, online(), { busy: true }).title, en + '\nsending…');
    }
    assert.equal(core.keyLabel(kind, { label: 'Mein Sensor' }, 'en'), 'Mein Sensor');
  }
  assert.equal(core.keyLabel('hotend', { label: 'Hotend' }, 'en'), 'Hotend');
  assert.equal(core.keyLabel('gcode', { label: 'Bett' }, 'en'), 'Bett', 'do not translate unrelated custom labels');
});

test('actions are localized but scripts, filenames and printer errors are preserved', () => {
  const snap = online({ print_stats: { state: 'printing', filename: 'Bett.gcode', message: 'Custom error' } });
  assert.equal(core.scriptAction('G28', 'Test', snap, true).error, 'Not during a print');
  assert.equal(core.actionFor('cancel', snap).label, 'Print cancelled');
  assert.equal(core.actionFor('estop', snap).label, 'Emergency stop triggered');
  const gcode = core.actionFor('gcode', snap, { label: 'Bett', gcode: 'M117 Bereit' });
  assert.equal(gcode.label, 'Bett sent');
  assert.equal(gcode.body.script, 'M117 Bereit');
  assert.match(core.renderKey('job', {}, snap).title, /^Bett\n/);
  assert.equal(core.renderKey('status', {}, online({ print_stats: { state: 'error', message: 'Benutzerfehler' } })).title, 'Printer\nError\nBenutzerfehler');
  const now = new Date(2026, 0, 1, 23, 30);
  assert.equal(core.formatEta(3600, now, 'en'), 'tomorrow 00:30');
});

test('network client uses the current language, including after a language change', async () => {
  let locale = 'en';
  const client = new Moonraker({ authMode: 'login' }, () => locale);
  try {
    await assert.rejects(client.login(), /No username configured/);
    locale = 'de';
    await assert.rejects(client.login(), /Kein Benutzername konfiguriert/);
  } finally { client.close(); }
});

function component(file) {
  const source = fs.readFileSync(path.join(root, `${core.UUID}.plugin/ui`, file), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const sandbox = { module: { exports: {} }, setInterval, clearInterval };
  vm.runInNewContext(script.replace('export default', 'module.exports ='), sandbox, { filename: file });
  return sandbox.module.exports;
}

test('every generated UI has native translations and language synchronization', () => {
  const manifest = require(`../${core.UUID}.plugin/manifest.json`);
  const dir = path.join(root, `${core.UUID}.plugin/ui`);
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.vue'))) {
    const options = component(file);
    const mixin = options.mixins[0];
    assert.equal(typeof mixin.watch['$i18n.locale'].handler, 'function', file);
    const ctx = {
      $i18n: { locale: 'en' },
      $t(key, params, { locale }) { return key.split('.').reduce((value, part) => value[part], manifest.local[locale]); },
    };
    assert.equal(mixin.methods.ui.call(ctx, 'Drucker'), 'Printer');
    ctx.$i18n.locale = 'de';
    assert.equal(mixin.methods.ui.call(ctx, 'Drucker'), 'Drucker');
    ctx.$i18n.locale = 'fr';
    assert.equal(mixin.methods.ui.call(ctx, 'Drucker'), 'Printer');
    assert.equal(mixin.methods.ui.call(ctx, 'My custom label'), 'My custom label');
    for (const [text, key] of Object.entries(keys)) {
      assert.equal(manifest.local.de.UI[key], text);
      assert.equal(manifest.local.en.UI[key], messages[text]);
    }
  }
});

test('locale mixin sends initial and changed host locales and cleans up retries', async () => {
  const mixin = component('status.vue').mixins[0];
  const sent = [];
  const ctx = { $i18n: { locale: 'de' }, $fd: { sendToBackend: async msg => { sent.push(msg); return { ok: true }; } } };
  ctx.syncKlipperLocale = mixin.methods.syncKlipperLocale.bind(ctx);
  mixin.watch['$i18n.locale'].handler.call(ctx);
  await ctx.syncKlipperLocale();
  assert.equal(sent[0].locale, 'de');
  ctx.$i18n.locale = 'en';
  await ctx.syncKlipperLocale();
  assert.equal(sent.at(-1).locale, 'en');
  ctx.$i18n.locale = 'de';
  const pending = ctx.syncKlipperLocale();
  ctx.$i18n.locale = 'en';
  await pending;
  assert.equal(sent.at(-1).locale, 'en', 'language changes during a request are not dropped');
  mixin.mounted.call(ctx);
  assert.ok(ctx.klipperLocaleTimer);
  mixin.beforeUnmount.call(ctx);
});

test('static UI compilation does not rewrite bound values or G-code', () => {
  const source = '<template><span>Drucker</span><input label="Beschriftung" v-model="modelValue.data.label" /><code>G28</code>{{ modelValue.data.label }}</template><script>export default {};</script>';
  const out = localizeUi(source, '({})');
  assert.match(out, /ui\("Drucker"\)/);
  assert.match(out, /:label="ui\('Beschriftung'\)"/);
  assert.match(out, /v-model="modelValue.data.label"/);
  assert.match(out, /<code>G28<\/code>/);
  assert.match(out, /\{\{ modelValue.data.label \}\}/);
});
