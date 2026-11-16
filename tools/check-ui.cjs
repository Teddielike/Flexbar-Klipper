'use strict';
// Flags module-level constants used inside <template> (Vue cannot see them there).
const fs = require('node:fs');
const path = require('node:path');
const { UUID } = require('../src/core');
const dirs = [path.join(__dirname, '..', 'ui-src'), path.join(__dirname, '..', `${UUID}.plugin`, 'ui')];
let bad = 0;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.vue'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const tpl = (src.match(/<template>([\s\S]*)<\/template>/) || [])[1] || '';
    const script = (src.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
    const consts = [...script.matchAll(/^(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
    // only look inside bound attributes / interpolations
    const exprs = [...tpl.matchAll(/(?:[:@]|v-[\w-]+=)[\w.-]*="([^"]*)"|\{\{([^}]*)\}\}/g)].map(m => m[1] || m[2] || '');
    for (const c of consts) {
      if (exprs.some(e => new RegExp(`(^|[^\\w.$'])${c}\\b`).test(e))) { console.log(`${f}: template uses module constant ${c}`); bad++; }
    }
  }
}
if (bad) process.exit(1);
console.log('UI check ok');
