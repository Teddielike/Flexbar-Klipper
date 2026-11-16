<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-text-field v-model="modelValue.data.label" label="Beschriftung auf der Taste" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-textarea v-model="modelValue.data.gcode" label="G-Code / Makros (eine Zeile pro Befehl)" variant="outlined"
          rows="4" auto-grow class="gcode" hide-details spellcheck="false"
          placeholder="SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50" />
      </v-col>
      <v-col cols="12">
        <div class="text-caption text-medium-emphasis mb-1">Vorlagen (ersetzen den Inhalt):</div>
        <div class="d-flex flex-wrap" style="gap: 6px">
          <v-chip v-for="t in templates" :key="t.title" size="small" variant="outlined" @click="apply(t)">{{ ui(t.title) }}</v-chip>
        </div>
      </v-col>
      <v-col cols="12" sm="6">
        <v-checkbox v-model="modelValue.data.confirm" label="Bestätigung durch zweites Tippen (3 s)" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-checkbox v-model="modelValue.data.idleOnly" label="Nur senden, wenn kein Druck läuft" density="compact" hide-details />
      </v-col>
      <v-col cols="12">
        <v-alert type="info" variant="tonal" density="compact">
          Die Befehle gehen über Moonraker (<code>/printer/gcode/script</code>) an Klipper – Makros wie
          <code>PRINT_START</code> oder <code>LOAD_FILAMENT</code> funktionieren ebenso. Wartende Befehle (z. B. <code>M190</code>)
          laufen im Hintergrund weiter; die Taste zeigt „läuft…“, bis Klipper fertig ist.
        </v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
const DEFAULTS = { printer: '', gcode: '', confirm: false, idleOnly: false };
export default {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() {
    return {
      printers: [],
      templates: [
        { title: 'Bett 60 °C', label: 'Bett 60°', gcode: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60' },
        { title: 'Hotend 200 °C', label: 'Hotend 200°', gcode: 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=200' },
        { title: 'PLA vorheizen', label: 'PLA', gcode: 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60\nSET_HEATER_TEMPERATURE HEATER=extruder TARGET=150' },
        { title: 'Box trocknen 50 °C', label: 'Trocknen', gcode: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=50' },
        { title: 'Box aus', label: 'Box aus', gcode: 'SET_HEATER_TEMPERATURE HEATER=heater_box1 TARGET=0' },
        { title: 'Alle Heizungen aus', label: 'Heizung aus', gcode: 'TURN_OFF_HEATERS' },
        { title: 'Referenzfahrt', label: 'Home', gcode: 'G28' },
        { title: 'Motoren aus', label: 'Motoren aus', gcode: 'M84' },
      ],
    };
  },
  computed: {
    printerItems() {
      return [{ title: this.ui('Standard (erster Drucker)'), value: '' }].concat(this.printers.map(p => ({ title: p.name + ' (' + p.host + ')', value: p.id })));
    },
  },
  watch: {
    'modelValue.data': { deep: true, handler() { this.$emit('update:modelValue', this.modelValue); } },
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
  },
  methods: {
    apply(t) {
      this.modelValue.data.gcode = t.gcode;
      this.modelValue.data.label = this.ui(t.label);
    },
  },
};
</script>

<style scoped>
.gcode :deep(textarea) { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
</style>
