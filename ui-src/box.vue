<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="2">
        <v-select v-model.number="modelValue.data.box" :items="boxItems" label="Box" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="4">
        <v-text-field v-model="modelValue.data.label" label="Beschriftung" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <div class="text-caption text-medium-emphasis">
          Sensor: <code>aht20_f heater_box{{ n }}</code> (Temperatur, Luftfeuchte) · Heizung: <code>heater_generic heater_box{{ n }}</code>
          <span v-if="foundBoxes.length"> · gefunden: Box {{ foundBoxes.join(', ') }}</span>
        </div>
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.showHumidity" label="Luftfeuchte" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.showTarget" label="Trocknungs-Soll" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.colorize" label="Farbe nach Status" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-select v-model.number="modelValue.data.decimals" :items="[0, 1]" label="Nachkommastellen" variant="outlined" density="compact" hide-details />
      </v-col>
    </v-row>

    <v-divider class="my-3" />
    <div class="text-subtitle-2 mb-1">G-Code beim Tippen</div>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeShort" label="Einfach tippen – Trocknen aus" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeLong" label="Doppelt tippen – Trocknen an" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" />
      </v-col>
      <v-col cols="12" class="d-flex align-center">
        <v-spacer />
        <v-checkbox v-model="modelValue.data.gcodeIdleOnly" label="Nicht während eines Drucks" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-alert type="info" variant="tonal" density="compact">
          Beim Wechsel der Box-Nummer werden <code>heater_boxN</code> in Beschriftung und G-Code automatisch angepasst.
          <b>Einfach tippen</b> sendet den ersten Code (nach 0,45 s), <b>doppelt tippen</b> den zweiten.
        </v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
const DEFAULTS = { printer: '', box: 1, showHumidity: true, showTarget: true, colorize: true, decimals: 0,
  gcodeShort: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=0', gcodeLong: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50',
  gcodeIdleOnly: false };
export default {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() {
    return { printers: [], foundBoxes: [] };
  },
  computed: {
    n() { return Math.max(1, parseInt(this.modelValue.data.box, 10) || 1); },
    boxItems() {
      const max = Math.max(4, ...this.foundBoxes);
      return Array.from({ length: max }, (_, i) => i + 1);
    },
    printerItems() {
      return [{ title: this.ui('Standard (erster Drucker)'), value: '' }].concat(this.printers.map(p => ({ title: p.name + ' (' + p.host + ')', value: p.id })));
    },
  },
  watch: {
    'modelValue.data': { deep: true, handler() { this.$emit('update:modelValue', this.modelValue); } },
    'modelValue.data.box'(nv, ov) {
      const d = this.modelValue.data;
      const fix = t => String(t || '').replace(new RegExp('heater_box' + ov + '\\b', 'g'), 'heater_box' + nv);
      d.gcodeShort = fix(d.gcodeShort);
      d.gcodeLong = fix(d.gcodeLong);
      if (d.label === 'QIDI Box ' + ov) d.label = 'QIDI Box ' + nv;
    },
    'modelValue.data.printer'() { this.loadBoxes(); },
  },
  created() {
    const d = this.modelValue.data || (this.modelValue.data = {});
    for (const [k, v] of Object.entries(DEFAULTS)) if (d[k] === undefined) d[k] = v;
  },
  async mounted() {
    try {
      const r = await this.$fd.sendToBackend({ action: 'listPrinters' });
      if (r && r.ok) this.printers = r.printers;
    } catch (_) { /* backend not running */ }
    this.loadBoxes();
  },
  methods: {
    async loadBoxes() {
      try {
        const r = await this.$fd.sendToBackend({ action: 'listObjects', printer: this.modelValue.data.printer || '' });
        if (r && r.ok) {
          this.foundBoxes = r.objects.map(o => /^aht20_f heater_box(\d+)$/.exec(o)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b);
        }
      } catch (_) { /* offline */ }
    },
  },
};
</script>

<style scoped>
.gcode :deep(textarea) { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
</style>
