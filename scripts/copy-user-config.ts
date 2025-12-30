import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const targetDir = process.argv[2];
if (!targetDir) {
	console.error('Usage: bun scripts/copy-user-config.ts <output-dir>');
	process.exit(1);
}

const jsonOverride = process.env.VIFHINT_USER_CONFIG_JSON;
const pathOverride = process.env.VIFHINT_USER_CONFIG_PATH;
const tsOverride = process.env.VIFHINT_USER_CONFIG_TS;

const sources = [
	{ key: 'VIFHINT_USER_CONFIG_JSON', value: jsonOverride },
	{ key: 'VIFHINT_USER_CONFIG_PATH', value: pathOverride },
	{ key: 'VIFHINT_USER_CONFIG_TS', value: tsOverride },
].filter((entry) => entry.value);

if (sources.length === 0) process.exit(0);
if (sources.length > 1) {
	console.error(
		`[config] Only one user config source can be set. Got: ${sources
			.map((entry) => entry.key)
			.join(', ')}`,
	);
	process.exit(1);
}

let raw = jsonOverride ?? '';
if (!raw && pathOverride) {
	if (!existsSync(pathOverride)) {
		console.error(`[config] File not found: ${pathOverride}`);
		process.exit(1);
	}
	raw = readFileSync(pathOverride, 'utf8');
}

const loadFromTypeScript = async (tsPath: string): Promise<string> => {
	if (!existsSync(tsPath)) {
		console.error(`[config] File not found: ${tsPath}`);
		process.exit(1);
	}
	const moduleUrl = pathToFileURL(resolve(tsPath)).href;
	const mod = await import(moduleUrl);
	let value = mod.default ?? mod.userConfig ?? mod.config;
	if (typeof value === 'function') {
		value = await value();
	}
	try {
		return JSON.stringify(value, null, '\t');
	} catch (error) {
		console.error('[config] Failed to serialize user config.', error);
		process.exit(1);
	}
};

const main = async (): Promise<void> => {
	if (!raw && tsOverride) {
		raw = await loadFromTypeScript(tsOverride);
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
};

void main();
