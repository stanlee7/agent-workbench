import { spawnSync } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, ['scripts/signin-smoke.mjs'], { stdio: 'inherit', env });
if (result.error || result.signal) console.error(`Electron smoke could not start: ${result.error?.message || result.signal}`);
process.exit(result.status ?? 1);
