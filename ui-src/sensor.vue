<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="4">
        <v-text-field v-model="modelValue.data.label" label="Beschriftung" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="2">
        <v-select v-model="modelValue.data.layout" :items="layouts" :item-title="localizedTitle" item-value="value"
          label="Anordnung" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-alert type="info" variant="tonal" density="compact">
          Wähle beliebige Klipper-Objekte (z. B. <code>temperature_sensor box</code>, <code>heater_generic …</code>,
          <code>aht10 …</code>, <code>fan</code>) oder Moonraker-Sensoren (<code>sensor:…</code>) und das gewünschte Feld.
          Bis zu 3 Werte pro Taste – z. B. Temperatur und Luftfeuchte der QIDI Box.
          <v-btn size="small" variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="loadObjects(true)">Objekte laden</v-btn>
          <span v-if="error" class="text-error">{{ error }}</span>
        </v-alert>
      </v-col>
    </v-row>

    <v-card v-for="(item, i) in modelValue.data.items" :key="i" variant="outlined" class="mb-2 pa-2">
      <v-row dense>
        <v-col cols="12" sm="7">
          <v-autocomplete v-model="item.object" :items="objectItems" item-title="title" item-value="value"
            label="Objekt" variant="outlined" density="compact" hide-details @update:modelValue="loadFields(i)" />
        </v-col>
        <v-col cols="12" sm="5">
          <v-combobox v-model="item.field" :items="fieldItems(i)" label="Feld" variant="outlined" density="compact" hide-details
            @focus="loadFields(i)" />
        </v-col>
        <v-col cols="3">
          <v-text-field v-model="item.prefix" label="Präfix" placeholder="🌡" variant="outlined" density="compact" hide-details />
        </v-col>
        <v-col cols="3">
          <v-text-field v-model="item.unit" label="Einheit" :placeholder="unitGuess(item.field)" variant="outlined" density="compact" hide-details />
        </v-col>
        <v-col cols="3">
          <v-select v-model.number="item.decimals" :items="[0, 1, 2, 3]" label="Stellen" variant="outlined" density="compact" hide-details />
        </v-col>
        <v-col cols="3">
          <v-text-field v-model="item.scale" label="Faktor" :placeholder="item.field === 'power' ? '100' : '1'" variant="outlined" density="compact" hide-details />
        </v-col>
        <v-col cols="12" class="d-flex">
          <span class="text-caption text-medium-emphasis">{{ preview(i) }}</span>
          <v-spacer />
          <v-btn size="small" variant="text" color="error" prepend-icon="mdi-delete" @click="modelValue.data.items.splice(i, 1)">Entfernen</v-btn>
        </v-col>
      </v-row>
    </v-card>
    <v-btn v-if="modelValue.data.items.length < 3" variant="outlined" size="small" prepend-icon="mdi-plus" @click="addItem">Wert hinzufügen</v-btn>

    <v-divider class="my-3" />
    <div class="text-subtitle-2 mb-1">G-Code beim Tippen (optional)</div>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeShort" label="Einfach tippen – z. B. „aus“" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="tplLine(0) || 'SET_HEATER_TEMPERATURE HEATER=… TARGET=0'" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeLong" label="Doppelt tippen – z. B. „an“" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="tplLine(50) || 'SET_HEATER_TEMPERATURE HEATER=… TARGET=50'" />
      </v-col>
      <v-col cols="12" class="d-flex align-center flex-wrap" style="gap: 8px">
        <v-btn size="small" variant="text" prepend-icon="mdi-close" @click="modelValue.data.gcodeShort = ''; modelValue.data.gcodeLong = ''">Leeren</v-btn>
        <v-spacer />
        <v-checkbox v-model="modelValue.data.gcodeIdleOnly" label="Nicht während eines Drucks" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-alert type="info" variant="tonal" density="compact">
          <b>Einfach tippen</b> sendet den ersten Code (nach 0,45 s, um ein zweites Tippen abzuwarten),
          <b>doppelt tippen</b> den zweiten.
          Ohne zweiten Code wird der erste sofort gesendet.
          <span v-if="!heaterCommand && objectName"> „{{ objectName }}“ ist kein Heizelement – Code bitte selbst eintragen.</span>
        </v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
const UNITS = { temperature: '°C', target: '°C', humidity: '%', pressure: 'hPa', power: '%', speed: 'rpm', rpm: 'rpm' };
export default {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() {
    return {
      printers: [], objects: [], sensors: [], fields: {}, loading: false, error: '', loadedFor: null,
      layouts: [{ title: 'Nebeneinander', value: 'inline' }, { title: 'Untereinander', value: 'lines' }],
    };
  },
  computed: {
    objectName() { return ((this.modelValue.data.items || []).find(i => i && i.object && !String(i.object).startsWith('sensor:')) || {}).object || ''; },
    heaterCommand() { return this.heaterCmd(this.objectName); },
    printerItems() {
      return [{ title: this.ui('Standard (erster Drucker)'), value: '' }].concat(this.printers.map(p => ({ title: p.name + ' (' + p.host + ')', value: p.id })));
    },
    objectItems() {
      const list = this.sensors.map(s => ({ title: this.ui('Moonraker-Sensor:') + ' ' + s.name, value: s.id }))
        .concat(this.objects.map(o => ({ title: o, value: o })));
      // Keep a configured value visible even when the printer is offline.
      for (const it of this.modelValue.data.items) {
        if (it.object && !list.some(l => l.value === it.object)) list.unshift({ title: it.object, value: it.object });
      }
      return list;
    },
  },
  watch: {
    'modelValue.data': { deep: true, handler() { this.$emit('update:modelValue', this.modelValue); } },
    'modelValue.data.printer'() { this.loadObjects(true); },
  },
  created() {
    const d = this.modelValue.data || (this.modelValue.data = {});
    if (d.printer === undefined) d.printer = '';
    if (d.gcodeShort === undefined) d.gcodeShort = '';
    if (d.gcodeLong === undefined) d.gcodeLong = '';
    if (d.gcodeIdleOnly === undefined) d.gcodeIdleOnly = true;
    if (d.label === undefined) d.label = '';
    if (!d.layout) d.layout = 'inline';
    if (!Array.isArray(d.items)) d.items = [];
    if (!d.items.length) this.addItem();
  },
  async mounted() {
    try {
      const r = await this.$fd.sendToBackend({ action: 'listPrinters' });
      if (r && r.ok) this.printers = r.printers;
    } catch (_) { /* backend not running */ }
    await this.loadObjects();
    this.modelValue.data.items.forEach((_, i) => this.loadFields(i));
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
    addItem() {
      this.modelValue.data.items.push({ object: '', field: 'temperature', prefix: '', unit: '', decimals: 1, scale: '' });
    },
    unitGuess(f) { return UNITS[f] || ''; },
    fieldItems(i) {
      const it = this.modelValue.data.items[i];
      const f = it && this.fields[it.object];
      return f ? Object.keys(f) : ['temperature', 'humidity', 'pressure', 'target', 'power', 'speed', 'rpm'];
    },
    preview(i) {
      const it = this.modelValue.data.items[i];
      const f = it && this.fields[it.object];
      if (!f || !(it.field in f)) return '';
      return this.ui('Aktueller Wert:') + ' ' + f[it.field];
    },
    async loadObjects(force) {
      const p = this.modelValue.data.printer || '';
      if (this.loading || (!force && this.loadedFor === p)) return;
      this.loading = true; this.error = '';
      try {
        const r = await this.$fd.sendToBackend({ action: 'listObjects', printer: p });
        if (r && r.ok) { this.objects = r.objects; this.sensors = r.sensors || []; this.loadedFor = p; this.fields = {}; }
        else this.error = (r && r.error) || this.ui('Drucker nicht erreichbar');
      } catch (e) { this.error = String(e && e.message || e); } finally { this.loading = false; }
    },
    async loadFields(i) {
      const it = this.modelValue.data.items[i];
      if (!it || !it.object || this.fields[it.object]) return;
      try {
        const r = await this.$fd.sendToBackend({ action: 'objectFields', printer: this.modelValue.data.printer || '', object: it.object });
        if (r && r.ok) {
          this.fields = Object.assign({}, this.fields, { [it.object]: r.fields });
          const keys = Object.keys(r.fields);
          if (keys.length && !keys.includes(it.field)) it.field = keys.includes('temperature') ? 'temperature' : keys[0];
        }
      } catch (_) { /* offline */ }
    },
  },
};
</script>

<style scoped>
.gcode :deep(textarea) { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
</style>
