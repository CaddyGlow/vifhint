// Application configuration

export type CoreCommand =
	| `tab:${'next' | 'previous' | 'close' | 'new' | 'restore'}`
	| 'hints:activate'
	| 'hints:newTab'
	| 'hints:backgroundTab'
	| 'hints:search'
	| 'scroll:top'
	| 'scroll:bottom'
	| 'scroll:half-down'
	| 'scroll:half-up'
	| 'scroll:center'
	| 'focus:input'
	| 'selection:expand'
	| 'selection:shrink'
	| 'selection:toggle'
	| 'selection:line-toggle'
	| 'selection:yank'
	| 'selection:swap'
	| 'motion:word-forward'
	| 'motion:word-back'
	| 'motion:word-end'
	| 'motion:WORD-forward'
	| 'motion:WORD-back'
	| 'motion:line-start'
	| 'motion:line-first'
	| 'motion:line-end'
	| 'motion:paragraph-prev'
	| 'motion:paragraph-next'
	| 'textobj:word-inner'
	| 'textobj:word-around'
	| 'textobj:paragraph-inner'
	| 'textobj:paragraph-around'
	| 'search:word-next'
	| 'search:word-prev'
	| 'caret:move-left'
	| 'caret:move-right'
	| 'caret:move-up'
	| 'caret:move-down'
	| 'help:toggle'
	| 'find:open'
	| 'find:next'
	| 'find:prev'
	| 'find:nohl';

export type PluginCommandId = `${string}.${string}`;
export type CommandId = CoreCommand | PluginCommandId;

export type Keymap = {
	readonly lhs: string;
	readonly rhs: CommandId;
	readonly desc: string;
	readonly repeatable: boolean;
};

type Options = {
	readonly leader: string;
	readonly timeoutlen: number;
	readonly noautofocus: boolean;
	readonly findmode: 'custom' | 'native';
	readonly scroll: number;
	readonly colorsheme: ColorshemeName;
	readonly caret: CaretOptions;
};

type ColorshemeName = 'base16-vif-dark' | 'base16-vif-light';

type CaretOptions = {
	readonly shape: 'block';
	readonly blink: 'steady' | 'blink';
};

export type AppConfig<PluginConfigs extends object = HintPluginConfigRegistry> = {
	readonly keymaps: readonly Keymap[];
	readonly options: Options;
	readonly plugins?: Record<
		string,
		{ enabled?: boolean; config?: Record<string, unknown>; options?: Record<string, unknown> }
	> &
		Partial<{
			[K in keyof PluginConfigs]: {
				enabled?: boolean;
				config?: PluginConfigs[K];
				options?: Record<string, unknown>;
			};
		}>;
};

export const appConfig: AppConfig = {
	keymaps: [
		// Tab operations
		{ lhs: 'gt', rhs: 'tab:next', desc: 'Next tab', repeatable: true },
		{ lhs: 'gT', rhs: 'tab:previous', desc: 'Previous tab', repeatable: true },
		{ lhs: 'x', rhs: 'tab:close', desc: 'Close tab', repeatable: false },
		{ lhs: 't', rhs: 'tab:new', desc: 'New tab', repeatable: true },
		{ lhs: 'X', rhs: 'tab:restore', desc: 'Restore closed tab', repeatable: false },

		// Scroll operations
		{ lhs: 'd', rhs: 'scroll:half-down', desc: 'Scroll page down', repeatable: true },
		{ lhs: 'u', rhs: 'scroll:half-up', desc: 'Scroll page up', repeatable: true },
		{ lhs: 'gg', rhs: 'scroll:top', desc: 'Scroll to top', repeatable: false },
		{ lhs: 'G', rhs: 'scroll:bottom', desc: 'Scroll to bottom', repeatable: false },
		{ lhs: 'zz', rhs: 'scroll:center', desc: 'Center on target', repeatable: false },

		// Hints
		{ lhs: 'f', rhs: 'hints:activate', desc: 'Activate link hints', repeatable: false },
		{ lhs: 'F', rhs: 'hints:newTab', desc: 'Open link in new tab', repeatable: false },
		{
			lhs: 'gF',
			rhs: 'hints:backgroundTab',
			desc: 'Open link in background tab',
			repeatable: false,
		},
		{
			lhs: '<leader> ',
			rhs: 'hints:search',
			desc: 'Search hint targets by text',
			repeatable: false,
		},

		// Focus
		{ lhs: 'gi', rhs: 'focus:input', desc: 'Focus next input', repeatable: true },

		// Selection
		{ lhs: 'v', rhs: 'selection:toggle', desc: 'Toggle visual mode', repeatable: false },
		{ lhs: 'V', rhs: 'selection:line-toggle', desc: 'Toggle visual line mode', repeatable: false },
		{ lhs: 's', rhs: 'selection:expand', desc: 'Expand selection to parent', repeatable: true },
		{ lhs: 'S', rhs: 'selection:shrink', desc: 'Shrink selection to child', repeatable: true },
		{ lhs: 'y', rhs: 'selection:yank', desc: 'Yank selection to clipboard', repeatable: false },
		{ lhs: 'o', rhs: 'selection:swap', desc: 'Swap selection endpoint', repeatable: false },

		// Motion
		{ lhs: 'w', rhs: 'motion:word-forward', desc: 'Next word', repeatable: true },
		{ lhs: 'b', rhs: 'motion:word-back', desc: 'Previous word', repeatable: true },
		{ lhs: 'e', rhs: 'motion:word-end', desc: 'End of word', repeatable: true },
		{ lhs: 'W', rhs: 'motion:WORD-forward', desc: 'Next WORD', repeatable: true },
		{ lhs: 'B', rhs: 'motion:WORD-back', desc: 'Previous WORD', repeatable: true },
		{ lhs: '0', rhs: 'motion:line-start', desc: 'Line start', repeatable: true },
		{ lhs: '^', rhs: 'motion:line-first', desc: 'Line first non-blank', repeatable: true },
		{ lhs: '$', rhs: 'motion:line-end', desc: 'Line end', repeatable: true },
		{ lhs: '{', rhs: 'motion:paragraph-prev', desc: 'Previous paragraph', repeatable: true },
		{ lhs: '}', rhs: 'motion:paragraph-next', desc: 'Next paragraph', repeatable: true },
		{ lhs: '*', rhs: 'search:word-next', desc: 'Search word forward', repeatable: true },
		{ lhs: '#', rhs: 'search:word-prev', desc: 'Search word backward', repeatable: true },
		{ lhs: 'iw', rhs: 'textobj:word-inner', desc: 'Select inner word', repeatable: false },
		{ lhs: 'aw', rhs: 'textobj:word-around', desc: 'Select around word', repeatable: false },
		{
			lhs: 'ip',
			rhs: 'textobj:paragraph-inner',
			desc: 'Select inner paragraph',
			repeatable: false,
		},
		{
			lhs: 'ap',
			rhs: 'textobj:paragraph-around',
			desc: 'Select around paragraph',
			repeatable: false,
		},

		// Caret
		{ lhs: 'h', rhs: 'caret:move-left', desc: 'Move caret left', repeatable: true },
		{ lhs: 'j', rhs: 'caret:move-down', desc: 'Move caret down', repeatable: true },
		{ lhs: 'k', rhs: 'caret:move-up', desc: 'Move caret up', repeatable: true },
		{ lhs: 'l', rhs: 'caret:move-right', desc: 'Move caret right', repeatable: true },
		{ lhs: '<Left>', rhs: 'caret:move-left', desc: 'Move caret left', repeatable: true },
		{ lhs: '<Down>', rhs: 'caret:move-down', desc: 'Move caret down', repeatable: true },
		{ lhs: '<Up>', rhs: 'caret:move-up', desc: 'Move caret up', repeatable: true },
		{ lhs: '<Right>', rhs: 'caret:move-right', desc: 'Move caret right', repeatable: true },

		// Find
		{ lhs: '/', rhs: 'find:open', desc: 'Find in page', repeatable: false },
		{ lhs: 'n', rhs: 'find:next', desc: 'Next match', repeatable: true },
		{ lhs: 'N', rhs: 'find:prev', desc: 'Previous match', repeatable: true },
		{ lhs: '<leader>nh', rhs: 'find:nohl', desc: 'Clear search highlights', repeatable: false },

		// Help
		{ lhs: '?', rhs: 'help:toggle', desc: 'Show keymaps', repeatable: false },
	],
	options: {
		leader: ' ',
		timeoutlen: 10000, // ms to wait for next key in sequence
		// Prevent autofocus from stealing keyboard input on page load.
		noautofocus: true,
		// 'native' uses the browser find UI when supported; 'custom' logs not implemented.
		findmode: 'custom',
		// Scroll amount as a fraction of the viewport height (e.g. 0.5 = half page).
		scroll: 0.5,
		// Base16 palette used by style.css.
		colorsheme: 'base16-vif-dark',
		// Vim-style caret options.
		caret: {
			shape: 'block',
			blink: 'steady',
		},
	},
	plugins: {
		'hint.whichKey': {
			enabled: true,
			config: {
				delay: 200,
			},
		},
	},
};
