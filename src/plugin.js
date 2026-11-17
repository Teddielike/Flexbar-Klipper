'use strict';
// FlexBar plugin: Klipper / Moonraker / Fluidd printer status and controls.
const VERSION = require('../package.json').version;
const { spawn } = require('node:child_process');
const { plugin, logger } = require('@eniac/flexdesigner');
const core = require('./core');
const { Moonraker } = require('./moonraker');
const { normalizeLocale, translate } = require('./i18n');
const { createHostLanguageReader } = require('./host-language');

const READY_DELAY_MS = 600;     // the device needs a moment after plugin.alive
const DRAW_SPACING_MS = 60;     // minimum gap between two draw calls
const CONFIRM_WINDOW_MS = 3000; // second tap must follow within this window
const OBJECT_LIST_TTL_MS = 60000;

let config = core.normalizeConfig({});
let configLoaded = false;
let locale = 'de'; // Preserve the language of existing installations until the UI reports it.
let localeFromUI = false;
let localeSave = Promise.resolve();
let hostLocale = null;
let hostLocaleRefresh = null;
let hostLocaleUnavailable = false;
const hostLanguage = createHostLanguageReader(() => plugin.electronAPI('app.getPath', 'userData'));
const t = (message, params) => translate(message, locale, params);
const keys = new Map();      // `${serial}:${uid}` -> registration
const printers = new Map();  // printer id -> runtime

const sleep = ms => new Promise(r => setTimeout(r, ms));
const errText = e => String((e && e.message) || e);

// ------------------------------------------------------------------ config
async function loadConfig(raw) {
  try {
    const data = raw !== undefined ? raw : await plugin.getConfig();
    if (!localeFromUI && data && typeof data._locale === 'string') applyLocale(data._locale);
    const next = core.normalizeConfig(data);
    const changed = JSON.stringify(next.printers) !== JSON.stringify(config.printers) || next.pollInterval !== config.pollInterval;
    const fontChanged = next.fontFamily !== config.fontFamily;
    config = next;
    configLoaded = true;
    if (changed) {
      logger.info(`Klipper: config loaded, ${config.printers.length} printer(s), poll ${config.pollInterval} ms`);
      for (const rt of printers.values()) { rt.stop = true; rt.client.close(); wake(rt); }
      printers.clear();
      for (const reg of keys.values()) { reg.sig = null; reg.rt = {}; }
      syncLoops();
    } else if (fontChanged) {
      syncLoops();
      for (const rt of printers.values()) renderPrinter(rt);
    }
  } catch (e) {
    logger.warn('Klipper: could not read config: ' + errText(e));
  }
}
async function ensureConfig() {
  if (!configLoaded) {
    await loadConfig();
    await refreshHostLocale();
  }
}

function refreshHostLocale() {
  if (hostLocaleRefresh) return hostLocaleRefresh;
  hostLocaleRefresh = (async () => {
    try {
      const next = await hostLanguage.read();
      hostLocale = next;
      hostLocaleUnavailable = false;
      if (next !== locale || !localeFromUI) await receiveLocale(next, 'host');
    } catch (_) {
      hostLocale = null;
      if (!hostLocaleUnavailable) logger.warn('Klipper: FlexDesigner language unavailable; using UI/last known language');
      hostLocaleUnavailable = true;
    }
  })().finally(() => { hostLocaleRefresh = null; });
  return hostLocaleRefresh;
}

function snapshotFor(rt) { return { ...(rt.snapshot || { online: false, objects: {} }), locale }; }
function applyLocale(value) {
  const next = normalizeLocale(value);
  if (next === locale) return;
  locale = next;
  logger.info(`Klipper: display language ${locale}`);
  for (const rt of printers.values()) renderPrinter(rt);
  for (const reg of keys.values()) {
    if (!core.printerFor(config, reg.key.data)) scheduleDraw(reg, { title: t('Kein Drucker\nkonfiguriert'), fgColor: core.COLORS.dim });
  }
}

// Serialize writes and merge with the raw config to preserve credentials and
// fields not used by the backend. Only a changed locale is persisted.
function receiveLocale(value, source = 'ui') {
  if (typeof value !== 'string' || !value.trim()) return Promise.resolve({ ok: false, error: t('Ungültige Sprache') });
  localeFromUI = true;
  // A cached/hidden UI page must not override the actual application setting.
  applyLocale(source === 'ui' && hostLocale ? hostLocale : value);
  const selected = locale;
  const save = localeSave.then(async () => {
    const stored = await plugin.getConfig() || {};
    if (stored._locale !== selected) await plugin.setConfig({ ...stored, _locale: selected });
    return { ok: true, locale: selected };
  });
  localeSave = save.catch(() => {});
  return save;
}

// ------------------------------------------------------------------ printers
function runtimeFor(printerCfg) {
  let rt = printers.get(printerCfg.id);
  if (!rt) {
    rt = { cfg: printerCfg, client: new Moonraker(printerCfg, () => locale), snapshot: null, objectList: null,
      objectListAt: 0, metaFile: null, meta: null, running: false, stop: false, wakeFn: null, failures: 0 };
    printers.set(printerCfg.id, rt);
  }
  return rt;
}
function wake(rt) { if (rt.wakeFn) { const f = rt.wakeFn; rt.wakeFn = null; f(); } }
function keysOf(printerId) {
  const out = [];
  for (const reg of keys.values()) {
    const p = core.printerFor(config, reg.key.data);
    if (p && p.id === printerId) out.push(reg);
  }
  return out;
}

function syncLoops() {
  const needed = new Set();
  for (const reg of keys.values()) {
    const p = core.printerFor(config, reg.key.data);
    if (p) needed.add(p.id);
    else scheduleDraw(reg, { title: t('Kein Drucker\nkonfiguriert'), fgColor: core.COLORS.dim });
  }
  for (const id of needed) {
    const rt = runtimeFor(config.printers.find(p => p.id === id));
    if (!rt.running) pollLoop(rt).catch(e => logger.error('Klipper: loop crashed: ' + errText(e)));
  }
}

async function refreshObjectList(rt) {
  try {
    const r = await rt.client.listObjects();
    rt.objectList = (r && r.objects) || [];
    rt.objectListAt = Date.now();
  } catch (e) { logger.debug('Klipper: objects/list failed: ' + errText(e)); }
}

async function poll(rt) {
  const regs = keysOf(rt.cfg.id);
  if (!rt.objectList || Date.now() - rt.objectListAt > OBJECT_LIST_TTL_MS) await refreshObjectList(rt);
  const wanted = new Set(['webhooks']);
  let wantSensors = false;
  for (const reg of regs) {
    for (const o of core.objectsForKey(reg.kind, reg.key.data, rt.objectList)) wanted.add(o);
    if (reg.kind === 'sensor' && core.sensorItems(reg.key.data).some(i => i.object.startsWith('sensor:'))) wantSensors = true;
  }
  // Only ask for objects Klipper knows; unknown names make Moonraker drop them anyway.
  const names = [...wanted].filter(o => !rt.objectList || !rt.objectList.length || rt.objectList.includes(o) || o === 'webhooks');
  const snapshot = { online: true, klippy: null, objects: {}, objectList: rt.objectList || [], sensors: {},
    meta: rt.meta, printerName: rt.cfg.name };
  try {
    const r = await rt.client.queryObjects(names);
    snapshot.objects = (r && r.status) || {};
    snapshot.klippy = (snapshot.objects.webhooks || {}).state || 'ready';
  } catch (e) {
    if (e.status === 0 || e.status === undefined) throw e; // network error -> offline
    // Moonraker reachable but Klippy not (503 etc.)
    const info = await rt.client.serverInfo();
    snapshot.klippy = (info && info.klippy_state) || 'disconnected';
    rt.objectList = null;
  }
  if (wantSensors) {
    try { const s = await rt.client.sensors(); snapshot.sensors = (s && s.sensors) || {}; } catch (_) { /* optional */ }
  }
  // File metadata for remaining-time estimation.
  const file = (snapshot.objects.print_stats || {}).filename || null;
  if (file !== rt.metaFile) {
    rt.metaFile = file; rt.meta = null;
    if (file) {
      try { rt.meta = await rt.client.metadata(file); } catch (e) { logger.debug('Klipper: metadata: ' + errText(e)); }
    }
  }
  snapshot.meta = rt.meta;
  return snapshot;
}

async function pollLoop(rt) {
  rt.running = true;
  try {
    while (!rt.stop && keysOf(rt.cfg.id).length) {
      try {
        rt.snapshot = await poll(rt);
        if (rt.failures) logger.info(`Klipper: ${rt.cfg.name} online again`);
        rt.failures = 0;
      } catch (e) {
        rt.failures++;
        if (rt.failures === 1 || rt.failures % 30 === 0) logger.warn(`Klipper: ${rt.cfg.name} unreachable: ${errText(e)}`);
        // Keep the last state through a single hiccup.
        if (rt.failures >= 2 || !rt.snapshot) rt.snapshot = { online: false, objects: {}, error: errText(e), printerName: rt.cfg.name };
        rt.objectList = null;
      }
      renderPrinter(rt);
      const delay = rt.failures ? Math.min(15000, config.pollInterval * (1 + rt.failures)) : config.pollInterval;
      await new Promise(resolve => { rt.wakeFn = resolve; setTimeout(resolve, delay); });
      rt.wakeFn = null;
    }
  } finally {
    rt.running = false;
  }
}

// ------------------------------------------------------------------ drawing
const drawQueue = new Map(); // reg id -> true
let drawBusy = false;

function renderPrinter(rt) {
  for (const reg of keysOf(rt.cfg.id)) renderKey(reg, rt.snapshot);
}

function renderKey(reg, snapshot) {
  if (!snapshot) return;
  const visual = core.renderKey(reg.kind, reg.key.data, { ...snapshot, locale }, reg.rt);
  scheduleDraw(reg, visual);
}

function scheduleDraw(reg, visual) {
  const progress = typeof visual.progress === 'number' ? Math.round(visual.progress * 200) / 200 : null;
  const v = { ...visual, progress, font: config.fontFamily || reg.userFont || '' };
  const sig = JSON.stringify(v);
  if (sig === reg.sig && !reg.dirty) return;
  reg.next = v; reg.nextSig = sig;
  drawQueue.set(reg.id, true);
  pumpDraws();
}

async function pumpDraws() {
  if (drawBusy) return;
  drawBusy = true;
  try {
    while (drawQueue.size) {
      let picked = null;
      for (const id of drawQueue.keys()) {
        const reg = keys.get(id);
        if (!reg) { drawQueue.delete(id); continue; }
        if (Date.now() >= reg.readyAt) { picked = reg; break; }
      }
      if (!picked) {
        if (!drawQueue.size) break;
        await sleep(100);
        continue;
      }
      drawQueue.delete(picked.id);
      await drawNow(picked);
      await sleep(DRAW_SPACING_MS);
    }
  } finally { drawBusy = false; }
}

async function drawNow(reg) {
  const v = reg.next;
  if (!v || reg.nextSig === reg.sig) return;
  const sig = reg.nextSig;
  const key = reg.key;
  const style = key.style = { ...(key.style || {}) };
  key.title = v.title;
  style.showTitle = v.showTitle !== false;
  style.font = v.font;
  if (v.fgColor) style.fgColor = v.fgColor;
  if (v.icon) { style.icon = v.icon; style.showIcon = true; }
  if (v.progress !== null && v.progress !== undefined && v.bar !== 'text' && v.bar !== 'none') {
    const width = style.width || key.width || 240;
    style.image = core.progressBarPng(width, 60, v.progress, { bg: reg.bgColor, fill: core.COLORS.accent });
    style.showImage = true;
    reg.usesImage = true;
  } else if (reg.usesImage) {
    style.showImage = reg.userShowImage;
    style.image = reg.userImage;
    reg.usesImage = false;
  }
  try {
    await plugin.draw(reg.serial, key, 'draw');
    reg.sig = sig;
    reg.dirty = false;
  } catch (e) {
    logger.warn(`Klipper: draw failed (${reg.kind}): ${errText(e)}`);
  }
}

// ------------------------------------------------------------------ keys
plugin.on('plugin.alive', async payload => {
  const serial = payload && payload.serialNumber;
  if (typeof serial !== 'string' || !serial) return;
  await ensureConfig();
  let count = 0;
  for (const key of (payload.keys || [])) {
    const kind = core.kindFromCid(key && key.cid);
    if (!kind || key.uid === undefined || key.uid === null) continue;
    key.data = key.data || {};
    key.style = key.style || {};
    const id = `${serial}:${key.uid}`;
    const old = keys.get(id);
    keys.set(id, { id, serial, key, kind, readyAt: Date.now() + READY_DELAY_MS, sig: null, rt: old ? old.rt : {},
      bgColor: key.style.bgColor || '#000000', userFont: key.style.font || '', userImage: key.style.image, userShowImage: !!key.style.showImage, usesImage: false });
    count++;
  }
  if (!count) return;
  logger.info(`Klipper: ${count} key(s) alive on ${serial}`);
  syncLoops();
  // Show the last known state right away instead of waiting for the next poll.
  for (const reg of keys.values()) {
    if (reg.serial !== serial) continue;
    const p = core.printerFor(config, reg.key.data);
    const rt = p && printers.get(p.id);
    if (rt && rt.snapshot) renderKey(reg, rt.snapshot);
    else if (p) scheduleDraw(reg, { title: t('Verbinde…'), fgColor: core.COLORS.dim });
  }
});

plugin.on('plugin.dead', payload => {
  const serial = payload && payload.serialNumber;
  const list = payload && payload.keys;
  if (!Array.isArray(list) || !list.length) {
    for (const [id, reg] of keys) if (reg.serial === serial) keys.delete(id);
  } else {
    for (const k of list) keys.delete(`${serial}:${k && k.uid}`);
  }
  // Loops end by themselves once no key needs their printer.
});

plugin.on('plugin.data', async payload => {
  const serial = payload && payload.serialNumber;
  const key = payload && payload.data && payload.data.key;
  const kind = core.kindFromCid(key && key.cid);
  if (!kind || typeof serial !== 'string') return;
  await ensureConfig();
  const id = `${serial}:${key.uid}`;
  let reg = keys.get(id);
  if (!reg) {
    reg = { id, serial, key, kind, readyAt: 0, sig: null, rt: {}, bgColor: (key.style || {}).bgColor || '#000000', userFont: (key.style || {}).font || '' };
    keys.set(id, reg);
    syncLoops();
  }
  if (kind === 'status' && core.programSpec(reg.key.data.program)) return openProgram(serial, reg.key.data.program);
  const p = core.printerFor(config, reg.key.data);
  if (!p) return { status: 'error', message: t('Kein Drucker konfiguriert') };
  const rt = runtimeFor(p);

  if (core.gestureScripts(kind, reg.key.data)) return handleGesture(serial, reg, rt, p);
  const action = core.actionFor(kind, snapshotFor(rt), reg.key.data);
  if (!action) { wake(rt); return { status: 'success' }; } // display key: refresh now
  if (action.error) {
    notify(serial, action.error, 'warning');
    return { status: 'error', message: action.error };
  }
  if (core.needsConfirm(kind, reg.key.data)) {
    const now = Date.now();
    if (!reg.rt.armedUntil || reg.rt.armedUntil < now) {
      reg.rt.armedUntil = now + CONFIRM_WINDOW_MS;
      renderKey(reg, rt.snapshot);
      setTimeout(() => { if (reg.rt.armedUntil && reg.rt.armedUntil <= Date.now()) { reg.rt.armedUntil = 0; renderKey(reg, rt.snapshot); } },
        CONFIRM_WINDOW_MS + 50);
      return { status: 'success', message: t('Zum Bestätigen erneut tippen') };
    }
    reg.rt.armedUntil = 0;
  }
  if (action.long) return runGcode(serial, reg, rt, p, action);
  try {
    // Emergency stop must not be delayed by a slow request queue.
    await rt.client.post(action.path, undefined, kind === 'estop' ? 3000 : 8000);
    logger.info(`Klipper: ${p.name}: ${action.path}`);
    notify(serial, action.label, kind === 'estop' ? 'error' : 'success');
    renderKey(reg, rt.snapshot);
    wake(rt);
    return { status: 'success', message: action.label };
  } catch (e) {
    logger.warn(`Klipper: ${action.path} failed: ${errText(e)}`);
    notify(serial, t('Fehler: {error}', { error: errText(e) }), 'error');
    renderKey(reg, rt.snapshot);
    return { status: 'error', message: errText(e) };
  }
});

// /printer/gcode/script only answers once the script has finished (M190, M109,
// long macros …). Report back after GCODE_ACK_MS at the latest and keep the key
// in a "running" state until Klipper is done.
const GCODE_ACK_MS = 4000;
const GCODE_TIMEOUT_MS = 2 * 3600 * 1000;
const FLASH_MS = 2500;
function flash(reg, rt, text, ok) {
  reg.rt.flash = { text, ok, until: Date.now() + FLASH_MS };
  renderKey(reg, rt.snapshot);
  setTimeout(() => { if (reg.rt.flash && reg.rt.flash.until <= Date.now()) { reg.rt.flash = null; renderKey(reg, rt.snapshot); } }, FLASH_MS + 50);
}
// ------------------------------------------------------------------ taps
// Single tap -> first G-code (gcodeShort), double tap -> second G-code (gcodeLong).
// The data keys keep their names so existing key configurations stay valid.
const DOUBLE_TAP_MS = 450; // a second tap within this window counts as double tap
function handleGesture(serial, reg, rt, p) {
  const scripts = core.gestureScripts(reg.kind, reg.key.data);
  const g = reg.gesture || (reg.gesture = { count: 0, timer: null });
  const fire = which => {
    const text = which === 'double' ? scripts.long : scripts.short;
    if (!text) { wake(rt); return; } // nothing configured for this tap
    const action = core.scriptAction(text, `${core.keyLabel(reg.kind, reg.key.data, locale)}: ${t(which === 'double' ? 'doppelt' : 'einfach')}`,
      snapshotFor(rt), scripts.idleOnly);
    if (action.error) { notify(serial, action.error, 'warning'); flash(reg, rt, action.error.slice(0, 20), false); return; }
    runGcode(serial, reg, rt, p, action).catch(e => logger.warn('Klipper: tap: ' + errText(e)));
  };
  // Without a double-tap code there is nothing to wait for.
  if (!scripts.long) { fire('single'); return { status: 'success' }; }
  g.count++;
  if (g.count === 1) {
    g.timer = setTimeout(() => { g.count = 0; g.timer = null; fire('single'); }, DOUBLE_TAP_MS);
    return { status: 'success' };
  }
  clearTimeout(g.timer); g.timer = null; g.count = 0;
  fire('double');
  return { status: 'success' };
}

async function runGcode(serial, reg, rt, p, action) {
  if (reg.rt.busy) return { status: 'error', message: t('G-Code läuft noch') };
  reg.rt.busy = true;
  renderKey(reg, rt.snapshot);
  logger.info(`Klipper: ${p.name}: G-Code: ${action.body.script.replace(/\n/g, ' | ')}`);
  const job = rt.client.post(action.path, action.body, GCODE_TIMEOUT_MS).then(
    () => ({ ok: true }), e => ({ ok: false, error: errText(e) }));
  job.then(r => {
    reg.rt.busy = false;
    if (r.ok) flash(reg, rt, 'OK', true);
    else {
      logger.warn(`Klipper: G-Code failed: ${r.error}`);
      notify(serial, t('G-Code: {error}', { error: r.error }), 'error');
      flash(reg, rt, 'Fehler', false);
    }
    wake(rt);
  });
  const first = await Promise.race([job, sleep(GCODE_ACK_MS).then(() => null)]);
  if (first === null) { notify(serial, action.label, 'info'); return { status: 'success', message: action.label }; }
  if (first.ok) { notify(serial, action.label, 'success'); return { status: 'success', message: action.label }; }
  return { status: 'error', message: first.error };
}

function notify(serial, msg, level) {
  try {
    Promise.resolve(plugin.showFlexbarSnackbarMessage(serial, String(msg).slice(0, 64), level,
      level === 'error' ? 'warning' : level === 'success' ? 'ok' : 'bell', 2500)).catch(() => {});
  } catch (_) { /* ignore */ }
}

function openProgram(serial, program) {
  const spec = core.programSpec(program);
  if (!spec) return Promise.resolve({ status: 'success' });
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(spec.command, spec.args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (e) {
      const message = t('Programm konnte nicht geöffnet werden: {error}', { error: errText(e) });
      notify(serial, message, 'error');
      resolve({ status: 'error', message });
      return;
    }
    const fail = e => {
      const message = t('Programm konnte nicht geöffnet werden: {error}', { error: errText(e) });
      notify(serial, message, 'error');
      resolve({ status: 'error', message });
    };
    child.once('error', fail);
    child.once('spawn', () => {
      child.removeListener('error', fail);
      child.unref();
      const message = t('Programm geöffnet');
      notify(serial, message, 'success');
      resolve({ status: 'success', message });
    });
  });
}

plugin.on('plugin.config.updated', payload => {
  loadConfig(payload && payload.config !== undefined ? payload.config : undefined);
});

// ------------------------------------------------------------------ UI bridge
plugin.on('ui.message', async payload => {
  const action = payload && payload.action;
  try {
    switch (action) {
      case 'setLanguage':
        await refreshHostLocale();
        return await receiveLocale(payload.locale);
      case 'reloadConfig':
        await loadConfig(payload.config !== undefined ? payload.config : undefined);
        return { ok: true };
      case 'listPrinters':
        await ensureConfig();
        return { ok: true, printers: config.printers.map(p => ({ id: p.id, name: p.name, host: p.host })) };
      case 'chooseProgram': {
        const result = await plugin.electronAPI('dialog.showOpenDialog', {
          title: t('Programm auswählen'),
          properties: ['openFile'],
        });
        return { ok: true, canceled: !!result.canceled, path: result.canceled ? '' : (result.filePaths || [])[0] || '' };
      }
      case 'testConnection': {
        const pc = core.normalizePrinter(payload.printer || {});
        if (!pc.host) return { ok: false, error: t('Keine IP/Hostname angegeben') };
        const client = new Moonraker(pc, () => locale);
        try {
          const info = await client.serverInfo();
          let printerInfo = null;
          try { printerInfo = await client.printerInfo(); } catch (_) { /* klippy may be down */ }
          const objects = await client.listObjects().then(r => (r && r.objects) || []).catch(() => []);
          return { ok: true, klippyState: info && info.klippy_state, moonraker: info && info.moonraker_version,
            hostname: printerInfo && printerInfo.hostname, klipper: printerInfo && printerInfo.software_version,
            objectCount: objects.length, chamber: core.chamberCandidates(objects) };
        } finally { client.close(); }
      }
      case 'listObjects': {
        await ensureConfig();
        const p = core.printerFor(config, { printer: payload.printer });
        if (!p) return { ok: false, error: t('Kein Drucker konfiguriert') };
        const rt = runtimeFor(p);
        const r = await rt.client.listObjects();
        const objects = ((r && r.objects) || []).slice().sort();
        let sensors = [];
        try {
          const s = await rt.client.sensors();
          sensors = Object.entries((s && s.sensors) || {}).map(([id, v]) => ({ id: 'sensor:' + id, name: (v && v.friendly_name) || id }));
        } catch (_) { /* optional component */ }
        return { ok: true, objects, sensors, chamber: core.chamberCandidates(objects) };
      }
      case 'objectFields': {
        await ensureConfig();
        const p = core.printerFor(config, { printer: payload.printer });
        if (!p) return { ok: false, error: t('Kein Drucker konfiguriert') };
        const rt = runtimeFor(p);
        const obj = String(payload.object || '');
        let fields = {};
        if (obj.startsWith('sensor:')) {
          const s = await rt.client.sensors();
          fields = (((s && s.sensors) || {})[obj.slice(7)] || {}).values || {};
        } else {
          const r = await rt.client.queryObjects([obj]);
          fields = ((r && r.status) || {})[obj] || {};
        }
        const out = {};
        for (const [k, v] of Object.entries(fields)) {
          if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length < 40)) out[k] = v;
        }
        return { ok: true, fields: out };
      }
      default:
        return { ok: false, error: t('Unbekannte Aktion') };
    }
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

plugin.start();
setTimeout(async () => { await loadConfig(); await refreshHostLocale(); }, 300);
// Independent of the settings iframe: also picks up changes while it is closed.
setInterval(() => { refreshHostLocale(); }, 2000).unref();
logger.info(`Klipper plugin v${VERSION} started`);
