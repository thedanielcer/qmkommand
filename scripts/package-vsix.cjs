const path = require('node:path');
const fs = require('node:fs');
const { createVSIX } = require('@vscode/vsce');

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('This packaging profile is verified only for win32-x64. Update the native binary allowlist and validate on your target host before packaging another platform.');
  }
  // Force native loading, rather than just requiring node-hid's lazy JS wrapper.
  console.log(`Native HIDAPI: ${require('node-hid').getHidapiVersion()}`);
  fs.mkdirSync('artifacts', { recursive: true });
  const { name, version } = require('../package.json');
  const packagePath = path.resolve('artifacts', `${name}-${version}-win32-x64.vsix`);
  await createVSIX({ target: 'win32-x64', packagePath, allowMissingRepository: true, skipLicense: true });
  console.log(`VSIX: ${packagePath}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
