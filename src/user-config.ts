import { type AppConfig, type Keymap, appConfig } from './config';
import { type HintConfig, defaultHintConfig } from './hint-config';

export type KeymapMode = 'merge' | 'replace';

export type UserConfig = {
	readonly keymaps?: readonly Keymap[];
	readonly keymapMode?: KeymapMode;
	readonly options?: Partial<AppConfig['options']>;
	readonly plugins?: AppConfig['plugins'];
	readonly hints?: Partial<HintConfig>;
};

export type ResolvedConfig = AppConfig & { hints: HintConfig };

const USER_CONFIG_KEY = 'hint.userConfig';
let cachedBundledConfig: UserConfig | null | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeUserConfig(value: unknown): UserConfig | null {
	if (!isPlainObject(value)) return null;
	return value as UserConfig;
}

async function loadBundledConfig(): Promise<UserConfig | null> {
	if (cachedBundledConfig !== undefined) return cachedBundledConfig;
	if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
		cachedBundledConfig = null;
		return cachedBundledConfig;
	}

	try {
		const url = chrome.runtime.getURL('user-config.json');
		const response = await fetch(url, { cache: 'no-store' });
		if (!response.ok) {
			cachedBundledConfig = null;
			return cachedBundledConfig;
		}
		const data = await response.json();
		cachedBundledConfig = normalizeUserConfig(data);
		return cachedBundledConfig;
	} catch (error) {
		console.warn('[config] Failed to load bundled config.', error);
		cachedBundledConfig = null;
		return cachedBundledConfig;
	}
}

async function loadStoredConfig(): Promise<UserConfig | null> {
	if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
	const [localResult, syncResult] = await Promise.all([
		chrome.storage.local.get(USER_CONFIG_KEY),
		chrome.storage.sync?.get ? chrome.storage.sync.get(USER_CONFIG_KEY) : Promise.resolve({}),
	]);
	const localValue = Object.prototype.hasOwnProperty.call(localResult, USER_CONFIG_KEY)
		? normalizeUserConfig(localResult[USER_CONFIG_KEY])
		: null;
	if (localValue) return localValue;
	const syncValue = Object.prototype.hasOwnProperty.call(syncResult, USER_CONFIG_KEY)
		? normalizeUserConfig(syncResult[USER_CONFIG_KEY])
		: null;
	return syncValue;
}

function mergeOptions(
	base: AppConfig['options'],
	override?: Partial<AppConfig['options']>,
): AppConfig['options'] {
	if (!override) return base;
	return {
		...base,
		...override,
		caret: {
			...base.caret,
			...override.caret,
		},
	};
}

function mergeHints(base: HintConfig, override?: Partial<HintConfig>): HintConfig {
	if (!override) return base;
	return {
		...base,
		...override,
		hintOffset: {
			...base.hintOffset,
			...override.hintOffset,
		},
	};
}

function mergeKeymaps(
	base: readonly Keymap[],
	override: readonly Keymap[] | undefined,
	mode: KeymapMode,
): Keymap[] {
	if (!override) return [...base];
	if (mode === 'replace') return [...override];
	if (override.length === 0) return [...base];
	const merged = new Map<string, Keymap>();
	for (const keymap of base) {
		merged.set(keymap.lhs, keymap);
	}
	for (const keymap of override) {
		merged.set(keymap.lhs, keymap);
	}
	return Array.from(merged.values());
}

type PluginConfigEntry = {
	enabled?: boolean;
	config?: Record<string, unknown>;
	options?: Record<string, unknown>;
};

function mergePlugins(
	base: AppConfig['plugins'] | undefined,
	override?: AppConfig['plugins'],
): AppConfig['plugins'] | undefined {
	if (!base && !override) return undefined;
	const merged: Record<string, PluginConfigEntry> = { ...(base ?? {}) };
	if (!override) return merged;
	for (const [pluginId, entry] of Object.entries(override)) {
		const current = merged[pluginId] ?? {};
		const next: PluginConfigEntry = {
			...current,
			...entry,
			config: {
				...(current.config ?? {}),
				...(entry?.config ?? {}),
			},
			options: {
				...(current.options ?? {}),
				...(entry?.options ?? {}),
			},
		};
		merged[pluginId] = next;
	}
	return merged as AppConfig['plugins'];
}

function mergeConfig(base: AppConfig, overrides: readonly (UserConfig | null)[]): ResolvedConfig {
	let keymapMode: KeymapMode = 'merge';
	let keymaps = [...base.keymaps];
	let options = base.options;
	let plugins = base.plugins;
	let hints = defaultHintConfig;

	for (const override of overrides) {
		if (!override) continue;
		if (override.keymapMode) keymapMode = override.keymapMode;
		if (override.options) options = mergeOptions(options, override.options);
		if (override.plugins) plugins = mergePlugins(plugins, override.plugins);
		if (override.hints) hints = mergeHints(hints, override.hints);
		if (override.keymaps) keymaps = mergeKeymaps(keymaps, override.keymaps, keymapMode);
	}

	return {
		...base,
		keymaps,
		options,
		plugins,
		hints,
	};
}

export async function loadConfig(): Promise<ResolvedConfig> {
	const [bundled, stored] = await Promise.all([loadBundledConfig(), loadStoredConfig()]);
	return mergeConfig(appConfig, [bundled, stored]);
}

export function watchConfigChanges(onChange: (config: ResolvedConfig) => void): () => void {
	if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
	const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
		if (areaName !== 'local' && areaName !== 'sync') return;
		if (!changes[USER_CONFIG_KEY]) return;
		void (async () => {
			onChange(await loadConfig());
		})();
	};
	chrome.storage.onChanged.addListener(listener);
	return () => chrome.storage.onChanged.removeListener(listener);
}
