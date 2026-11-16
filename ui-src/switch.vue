<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6" class="d-flex align-center" style="gap: 8px">
        <v-checkbox v-model="modelValue.data.showText" :label="ui(kind === 'light' ? 'Text statt Lampensymbol' : 'Text statt Schneeflocke')" density="compact" hide-details />
        <v-text-field v-if="modelValue.data.showText" v-model="modelValue.data.label" label="Beschriftung"
          variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-combobox v-model="modelValue.data.object" :items="objectItems" :loading="loading"
          label="Klipper-Objekt für die Anzeige An/Aus" variant="outlined" density="compact"
          hint="z. B. output_pin caselight – leer lassen, wenn kein Status angezeigt werden soll" persistent-hint @focus="loadObjects" />
      </v-col>
    </v-row>

    <v-divider class="my-3" />
    <div class="text-subtitle-2 mb-1">G-Code beim Tippen</div>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeShort" label="Einfach tippen – aus" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="pinLine(0)" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeLong" label="Doppelt tippen – an" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="pinLine(1)" />
      </v-col>
      <v-col cols="12" class="d-flex align-center">
        <v-spacer />
        <v-checkbox v-model="modelValue.data.gcodeIdleOnly" label="Nicht während eines Drucks" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-alert type="info" variant="tonal" density="compact">
          <b>Einfach tippen</b> sendet den ersten Code (nach 0,45 s, um ein zweites Tippen abzuwarten),
          <b>doppelt tippen</b> den zweiten.
          <span v-if="!modelValue.data.showText">{{ ui(kind === 'light' ? 'Die Lampe leuchtet gelb' : 'Die Schneeflocke wird blau') }}, sobald der Wert des Objekts größer als 0 ist.</span>
          <span v-else>Die Taste zeigt „An“ grün, sobald der Wert des Objekts größer als 0 ist.</span>
        </v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
const KIND = '__KIND__';
const DEFAULTS = {
  light: { label: 'Beleuchtung', pin: 'caselight' },
  cooler: { label: 'Polar-Cooler', pin: 'polar_cooler' },
}[KIND];
export default {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() {
    return { kind: KIND, printers: [], objects: [], loading: false, loadedFor: null };
  },
  computed: {
    printerItems() {
      return [{ title: this.ui('Standard (erster Drucker)'), value: '' }].concat(this.printers.map(p => ({ title: p.name + ' (' + p.host + ')', value: p.id })));
    },
    objectItems() {
      return this.objects.filter(o => /^(output_pin |smart_output_pin |fan_generic |led |neopixel )/.test(o));
    },
  },
  watch: {
    'modelValue.data': { deep: true, handler() { this.$emit('update:modelValue', this.modelValue); } },
    'modelValue.data.printer'() { this.objects = []; this.loadedFor = null; },
  },
  created() {
    const d = this.modelValue.data || (this.modelValue.data = {});
    const defaults = { printer: '', object: 'output_pin ' + DEFAULTS.pin,
      gcodeShort: 'SET_PIN PIN=' + DEFAULTS.pin + ' VALUE=0', gcodeLong: 'SET_PIN PIN=' + DEFAULTS.pin + ' VALUE=1', gcodeIdleOnly: false, showText: false };
    for (const [k, v] of Object.entries(defaults)) if (d[k] === undefined) d[k] = v;
  },
  async mounted() {
    try {
      const r = await this.$fd.sendToBackend({ action: 'listPrinters' });
      if (r && r.ok) this.printers = r.printers;
    } catch (_) { /* backend not running */ }
  },
  methods: {
    pinLine(v) {
      const m = /^output_pin (.+)$/.exec(this.modelValue.data.object || '');
      return 'SET_PIN PIN=' + (m ? m[1] : '…') + ' VALUE=' + v;
    },
    async loadObjects() {
      const p = this.modelValue.data.printer || '';
      if (this.loading || this.loadedFor === p) return;
      this.loading = true;
      try {
        const r = await this.$fd.sendToBackend({ action: 'listObjects', printer: p });
        if (r && r.ok) { this.objects = r.objects; this.loadedFor = p; }
      } catch (_) { /* offline */ } finally { this.loading = false; }
    },
  },
};
</script>

<style scoped>
.gcode :deep(textarea) { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
</style>
