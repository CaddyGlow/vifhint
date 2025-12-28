// Application configuration

type KeyOperation =
	| `tab:${'next' | 'previous' | 'close' | 'new' | 'restore'}`
	| 'hints:activate'
	| 'hints:newTab'
	| 'hints:backgroundTab'
	| 'scroll:top'
	| 'scroll:bottom'
	| 'scroll:half-down'
	| 'scroll:half-up'
	| 'focus:input';

type KeyBinding = {
	readonly keys: string;
	readonly operation: KeyOperation;
	readonly description: string;
	readonly repeatable: boolean;
};

type KeyBindingConfig = {
	readonly timeout: number;
	readonly bindings: readonly KeyBinding[];
};

type Settings = {
	readonly stealFocusOnLoad: boolean;
};

type AppConfig = {
	readonly keyBindings: KeyBindingConfig;
	readonly settings: Settings;
};

export const appConfig = {
	keyBindings: {
		timeout: 500, // ms to wait for next key in sequence
		bindings: [
			// Tab operations
			{ keys: 'gt', operation: 'tab:next', description: 'Next tab', repeatable: true },
			{ keys: 'gT', operation: 'tab:previous', description: 'Previous tab', repeatable: true },
			{ keys: 'x', operation: 'tab:close', description: 'Close tab', repeatable: false },
			{ keys: 't', operation: 'tab:new', description: 'New tab', repeatable: true },
			{ keys: 'X', operation: 'tab:restore', description: 'Restore closed tab', repeatable: false },

			// Scroll operations
			{
				keys: 'd',
				operation: 'scroll:half-down',
				description: 'Scroll half page down',
				repeatable: true,
			},
			{
				keys: 'u',
				operation: 'scroll:half-up',
				description: 'Scroll half page up',
				repeatable: true,
			},
			{ keys: 'gg', operation: 'scroll:top', description: 'Scroll to top', repeatable: false },
			{ keys: 'G', operation: 'scroll:bottom', description: 'Scroll to bottom', repeatable: false },

			// Hints
			{
				keys: 'f',
				operation: 'hints:activate',
				description: 'Activate link hints',
				repeatable: false,
			},
			{
				keys: 'F',
				operation: 'hints:newTab',
				description: 'Open link in new tab',
				repeatable: false,
			},
			{
				keys: 'gF',
				operation: 'hints:backgroundTab',
				description: 'Open link in background tab',
				repeatable: false,
			},

			// Focus
			{ keys: 'gi', operation: 'focus:input', description: 'Focus next input', repeatable: true },
		],
	},
	settings: {
		// Prevent autofocus from stealing keyboard input on page load.
		stealFocusOnLoad: true,
	},
} as const satisfies AppConfig;
