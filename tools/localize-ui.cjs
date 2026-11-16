'use strict';
const crypto = require('node:crypto');
const messages = require('./ui-messages.cjs');
const keys = Object.fromEntries(Object.keys(messages).map(text => [text, 'm' + crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)]));
const normalize = text => text.replace(/\s+/g, ' ').trim();

function localizeUi(source, mixin) {
  const start = source.indexOf('<template>') + '<template>'.length;
  const end = source.lastIndexOf('</template>');
  const template = source.slice(start, end);
  // Only static labels and text nodes are compiled. Never rewrite v-model,
  // object names, G-code, user labels or JavaScript string literals.
  const token = /\{\{[\s\S]*?\}\}|<!--[\s\S]*?-->|<\/?[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g;
  const localizeText = text => {
    const message = normalize(text);
    if (!Object.hasOwn(messages, message)) return text;
    return text.replace(/\S[\s\S]*\S|\S/, () => `{{ ui(${JSON.stringify(message)}) }}`);
  };
  let pos = 0, out = '';
  for (const match of template.matchAll(token)) {
    out += localizeText(template.slice(pos, match.index));
    out += match[0].replace(/(?<![\w:-])(label|title|hint)="([^"]*)"/g, (attribute, name, text) => {
      return Object.hasOwn(messages, text) ? `:${name}="ui('${text.replace(/'/g, "\\'")}')"` : attribute;
    });
    pos = match.index + match[0].length;
  }
  out += localizeText(template.slice(pos));
  source = source.slice(0, start) + out + source.slice(end);
  return source.replace('<script>', `<script>\nconst KLIPPER_UI_KEYS = ${JSON.stringify(keys)};\nconst KLIPPER_LOCALE_MIXIN = ${mixin.trim()};`)
    .replace('export default {', 'export default {\n  mixins: [KLIPPER_LOCALE_MIXIN],');
}

const local = {
  de: Object.fromEntries(Object.entries(keys).map(([text, key]) => [key, text])),
  en: Object.fromEntries(Object.entries(keys).map(([text, key]) => [key, messages[text]])),
};
module.exports = { localizeUi, local, keys, messages };
