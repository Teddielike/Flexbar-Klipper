<template>
  <v-container>
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-select v-model="modelValue.data.printer" :items="printerItems" item-title="title" item-value="value"
          label="Drucker" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col v-if="kind === 'status'" cols="12" sm="6">
        <v-text-field v-model="modelValue.data.label" label="Beschriftung (leer = Druckername)" variant="outlined" density="compact" hide-details />
      </v-col>
      <v-col v-if="kind === 'status'" cols="12">
        <v-row dense align="center">
          <v-col>
            <v-text-field v-model="modelValue.data.program" :label="ui('Programm / App öffnen (optional)')" :placeholder="ui('z. B. QIDI Studio oder /Applications/QIDI Studio.app')" variant="outlined" density="compact" hide-details />
          </v-col>
          <v-col cols="auto">
            <v-btn icon="mdi-open-in-new" variant="text" :aria-label="ui('Anwendung öffnen')" :title="ui('Anwendung öffnen')" @click="chooseProgram" />
          </v-col>
        </v-row>
      </v-col>
      <v-col v-else cols="12" sm="6" class="d-flex align-center">
        <v-checkbox v-model="modelValue.data.confirm" label="Bestätigung durch zweites Tippen (3 s)" density="compact" hide-details />
      </v-col>
      <v-col v-if="note" cols="12">
        <v-alert :type="kind === 'estop' ? 'warning' : 'info'" variant="tonal" density="compact">{{ ui(note) }}</v-alert>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
const KIND = '__KIND__';
const CONFIRM_DEFAULT = { pause: false, cancel: true, estop: true, restart: true, status: false };
const NOTES = {
  pause: 'Tippen pausiert einen laufenden Druck bzw. setzt einen pausierten Druck fort. Das Symbol wechselt automatisch.',
  cancel: 'Bricht den laufenden Druck ab (CANCEL_PRINT-Makro).',
  estop: 'Not-Aus stoppt Klipper sofort (M112). Danach ist ein Firmware-Neustart nötig. Die Bestätigung schützt vor versehentlichem Berühren der FlexBar.',
  restart: 'Führt FIRMWARE_RESTART aus – z. B. nach einem Not-Aus oder Fehler.',
  status: '',
};
export default {
  props: { modelValue: { type: Object, required: true } },
  emits: ['update:modelValue'],
  data() { return { printers: [], kind: KIND, note: NOTES[KIND] }; },
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
    if (d.printer === undefined) d.printer = '';
    if (KIND === 'status') { if (d.label === undefined) d.label = ''; if (d.program === undefined) d.program = ''; }
    else if (d.confirm === undefined) d.confirm = CONFIRM_DEFAULT[KIND];
  },
  async mounted() {
    try {
      const r = await this.$fd.sendToBackend({ action: 'listPrinters' });
      if (r && r.ok) this.printers = r.printers;
    } catch (_) { /* backend not running */ }
  },
  methods: {
    async chooseProgram() {
      try {
        const r = await this.$fd.sendToBackend({ action: 'chooseProgram' });
        if (r && r.ok && r.path) this.modelValue.data.program = r.path;
      } catch (_) { /* backend not running */ }
    },
  },
};
</script>
