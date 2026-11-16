<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.remainingMode" :items="modes" :item-title="localizedTitle" item-value="value"
          label="Restzeit-Berechnung" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12"><div class="text-subtitle-2 mt-2">Angezeigte Informationen</div></v-col>
      <v-col v-for="o in options" :key="o.key" cols="6" sm="4">
        <v-checkbox v-model="modelValue.data[o.key]" :label="ui(o.label)" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.bar" :items="bars" :item-title="localizedTitle" item-value="value"
          label="Fortschrittsbalken" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-text-field v-model.number="modelValue.data.maxLength" type="number" min="6" max="60"
          label="Max. Länge Dateiname" variant="outlined" density="compact" hide-details />
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
const DEFAULTS = { printer: '', showFilename: true, showProgress: true, showRemaining: true, showEta: false,
  showElapsed: false, showLayer: false, stripExtension: true, maxLength: 26, remainingMode: 'auto', bar: 'image' };
export default {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() {
    return {
      printers: [],
      options: [
        { key: 'showFilename', label: 'Name des Druckteils' },
        { key: 'showProgress', label: 'Fortschritt %' },
        { key: 'showRemaining', label: 'Restzeit' },
        { key: 'showEta', label: 'Fertig um (Uhrzeit)' },
        { key: 'showElapsed', label: 'Bisherige Druckzeit' },
        { key: 'showLayer', label: 'Layer x / y' },
        { key: 'stripExtension', label: '.gcode ausblenden' },
      ],
      modes: [
        { title: 'Automatisch (Slicer + Fortschritt)', value: 'auto' },
        { title: 'Dateifortschritt', value: 'file' },
        { title: 'Slicer-Schätzung', value: 'slicer' },
        { title: 'Filamentverbrauch', value: 'filament' },
      ],
      bars: [
        { title: 'Grafischer Balken', value: 'image' },
        { title: 'Textbalken ████░░', value: 'text' },
        { title: 'Kein Balken', value: 'none' },
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
};
</script>
