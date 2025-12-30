import type { PluginModule } from './plugins/types';

const NOOP_MODULE: PluginModule = {
	activateBackground: () => {},
	activateContent: () => {},
};

function coerceModule(module: unknown): PluginModule {
	if (module && typeof module === 'object') {
		const typed = module as PluginModule & { default?: unknown };
		if (typed.activateBackground || typed.activateContent) return typed;
		if (typeof typed.default === 'function') {
			return {
				activateBackground: typed.default as PluginModule['activateBackground'],
				activateContent: typed.default as PluginModule['activateContent'],
			};
		}
	}
	return NOOP_MODULE;
}

export async function loadUserPluginModule(): Promise<PluginModule> {
	if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return NOOP_MODULE;
	const url = chrome.runtime.getURL('user-plugin.js');
	try {
		const module = await import(url);
		return coerceModule(module);
	} catch {
		return NOOP_MODULE;
	}
}
