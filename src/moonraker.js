'use strict';
// Minimal Moonraker HTTP client (works directly on port 7125 or through the
// Fluidd/Mainsail nginx proxy on port 80/443).
const http = require('node:http');
const https = require('node:https');
const { translate } = require('./i18n');

class MoonrakerError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

class Moonraker {
  constructor(printer, getLocale = () => 'de') {
    this.printer = printer;
    this.t = message => translate(message, getLocale());
    this.token = null;
    this.refreshToken = null;
    this.agent = printer.https
      ? new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: !printer.insecure })
      : new http.Agent({ keepAlive: true, maxSockets: 4 });
  }

  close() { try { this.agent.destroy(); } catch (_) { /* ignore */ } }

  raw(method, path, body, timeout = 5000, withAuth = true) {
    const p = this.printer;
    const lib = p.https ? https : http;
    const payload = body ? JSON.stringify(body) : '';
    const headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (withAuth) {
      if (p.authMode === 'apikey' && p.apiKey) headers['X-Api-Key'] = p.apiKey;
      if (p.authMode === 'login' && this.token) headers.Authorization = 'Bearer ' + this.token;
    }
    const host = p.host.replace(/^\[|\]$/g, '');
    return new Promise((resolve, reject) => {
      const req = lib.request({ host, port: p.port, path, method, headers, agent: this.agent, timeout }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', c => { if (data.length < 4 * 1048576) data += c; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch (_) { /* not json */ }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json && 'result' in json ? json.result : json);
          const msg = json && json.error ? (json.error.message || JSON.stringify(json.error)) : `HTTP ${res.statusCode}`;
          reject(new MoonrakerError(msg, res.statusCode));
        });
      });
      req.on('timeout', () => req.destroy(new MoonrakerError(this.t('Zeitüberschreitung'), 0)));
      req.on('error', e => reject(e instanceof MoonrakerError ? e : new MoonrakerError(this.t(e.code === 'ECONNREFUSED'
        ? 'Verbindung abgelehnt' : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? 'Host nicht erreichbar'
          : e.code === 'ENOTFOUND' ? 'Host nicht gefunden' : (e.message || String(e))), 0)));
      req.end(payload);
    });
  }

  async login() {
    const p = this.printer;
    if (!p.username) throw new MoonrakerError(this.t('Kein Benutzername konfiguriert'), 401);
    const r = await this.raw('POST', '/access/login', { username: p.username, password: p.password, source: 'moonraker' }, 8000, false);
    this.token = r && r.token;
    this.refreshToken = r && r.refresh_token;
    if (!this.token) throw new MoonrakerError(this.t('Login fehlgeschlagen'), 401);
  }

  async refresh() {
    if (!this.refreshToken) return this.login();
    try {
      const r = await this.raw('POST', '/access/refresh_jwt', { refresh_token: this.refreshToken }, 8000, false);
      this.token = r && r.token;
      if (!this.token) throw new Error('no token');
    } catch (_) { await this.login(); }
  }

  async request(method, path, body, timeout) {
    if (this.printer.authMode === 'login' && !this.token) await this.login();
    try {
      return await this.raw(method, path, body, timeout);
    } catch (e) {
      if (e.status === 401 && this.printer.authMode === 'login') {
        await this.refresh();
        return this.raw(method, path, body, timeout);
      }
      if (e.status === 401 || e.status === 403) {
        throw new MoonrakerError(this.t(this.printer.authMode === 'none'
          ? 'Nicht autorisiert – API-Key oder Login nötig' : 'Zugangsdaten abgelehnt'), e.status);
      }
      throw e;
    }
  }

  get(path, timeout) { return this.request('GET', path, null, timeout); }
  post(path, body, timeout) { return this.request('POST', path, body, timeout); }

  queryObjects(names) {
    const q = names.map(n => encodeURIComponent(n)).join('&');
    return this.get('/printer/objects/query?' + q);
  }
  listObjects() { return this.get('/printer/objects/list'); }
  serverInfo() { return this.get('/server/info'); }
  printerInfo() { return this.get('/printer/info'); }
  metadata(filename) { return this.get('/server/files/metadata?filename=' + encodeURIComponent(filename)); }
  async sensors() {
    try { return await this.get('/server/sensors/list'); } catch (e) { if (e.status === 404) return { sensors: {} }; throw e; }
  }
}

module.exports = { Moonraker, MoonrakerError };
