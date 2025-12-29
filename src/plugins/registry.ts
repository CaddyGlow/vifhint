import type { PluginDefinition } from './types';
import { manifest as whichKeyManifest } from './which-key/manifest';

// Add build-time plugin entries here to bundle them with the extension.
export const pluginRegistry: PluginDefinition[] = [
	{
		manifest: whichKeyManifest,
		load: {
			content: () => import('./which-key/content'),
		},
	},
];
