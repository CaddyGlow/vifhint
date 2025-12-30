import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const targetDir = process.argv[2];
if (!targetDir) {
	console.error('Usage: bun scripts/copy-user-config.ts <output-dir>');
	process.exit(1);
}

const jsonOverride = process.env.VIFHINT_USER_CONFIG_JSON;
const pathOverride = process.env.VIFHINT_USER_CONFIG_PATH;

if (!jsonOverride && !pathOverride) {
	process.exit(0);
}

let raw = jsonOverride ?? '';
if (!raw && pathOverride) {
	if (!existsSync(pathOverride)) {
		console.error(`[config] File not found: ${pathOverride}`);
		process.exit(1);
	}
	raw = readFileSync(pathOverride, 'utf8');
}

try {
	JSON.parse(raw);
} catch (error) {
	console.error('[config] Invalid JSON in user config.', error);
	process.exit(1);
}

const outputPath = join(targetDir, 'user-config.json');
writeFileSync(outputPath, raw, 'utf8');
console.log(`[config] Wrote ${outputPath}`);
