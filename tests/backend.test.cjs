'use strict';
// Runs the built backend against a fake Moonraker server with a mocked SDK.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const { UUID } = require('../src/core');

function fakeMoonraker() {
  const state = { calls: [], printState: 'printing', authHeader: null, scripts: [] };
  const server = http.createServer((req, res) => {
    state.calls.push(`${req.method} ${req.url}`);
    state.authHeader = req.headers['x-api-key'] || req.headers.authorization || null;
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers['x-api-key'] !== 'secret') return send(401, { error: { code: 401, message: 'Unauthorized' } });
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/printer/objects/list') return send(200, { result: { objects: ['webhooks', 'print_stats', 'virtual_sdcard', 'extruder', 'heater_bed', 'heater_generic chamber', 'pause_resume'] } });
    if (u.pathname === '/printer/objects/query') {
      const all = {
        webhooks: { state: 'ready' },
        print_stats: { state: state.printState, filename: 'Benchy.gcode', print_duration: 600, filament_used: 100 },
        virtual_sdcard: { progress: 0.5 }, extruder: { temperature: 219.6, target: 220 },
        heater_bed: { temperature: 60, target: 60 }, 'heater_generic chamber': { temperature: 40.2, target: 45 },
        pause_resume: { is_paused: state.printState === 'paused' },
      };
      const status = {};
      for (const k of u.searchParams.keys()) if (all[k]) status[k] = all[k];
      return send(200, { result: { eventtime: 1, status } });
    }
    if (u.pathname === '/server/files/metadata') return send(200, { result: { estimated_time: 1300 } });
    if (u.pathname === '/server/info') return send(200, { result: { klippy_state: 'ready', moonraker_version: 'v0.9' } });
    if (u.pathname === '/printer/info') return send(200, { result: { hostname: 'qidi', software_version: 'v0.12' } });
    if (u.pathname === '/server/sensors/list') return send(404, { error: { message: 'nope' } });
    if (req.method === 'POST' && u.pathname === '/printer/print/pause') { state.printState = 'paused'; return send(200, { result: 'ok' }); }
    if (req.method === 'POST' && u.pathname === '/printer/gcode/script') {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => {
        state.scripts.push(JSON.parse(body).script);
        if (/M190/.test(body)) setTimeout(() => send(200, { result: 'ok' }), 5000); else send(200, { result: 'ok' });
      });
      return;
    }
    if (req.method === 'POST' && u.pathname.startsWith('/printer/')) return send(200, { result: 'ok' });
    send(404, { error: { message: 'not found' } });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, state, port: server.address().port })));
}

function loadBackend(sdkConfig, userData = null) {
  const handlers = {}, draws = [], snacks = [];
  let storedConfig = sdkConfig;
  const sdk = {
    plugin: {
      on: (n, f) => { handlers[n] = f; }, start() {},
      draw: async (serial, key) => { draws.push({ serial, cid: key.cid, title: key.title, style: { ...key.style } }); },
      getConfig: async () => storedConfig,
      setConfig: async value => { storedConfig = value; },
      electronAPI: async (api, name) => {
        assert.equal(api, 'app.getPath');
        assert.equal(name, 'userData');
        if (!userData) throw new Error('Host language unavailable in this test');
        return userData;
      },
      showFlexbarSnackbarMessage: async (s, msg, level) => { snacks.push({ msg, level }); },
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === '@eniac/flexdesigner' ? sdk : orig.call(this, req, ...rest); };
  const file = path.resolve(__dirname, '../src/plugin.js');
  delete require.cache[file];
  try { require(file); } finally { Module._load = orig; }
  return { handlers, draws, snacks, getStoredConfig: () => storedConfig };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const k = (kind, uid, data = {}) => ({ cid: UUID + '.' + kind, uid, data, style: { width: 240, bgColor: '#101010' } });

test('backend polls, draws and executes actions', { timeout: 60000 }, async () => {
  const fake = await fakeMoonraker();
  const cfg = { printers: [{ id: 'q', name: 'QIDI', host: '127.0.0.1', port: fake.port, authMode: 'apikey', apiKey: 'secret' }], pollInterval: 500 };
  const be = loadBackend(cfg);
  try {
    const hotend = k('hotend', 2, { object: 'extruder', label: 'Hotend' });
    hotend.style.font = 'Georgia';
    await be.handlers['plugin.alive']({ serialNumber: 'S1', keys: [
      k('job', 1), hotend, k('chamber', 3, { object: 'auto', label: 'Kammer' }),
      k('pause', 4), k('estop', 5, { confirm: true }),
    ] });
    await wait(1600);
    const last = cid => [...be.draws].reverse().find(d => d.cid === UUID + '.' + cid);
    assert.equal(last('job').title, 'Benchy\n50% · 10m');
    assert.equal(last('job').style.showImage, true);
    assert.match(last('job').style.image, /^data:image\/png;base64,/);
    assert.equal(last('hotend').title, 'Hotend\n220° / 220°');
    assert.equal(last('chamber').title, 'Bauraum\n40° / 45°');
    assert.equal(last('hotend').style.font, '"Arial Narrow", Arial, sans-serif');
    assert.equal(last('pause').title, 'Pause');
    assert.equal(fake.state.authHeader, 'secret');

    // Pause (no confirmation)
    const r = await be.handlers['plugin.data']({ serialNumber: 'S1', data: { evt: 'click', key: k('pause', 4) } });
    assert.equal(r.status, 'success');
    assert.ok(fake.state.calls.includes('POST /printer/print/pause'));
    await wait(900);
    assert.equal(last('pause').title, 'Fortsetzen');

    // Emergency stop needs two taps
    const first = await be.handlers['plugin.data']({ serialNumber: 'S1', data: { evt: 'click', key: k('estop', 5, { confirm: true }) } });
    assert.match(first.message, /erneut/);
    assert.ok(!fake.state.calls.includes('POST /printer/emergency_stop'));
    await wait(200);
    assert.match(last('estop').title, /nochmal/);
    await be.handlers['plugin.data']({ serialNumber: 'S1', data: { evt: 'click', key: k('estop', 5, { confirm: true }) } });
    assert.ok(fake.state.calls.includes('POST /printer/emergency_stop'));

    // Custom G-code: fast and blocking script
    const g = k('gcode', 6, { gcode: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50', label: 'Trocknen' });
    const gr = await be.handlers['plugin.data']({ serialNumber: 'S1', data: { evt: 'click', key: g } });
    assert.equal(gr.status, 'success');
    assert.deepEqual(fake.state.scripts, ['SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50']);
    const slow = k('gcode', 7, { gcode: 'M190 S60', label: 'Bett' });
    const t0 = Date.now();
    const sr = await be.handlers['plugin.data']({ serialNumber: 'S1', data: { evt: 'click', key: slow } });
    assert.equal(sr.status, 'success');
    assert.ok(Date.now() - t0 < 4600, 'tap must return before the script finishes');
    assert.equal(last('gcode') && [...be.draws].reverse().find(d => d.title.startsWith('Bett')).title, 'Bett\nläuft…');
    const again = await be.handlers['plugin.data']({ serialNumber: 'S1', data: { evt: 'click', key: slow } });
    assert.equal(again.status, 'error');
    await be.handlers['ui.message']({ action: 'reloadConfig', config: { ...cfg, fontFamily: 'Arial, sans-serif' } });
    await wait(1500);
    assert.equal([...be.draws].reverse().find(d => d.title.startsWith('Bett')).title, 'Bett\nOK');
    assert.equal(last('hotend').style.font, 'Arial, sans-serif');
    await be.handlers['ui.message']({ action: 'reloadConfig', config: { ...cfg, fontFamily: '' } });
    await wait(700);
    assert.equal(last('hotend').style.font, 'Georgia', 'empty global font restores the key font');

    // Temperature key: single tap = first code, double tap = second code
    fake.state.printState = 'standby';
    await wait(700);
    const bed = k('bed', 8, { object: 'heater_bed', label: 'Bett', gcodeShort: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=0',
      gcodeLong: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60' });
    const tap = () => be.handlers['plugin.data']({ serialNumber: 'S1', data: { evt: 'click', key: bed } });
    fake.state.scripts.length = 0;
    await tap();
    await wait(200);
    assert.equal(fake.state.scripts.length, 0, 'single tap waits for a possible second tap');
    await wait(700);
    assert.deepEqual(fake.state.scripts, ['SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=0']);
    fake.state.scripts.length = 0;
    await tap(); await wait(250); await tap();            // double tap
    await wait(1000);
    assert.deepEqual(fake.state.scripts, ['SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60']);
    fake.state.scripts.length = 0;
    // idle-only blocks while printing
    fake.state.printState = 'printing';
    await wait(700);
    fake.state.scripts.length = 0;
    await tap(); await wait(1000);
    assert.equal(fake.state.scripts.length, 0);
    fake.state.printState = 'standby';

    // UI bridge
    const t = await be.handlers['ui.message']({ action: 'testConnection', printer: cfg.printers[0] });
    assert.equal(t.ok, true);
    assert.deepEqual(t.chamber, ['heater_generic chamber']);
    const bad = await be.handlers['ui.message']({ action: 'testConnection', printer: { ...cfg.printers[0], apiKey: 'wrong' } });
    assert.equal(bad.ok, false);
    const f = await be.handlers['ui.message']({ action: 'objectFields', printer: 'q', object: 'extruder' });
    assert.equal(f.fields.temperature, 219.6);

    // Host language changes repaint existing keys without reconnecting printers.
    fake.state.printState = 'standby';
    await wait(700);
    const lang = await be.handlers['ui.message']({ action: 'setLanguage', locale: 'en-US' });
    assert.equal(lang.locale, 'en');
    assert.equal(be.getStoredConfig()._locale, 'en');
    assert.deepEqual(be.getStoredConfig().printers, cfg.printers, 'locale save preserves credentials');
    await wait(700);
    assert.equal(last('estop').title, 'E-STOP');
    assert.equal(last('job').title, 'Ready');
    assert.equal(last('hotend').title, 'Hotend\n220° / 220°', 'custom label remains unchanged');
    const noPrint = await be.handlers['plugin.data']({ serialNumber: 'S1', data: { key: k('pause', 4) } });
    assert.equal(noPrint.message, 'No active print');
    assert.equal((await be.handlers['ui.message']({ action: 'unknown' })).error, 'Unknown action');
    assert.equal((await be.handlers['ui.message']({ action: 'setLanguage', locale: null })).ok, false);
    await be.handlers['ui.message']({ action: 'setLanguage', locale: 'fr' });
    assert.equal(be.getStoredConfig()._locale, 'en', 'unsupported host languages fall back to English');
    await be.handlers['ui.message']({ action: 'setLanguage', locale: 'de-DE' });
    await wait(700);
    assert.equal(last('estop').title, 'NOT-AUS');
    assert.equal(last('job').title, 'Bereit');
  } finally {
    await be.handlers['plugin.dead']({ serialNumber: 'S1', keys: [] });
    await be.handlers['ui.message']({ action: 'reloadConfig', config: {} });
    fake.server.closeAllConnections();
    fake.server.close();
  }
});

test('backend restores the last host language before any settings page opens', async () => {
  const be = loadBackend({ _locale: 'en', printers: [] });
  try {
    await be.handlers['plugin.alive']({ serialNumber: 'S2', keys: [k('status', 1)] });
    await wait(900);
    assert.equal(be.draws.at(-1).title, 'No printer\nconfigured');
  } finally {
    await be.handlers['plugin.dead']({ serialNumber: 'S2', keys: [] });
  }
});

test('backend follows FlexDesigner language with no settings page and ignores stale UI locale', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'klipper-host-language-'));
  fs.mkdirSync(path.join(directory, 'data'));
  const hostConfig = path.join(directory, 'data', 'config.json');
  const saveHostLanguage = language => fs.writeFileSync(hostConfig, JSON.stringify({ common: { language } }));
  saveHostLanguage('de');
  const be = loadBackend({ _locale: 'en', printers: [] }, directory);
  try {
    await be.handlers['plugin.alive']({ serialNumber: 'HOST', keys: [k('status', 1)] });
    await wait(900);
    assert.equal(be.draws.at(-1).title, 'Kein Drucker\nkonfiguriert', 'host locale overrides stale saved plugin locale at startup');
    assert.equal(be.getStoredConfig()._locale, 'de');
    saveHostLanguage('en');
    await wait(2400);
    assert.equal(be.draws.at(-1).title, 'No printer\nconfigured', 'language changes without any UI message');
    assert.equal(be.getStoredConfig()._locale, 'en');
    const stale = await be.handlers['ui.message']({ action: 'setLanguage', locale: 'de' });
    assert.equal(stale.locale, 'en', 'stale UI does not override FlexDesigner');
    saveHostLanguage('de');
    await wait(2400);
    assert.equal(be.draws.at(-1).title, 'Kein Drucker\nkonfiguriert');
  } finally {
    await be.handlers['plugin.dead']({ serialNumber: 'HOST', keys: [] });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
