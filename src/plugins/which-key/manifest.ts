import type { PluginManifest } from '../types';

declare global {
	interface HintPluginConfigRegistry {
		'hint.whichKey': { delay?: number };
	}
}

export const manifest = {
	id: 'hint.whichKey',
	name: 'Which Key',
	version: '0.1.0',
	description: 'Shows available keybindings for the current prefix.',
	contexts: ['content'],
	activation: [{ type: 'onStartup' }],
} satisfies PluginManifest;
