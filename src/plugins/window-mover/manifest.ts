import type { PluginManifest } from '../types';

declare global {
	interface HintPluginConfigRegistry {
		'hint.windowMover'?: Record<string, never>;
	}
}

export const manifest = {
	id: 'hint.windowMover',
	name: 'Window Mover',
	version: '0.1.0',
	description: 'Move the current tab to another window or a new window.',
	contexts: ['content', 'background'],
	activation: [{ type: 'onStartup' }],
	contributes: {
		commands: [{ id: 'window.moveTab', title: 'Move current tab to window' }],
		keymaps: [
			{
				lhs: '<leader>w',
				rhs: 'window.moveTab',
				desc: 'Move current tab to another window',
				repeatable: false,
			},
		],
	},
} satisfies PluginManifest;
