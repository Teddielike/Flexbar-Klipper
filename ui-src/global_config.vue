<template>
  <v-container class="klipper-config">
    <v-card prepend-icon="mdi-printer-3d" title="Klipper / Moonraker – Drucker">
      <v-card-subtitle class="pb-2">
        Verbindung zu Moonraker. Direkt: Port 7125 · über Fluidd/Mainsail-Webserver: Port 80 (bzw. 443 mit HTTPS).
      </v-card-subtitle>
      <v-card-text>
        <v-alert v-if="notice" :type="notice.type" variant="tonal" density="compact" class="mb-3">{{ notice.text }}</v-alert>
        <v-progress-linear v-if="loading" indeterminate class="mb-3" :aria-label="ui('Konfiguration wird geladen…')" />
        <v-expansion-panels v-model="open" variant="accordion" :disabled="loading">
          <v-expansion-panel v-for="(p, i) in cfg.printers" :key="i" :value="i">
            <v-expansion-panel-title>
              <v-icon class="mr-2" size="small">mdi-printer-3d</v-icon>
              <strong>{{ p.name || (ui('Drucker') + ' ' + (i + 1)) }}</strong>
              <span class="ml-3 text-medium-emphasis">{{ p.host ? (p.host + ':' + (p.port || 7125)) : ui('nicht konfiguriert') }}</span>
              <v-chip v-if="results[i]" size="x-small" class="ml-3" :color="results[i].ok ? 'success' : 'error'" variant="tonal">
                {{ results[i].ok ? 'OK' : ui('Fehler') }}
              </v-chip>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-row dense>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="p.name" label="Name" variant="outlined" density="compact" hide-details />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="p.id" label="Interne ID" variant="outlined" density="compact" hide-details
                    hint="Wird von den Tasten referenziert" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="p.host" label="IP-Adresse / Hostname" placeholder="192.168.1.50"
                    variant="outlined" density="compact" hide-details />
                </v-col>
                <v-col cols="6" sm="3">
                  <v-text-field v-model.number="p.port" label="Port" type="number" variant="outlined" density="compact" hide-details />
                </v-col>
                <v-col cols="6" sm="3" class="d-flex align-center">
                  <v-switch v-model="p.https" label="HTTPS" color="primary" density="compact" hide-details />
                </v-col>
                <v-col v-if="p.https" cols="12">
                  <v-checkbox v-model="p.insecure" label="Selbstsigniertes Zertifikat akzeptieren" density="compact" hide-details />
                </v-col>
                <v-col cols="12">
                  <v-btn-toggle v-model="p.authMode" mandatory density="compact" color="primary" variant="outlined" divided>
                    <v-btn value="none">Ohne Anmeldung</v-btn>
                    <v-btn value="login">Benutzer / Passwort</v-btn>
                    <v-btn value="apikey">API-Key</v-btn>
                  </v-btn-toggle>
                </v-col>
                <template v-if="p.authMode === 'login'">
                  <v-col cols="12" sm="6">
                    <v-text-field v-model="p.username" label="Benutzername" variant="outlined" density="compact" hide-details autocomplete="off" />
                  </v-col>
                  <v-col cols="12" sm="6">
                    <v-text-field v-model="p.password" label="Passwort" variant="outlined" density="compact" hide-details
                      :type="showPw ? 'text' : 'password'" :append-inner-icon="showPw ? 'mdi-eye-off' : 'mdi-eye'"
                      @click:append-inner="showPw = !showPw" autocomplete="new-password" />
                  </v-col>
                </template>
                <v-col v-if="p.authMode === 'apikey'" cols="12">
                  <v-text-field v-model="p.apiKey" label="Moonraker API-Key" variant="outlined" density="compact" hide-details
                    :type="showPw ? 'text' : 'password'" :append-inner-icon="showPw ? 'mdi-eye-off' : 'mdi-eye'"
                    @click:append-inner="showPw = !showPw" />
                </v-col>
                <v-col cols="12" class="d-flex align-center flex-wrap" style="gap: 8px">
                  <v-btn color="primary" variant="tonal" prepend-icon="mdi-lan-connect" :loading="testing === i" @click="test(i)">
                    Verbindung testen
                  </v-btn>
                  <v-spacer />
                  <v-btn color="error" variant="text" prepend-icon="mdi-delete" @click="remove(i)">Entfernen</v-btn>
                </v-col>
                <v-col v-if="results[i]" cols="12">
                  <v-alert :type="results[i].ok ? 'success' : 'error'" variant="tonal" density="compact">
                    <template v-if="results[i].ok">
                      Verbunden – Klipper: <b>{{ results[i].klippyState }}</b>
                      <span v-if="results[i].klipper"> · {{ results[i].klipper }}</span>
                      <span v-if="results[i].hostname"> · Host {{ results[i].hostname }}</span>
                      <span v-if="results[i].moonraker"> · Moonraker {{ results[i].moonraker }}</span>
                      <div v-if="results[i].objectCount">{{ results[i].objectCount }} Klipper-Objekte gefunden.
                        <span v-if="results[i].chamber && results[i].chamber.length">Kammersensor: {{ results[i].chamber[0] }}</span>
                        <span v-else>Kein Kammersensor automatisch gefunden.</span>
                      </div>
                    </template>
                    <template v-else>{{ results[i].error }}</template>
                  </v-alert>
                </v-col>
              </v-row>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <v-btn class="mt-3" variant="outlined" prepend-icon="mdi-plus" :disabled="loading" @click="add">Drucker hinzufügen</v-btn>

        <v-divider class="my-4" />
        <v-row dense>
          <v-col cols="12" sm="6">
            <v-text-field v-model.number="cfg.pollInterval" :disabled="loading" label="Aktualisierungsintervall (ms)" type="number" min="500"
              variant="outlined" density="compact" hint="Standard 2000 ms" persistent-hint />
          </v-col>
        </v-row>
        <v-text-field v-model="cfg.fontFamily" :disabled="loading" label="Schriftarten für die FlexBar" class="mt-3"
          placeholder="Arial Narrow, Arial" variant="outlined" density="compact"
          hint="Kommagetrennte Prioritätsliste. Erste verfügbare Schrift wird genutzt; leer = Schrift der Taste aus FlexDesigner."
          persistent-hint />
        <v-alert type="info" variant="tonal" density="compact" class="mt-3">
          Zugangsdaten werden lokal in der Plugin-Konfiguration von FlexDesigner gespeichert.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="elevated" prepend-icon="mdi-content-save" :disabled="loading" :loading="saving" @click="save">Speichern</v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<script>
function blankPrinter(n, name) {
  return { id: 'printer' + n, name, host: '', port: 7125, https: false, insecure: false,
    authMode: 'none', username: '', password: '', apiKey: '' };
}
export default {
  props: {
    modelValue: { type: Object, default: null },
  },
  data() {
    // Use an independent editable draft: the host can replace its model while
    // loading the settings iframe. Never mutate or depend on that model in render.
    return { cfg: { printers: [], pollInterval: 2000, fontFamily: 'Arial Narrow, Arial' },
      open: 0, testing: -1, results: {}, showPw: false, loading: false, saving: false, notice: null };
  },
  created() {
    const raw = this.modelValue && this.modelValue.config;
    this.initializeConfig(raw);
    this.loading = !raw || typeof raw !== 'object' || Array.isArray(raw);
  },
  async mounted() {
    if (!this.loading) return;
    try { this.initializeConfig(await this.$fd.getConfig()); }
    catch (_) { this.notice = { type: 'warning', text: this.ui('Konfiguration konnte nicht geladen werden. Bitte die Einstellungsseite erneut öffnen.') }; }
    finally { this.loading = false; }
  },
  methods: {
    initializeConfig(raw) {
      const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? JSON.parse(JSON.stringify(raw)) : {};
      if (!Array.isArray(c.printers)) c.printers = c.host ? [Object.assign(blankPrinter(1, this.ui('Drucker') + ' 1'), c)] : [];
      c.printers = c.printers.filter(p => p && typeof p === 'object' && !Array.isArray(p));
      if (!c.printers.length) c.printers.push(blankPrinter(1, this.ui('Drucker') + ' 1'));
      if (!c.pollInterval) c.pollInterval = 2000;
      if (c.fontFamily === undefined) c.fontFamily = 'Arial Narrow, Arial';
      for (const p of c.printers) {
        if (!p.authMode) p.authMode = 'none';
        if (!p.port) p.port = 7125;
      }
      this.cfg = c;
      this.open = 0;
    },
    add() {
      const ids = new Set(this.cfg.printers.map(p => p.id));
      let n = this.cfg.printers.length + 1;
      while (ids.has('printer' + n)) n++;
      this.cfg.printers.push(blankPrinter(n, this.ui('Drucker') + ' ' + n));
      this.open = this.cfg.printers.length - 1;
    },
    remove(i) {
      this.cfg.printers.splice(i, 1);
      this.results = {};
    },
    async test(i) {
      this.testing = i;
      try {
        const r = await this.$fd.sendToBackend({ action: 'testConnection', printer: JSON.parse(JSON.stringify(this.cfg.printers[i])) });
        this.results = Object.assign({}, this.results, { [i]: r || { ok: false, error: this.ui('Keine Antwort vom Plugin') } });
      } catch (e) {
        this.results = Object.assign({}, this.results, { [i]: { ok: false, error: String(e && e.message || e) } });
      } finally {
        this.testing = -1;
      }
    },
    async save() {
      if (this.saving || this.loading) return;
      this.saving = true;
      this.notice = null;
      const config = JSON.parse(JSON.stringify(this.cfg));
      config._locale = /^de(?:[-_]|$)/i.test(this.$i18n.locale) ? 'de' : 'en';
      try {
        const result = await this.$fd.setConfig(config);
        if (result && (result.status === 'error' || result.ok === false)) throw new Error(result.error || this.ui('Speichern fehlgeschlagen:'));
        // Make sure the backend picks it up even if no config event is delivered.
        try { await this.$fd.sendToBackend({ action: 'reloadConfig', config }); }
        catch (_) {
          this.notice = { type: 'warning', text: this.ui('Konfiguration gespeichert. Das Backend ist nicht erreichbar; bitte das Plugin neu starten.') };
          return;
        }
        this.notice = { type: 'success', text: this.ui('Klipper-Konfiguration gespeichert') };
        this.$fd.showSnackbarMessage('success', this.ui('Klipper-Konfiguration gespeichert'));
      } catch (e) {
        this.notice = { type: 'error', text: this.ui('Speichern fehlgeschlagen:') + ' ' + (e && e.message || e) };
        this.$fd.showSnackbarMessage('error', this.notice.text);
      } finally { this.saving = false; }
    },
  },
};
</script>

<style scoped>
.klipper-config { max-width: 860px; }
</style>
