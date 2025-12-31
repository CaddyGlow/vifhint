import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const isWindows = process.platform === 'win32';
const scriptPath = isWindows
	? path.join(scriptDir, 'install-unpacked.ps1')
	: path.join(scriptDir, 'install-unpacked.sh');

const cmd = isWindows ? 'powershell' : 'bash';
const args = isWindows ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath] : [scriptPath];

const result = spawnSync(cmd, args, { stdio: 'inherit' });
if (result.status && result.status !== 0) {
	process.exit(result.status);
}
