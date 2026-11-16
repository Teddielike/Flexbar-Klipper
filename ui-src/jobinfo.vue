<!-- Localized by the shared UI mixin during generation. -->
<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.field" :items="fields" :item-title="localizedTitle" item-value="value"
          label="Angezeigter Wert" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6">
        <v-text-field v-model="modelValue.data.label" label="Eigene Beschriftung (leer = Standard)" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col cols="12" sm="6" class="d-flex align-center">
        <v-checkbox v-model="modelValue.data.showLabel" label="Beschriftung anzeigen" density="compact" hide-details />
      </v-col>
      <v-col v-if="['remaining', 'eta'].includes(modelValue.data.field)" cols="12" sm="6">
        <v-select v-model="modelValue.data.remainingMode" :items="modes" :item-title="localizedTitle" item-value="value"
          label="Restzeit-Berechnung" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col v-if="modelValue.data.field === 'progress'" cols="12" sm="6">
        <v-select v-model="modelValue.data.bar" :items="bars" :item-title="localizedTitle" item-value="value"
          label="Fortschrittsbalken" variant="outlined" density="compact" hide-details />
      </v-col>
      <template v-if="modelValue.data.field === 'filename'">
        <v-col cols="6">
          <v-text-field v-model.number="modelValue.data.maxLength" type="number" label="Max. Länge" variant="outlined" density="compact" hide-details />
        </v-col>
        <v-col cols="6">
          <v-checkbox v-model="modelValue.data.stripExtension" label=".gcode ausblenden" density="compact" hide-details />
        </v-col>
      </template>
    </v-row>
  </v-container>
</template>

<script>
const DEFAULTS = { printer: '', field: 'progress', label: '', showLabel: true, stripExtension: true, maxLength: 18,
  remainingMode: 'auto', bar: 'image' };
export default {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() {
    return {
      printers: [],
      fields: [
        { title: 'Fortschritt %', value: 'progress' },
        { title: 'Restzeit', value: 'remaining' },
        { title: 'Fertig um (Uhrzeit)', value: 'eta' },
        { title: 'Name des Druckteils', value: 'filename' },
        { title: 'Bisherige Druckzeit', value: 'elapsed' },
        { title: 'Layer', value: 'layer' },
        { title: 'Filamentverbrauch', value: 'filament' },
        { title: 'Druckerstatus', value: 'state' },
      ],
      modes: [
        { title: 'Automatisch (Slicer + Fortschritt)', value: 'auto' },
        { title: 'Dateifortschritt', value: 'file' },
        { title: 'Slicer-Schätzung', value: 'slicer' },
        { title: 'Filamentverbrauch', value: 'filament' },
      ],
      bars: [
        { title: 'Grafischer Balken', value: 'image' },
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
