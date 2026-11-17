'use strict';
// Pure helpers (no SDK, no network) so that they can be unit-tested.
const zlib = require('node:zlib');
const { translator } = require('./i18n');

const UUID = 'de.teddielike.flexbar-klipper';
const KINDS = new Set(['job', 'jobinfo', 'hotend', 'bed', 'chamber', 'sensor',
  'pause', 'cancel', 'estop', 'restart', 'status', 'gcode', 'light', 'cooler', 'box']);

function kindFromCid(cid) {
  if (typeof cid !== 'string' || !cid.startsWith(UUID + '.')) return null;
  const kind = cid.slice(UUID.length + 1);
  return KINDS.has(kind) ? kind : null;
}

// ---------------------------------------------------------------- config
const DEFAULT_FONT_FAMILY = '"Arial Narrow", Arial, sans-serif';
function normalizeFontFamily(value = DEFAULT_FONT_FAMILY) {
  const families = (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [])
    .filter(v => typeof v === 'string')
    .map(v => v.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter(Boolean).slice(0, 16);
  if (!families.length) return ''; // Keep the font chosen in FlexDesigner.
  if (!families.some(v => /^(sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(v))) families.push('sans-serif');
  return [...new Set(families)].map(v => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v) ? v : JSON.stringify(v)).join(', ');
}

function cleanHost(raw) {
  let host = String(raw || '').trim();
  let port = null, https = null;
  const m = host.match(/^(https?):\/\//i);
  if (m) { https = m[1].toLowerCase() === 'https'; host = host.slice(m[0].length); }
  host = host.replace(/[/?#].*$/, '');
  const pm = host.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
  if (pm) { host = pm[1]; port = Number(pm[2]); }
  return { host, port, https };
}

function normalizePrinter(p, index = 0) {
  const src = p && typeof p === 'object' ? p : {};
  const parsed = cleanHost(src.host);
  const https = parsed.https !== null ? parsed.https : !!src.https;
  let port = Number(src.port) || parsed.port || (https ? 443 : 7125);
  if (parsed.port && !Number(src.port)) port = parsed.port;
  const authMode = ['none', 'apikey', 'login'].includes(src.authMode) ? src.authMode : 'none';
  return {
    id: String(src.id || `printer${index + 1}`),
    name: String(src.name || `Drucker ${index + 1}`),
    host: parsed.host,
    port: Math.min(65535, Math.max(1, port)),
    https,
    insecure: !!src.insecure,
    authMode,
    apiKey: String(src.apiKey || ''),
    username: String(src.username || ''),
    password: String(src.password || ''),
  };
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  let printers = Array.isArray(cfg.printers) ? cfg.printers : [];
  // Legacy / flat form: { host, port, ... }
  if (!printers.length && cfg.host) printers = [cfg];
  printers = printers.map(normalizePrinter).filter(p => p.host);
  const seen = new Set();
  for (const p of printers) {
    while (seen.has(p.id)) p.id += '_';
    seen.add(p.id);
  }
  return {
    printers,
    pollInterval: Math.min(30000, Math.max(500, Number(cfg.pollInterval) || 2000)),
    fontFamily: normalizeFontFamily(cfg.fontFamily),
  };
}

function printerFor(config, data) {
  const wanted = data && data.printer;
  return config.printers.find(p => p.id === wanted) || config.printers[0] || null;
}

function programSpec(value, platform = process.platform) {
  const program = String(value || '').trim();
  if (!program) return null;
  // macOS can open both an .app path and an application name through Launch
  // Services. Other platforms execute the configured program/path directly.
  return platform === 'darwin'
    ? { command: 'open', args: ['-a', program] }
    : { command: program, args: [] };
}

// ---------------------------------------------------------------- formatting
function formatDuration(sec) {
  if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return '--';
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function formatClock(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatEta(remainingSec, now = new Date(), locale = 'de') {
  if (remainingSec === null || !isFinite(remainingSec)) return '--';
  const end = new Date(now.getTime() + remainingSec * 1000);
  const sameDay = end.toDateString() === now.toDateString();
  const clock = formatClock(end);
  if (sameDay) return clock;
  const days = Math.round((new Date(end.toDateString()) - new Date(now.toDateString())) / 86400000);
  return days === 1 ? translator(locale)('morgen {time}', { time: clock }) : `+${days}d ${clock}`;
}

function formatNumber(value, decimals) {
  if (typeof value !== 'number' || !isFinite(value)) return '--';
  const d = Math.min(3, Math.max(0, Number.isFinite(Number(decimals)) ? Number(decimals) : 0));
  return value.toFixed(d);
}

function shortenFilename(name, { stripExtension = true, maxLength = 24 } = {}) {
  if (!name) return '';
  let base = String(name).split('/').pop();
  if (stripExtension) base = base.replace(/\.(gcode|g|gco|bgcode|ufp)$/i, '');
  const max = Math.max(6, Number(maxLength) || 24);
  if (base.length > max) base = base.slice(0, max - 1) + '…';
  return base;
}

function textBar(progress, cells = 10) {
  const p = Math.min(1, Math.max(0, progress || 0));
  const full = Math.round(p * cells);
  return '█'.repeat(full) + '░'.repeat(cells - full);
}

// ---------------------------------------------------------------- job maths
function jobProgress(objects) {
  const vsd = objects.virtual_sdcard || {};
  const ds = objects.display_status || {};
  // M73 (display_status) wins when the slicer emits it, else file position.
  if (typeof ds.progress === 'number' && ds.progress > 0) return ds.progress;
  if (typeof vsd.progress === 'number') return vsd.progress;
  return 0;
}

/**
 * Remaining seconds. mode: auto | file | slicer | filament
 * Mirrors the estimators known from Fluidd/Mainsail.
 */
function remainingTime(objects, meta, mode = 'auto') {
  const ps = objects.print_stats || {};
  const duration = Number(ps.print_duration) || 0;
  const progress = jobProgress(objects);
  const est = meta && Number(meta.estimated_time) > 0 ? Number(meta.estimated_time) : null;
  const filTotal = meta && Number(meta.filament_total) > 0 ? Number(meta.filament_total) : null;
  const filUsed = Number(ps.filament_used) || 0;

  const file = progress > 0.001 && duration > 0 ? duration / progress - duration : null;
  const slicer = est !== null ? Math.max(0, est - duration) : null;
  const filament = filTotal && filUsed > 0 && duration > 0
    ? duration / Math.min(1, filUsed / filTotal) - duration : null;

  switch (mode) {
    case 'file': return file;
    case 'slicer': return slicer ?? file;
    case 'filament': return filament ?? file;
    default: {
      if (slicer !== null && (file === null || progress < 0.05)) return slicer;
      if (slicer !== null && file !== null) {
        // Blend: trust the slicer early on, the measured rate later.
        const w = Math.min(1, progress * 1.25);
        return slicer * (1 - w) + file * w;
      }
      return file ?? filament;
    }
  }
}

function layerInfo(objects, meta) {
  const info = (objects.print_stats || {}).info || {};
  let current = Number(info.current_layer);
  let total = Number(info.total_layer);
  if (!total && meta) total = Number(meta.layer_count) || 0;
  if (!current && meta && objects.gcode_move && meta.layer_height) {
    const z = objects.gcode_move.gcode_position ? objects.gcode_move.gcode_position[2] : 0;
    const first = Number(meta.first_layer_height) || Number(meta.layer_height);
    if (z > 0) current = Math.max(1, Math.floor((z - first) / meta.layer_height) + 1);
  }
  return { current: current || 0, total: total || 0 };
}

const STATE_TEXT = {
  standby: 'Bereit', printing: 'Druckt', paused: 'Pausiert', complete: 'Fertig',
  cancelled: 'Abgebrochen', error: 'Fehler',
};
const KLIPPY_TEXT = {
  ready: 'Bereit', startup: 'Startet…', shutdown: 'Shutdown', error: 'Klipper-Fehler',
  disconnected: 'Getrennt',
};

function printerState(snapshot) {
  const t = translator(snapshot && snapshot.locale || 'de');
  if (!snapshot || !snapshot.online) return { code: 'offline', text: 'Offline' };
  const klippy = snapshot.klippy || (snapshot.objects.webhooks || {}).state;
  if (klippy && klippy !== 'ready') return { code: klippy, text: t(KLIPPY_TEXT[klippy] || klippy) };
  const st = (snapshot.objects.print_stats || {}).state || 'standby';
  return { code: st, text: t(STATE_TEXT[st] || st) };
}

// ---------------------------------------------------------------- values
const UNIT_GUESS = {
  temperature: '°C', target: '°C', humidity: '%', pressure: 'hPa', power: '%', speed: 'rpm',
  rpm: 'rpm', value: '', gas: 'Ω',
};
function defaultUnit(field) { return UNIT_GUESS[field] ?? ''; }
function defaultScale(field) { return field === 'power' ? 100 : 1; }

function readField(snapshot, objectName, field) {
  if (!snapshot || !objectName) return undefined;
  if (objectName.startsWith('sensor:')) {
    const s = (snapshot.sensors || {})[objectName.slice(7)];
    return s && s.values ? s.values[field] : undefined;
  }
  const obj = snapshot.objects[objectName];
  if (!obj) return undefined;
  return field.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function chamberCandidates(objectList) {
  const list = (objectList || []).filter(o => /chamber|kammer|enclosure|cavity/i.test(o));
  const rank = o => o.startsWith('heater_generic') ? 0 : o.startsWith('temperature_sensor') ? 1
    : o.startsWith('temperature_fan') ? 2 : 3;
  return list.sort((a, b) => rank(a) - rank(b));
}

function heaterObject(kind, data, objectList) {
  const configured = data && typeof data.object === 'string' ? data.object.trim() : '';
  if (configured && configured !== 'auto') return configured;
  if (kind === 'hotend') return 'extruder';
  if (kind === 'bed') return 'heater_bed';
  if (kind === 'chamber') return chamberCandidates(objectList)[0] || null;
  return null;
}

/** Objects that must be queried for a key. */
function objectsForKey(kind, data, objectList) {
  data = data || {};
  switch (kind) {
    case 'job': case 'jobinfo': case 'status':
      return ['webhooks', 'print_stats', 'virtual_sdcard', 'display_status', 'gcode_move'];
    case 'pause': case 'cancel':
      return ['webhooks', 'print_stats', 'pause_resume'];
    case 'estop': case 'restart':
      return ['webhooks'];
    case 'gcode':
      return bool(data.idleOnly, false) ? ['webhooks', 'print_stats'] : ['webhooks'];
    case 'hotend': case 'bed': case 'chamber': {
      const o = heaterObject(kind, data, objectList);
      return o ? ['webhooks', o] : ['webhooks'];
    }
    case 'light': case 'cooler':
      return data.object ? ['webhooks', String(data.object).trim()] : ['webhooks'];
    case 'box': {
      const b = boxObjects(data);
      return ['webhooks', b.sensor, b.heater];
    }
    case 'sensor':
      return ['webhooks', ...sensorItems(data).map(i => i.object).filter(o => o && !o.startsWith('sensor:'))];
    default: return [];
  }
}

/** QIDI Box n: AHT20 temperature/humidity sensor and the drying heater. */
function boxObjects(data) {
  const n = Math.max(1, parseInt(data && data.box, 10) || 1);
  return { n, sensor: `aht20_f heater_box${n}`, heater: `heater_generic heater_box${n}` };
}

function sensorItems(data) {
  const items = Array.isArray(data && data.items) ? data.items : [];
  return items.filter(i => i && i.object && i.field).slice(0, 3);
}

// ---------------------------------------------------------------- PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function hexToRgb(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const v = m ? parseInt(m[1], 16) : parseInt(fallback.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Background PNG (data URL) with a progress bar along the bottom edge. */
function progressBarPng(width, height, progress, { bg = '#000000', track = '#2a3240', fill = '#3fa9f5' } = {}) {
  width = Math.max(60, Math.min(1000, Math.round(width) || 240));
  height = Math.max(20, Math.min(120, Math.round(height) || 60));
  const p = Math.min(1, Math.max(0, progress || 0));
  const B = hexToRgb(bg, '#000000'), T = hexToRgb(track, '#2a3240'), F = hexToRgb(fill, '#3fa9f5');
  const margin = 8, barH = 5, barTop = height - barH - 4;
  const fillEnd = margin + Math.round((width - 2 * margin) * p);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    const inBar = y >= barTop && y < barTop + barH;
    for (let x = 0; x < width; x++) {
      let c = B;
      if (inBar && x >= margin && x < width - margin) c = x < fillEnd ? F : T;
      const o = row + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

// ---------------------------------------------------------------- rendering
const COLORS = {
  text: '#f0f3f6', dim: '#7d8896', heating: '#ff9d3c', atTarget: '#4cd27a', cooling: '#5ab4ff',
  error: '#ff5a5a', warn: '#ffc83c', accent: '#3fa9f5', lamp: '#ffd23c',
};

function bool(v, dflt) { return v === undefined || v === null || v === '' ? dflt : v === true || v === 'true'; }

/**
 * Returns the visual for a key: { title, icon?, fgColor?, progress?, bar? }.
 * `rt` is per-key runtime state (e.g. armed confirmation).
 */
function renderKey(kind, data, snapshot, rt = {}, now = new Date()) {
  const locale = snapshot && snapshot.locale || 'de';
  const t = translator(locale);
  data = data || {};
  if ((kind === 'light' || kind === 'cooler') && !bool(data.showText, false)) return renderSwitchIcon(kind, data, snapshot, rt, now);
  if (GESTURE_KINDS.has(kind)) {
    if (rt.busy) return { title: `${keyLabel(kind, data, locale)}\n${t('sende…')}`, fgColor: COLORS.accent };
    if (rt.flash && rt.flash.until > now.getTime()) {
      return { title: `${keyLabel(kind, data, locale)}\n${t(rt.flash.text)}`, fgColor: rt.flash.ok ? COLORS.atTarget : COLORS.error };
    }
  }
  const state = printerState(snapshot);
  const offline = state.code === 'offline';
  if (offline && !['estop', 'restart', 'pause', 'cancel'].includes(kind)) {
    const label = ['hotend', 'bed', 'chamber'].includes(kind) && data.label !== '' ? keyLabel(kind, data, locale) : data.label;
    return { title: label ? `${label}\nOffline` : 'Offline', fgColor: COLORS.dim };
  }
  const objects = snapshot ? snapshot.objects : {};
  const meta = snapshot ? snapshot.meta : null;

  switch (kind) {
    case 'status': {
      const color = { printing: COLORS.accent, paused: COLORS.warn, complete: COLORS.atTarget,
        error: COLORS.error, shutdown: COLORS.error, cancelled: COLORS.dim, offline: COLORS.dim }[state.code];
      const msg = state.code === 'error' || state.code === 'shutdown'
        ? ((objects.webhooks || {}).state_message || (objects.print_stats || {}).message || '') : '';
      const label = data.label || snapshot.printerName || t('Drucker');
      return { title: `${label}\n${state.text}${msg ? '\n' + msg.split('\n')[0].slice(0, 28) : ''}`, fgColor: color || COLORS.text };
    }
    case 'job': {
      const ps = objects.print_stats || {};
      const name = shortenFilename(ps.filename, { stripExtension: bool(data.stripExtension, true), maxLength: data.maxLength });
      const active = state.code === 'printing' || state.code === 'paused';
      const progress = jobProgress(objects);
      const lines = [];
      if (!active) {
        lines.push(state.text);
        if (name && bool(data.showFilename, true) && state.code !== 'standby') lines.push(name);
        return { title: lines.join('\n'), fgColor: state.code === 'error' ? COLORS.error : COLORS.text,
          progress: state.code === 'complete' ? 1 : null, bar: data.bar || 'image' };
      }
      const rem = remainingTime(objects, meta, data.remainingMode || 'auto');
      if (bool(data.showFilename, true) && name) lines.push(state.code === 'paused' ? `⏸ ${name}` : name);
      else if (state.code === 'paused') lines.push(t('Pausiert'));
      const parts = [];
      if (bool(data.showProgress, true)) parts.push(`${Math.floor(progress * 100)}%`);
      if (bool(data.showRemaining, true)) parts.push(formatDuration(rem));
      if (bool(data.showEta, false)) parts.push(`⏱ ${formatEta(rem, now, locale)}`);
      if (parts.length) lines.push(parts.join(' · '));
      const extra = [];
      if (bool(data.showElapsed, false)) extra.push(t('seit {duration}', { duration: formatDuration(ps.print_duration) }));
      if (bool(data.showLayer, false)) {
        const l = layerInfo(objects, meta);
        if (l.total) extra.push(`L ${l.current}/${l.total}`);
      }
      if (extra.length) lines.push(extra.join(' · '));
      if ((data.bar || 'image') === 'text') lines.push(textBar(progress));
      return { title: lines.join('\n'), fgColor: state.code === 'paused' ? COLORS.warn : COLORS.text,
        progress, bar: data.bar || 'image' };
    }
    case 'jobinfo': {
      const ps = objects.print_stats || {};
      const active = state.code === 'printing' || state.code === 'paused';
      const progress = jobProgress(objects);
      const rem = active ? remainingTime(objects, meta, data.remainingMode || 'auto') : null;
      const field = data.field || 'progress';
      let value, label;
      switch (field) {
        case 'filename': label = 'Datei';
          value = shortenFilename(ps.filename, { stripExtension: bool(data.stripExtension, true), maxLength: data.maxLength }) || '—'; break;
        case 'remaining': label = 'Restzeit'; value = active ? formatDuration(rem) : '--'; break;
        case 'eta': label = 'Fertig um'; value = active ? formatEta(rem, now, locale) : '--'; break;
        case 'elapsed': label = 'Druckzeit'; value = ps.print_duration ? formatDuration(ps.print_duration) : '--'; break;
        case 'layer': { label = 'Layer'; const l = layerInfo(objects, meta); value = l.total ? `${l.current} / ${l.total}` : '--'; break; }
        case 'filament': label = 'Filament'; value = ps.filament_used ? `${(ps.filament_used / 1000).toFixed(2)} m` : '--'; break;
        case 'state': label = 'Status'; value = state.text; break;
        default: label = 'Fortschritt'; value = active || state.code === 'complete'
          ? `${Math.floor((state.code === 'complete' ? 1 : progress) * 100)}%` : '--';
      }
      const showLabel = bool(data.showLabel, true);
      const title = showLabel ? `${data.label || t(label)}\n${value}` : value;
      const wantBar = field === 'progress' && (active || state.code === 'complete');
      return { title, fgColor: state.code === 'paused' ? COLORS.warn : COLORS.text,
        progress: wantBar ? (state.code === 'complete' ? 1 : progress) : null, bar: data.bar || 'image' };
    }
    case 'hotend': case 'bed': case 'chamber': {
      const obj = heaterObject(kind, data, snapshot.objectList);
      const label = data.label === '' ? '' : keyLabel(kind, data, locale);
      const o = obj ? objects[obj] : null;
      if (!o || typeof o.temperature !== 'number') {
        return { title: `${label ? label + '\n' : ''}${t(obj ? 'n/v' : 'kein Sensor')}`, fgColor: COLORS.dim };
      }
      const dec = data.decimals ?? 0;
      const cur = formatNumber(o.temperature, dec);
      const hasTarget = typeof o.target === 'number';
      let line = `${cur}°`;
      if (hasTarget && bool(data.showTarget, true)) line += o.target > 0 ? ` / ${formatNumber(o.target, 0)}°` : ` / ${t('aus')}`;
      if (hasTarget && bool(data.showPower, false) && typeof o.power === 'number') line += ` ${Math.round(o.power * 100)}%`;
      let fg = COLORS.text;
      if (bool(data.colorize, true) && hasTarget) {
        if (o.target > 0) fg = Math.abs(o.temperature - o.target) <= Math.max(2, o.target * 0.02) ? COLORS.atTarget : (o.temperature < o.target ? COLORS.heating : COLORS.cooling);
        else if (o.temperature > 50) fg = COLORS.cooling;
      }
      return { title: label ? `${label}\n${line}` : line, fgColor: fg };
    }
    case 'sensor': {
      const items = sensorItems(data);
      if (!items.length) return { title: `${data.label || t('Sensor')}\n${t('nicht konfiguriert')}`, fgColor: COLORS.dim };
      const parts = items.map(i => {
        const raw = readField(snapshot, i.object, i.field);
        const scale = i.scale !== undefined && i.scale !== '' ? Number(i.scale) : defaultScale(i.field);
        const unit = i.unit !== undefined && i.unit !== null && i.unit !== '' ? i.unit : defaultUnit(i.field);
        const value = typeof raw === 'number' ? formatNumber(raw * (isFinite(scale) ? scale : 1), i.decimals ?? 1)
          : (typeof raw === 'string' || typeof raw === 'boolean' ? String(raw) : '--');
        return `${i.prefix ? i.prefix + ' ' : ''}${value}${value !== '--' ? unit : ''}`;
      });
      const joined = parts.join(data.layout === 'lines' ? '\n' : '  ');
      return { title: data.label ? `${data.label}\n${joined}` : joined, fgColor: COLORS.text };
    }
    case 'light': case 'cooler': {
      const label = keyLabel(kind, data, locale);
      const o = data.object ? objects[String(data.object).trim()] : null;
      if (!o || typeof o.value !== 'number') return { title: `${label}\n${t(data.object ? 'n/v' : 'kein Objekt')}`, fgColor: COLORS.dim };
      const on = o.value > 0;
      const text = !on ? t('Aus') : o.value < 1 ? `${t('An')} ${Math.round(o.value * 100)}%` : t('An');
      return { title: `${label}\n${text}`, fgColor: on ? COLORS.atTarget : COLORS.text };
    }
    case 'box': {
      const label = keyLabel(kind, data, locale);
      const b = boxObjects(data);
      const a = objects[b.sensor] || {}, h = objects[b.heater] || {};
      const temp = typeof a.temperature === 'number' ? a.temperature : h.temperature;
      if (typeof temp !== 'number') return { title: `${label}\n${t('n/v')}`, fgColor: COLORS.dim };
      const parts = [`${formatNumber(temp, data.decimals ?? 0)}°`];
      if (bool(data.showHumidity, true) && typeof a.humidity === 'number') parts.push(`${Math.round(a.humidity)}%`);
      const lines = [label, parts.join('  ')].filter(Boolean);
      const drying = typeof h.target === 'number' && h.target > 0;
      if (drying && bool(data.showTarget, true)) lines.push(`→ ${formatNumber(h.target, 0)}°`);
      let fg = COLORS.text;
      if (drying && bool(data.colorize, true)) fg = Math.abs(temp - h.target) <= Math.max(2, h.target * 0.02) ? COLORS.atTarget
        : temp < h.target ? COLORS.heating : COLORS.cooling;
      return { title: lines.join('\n'), fgColor: fg };
    }
    case 'pause': {
      const ps = objects.print_stats || {};
      const paused = state.code === 'paused' || (objects.pause_resume || {}).is_paused === true;
      const printing = ps.state === 'printing' && !paused;
      if (rt.armedUntil && rt.armedUntil > now.getTime()) {
        return { title: `${t(paused ? 'Fortsetzen?' : 'Pause?')}\n${t('nochmal tippen')}`, icon: paused ? 'mdi mdi-play' : 'mdi mdi-pause', fgColor: COLORS.warn };
      }
      if (paused) return { title: t('Fortsetzen'), icon: 'mdi mdi-play', fgColor: COLORS.atTarget };
      if (printing) return { title: 'Pause', icon: 'mdi mdi-pause', fgColor: COLORS.text };
      return { title: 'Pause', icon: 'mdi mdi-pause', fgColor: COLORS.dim };
    }
    case 'cancel': {
      const active = state.code === 'printing' || state.code === 'paused';
      if (rt.armedUntil && rt.armedUntil > now.getTime()) return { title: `${t('Abbrechen?')}\n${t('nochmal tippen')}`, fgColor: COLORS.error };
      return { title: t('Stopp'), fgColor: active ? COLORS.text : COLORS.dim };
    }
    case 'estop': {
      if (rt.armedUntil && rt.armedUntil > now.getTime()) return { title: `${t('NOT-AUS?')}\n${t('nochmal tippen')}`, fgColor: '#ffffff' };
      return { title: t('NOT-AUS'), fgColor: offline ? COLORS.dim : '#ffffff' };
    }
    case 'restart': {
      if (rt.armedUntil && rt.armedUntil > now.getTime()) return { title: `${t('Neustart?')}\n${t('nochmal tippen')}`, fgColor: COLORS.warn };
      const bad = state.code === 'shutdown' || state.code === 'error';
      return { title: t('FW-Neustart'), fgColor: bad ? COLORS.warn : (offline ? COLORS.dim : COLORS.text) };
    }
    case 'gcode': {
      const label = data.label || t('G-Code');
      if (rt.armedUntil && rt.armedUntil > now.getTime()) return { title: `${label}\n${t('nochmal tippen')}`, fgColor: COLORS.warn };
      if (rt.busy) return { title: `${label}\n${t('läuft…')}`, fgColor: COLORS.accent };
      if (rt.flash && rt.flash.until > now.getTime()) return { title: `${label}\n${t(rt.flash.text)}`, fgColor: rt.flash.ok ? COLORS.atTarget : COLORS.error };
      const blocked = state.code !== 'standby' && state.code !== 'complete' && state.code !== 'cancelled' && state.code !== 'error'
        && !(state.code === 'printing' || state.code === 'paused');
      const busyPrint = bool(data.idleOnly, false) && (state.code === 'printing' || state.code === 'paused');
      return { title: label, fgColor: blocked || busyPrint || !String(data.gcode || '').trim() ? COLORS.dim : COLORS.text };
    }
    default: return { title: '' };
  }
}

/** Icon-only switch: lamp lit (yellow) / outline, snowflake blue / white. */
const SWITCH_ICONS = {
  light: { on: 'mdi mdi-lightbulb-on', off: 'mdi mdi-lightbulb-outline', color: '#ffd23c' },
  cooler: { on: 'mdi mdi-snowflake', off: 'mdi mdi-snowflake', color: '#3fa9f5' },
};
function renderSwitchIcon(kind, data, snapshot, rt, now) {
  const look = SWITCH_ICONS[kind];
  const offline = printerState(snapshot).code === 'offline';
  const o = !offline && data.object ? (snapshot.objects || {})[String(data.object).trim()] : null;
  const known = !!o && typeof o.value === 'number';
  const on = known && o.value > 0;
  let fg = on ? look.color : known ? COLORS.text : COLORS.dim;
  if (rt.busy) fg = kind === 'cooler' ? COLORS.warn : COLORS.accent;
  else if (rt.flash && rt.flash.until > now.getTime() && !rt.flash.ok) fg = COLORS.error;
  return { title: '', showTitle: false, icon: on ? look.on : look.off, fgColor: fg };
}

/** Which action a control key triggers in the current state, or an error text. */
function actionFor(kind, snapshot, data = {}) {
  const t = translator(snapshot && snapshot.locale || 'de');
  const state = printerState(snapshot);
  if (state.code === 'offline') return { error: t('Drucker offline') };
  const objects = snapshot.objects;
  switch (kind) {
    case 'pause': {
      const paused = state.code === 'paused' || (objects.pause_resume || {}).is_paused === true;
      if (paused) return { path: '/printer/print/resume', label: t('Fortsetzen') };
      if (state.code === 'printing') return { path: '/printer/print/pause', label: 'Pause' };
      return { error: t('Kein aktiver Druck') };
    }
    case 'cancel':
      if (state.code === 'printing' || state.code === 'paused') return { path: '/printer/print/cancel', label: t('Druck abgebrochen') };
      return { error: t('Kein aktiver Druck') };
    case 'estop': return { path: '/printer/emergency_stop', label: t('NOT-AUS ausgelöst') };
    case 'restart': return { path: '/printer/firmware_restart', label: t('Firmware-Neustart') };
    case 'gcode':
      return scriptAction(data && data.gcode, t('{label} gesendet', { label: data.label || t('G-Code') }), snapshot, bool(data && data.idleOnly, false));
    default: return null;
  }
}

function cleanScript(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n');
}

/** Validated G-code request (shared by the G-code key and the temperature keys). */
function scriptAction(text, label, snapshot, idleOnly) {
  const t = translator(snapshot && snapshot.locale || 'de');
  const script = cleanScript(text);
  if (!script) return { error: t('Kein G-Code konfiguriert') };
  const state = printerState(snapshot);
  if (state.code === 'offline') return { error: t('Drucker offline') };
  const klippy = snapshot.klippy || ((snapshot.objects || {}).webhooks || {}).state;
  if (klippy && klippy !== 'ready') return { error: t('Klipper nicht bereit ({state})', { state: klippy }) };
  if (idleOnly && (state.code === 'printing' || state.code === 'paused')) return { error: t('Nicht während eines Drucks') };
  return { path: '/printer/gcode/script', body: { script }, label, long: true };
}

// Keys whose single / double tap runs a G-code (gcodeShort / gcodeLong).
const GESTURE_KINDS = new Set(['hotend', 'bed', 'chamber', 'sensor', 'light', 'cooler', 'box']);
function gestureScripts(kind, data) {
  if (!GESTURE_KINDS.has(kind) || !data) return null;
  const short = cleanScript(data.gcodeShort), long = cleanScript(data.gcodeLong);
  return short || long ? { short, long, idleOnly: bool(data.gcodeIdleOnly, true) } : null;
}
function keyLabel(kind, data, locale = 'de') {
  data = data || {};
  // Old profiles contain the former default labels as ordinary strings. Treat
  // just these known heater defaults as automatic, without rewriting the profile.
  const defaults = { bed: ['Bett', 'Bed', 'Druckbett', 'Build plate'], chamber: ['Kammer', 'Chamber', 'Bauraum', 'Build chamber'] };
  if (data.label !== undefined && data.label !== null && data.label !== '' && !(defaults[kind] || []).includes(data.label)) return data.label;
  if (kind === 'box') return `QIDI Box ${boxObjects(data).n}`;
  return translator(locale)({ hotend: 'Hotend', bed: 'Druckbett', chamber: 'Bauraum', sensor: 'Sensor', gcode: 'G-Code', light: 'Beleuchtung', cooler: 'Polar-Cooler' }[kind] || '');
}

const CONFIRM_DEFAULT = { pause: false, cancel: true, estop: true, restart: true, gcode: false };
function needsConfirm(kind, data) { return bool(data && data.confirm, CONFIRM_DEFAULT[kind] ?? false); }

module.exports = {
  UUID, kindFromCid, cleanHost, normalizePrinter, normalizeConfig, printerFor, programSpec,
  DEFAULT_FONT_FAMILY, normalizeFontFamily,
  formatDuration, formatEta, formatNumber, shortenFilename, textBar,
  jobProgress, remainingTime, layerInfo, printerState, readField, chamberCandidates, heaterObject,
  objectsForKey, sensorItems, boxObjects, scriptAction, cleanScript, gestureScripts, keyLabel, GESTURE_KINDS, defaultUnit, progressBarPng, renderKey, actionFor, needsConfirm, COLORS, crc32,
};
