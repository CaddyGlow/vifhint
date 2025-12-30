import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const targetDir = process.argv[2];
if (!targetDir) {
	console.error('Usage: bun scripts/build-user-plugin.ts <output-dir>');
	process.exit(1);
}

const tsOverride = process.env.VIFHINT_USER_PLUGIN_TS;
const pathOverride = process.env.VIFHINT_USER_PLUGIN_PATH;

const sources = [
	{ key: 'VIFHINT_USER_PLUGIN_TS', value: tsOverride },
	{ key: 'VIFHINT_USER_PLUGIN_PATH', value: pathOverride },
].filter((entry) => entry.value);

if (sources.length === 0) process.exit(0);
if (sources.length > 1) {
	console.error(
		`[plugin] Only one user plugin source can be set. Got: ${sources
			.map((entry) => entry.key)
			.join(', ')}`,
	);
	process.exit(1);
}

const entry = tsOverride ?? pathOverride ?? '';
if (!existsSync(entry)) {
	console.error(`[plugin] File not found: ${entry}`);
	process.exit(1);
}

const result = await Bun.build({
	entrypoints: [entry],
	outdir: targetDir,
	target: 'browser',
	format: 'esm',
	sourcemap: 'external',
	naming: {
		entry: 'user-plugin.js',
	},
});

if (!result.success) {
	console.error('[plugin] Failed to build user plugin.');
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log(`[plugin] Built ${resolve(targetDir, 'user-plugin.js')}`);
