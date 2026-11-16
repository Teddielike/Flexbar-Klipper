// Inlined by gen-manifest.cjs: FlexDesigner loads standalone Vue components.
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
})
