<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-text-field v-model="modelValue.data.label" label="Beschriftung (leer = keine)" :placeholder="defaultLabel"
          variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-combobox v-model="modelValue.data.object" :items="objectItems" :loading="loading"
          label="Klipper-Objekt (Heizung / Sensor)" variant="outlined" density="compact"
          :hint="hint" persistent-hint @focus="loadObjects" />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.showTarget" label="Solltemperatur" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.showPower" label="Heizleistung %" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-checkbox v-model="modelValue.data.colorize" label="Farbe nach Status" density="compact" hide-details />
      </v-col>
      <v-col cols="6" sm="3">
        <v-select v-model.number="modelValue.data.decimals" :items="[0, 1, 2]" label="Nachkommastellen"
          variant="outlined" density="compact" hide-details />
      </v-col>
    </v-row>

    <v-divider class="my-3" />
    <div class="text-subtitle-2 mb-1">G-Code beim Tippen (optional)</div>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeShort" label="Einfach tippen – z. B. „aus“" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="tplLine(0) || 'SET_HEATER_TEMPERATURE HEATER=… TARGET=0'" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-textarea v-model="modelValue.data.gcodeLong" label="Doppelt tippen – z. B. „an“" variant="outlined" rows="2" auto-grow
          class="gcode" hide-details spellcheck="false" :placeholder="tplLine(onTemp) || 'SET_HEATER_TEMPERATURE HEATER=… TARGET=50'" />
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
const KIND = '__KIND__';
const DEFAULTS = {
  hotend: { object: 'extruder', label: 'Hotend', heater: 'extruder', on: 250 },
   bed: { object: 'heater_bed', label: 'Druckbett', heater: 'heater_bed', on: 50 },
   chamber: { object: 'auto', label: 'Bauraum', heater: 'chamber', on: 30 },
};
export default {
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
