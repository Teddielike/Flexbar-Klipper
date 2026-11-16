'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const core = require('../src/core.js');

const online = (objects, extra = {}) => ({ online: true, klippy: 'ready', objects, objectList: [], sensors: {}, meta: null, ...extra });

test('kindFromCid', () => {
  assert.equal(core.UUID, 'de.teddielike.flexbar-klipper');
  assert.equal(core.kindFromCid('de.teddielike.flexbar-klipper.job'), 'job');
  assert.equal(core.kindFromCid('de.teddielike.flexbar-klipper.nope'), null);
  assert.equal(core.kindFromCid('com.other.job'), null);
});

test('normalizeConfig parses host with scheme and port', () => {
  const c = core.normalizeConfig({ printers: [{ host: 'http://192.168.1.5:80/fluidd', authMode: 'login', username: 'u' }, { host: '' }] });
  assert.equal(c.printers.length, 1);
  assert.equal(c.printers[0].host, '192.168.1.5');
  assert.equal(c.printers[0].port, 80);
  assert.equal(c.printers[0].https, false);
  assert.equal(c.pollInterval, 2000);
  const flat = core.normalizeConfig({ host: 'printer.local' });
  assert.equal(flat.printers[0].port, 7125);
  const dup = core.normalizeConfig({ printers: [{ id: 'a', host: 'x' }, { id: 'a', host: 'y' }] });
  assert.notEqual(dup.printers[0].id, dup.printers[1].id);
});

test('printerFor falls back to first printer', () => {
  const c = core.normalizeConfig({ printers: [{ id: 'a', host: 'x' }, { id: 'b', host: 'y' }] });
  assert.equal(core.printerFor(c, { printer: 'b' }).id, 'b');
  assert.equal(core.printerFor(c, { printer: '' }).id, 'a');
  assert.equal(core.printerFor(core.normalizeConfig({}), {}), null);
});

test('formatDuration / shortenFilename', () => {
  assert.equal(core.formatDuration(45), '45s');
  assert.equal(core.formatDuration(125), '2m');
  assert.equal(core.formatDuration(3600 + 5 * 60), '1h 05m');
  assert.equal(core.formatDuration(90000), '1d 1h');
  assert.equal(core.formatDuration(null), '--');
  assert.equal(core.shortenFilename('dir/Benchy_PLA_0.2mm.gcode'), 'Benchy_PLA_0.2mm');
  assert.equal(core.shortenFilename('a'.repeat(40) + '.gcode', { maxLength: 10 }).length, 10);
});

test('remainingTime estimators', () => {
  const objects = { print_stats: { print_duration: 600, filament_used: 1000 }, virtual_sdcard: { progress: 0.25 } };
  assert.equal(Math.round(core.remainingTime(objects, null, 'file')), 1800);
  assert.equal(core.remainingTime(objects, { estimated_time: 3000 }, 'slicer'), 2400);
  assert.equal(Math.round(core.remainingTime(objects, { filament_total: 4000 }, 'filament')), 1800);
  const auto = core.remainingTime(objects, { estimated_time: 3000 }, 'auto');
  assert.ok(auto > 1800 && auto < 2400);
  // M73 progress wins over file position
  assert.equal(core.jobProgress({ virtual_sdcard: { progress: 0.1 }, display_status: { progress: 0.3 } }), 0.3);
});

test('render job while printing', () => {
  const snap = online({ print_stats: { state: 'printing', filename: 'Benchy.gcode', print_duration: 600 },
    virtual_sdcard: { progress: 0.5 }, webhooks: { state: 'ready' } });
  const v = core.renderKey('job', {}, snap);
  assert.equal(v.title, 'Benchy\n50% · 10m');
  assert.equal(v.progress, 0.5);
  const p = core.renderKey('job', { showRemaining: false, showLayer: true }, snap);
  assert.equal(p.title, 'Benchy\n50%');
});

test('render job idle / offline', () => {
  assert.equal(core.renderKey('job', {}, online({ print_stats: { state: 'standby' } })).title, 'Bereit');
  assert.match(core.renderKey('job', {}, { online: false, objects: {} }).title, /Offline/);
  assert.equal(core.renderKey('job', {}, online({}, { klippy: 'shutdown' })).title, 'Shutdown');
});

test('render jobinfo fields', () => {
  const snap = online({ print_stats: { state: 'printing', filename: 'x.gcode', print_duration: 600, info: { current_layer: 3, total_layer: 90 } },
    virtual_sdcard: { progress: 0.42 } });
  assert.equal(core.renderKey('jobinfo', { field: 'progress' }, snap).title, 'Fortschritt\n42%');
  assert.equal(core.renderKey('jobinfo', { field: 'layer', showLabel: false }, snap).title, '3 / 90');
  assert.equal(core.renderKey('jobinfo', { field: 'filename', label: 'Teil' }, snap).title, 'Teil\nx');
});

test('render heaters with colours and chamber auto-detection', () => {
  const snap = online({ extruder: { temperature: 180.4, target: 220, power: 0.8 }, heater_bed: { temperature: 60.2, target: 60 },
    'temperature_sensor chamber_temp': { temperature: 35.6 } }, { objectList: ['extruder', 'heater_bed', 'temperature_sensor chamber_temp'] });
  const h = core.renderKey('hotend', { label: 'Hotend' }, snap);
  assert.equal(h.title, 'Hotend\n180° / 220°');
  assert.equal(h.fgColor, core.COLORS.heating);
  assert.equal(core.renderKey('bed', {}, snap).fgColor, core.COLORS.atTarget);
  assert.equal(core.renderKey('chamber', { object: 'auto', label: '' }, snap).title, '36°');
  assert.equal(core.renderKey('hotend', { showPower: true, label: '' }, snap).title, '180° / 220° 80%');
  assert.deepEqual(core.objectsForKey('chamber', { object: 'auto' }, snap.objectList), ['webhooks', 'temperature_sensor chamber_temp']);
  assert.match(core.renderKey('chamber', {}, online({}, { objectList: [] })).title, /kein Sensor/);
});

test('render custom sensor incl. moonraker sensors', () => {
  const snap = online({ 'aht10 box': { temperature: 28.26, humidity: 35.1 } }, { sensors: { scale: { values: { weight: 812.5 } } } });
  const v = core.renderKey('sensor', { label: 'Box', items: [
    { object: 'aht10 box', field: 'temperature', decimals: 1 },
    { object: 'aht10 box', field: 'humidity', decimals: 0 },
    { object: 'sensor:scale', field: 'weight', unit: 'g', decimals: 0 },
  ] }, snap);
  assert.equal(v.title, 'Box\n28.3°C  35%  813g');
  assert.deepEqual(core.objectsForKey('sensor', { items: [{ object: 'sensor:scale', field: 'weight' }, { object: 'fan', field: 'speed' }] }), ['webhooks', 'fan']);
});

test('actions depend on state', () => {
  const printing = online({ print_stats: { state: 'printing' } });
  const paused = online({ print_stats: { state: 'paused' }, pause_resume: { is_paused: true } });
  const idle = online({ print_stats: { state: 'standby' } });
  assert.equal(core.actionFor('pause', printing).path, '/printer/print/pause');
  assert.equal(core.actionFor('pause', paused).path, '/printer/print/resume');
  assert.ok(core.actionFor('pause', idle).error);
  assert.ok(core.actionFor('cancel', idle).error);
  assert.equal(core.actionFor('cancel', paused).path, '/printer/print/cancel');
  assert.equal(core.actionFor('estop', idle).path, '/printer/emergency_stop');
  assert.ok(core.actionFor('estop', { online: false, objects: {} }).error);
  assert.equal(core.actionFor('job', idle), null);
  assert.equal(core.needsConfirm('estop', {}), true);
  assert.equal(core.needsConfirm('estop', { confirm: false }), false);
  assert.equal(core.needsConfirm('pause', {}), false);
});

test('armed confirmation is rendered', () => {
  const snap = online({ print_stats: { state: 'printing' } });
  const now = new Date();
  assert.match(core.renderKey('cancel', {}, snap, { armedUntil: now.getTime() + 1000 }, now).title, /nochmal/);
  assert.equal(core.renderKey('cancel', {}, snap, { armedUntil: now.getTime() - 1 }, now).title, 'Stopp');
});

test('progress bar PNG is valid', () => {
  const url = core.progressBarPng(240, 60, 0.5, { bg: '#112233' });
  const buf = Buffer.from(url.split(',')[1], 'base64');
  assert.equal(buf.slice(1, 4).toString(), 'PNG');
  assert.equal(buf.readUInt32BE(16), 240);
  assert.equal(buf.readUInt32BE(20), 60);
  // Verify CRC of IHDR and decode IDAT
  const ihdr = buf.slice(12, 29);
  assert.equal(buf.readUInt32BE(29), core.crc32(ihdr));
  const idatLen = buf.readUInt32BE(33);
  const raw = zlib.inflateSync(buf.slice(41, 41 + idatLen));
  assert.equal(raw.length, (240 * 3 + 1) * 60);
  assert.deepEqual([...raw.slice(1, 4)], [0x11, 0x22, 0x33]);
});

test('gcode action and rendering', () => {
  const idle = online({ print_stats: { state: 'standby' }, webhooks: { state: 'ready' } });
  const printing = online({ print_stats: { state: 'printing' } });
  const a = core.actionFor('gcode', idle, { gcode: '  SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50 \n\n G28 ', label: 'Box' });
  assert.equal(a.path, '/printer/gcode/script');
  assert.deepEqual(a.body, { script: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50\nG28' });
  assert.equal(a.long, true);
  assert.match(core.actionFor('gcode', idle, { gcode: ' ' }).error, /Kein G-Code/);
  assert.match(core.actionFor('gcode', printing, { gcode: 'G28', idleOnly: true }).error, /Druck/);
  assert.equal(core.actionFor('gcode', printing, { gcode: 'M117 hi' }).path, '/printer/gcode/script');
  assert.match(core.actionFor('gcode', online({}, { klippy: 'shutdown' }), { gcode: 'G28' }).error, /nicht bereit/);
  assert.equal(core.needsConfirm('gcode', {}), false);
  assert.equal(core.renderKey('gcode', { label: 'Trocknen', gcode: 'X' }, idle).title, 'Trocknen');
  assert.equal(core.renderKey('gcode', { label: 'Trocknen', gcode: 'X' }, idle, { busy: true }).title, 'Trocknen\nläuft…');
  assert.equal(core.renderKey('gcode', { gcode: '' }, idle).fgColor, core.COLORS.dim);
});

test('temperature keys: short/long G-code', () => {
  assert.equal(core.gestureScripts('hotend', {}), null);
  assert.equal(core.gestureScripts('job', { gcodeShort: 'G28' }), null);
  assert.deepEqual(core.gestureScripts('bed', { gcodeShort: ' A \n', gcodeLong: 'B' }), { short: 'A', long: 'B', idleOnly: true });
  assert.equal(core.gestureScripts('chamber', { gcodeLong: 'B', gcodeIdleOnly: false }).idleOnly, false);
  const printing = online({ print_stats: { state: 'printing' } });
  assert.match(core.scriptAction('X', 'l', printing, true).error, /Druck/);
  assert.equal(core.scriptAction('X', 'l', printing, false).body.script, 'X');
  assert.match(core.scriptAction('X', 'l', { online: false, objects: {} }, false).error, /offline/);
  const snap = online({ extruder: { temperature: 20, target: 0 } });
  assert.equal(core.renderKey('hotend', { label: 'Hotend' }, snap, { busy: true }).title, 'Hotend\nsende…');
  const now = new Date();
  assert.equal(core.renderKey('bed', {}, snap, { flash: { text: 'OK', ok: true, until: now.getTime() + 500 } }, now).title, 'Druckbett\nOK');
});

test('light / cooler / QIDI box keys', () => {
  const snap = online({
    'output_pin caselight': { value: 0 }, 'output_pin polar_cooler': { value: 1 },
    'aht20_f heater_box1': { temperature: 37.17, humidity: 52 }, 'heater_generic heater_box1': { temperature: 37.16, target: 50, power: 1 },
    'aht20_f heater_box2': { temperature: 22.4, humidity: 41 }, 'heater_generic heater_box2': { temperature: 22.4, target: 0 },
  });
  const light = core.renderKey('light', { label: 'Beleuchtung', object: 'output_pin caselight', showText: true }, snap);
  assert.equal(light.title, 'Beleuchtung\nAus');
  // default: icon-only lamp
  const off = core.renderKey('light', { object: 'output_pin caselight' }, snap);
  assert.deepEqual(off, { title: '', showTitle: false, icon: 'mdi mdi-lightbulb-outline', fgColor: core.COLORS.text });
  const lit = core.renderKey('light', { object: 'output_pin x' }, online({ 'output_pin x': { value: 1 } }));
  assert.equal(lit.icon, 'mdi mdi-lightbulb-on');
  assert.equal(lit.fgColor, core.COLORS.lamp);
  assert.equal(core.renderKey('light', { object: 'output_pin x' }, online({ 'output_pin x': { value: 1 } }), { busy: true }).title, '');
  assert.equal(core.renderKey('light', { object: 'output_pin x' }, { online: false, objects: {} }).fgColor, core.COLORS.dim);
  const flake = core.renderKey('cooler', { object: 'output_pin polar_cooler' }, snap);
  assert.deepEqual(flake, { title: '', showTitle: false, icon: 'mdi mdi-snowflake', fgColor: '#3fa9f5' });
  assert.equal(core.renderKey('cooler', { object: 'output_pin caselight' }, snap).fgColor, core.COLORS.text);
  const cool = core.renderKey('cooler', { object: 'output_pin polar_cooler', showText: true }, snap);
  assert.equal(cool.title, 'Polar-Cooler\nAn');
  assert.equal(cool.fgColor, core.COLORS.atTarget);
  assert.equal(core.renderKey('light', { object: 'output_pin x', showText: true }, online({ 'output_pin x': { value: 0.4 } })).title, 'Beleuchtung\nAn 40%');
  assert.deepEqual(core.objectsForKey('light', { object: 'output_pin caselight' }), ['webhooks', 'output_pin caselight']);
  const box = core.renderKey('box', { box: 1, label: 'QIDI Box 1' }, snap);
  assert.equal(box.title, 'QIDI Box 1\n37°  52%\n→ 50°');
  assert.equal(box.fgColor, core.COLORS.heating);
  assert.equal(core.renderKey('box', { box: 2, label: '' }, snap).title, 'QIDI Box 2\n22°  41%');
  assert.deepEqual(core.objectsForKey('box', { box: 2 }), ['webhooks', 'aht20_f heater_box2', 'heater_generic heater_box2']);
  assert.deepEqual(core.gestureScripts('light', { gcodeShort: 'SET_PIN PIN=caselight VALUE=0', gcodeLong: 'SET_PIN PIN=caselight VALUE=1', gcodeIdleOnly: false }),
    { short: 'SET_PIN PIN=caselight VALUE=0', long: 'SET_PIN PIN=caselight VALUE=1', idleOnly: false });
});
