// Build locally with the installed Electron; no signing or publishing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('dist:mac requires an Apple silicon Mac and an arm64 Electron install.');
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status})`);
};
// ICNS can embed the original 512px PNG without changing its pixels.
const png = fs.readFileSync('build/icon.png');
const header = Buffer.alloc(16);
header.write('icns', 0); header.writeUInt32BE(png.length + 16, 4);
header.write('ic09', 8); header.writeUInt32BE(png.length + 8, 12);
fs.writeFileSync('build/icon.icns', Buffer.concat([header, png]));
run(process.execPath, ['node_modules/electron-builder/cli.js', '--mac', '--arm64', '--dir', '--publish', 'never', '-c.electronDist=node_modules/electron/dist']);
const folder = path.resolve('dist/mac-arm64');
const applications = path.join(folder, 'Applications');
if (!fs.existsSync(applications)) fs.symlinkSync('/Applications', applications);
const artifact = path.resolve('dist', `${pkg.build.productName}-${pkg.version}-mac-arm64.dmg`);
run('/usr/bin/hdiutil', ['create', '-volname', pkg.build.productName, '-srcfolder', folder, '-ov', '-format', 'UDZO', artifact]);
console.log(`${artifact} (${fs.statSync(artifact).size} bytes)`);
