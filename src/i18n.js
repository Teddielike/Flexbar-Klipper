'use strict';

// German source messages are stable lookup keys. Never translate user input,
// filenames, G-code, object names or errors returned by the printer.
const english = {
  'Bereit': 'Ready', 'Druckt': 'Printing', 'Pausiert': 'Paused', 'Fertig': 'Complete',
  'Abgebrochen': 'Cancelled', 'Fehler': 'Error', 'Startet…': 'Starting…',
  'Klipper-Fehler': 'Klipper error', 'Getrennt': 'Disconnected',
  'Drucker': 'Printer', 'Hotend': 'Hotend', 'Bett': 'Bed', 'Kammer': 'Chamber',
  'Druckbett': 'Build plate', 'Bauraum': 'Build chamber',
  'Sensor': 'Sensor', 'G-Code': 'G-code', 'Beleuchtung': 'Case light', 'Polar-Cooler': 'Polar cooler',
  'Datei': 'File', 'Restzeit': 'Time left', 'Fertig um': 'ETA', 'Druckzeit': 'Print time',
  'Fortschritt': 'Progress', 'Status': 'Status', 'Layer': 'Layer', 'Filament': 'Filament',
  'morgen {time}': 'tomorrow {time}', 'seit {duration}': 'elapsed {duration}',
  'aus': 'off', 'An': 'On', 'Aus': 'Off', 'kein Sensor': 'no sensor',
  'kein Objekt': 'no object', 'n/v': 'n/a', 'nicht konfiguriert': 'not configured',
  'sende…': 'sending…', 'läuft…': 'running…', 'nochmal tippen': 'tap again',
  'Fortsetzen?': 'Resume?', 'Pause?': 'Pause?', 'Abbrechen?': 'Cancel?',
  'NOT-AUS?': 'E-STOP?', 'Neustart?': 'Restart?', 'NOT-AUS': 'E-STOP',
  'Fortsetzen': 'Resume', 'Stopp': 'Stop', 'FW-Neustart': 'FW restart',
  'Drucker offline': 'Printer offline', 'Kein aktiver Druck': 'No active print',
  'Druck abgebrochen': 'Print cancelled', 'NOT-AUS ausgelöst': 'Emergency stop triggered',
  'Firmware-Neustart': 'Firmware restart', 'Kein G-Code konfiguriert': 'No G-code configured',
  'Klipper nicht bereit ({state})': 'Klipper not ready ({state})',
  'Nicht während eines Drucks': 'Not during a print',
  '{label} gesendet': '{label} sent', 'einfach': 'single tap', 'doppelt': 'double tap',
  'Kein Drucker\nkonfiguriert': 'No printer\nconfigured', 'Verbinde…': 'Connecting…',
  'Kein Drucker konfiguriert': 'No printer configured',
  'Zum Bestätigen erneut tippen': 'Tap again to confirm', 'G-Code läuft noch': 'G-code is still running',
  'Fehler: {error}': 'Error: {error}', 'G-Code: {error}': 'G-code: {error}',
  'Keine IP/Hostname angegeben': 'No IP address/hostname specified', 'Unbekannte Aktion': 'Unknown action',
  'Ungültige Sprache': 'Invalid locale',
  'Zeitüberschreitung': 'Request timed out', 'Verbindung abgelehnt': 'Connection refused',
  'Host nicht erreichbar': 'Host unreachable', 'Host nicht gefunden': 'Host not found',
  'Kein Benutzername konfiguriert': 'No username configured', 'Login fehlgeschlagen': 'Login failed',
  'Nicht autorisiert – API-Key oder Login nötig': 'Unauthorized – API key or login required',
  'Zugangsdaten abgelehnt': 'Credentials rejected',
  'Programm geöffnet': 'Program opened',
  'Programm auswählen': 'Choose program',
  'Programm konnte nicht geöffnet werden: {error}': 'Could not open program: {error}',
};

function normalizeLocale(value) {
  return typeof value === 'string' && /^de(?:[-_]|$)/i.test(value) ? 'de' : 'en';
}

function translate(message, locale = 'de', params = {}) {
  const text = normalizeLocale(locale) === 'de' ? message : (english[message] || message);
  return text.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
}

function translator(locale) { return (message, params) => translate(message, locale, params); }

module.exports = { normalizeLocale, translate, translator, english };
