const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pipeline } = require('node:stream/promises');
const { spawnSync } = require('node:child_process');
// Reuse the archive reader already required by the packaging tool.
const yauzl = createRequire(require.resolve('@vscode/vsce/package.json'))('yauzl');

async function extract(archive, destination) {
  const zip = await new Promise((resolve, reject) => yauzl.open(archive, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  const entries = [];
  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', entry => {
      (async () => {
        entries.push(entry.fileName);
        const target = path.resolve(destination, entry.fileName);
        assert.ok(target.startsWith(destination + path.sep), 'Archive entry must stay inside extraction directory');
        if (!entry.fileName.endsWith('/')) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const input = await new Promise((done, fail) => zip.openReadStream(entry, (error, stream) => error ? fail(error) : done(stream)));
          await pipeline(input, fs.createWriteStream(target));
        }
        zip.readEntry();
      })().catch(reject);
    });
    zip.readEntry();
  });
  return entries;
}

async function main() {
  const { name, version } = require('../package.json');
  const archive = path.resolve(process.argv[2] || `artifacts/${name}-${version}-win32-x64.vsix`);
  const destination = fs.mkdtempSync(path.resolve('artifacts', 'verify-'));
  const entries = await extract(archive, destination);
  const required = [
    'dist/extension.js', 'node_modules/node-hid/nodehid.js', 'node_modules/node-hid/binding-options.js',
    'node_modules/node-hid/package.json', 'node_modules/node-hid/prebuilds/HID-win32-x64/node-napi-v4.node',
    'node_modules/pkg-prebuilds/package.json', 'node_modules/pkg-prebuilds/bindings.js', 'node_modules/pkg-prebuilds/lib/prebuild.js',
  ];
  for (const file of required) { assert.ok(entries.includes(`extension/${file}`), `Missing runtime file: ${file}`); }
  assert.equal(entries.filter(file => file.endsWith('.node')).length, 1);
  assert.ok(!entries.some(file => /^extension\/(src|out|scripts)\//.test(file)));
  const root = path.join(destination, 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.extensionKind, ['ui']);
  assert.equal(manifest.browser, undefined);
  const properties = manifest.contributes.configuration.properties;
  assert.equal(properties['qmkommand.bindings'].scope, 'application');
  assert.equal(properties['qmkommand.device'].scope, 'application');
  assert.deepEqual(properties['qmkommand.bindings'].items.properties.key.enum, Array.from({ length: 32 }, (_, i) => `VSC_${i + 1}`));
  assert.match(fs.readFileSync(path.join(destination, 'extension.vsixmanifest'), 'utf8'), /TargetPlatform="win32-x64"/);

  // The isolated process refuses module resolution outside the extracted extension.
  // This prevents a missing VSIX dependency being masked by repository node_modules.
  const probe = String.raw`
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const Module = require('node:module');
    const root = process.argv[1];
    const original = Module._resolveFilename;
    Module._resolveFilename = function (...args) {
      const result = original.apply(this, args);
      if (path.isAbsolute(result)) assert.ok(result.startsWith(root + path.sep), 'Dependency escaped VSIX: ' + result);
      return result;
    };
    const hid = require(path.join(root, 'node_modules', 'node-hid'));
    assert.equal(typeof hid.devicesAsync, 'function');
    assert.equal(typeof hid.HIDAsync.open, 'function');
    console.log('Extracted VSIX native HIDAPI:', hid.getHidapiVersion());
  `;
  const result = spawnSync(process.execPath, ['-e', probe, root], { encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, 'Extracted native dependency smoke test failed');
  console.log(`Verified ${entries.length} VSIX entries, host target, schema, runtime dependencies and native loading.`);
  fs.writeFileSync(path.resolve('artifacts', 'verification.json'), JSON.stringify({
    archive, platform: process.platform, architecture: process.arch, node: process.version,
    entries, nativeLoad: 'passed', physicalHardware: 'not tested', vscodeHost: 'not tested',
  }, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
