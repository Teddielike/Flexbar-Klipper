<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          :label="ui('Drucker')" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-text-field v-model="modelValue.data.label" :label="ui('Beschriftung (leer = keine)')" :placeholder="defaultLabel"
          variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-combobox v-model="modelValue.data.object" :items="objectItems" :loading="loading"
          :label="ui('Klipper-Objekt (Heizung / Sensor)')" variant="outlined" density="compact"
          :hint="hint" persistent-hint @focus="loadObjects" />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.showTarget" :label="ui('Solltemperatur')" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.showPower" :label="ui('Heizleistung %')" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.colorize" :label="ui('Farbe nach Status')" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-select v-model.number="modelValue.data.decimals" :items="[0, 1, 2]" :label="ui('Nachkommastellen')"
          variant="outlined" density="compact" hide-details />
      </v-col>
    </v-row>

    <v-divider class="my-3" />
    <div class="text-subtitle-2 mb-1">{{ ui("G-Code beim Tippen (optional)") }}</div>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeShort" :label="ui('Einfach tippen – z. B. „aus“')" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="tplLine(0) || 'SET_HEATER_TEMPERATURE HEATER=… TARGET=0'" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeLong" :label="ui('Doppelt tippen – z. B. „an“')" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="tplLine(onTemp) || 'SET_HEATER_TEMPERATURE HEATER=… TARGET=50'" />
      </v-col>
      <v-col cols="12" class="d-flex align-center flex-wrap" style="gap: 8px">
        <v-btn size="small" variant="text" prepend-icon="mdi-close" @click="modelValue.data.gcodeShort = ''; modelValue.data.gcodeLong = ''">{{ ui("Leeren") }}</v-btn>
        <v-spacer />
        <v-checkbox v-model="modelValue.data.gcodeIdleOnly" :label="ui('Nicht während eines Drucks')" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-alert type="info" variant="tonal" density="compact">
          <b>{{ ui("Einfach tippen") }}</b> {{ ui("sendet den ersten Code (nach 0,45 s, um ein zweites Tippen abzuwarten),") }}
          <b>{{ ui("doppelt tippen") }}</b> {{ ui("den zweiten. Ohne zweiten Code wird der erste sofort gesendet.") }}
          <span v-if="!heaterCommand && objectName"> {{ ui("„") }}{{ objectName }}{{ ui("“ ist kein Heizelement – Code bitte selbst eintragen.") }}</span>
        </v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
const KLIPPER_UI_KEYS = {"Konfiguration wird geladen…":"ma45850db2005","Konfiguration konnte nicht geladen werden. Bitte die Einstellungsseite erneut öffnen.":"m5a84048ee669","Konfiguration gespeichert. Das Backend ist nicht erreichbar; bitte das Plugin neu starten.":"m1852488b6cc2","Hotend":"maa591be9b71e","Druckbett":"m9e840bdfa41b","Bauraum":"mebd0e866e47c","Schriftarten für die FlexBar":"mc12fd52b86aa","Kommagetrennte Prioritätsliste. Erste verfügbare Schrift wird genutzt; leer = Schrift der Taste aus FlexDesigner.":"me83fae29f977","Drucker":"m3e305e7fdf7b","Fehler":"mf6cc01cb7edb","nicht konfiguriert":"m1200fafc884d","Standard (erster Drucker)":"m5e7adf66644d","Beschriftung":"m30988b745948","Beschriftung (leer = keine)":"mae2087ad82c5","Beschriftung (leer = Druckername)":"mbbdbb43f8cc0","Eigene Beschriftung (leer = Standard)":"mf3ba90f0852d","Beschriftung auf der Taste":"mfe1aa5426ecd","Beschriftung anzeigen":"mce984c08718b","Bestätigung durch zweites Tippen (3 s)":"m361037d69e46","Nicht während eines Drucks":"m5cbbfd25d962","Klipper-Objekt (Heizung / Sensor)":"ma1f713cf27ca","Solltemperatur":"meebd09bd8634","Heizleistung %":"mf01c4f31b39f","Farbe nach Status":"m62c2de05eef5","Nachkommastellen":"mfb5d6f77b36e","G-Code beim Tippen (optional)":"mfe2d4d9fdb6d","G-Code beim Tippen":"m9c557b5e3b92","Einfach tippen – z. B. „aus“":"m7951c6100fd4","Doppelt tippen – z. B. „an“":"m7a8cd714eade","Einfach tippen":"m0989c646f8e6","doppelt tippen":"m4e6879216bb5","Leeren":"m9de63c78485e","sendet den ersten Code (nach 0,45 s, um ein zweites Tippen abzuwarten),":"m1bc98359b65c","den zweiten. Ohne zweiten Code wird der erste sofort gesendet.":"md7a8e160eb04","den zweiten.":"m6785f499bcc2","Ohne zweiten Code wird der erste sofort gesendet.":"m421c5296802e","„":"me89a9e21ef45","“ ist kein Heizelement – Code bitte selbst eintragen.":"m2799697a2b1d","auto = erstes Objekt mit „chamber“ im Namen":"m50017fa79461","Standard:":"ma99574a8529c","Tippen pausiert einen laufenden Druck bzw. setzt einen pausierten Druck fort. Das Symbol wechselt automatisch.":"m57d9eaacaa53","Bricht den laufenden Druck ab (CANCEL_PRINT-Makro).":"mfd2193ccd5c8","Not-Aus stoppt Klipper sofort (M112). Danach ist ein Firmware-Neustart nötig. Die Bestätigung schützt vor versehentlichem Berühren der FlexBar.":"m965fd0667316","Führt FIRMWARE_RESTART aus – z. B. nach einem Not-Aus oder Fehler.":"m4b94da343b1e","Text statt Lampensymbol":"m1700c6a9fe8c","Text statt Schneeflocke":"m83d2ba8a3fe1","Klipper-Objekt für die Anzeige An/Aus":"ma6c48353330e","z. B. output_pin caselight – leer lassen, wenn kein Status angezeigt werden soll":"m79305d39c524","Einfach tippen – aus":"md6dfb7fbaab0","Doppelt tippen – an":"m054ca9925bb7","Die Lampe leuchtet gelb":"md333aa7061d6","Die Schneeflocke wird blau":"m24f8448bf6af",", sobald der Wert des Objekts größer als 0 ist.":"ma6e5b6758770","Die Taste zeigt „An“ grün, sobald der Wert des Objekts größer als 0 ist.":"m949d93ec5f0e","Restzeit-Berechnung":"m03f580896215","Angezeigte Informationen":"m57ff53b8e69b","Fortschrittsbalken":"m689c7511cbbb","Max. Länge Dateiname":"m82bdf3049e91","Max. Länge":"m9e96da01f530","Name des Druckteils":"me8394032270b","Fortschritt %":"m6337be3c71c5","Restzeit":"m38220f561750","Fertig um (Uhrzeit)":"m339ec9f419c1","Bisherige Druckzeit":"m1455afaa4a47","Layer x / y":"m40c19479df33",".gcode ausblenden":"me9e189573029","Automatisch (Slicer + Fortschritt)":"m548b8fc4e985","Dateifortschritt":"m0f6b38eafc53","Slicer-Schätzung":"m1f1d64d37486","Filamentverbrauch":"m937e5ec0d8bd","Grafischer Balken":"m872e40ff4a06","Textbalken ████░░":"m50de7fb057de","Kein Balken":"mf7deea092ed8","Angezeigter Wert":"mabcc1bdd7fda","Druckerstatus":"mca7b2a9dab47","Luftfeuchte":"m2efe8e4b46e7","Trocknungs-Soll":"m01c1e3ec10dc","Sensor:":"mf2d5d7ce04cc","(Temperatur, Luftfeuchte) · Heizung:":"m261f9e111750","· gefunden: Box":"m384d06f23cfa","Einfach tippen – Trocknen aus":"m7ddacf8cbc6d","Doppelt tippen – Trocknen an":"md496ee166907","Beim Wechsel der Box-Nummer werden":"m565e382e1e1f","in Beschriftung und G-Code automatisch angepasst.":"m97bcf002bf5c","sendet den ersten Code (nach 0,45 s),":"m8b432f62af76","G-Code / Makros (eine Zeile pro Befehl)":"mcb183dfd288f","Vorlagen (ersetzen den Inhalt):":"m3d1bd2d9e769","Nur senden, wenn kein Druck läuft":"m32881f4cc82c","Die Befehle gehen über Moonraker (":"md9e0b58d4a9b",") an Klipper – Makros wie":"m6a6f998b5f8f","oder":"mb81d9593a3f6","funktionieren ebenso. Wartende Befehle (z. B.":"m1380511882f5",") laufen im Hintergrund weiter; die Taste zeigt „läuft…“, bis Klipper fertig ist.":"mdccb82a0d369","Bett 60 °C":"m58a1e007849b","PLA vorheizen":"mfcf34fdd91f6","Box trocknen 50 °C":"meca7c3c03004","Box aus":"m6b0466c29903","Alle Heizungen aus":"me204a95cc551","Referenzfahrt":"m71889ab91ffd","Motoren aus":"m1ff7aad24f05","Bett 60°":"mfdaaf8405cd0","Trocknen":"m8b22eeac0f1a","Heizung aus":"m090f01864cfc","Anordnung":"mc7ed6a8e3910","Nebeneinander":"mf3148d80a0d1","Untereinander":"m79693cb796c5","Wähle beliebige Klipper-Objekte (z. B.":"m29f3f481ea5d",") oder Moonraker-Sensoren (":"mcb4be624273b",") und das gewünschte Feld. Bis zu 3 Werte pro Taste – z. B. Temperatur und Luftfeuchte der QIDI Box.":"m01f17ed12b82","Objekte laden":"mc79dd5e8a442","Objekt":"mfe41f9bb1834","Feld":"m1dbe99d0e423","Präfix":"m2d6e8f51097c","Einheit":"md5ba1549d55b","Stellen":"me97b6dee818e","Faktor":"m10519914aa6b","Entfernen":"m3828375a2d45","Wert hinzufügen":"m377d0269a297","Moonraker-Sensor:":"m329001fee580","Aktueller Wert:":"m64e831ce506d","Drucker nicht erreichbar":"m3cbc68baf6bb","Klipper / Moonraker – Drucker":"md2bb8b715d5a","Verbindung zu Moonraker. Direkt: Port 7125 · über Fluidd/Mainsail-Webserver: Port 80 (bzw. 443 mit HTTPS).":"mefddb5692027","Name":"mdcd1d5223f73","Interne ID":"m82c3bf61e3da","Wird von den Tasten referenziert":"m06cd24ce9a42","IP-Adresse / Hostname":"ma263a4ef03bc","Selbstsigniertes Zertifikat akzeptieren":"me58a7f186119","Ohne Anmeldung":"m1b3804d7c6a8","Benutzer / Passwort":"m293a980bc980","Benutzername":"mfc309e30dbbe","Passwort":"ma36c101570cc","Verbindung testen":"ma5d6a6f03db1","Verbunden – Klipper:":"m313eb280428c","Klipper-Objekte gefunden.":"mbaff35007a45","Kammersensor:":"m2b203c03e542","Kein Kammersensor automatisch gefunden.":"m6b9da0e2fabb","Drucker hinzufügen":"mbf15b884edaa","Aktualisierungsintervall (ms)":"mf2ad3ad5c432","Standard 2000 ms":"m144faa9a968d","Zugangsdaten werden lokal in der Plugin-Konfiguration von FlexDesigner gespeichert.":"m3af5500e6042","Speichern":"mf6b2ff39f540","Keine Antwort vom Plugin":"md312bb142616","Klipper-Konfiguration gespeichert":"md62701a76fad","Speichern fehlgeschlagen:":"m0da605e7db26"};
const KLIPPER_LOCALE_MIXIN = // Inlined by gen-manifest.cjs: FlexDesigner loads standalone Vue components.
// Read the host i18n instance, not navigator.language (which may be different).
({
  watch: {
    '$i18n.locale': { immediate: true, handler() { this.syncKlipperLocale(); } },
  },
  mounted() {
    // Retry while this page is open if the backend is starting or restarting.
    this.klipperLocaleTimer = setInterval(() => this.syncKlipperLocale(), 2000);
    this.syncKlipperLocale();
  },
  beforeUnmount() { clearInterval(this.klipperLocaleTimer); },
  methods: {
    ui(message, params) {
      const key = KLIPPER_UI_KEYS[message];
      if (!key) return message;
      const language = /^de(?:[-_]|$)/i.test(this.$i18n.locale) ? 'de' : 'en';
      return this.$t('UI.' + key, params || {}, { locale: language });
    },
    localizedTitle(item) { return this.ui(item.title); },
    async syncKlipperLocale() {
      const locale = this.$i18n.locale;
      if (!locale) return;
      if (this.klipperLocalePending) return this.klipperLocalePending;
      this.klipperLocalePending = Promise.resolve()
        .then(() => this.$fd.sendToBackend({ action: 'setLanguage', locale }))
        .catch(() => { /* Retry without blocking the settings page. */ })
        .finally(() => {
          this.klipperLocalePending = null;
          // A language switch during an in-flight request must not be lost.
          if (this.$i18n.locale !== locale) return this.syncKlipperLocale();
        });
      return this.klipperLocalePending;
    },
  },
});
const KIND = 'hotend';
const DEFAULTS = {
  hotend: { object: 'extruder', label: 'Hotend', heater: 'extruder', on: 250 },
   bed: { object: 'heater_bed', label: 'Druckbett', heater: 'heater_bed', on: 50 },
   chamber: { object: 'auto', label: 'Bauraum', heater: 'chamber', on: 30 },
};
export default {
  mixins: [KLIPPER_LOCALE_MIXIN],
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() {
    return { printers: [], objects: [], chamber: [], loading: false, loadedFor: null };
  },
  computed: {
    defaultLabel() { return this.ui(DEFAULTS[KIND].label); },
    onTemp() { return DEFAULTS[KIND].on; },
    objectName() { return (this.modelValue.data.object === 'auto' || !this.modelValue.data.object) ? (KIND === 'chamber' ? (this.chamber[0] || '') : ({ hotend: 'extruder', bed: 'heater_bed' })[KIND]) : this.modelValue.data.object; },
    heaterCommand() { return this.heaterCmd(this.objectName); },
    printerItems() {
      return [{ title: this.ui('Standard (erster Drucker)'), value: '' }].concat(this.printers.map(p => ({ title: p.name + ' (' + p.host + ')', value: p.id })));
    },
    objectItems() {
      const heat = this.objects.filter(o => /^(extruder\d*|heater_bed|heater_generic |temperature_sensor |temperature_fan )/.test(o));
      return (KIND === 'chamber' ? ['auto'] : []).concat(heat);
    },
    hint() {
      if (KIND === 'chamber') {
        return this.chamber.length ? 'auto = ' + this.chamber[0] : this.ui('auto = erstes Objekt mit „chamber“ im Namen');
      }
      return this.ui('Standard:') + ' ' + DEFAULTS[KIND].object;
    },
  },
  watch: {
    'modelValue.data': { deep: true, handler() { this.$emit('update:modelValue', this.modelValue); } },
    'modelValue.data.printer'() { this.objects = []; this.loadedFor = null; },
  },
  created() {
    const d = this.modelValue.data || (this.modelValue.data = {});
    const def = DEFAULTS[KIND];
    if (d.object === undefined) d.object = def.object;
    if (d.printer === undefined) d.printer = '';
    if (d.gcodeShort === undefined) d.gcodeShort = 'SET_HEATER_TEMPERATURE HEATER=' + def.heater + ' TARGET=0';
    if (d.gcodeLong === undefined) d.gcodeLong = 'SET_HEATER_TEMPERATURE HEATER=' + def.heater + ' TARGET=' + def.on;
    if (d.gcodeIdleOnly === undefined) d.gcodeIdleOnly = true;
    if (d.showTarget === undefined) d.showTarget = true;
    if (d.showPower === undefined) d.showPower = false;
    if (d.colorize === undefined) d.colorize = true;
    if (d.decimals === undefined) d.decimals = 0;
  },
  async mounted() {
    try {
      const r = await this.$fd.sendToBackend({ action: 'listPrinters' });
      if (r && r.ok) this.printers = r.printers;
    } catch (_) { /* backend not running */ }
    this.loadObjects();
  },
  methods: {
    heaterCmd(obj) {
      if (!obj) return null;
      if (/^extruder\d*$/.test(obj) || obj === 'heater_bed') return 'SET_HEATER_TEMPERATURE HEATER=' + obj + ' TARGET=';
      let m = /^heater_generic (.+)$/.exec(obj);
      if (m) return 'SET_HEATER_TEMPERATURE HEATER=' + m[1] + ' TARGET=';
      m = /^temperature_fan (.+)$/.exec(obj);
      if (m) return 'SET_TEMPERATURE_FAN_TARGET TEMPERATURE_FAN=' + m[1] + ' TARGET=';
      return null;
    },
    tplLine(t) { return this.heaterCommand ? this.heaterCommand + t : ''; },
    async loadObjects() {
      const p = this.modelValue.data.printer || '';
      if (this.loading || this.loadedFor === p) return;
      this.loading = true;
      try {
        const r = await this.$fd.sendToBackend({ action: 'listObjects', printer: p });
        if (r && r.ok) { this.objects = r.objects; this.chamber = r.chamber || []; this.loadedFor = p; }
      } catch (_) { /* offline */ } finally { this.loading = false; }
    },
  },
};
</script>

<style scoped>
.gcode :deep(textarea) { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
</style>
