'use strict';
// Generates the plugin manifest (single source of truth for keys).
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const { UUID } = require('../src/core');
const { localizeUi, local } = require('./localize-ui.cjs');

// FlexDesigner's extractPluginUUIDFromKeyCID consumes exactly three segments.
// Its manifest validator also accepts longer IDs, but then no UI can be loaded.
if (UUID.split('.').length !== 3) throw new Error('FlexDesigner requires a three-part plugin UUID for UI routing');

function key(id, icon, width, data, style = {}, clickable = true) {
  return {
    title: `$Keys.${id}.Title`,
    tip: `$Keys.${id}.Tip`,
    cid: `${UUID}.${id}`,
    config: { keyType: 'default', clickable, platform: ['mac', 'windows'] },
    style: {
      icon, width, showIcon: true, showTitle: true, showEmoji: false,
      fontSize: 15, iconSize: 30, bgColor: '#141a22', fgColor: '#f0f3f6',
      iconPos: { X: width >= 300 ? 9 : 17, Y: 50 },
      titlePos: { X: width >= 300 ? 56 : 62, Y: 50 },
      ...style,
    },
    data,
  };
}

// Single / double tap G-code (empty = off).
const GESTURE = { gcodeShort: '', gcodeLong: '', gcodeIdleOnly: true };

const children = [
  key('status', 'mdi mdi-printer-3d', 180, { printer: '', label: '', program: '' }),
  key('job', 'mdi mdi-printer-3d-nozzle', 440, {
    printer: '', showFilename: true, showProgress: true, showRemaining: true, showEta: false,
    showElapsed: false, showLayer: false, stripExtension: true, maxLength: 26, remainingMode: 'auto', bar: 'image',
  }),
  key('jobinfo', 'mdi mdi-progress-clock', 240, {
    printer: '', field: 'progress', label: '', showLabel: true, stripExtension: true, maxLength: 18,
    remainingMode: 'auto', bar: 'image',
  }),
  key('hotend', 'mdi mdi-printer-3d-nozzle-heat', 180, { printer: '', object: 'extruder', label: 'Hotend', showTarget: true, showPower: false, colorize: true, decimals: 0, ...GESTURE,
    gcodeShort: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0', gcodeLong: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=250' }),
  key('bed', 'mdi mdi-radiator', 180, { printer: '', object: 'heater_bed', showTarget: true, showPower: false, colorize: true, decimals: 0, ...GESTURE,
    gcodeShort: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=0', gcodeLong: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=50' }),
  key('chamber', 'mdi mdi-home-thermometer-outline', 180, { printer: '', object: 'auto', showTarget: true, showPower: false, colorize: true, decimals: 0, ...GESTURE,
    gcodeShort: 'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=0', gcodeLong: 'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=30' }),
  key('sensor', 'mdi mdi-water-percent', 180, {
    printer: '', label: 'Box', layout: 'inline',
    items: [{ object: '', field: 'temperature', prefix: '', unit: '', decimals: 1, scale: '' }], ...GESTURE,
  }),
  key('pause', 'mdi mdi-pause', 120, { printer: '', confirm: false }),
  key('cancel', 'mdi mdi-stop', 120, { printer: '', confirm: true }),
  key('estop', 'mdi mdi-alert-octagon', 120, { printer: '', confirm: true }, { bgColor: '#a31515', fgColor: '#ffffff' }),
  key('restart', 'mdi mdi-restart', 220, { printer: '', confirm: true }),
  key('light', 'mdi mdi-lightbulb-outline', 60, { printer: '', label: 'Beleuchtung', object: 'output_pin caselight', showText: false,
    gcodeShort: 'SET_PIN PIN=caselight VALUE=0', gcodeLong: 'SET_PIN PIN=caselight VALUE=1', gcodeIdleOnly: false },
  { showTitle: false, iconSize: 40, iconPos: { X: 50, Y: 50 } }),
  key('cooler', 'mdi mdi-snowflake', 60, { printer: '', label: 'Polar-Cooler', object: 'output_pin polar_cooler', showText: false,
    gcodeShort: 'SET_PIN PIN=polar_cooler VALUE=0', gcodeLong: 'SET_PIN PIN=polar_cooler VALUE=1', gcodeIdleOnly: false },
  { showTitle: false, iconSize: 40, iconPos: { X: 50, Y: 50 } }),
  key('box', 'mdi mdi-package-variant-closed', 180, { printer: '', box: 1, label: 'QIDI Box 1', showHumidity: true, showTarget: true,
    colorize: true, decimals: 0, gcodeShort: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=0',
    gcodeLong: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50', gcodeIdleOnly: false }),
  key('gcode', 'mdi mdi-console-line', 240, { printer: '', label: 'Bett 60°', gcode: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60', confirm: false, idleOnly: false }),
];

const de = {
  PluginName: 'Klipper',
  Keys: {
    status: { Title: 'Druckerstatus', Tip: 'Zeigt den Zustand des Druckers (Bereit, Druckt, Pausiert, Fehler, Offline).' },
    job: { Title: 'Druckauftrag', Tip: 'Aktueller Druck: Name, Fortschritt in %, Restzeit, optional Fertig-um, Layer und Fortschrittsbalken.' },
    jobinfo: { Title: 'Druck-Einzelwert', Tip: 'Ein einzelner Wert des aktuellen Drucks: Fortschritt, Restzeit, Fertig um, Dateiname, Layer, Filament …' },
    hotend: { Title: 'Hotend', Tip: 'Ist- und Solltemperatur des Hotends (extruder). Optional: eigener G-Code für einfaches und doppeltes Tippen.' },
    bed: { Title: 'Druckbett', Tip: 'Ist- und Solltemperatur der Bauplatte (heater_bed). Optional: eigener G-Code für einfaches und doppeltes Tippen.' },
    chamber: { Title: 'Bauraum', Tip: 'Bauraumtemperatur – wird automatisch erkannt oder frei gewählt. Optional: eigener G-Code für einfaches und doppeltes Tippen.' },
    sensor: { Title: 'Sensor (frei)', Tip: 'Beliebige Klipper-Objekte oder Moonraker-Sensoren, z. B. QIDI Box, Feuchtesensoren, Lüfter, MCU-Temperatur. Optional: eigener G-Code für einfaches und doppeltes Tippen.' },
    pause: { Title: 'Pause\nFortsetzen', Tip: 'Pausiert den laufenden Druck bzw. setzt ihn fort.' },
    cancel: { Title: 'Stopp', Tip: 'Bricht den laufenden Druck ab (standardmäßig mit Bestätigung durch zweites Tippen).' },
    estop: { Title: 'Not-Aus', Tip: 'Sendet M112 / Emergency Stop an Klipper (standardmäßig mit Bestätigung durch zweites Tippen).' },
    restart: { Title: 'Firmware-Neustart', Tip: 'FIRMWARE_RESTART – z. B. nach einem Not-Aus.' },
    light: { Title: 'Beleuchtung', Tip: 'Zeigt, ob die Beleuchtung an ist (output_pin caselight). Einfach tippen: aus, doppelt tippen: an.' },
    cooler: { Title: 'Polar-Cooler', Tip: 'Zeigt, ob der Polar-Cooler an ist (output_pin polar_cooler). Einfach tippen: aus, doppelt tippen: an.' },
    box: { Title: 'QIDI Box', Tip: 'Temperatur und Luftfeuchte der QIDI Box (aht20_f heater_boxN), Trocknungs-Soll. Einfach tippen: Trocknen aus, doppelt tippen: an.' },
    gcode: { Title: 'G-Code / Makro', Tip: 'Sendet eigenen G-Code oder Makros an den Drucker, z. B. Bett vorheizen oder Filament trocknen.' },
  },
};
const en = {
  PluginName: 'Klipper',
  Keys: {
    status: { Title: 'Printer status', Tip: 'Shows the printer state (ready, printing, paused, error, offline).' },
    job: { Title: 'Print job', Tip: 'Current print: name, progress %, time left, optional ETA, layer and progress bar.' },
    jobinfo: { Title: 'Print value', Tip: 'A single value of the current print: progress, time left, ETA, file name, layer, filament …' },
    hotend: { Title: 'Hotend', Tip: 'Current and target temperature of the hotend (extruder). Optional: custom G-code for single and double tap.' },
    bed: { Title: 'Build plate', Tip: 'Current and target temperature of the build plate (heater_bed). Optional: custom G-code for single and double tap.' },
    chamber: { Title: 'Build chamber', Tip: 'Build chamber temperature – auto-detected or freely selectable. Optional: custom G-code for single and double tap.' },
    sensor: { Title: 'Sensor (custom)', Tip: 'Any Klipper object or Moonraker sensor, e.g. QIDI Box, humidity sensors, fans, MCU temperature. Optional: custom G-code for single and double tap.' },
    pause: { Title: 'Pause\nResume', Tip: 'Pauses or resumes the current print.' },
    cancel: { Title: 'Stop', Tip: 'Cancels the current print (confirmation by second tap by default).' },
    estop: { Title: 'Emergency stop', Tip: 'Sends an emergency stop to Klipper (confirmation by second tap by default).' },
    restart: { Title: 'Firmware restart', Tip: 'FIRMWARE_RESTART – e.g. after an emergency stop.' },
    light: { Title: 'Case light', Tip: 'Shows whether the case light is on (output_pin caselight). Single tap: off, double tap: on.' },
    cooler: { Title: 'Polar cooler', Tip: 'Shows whether the polar cooler is on (output_pin polar_cooler). Single tap: off, double tap: on.' },
    box: { Title: 'QIDI Box', Tip: 'Temperature and humidity of the QIDI Box (aht20_f heater_boxN) and drying target. Single tap: drying off, double tap: on.' },
    gcode: { Title: 'G-code / macro', Tip: 'Sends custom G-code or macros to the printer, e.g. preheat the bed or dry filament.' },
  },
};

const manifest = {
  name: 'Klipper',
  uuid: UUID,
  version: pkg.version,
  author: 'Christian Sperber',
  entry: 'backend/plugin.cjs',
  description: 'Status und Steuerung für 3D-Drucker mit Klipper, Moonraker und Fluidd/Mainsail: Druckfortschritt, Restzeit, Temperaturen, freie Sensoren, Pause, Stopp und Not-Aus.',
  repo: 'https://github.com/Teddielike/Flexbar-Klipper',
  sdk: { version: '1.0.9' },
  software: { minimumVersion: '1.0.6' },
  os: [{ platform: 'mac', minimumVersion: '10.15' }, { platform: 'windows', minimumVersion: '10' }],
  device: [{ name: 'flexbar', version: '1.0.0' }],
  configPage: 'settings',
  shortcuts: [],
  keyLibrary: { title: '$PluginName', style: { icon: 'mdi mdi-printer-3d' }, children },
  local: { de: { ...de, UI: local.de }, en: { ...en, UI: local.en } },
};

// Omitted labels use translated runtime defaults. Explicit empty labels still
// hide the label; existing/custom labels are never rewritten on language changes.
for (const k of children) {
  if (['hotend', 'bed', 'chamber', 'light', 'cooler', 'box', 'gcode'].includes(k.cid.slice(UUID.length + 1))) delete k.data.label;
}

const out = path.join(__dirname, '..', `${UUID}.plugin`, 'manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

// Hotend, bed and chamber share one settings page.
const uiDir = path.join(__dirname, '..', `${UUID}.plugin`, 'ui');
const srcDir = path.join(__dirname, '..', 'ui-src');
const mixin = fs.readFileSync(path.join(srcDir, 'locale-mixin.js'), 'utf8');
function writeUi(name, source) { fs.writeFileSync(path.join(uiDir, `${name}.vue`), localizeUi(source, mixin)); }
const tpl = fs.readFileSync(path.join(__dirname, '..', 'ui-src', 'temperature.vue'), 'utf8');
for (const k of ['hotend', 'bed', 'chamber']) writeUi(k, tpl.replace(/__KIND__/g, k));
const ctl = fs.readFileSync(path.join(__dirname, '..', 'ui-src', 'control.vue'), 'utf8');
for (const k of ['status', 'pause', 'cancel', 'estop', 'restart']) writeUi(k, ctl.replace(/__KIND__/g, k));
const sw = fs.readFileSync(path.join(__dirname, '..', 'ui-src', 'switch.vue'), 'utf8');
for (const k of ['light', 'cooler']) writeUi(k, sw.replace(/__KIND__/g, k));
for (const k of ['global_config', 'job', 'jobinfo', 'sensor', 'box', 'gcode']) writeUi(k, fs.readFileSync(path.join(srcDir, `${k}.vue`), 'utf8'));
// Resolve the global settings through a fresh CID (avoids cached old pages).
// Ship both filename conventions used by FlexDesigner/plugin tooling.
const settings = fs.readFileSync(path.join(srcDir, 'global_config.vue'), 'utf8');
writeUi('settings', settings);
writeUi(`${UUID}.settings`, settings);
console.log('manifest + generated UIs written');
