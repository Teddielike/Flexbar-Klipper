'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeLocale } = require('./i18n');

// The SDK has no language getter/event for backends. FlexDesigner 2.2 stores
// its selected language here. Resolve userData through the documented Electron
// bridge, rather than guessing OS-specific directories. This file is read only;
// if its internal format changes, callers fall back to the UI/cached locale.
function createHostLanguageReader(getUserDataPath, readFile = fs.readFile, timeoutMs = 3000) {
  let configPath = null;
  let pending = null;
  async function read() {
    if (!configPath) {
      const directory = await getUserDataPath();
      if (typeof directory !== 'string' || !directory) throw new Error('FlexDesigner userData path unavailable');
      configPath = path.join(directory, 'data', 'config.json');
    }
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const language = config && config.common && config.common.language;
    if (typeof language !== 'string' || !language.trim()) throw new Error('FlexDesigner language unavailable');
    return normalizeLocale(language);
  }
  return {
    read() {
      if (pending) return pending;
      let timer;
      pending = Promise.race([
        read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('FlexDesigner language lookup timed out')), timeoutMs); }),
      ]).finally(() => { clearTimeout(timer); pending = null; });
      return pending;
    },
  };
}

module.exports = { createHostLanguageReader };
