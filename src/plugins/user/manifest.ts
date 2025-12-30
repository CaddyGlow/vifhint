import type { PluginManifest } from '../types';

export const manifest = {
	id: 'hint.user',
	name: 'User Script',
	version: '1.0.0',
	contexts: ['content', 'background'],
	activation: [{ type: 'onStartup' }],
} satisfies PluginManifest;
