'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function runBuild(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'klipper build test '));
  const id = 'de.teddielike.flexbar-klipper';
  const plugin = path.join(directory, id + '.plugin');
  const bin = path.join(directory, 'bin');
  const log = path.join(directory, 'commands.log');
  try {
    for (const folder of ['backend', 'ui', 'resources', 'logs']) fs.mkdirSync(path.join(plugin, folder), { recursive: true });
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(directory, 'src'));
    fs.copyFileSync(path.resolve(__dirname, '../build.sh'), path.join(directory, 'build.sh'));
    fs.writeFileSync(path.join(directory, 'src/core.js'), `module.exports = { UUID: ${JSON.stringify(id)} };`);
    fs.writeFileSync(path.join(plugin, 'manifest.json'), JSON.stringify({ uuid: id }));
    fs.writeFileSync(path.join(plugin, 'config.json'), '{"password":"must-stay-local"}');
    fs.writeFileSync(path.join(plugin, 'logs/private.log'), 'private');
    fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv.slice(2).join(' ');
fs.appendFileSync(process.env.BUILD_TEST_LOG, 'npm ' + command + '\\n');
if (command === process.env.BUILD_TEST_FAIL_NPM) process.exit(23);
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'flexcli'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BUILD_TEST_LOG, 'flexcli ' + args.slice(0,2).join(' ') + '\\n');
if (args.includes('--force')) throw new Error('Unexpected forced install');
const input = args[args.indexOf('--path') + 1];
if (args[1] === 'pack') {
  if (fs.readFileSync(path.join(input, 'config.json'), 'utf8').trim() !== '{}') throw new Error('Credentials in package');
  if (fs.existsSync(path.join(input, 'logs'))) throw new Error('Logs in package');
  const id = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'))).uuid;
  fs.writeFileSync(path.join(path.dirname(input), id + '.flexplugin'), 'test archive');
} else if (args[1] === 'install') {
  if (!fs.existsSync(input)) throw new Error('Missing archive');
  console.log(process.env.BUILD_TEST_INSTALL_FAIL ? 'Install command failed:' : 'Install command successful:');
}
`, { mode: 0o755 });
    const result = spawnSync('bash', [path.join(directory, 'build.sh')], {
      cwd: os.tmpdir(), encoding: 'utf8',
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, BUILD_TEST_LOG: log,
        BUILD_TEST_FAIL_NPM: options.failNpm || '', BUILD_TEST_INSTALL_FAIL: options.failInstall ? '1' : '' },
    });
    assert.equal(fs.readFileSync(path.join(plugin, 'config.json'), 'utf8'), '{"password":"must-stay-local"}');
    return { ...result, commands: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [],
      archive: fs.existsSync(path.join(directory, id + '.flexplugin')) };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('build.sh runs every step from any directory and excludes private configuration', () => {
  const result = runBuild();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.commands, ['npm ci --include=dev', 'npm run build', 'npm test', 'npm run plugin:validate', 'flexcli plugin pack', 'flexcli plugin install']);
  assert.ok(result.archive);
});

test('build.sh stops before packaging or installation when a build step fails', () => {
  const result = runBuild({ failNpm: 'run build' });
  assert.equal(result.status, 23);
  assert.deepEqual(result.commands, ['npm ci --include=dev', 'npm run build']);
  assert.equal(result.archive, false);
});

test('build.sh detects an installation rejection even when FlexCLI exits zero', () => {
  const result = runBuild({ failInstall: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Installation nicht bestätigt/);
  assert.ok(result.archive, 'keep the package for manual installation');
});
