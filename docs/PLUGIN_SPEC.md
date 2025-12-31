# Plugin Spec

This document defines a build-time plugin system for the extension. Plugins are bundled
at build time, can be enabled or disabled per build, and support lazy loading (e.g. on
keybinding or command invocation). The API mirrors Neovim-style plugins: commands,
keymaps, and event hooks.

## Goals

- Build-time selection: include or exclude plugins per build without runtime fetches.
- Lazy loading: load plugin code only when activation conditions are met.
- Fast startup: minimal work before first user interaction.
- Flexible surface: allow plugins to add commands, keymaps, UI, and behavior.
- Stable core: ensure plugins can be versioned and validated against core versions.

## Non-goals

- Remote code execution or runtime plugin downloads.
- Automatic plugin discovery from the filesystem at runtime.
- Full sandboxing; plugins are trusted code bundled with the extension.

## Terminology

- Plugin: a build-time bundled module that contributes features.
- Manifest: static, side-effect free metadata about the plugin.
- Activation: the conditions under which a plugin is loaded.
- Contribution: keymaps, commands, options, UI, or behavior added by a plugin.

## Plugin Package Layout

A plugin is a TypeScript module (local folder or dependency) with a manifest and one or
more entrypoints. The manifest must be side-effect free and cheap to import.

Recommended layout:

- plugins/<id>/manifest.ts
- plugins/<id>/content.ts
- plugins/<id>/background.ts

Third-party packages may use the same export names.

## Manifest Shape

The manifest is loaded eagerly at startup. It must not touch the DOM or browser APIs.

```ts
export type PluginManifest = {
	id: string; // unique: e.g. "author.pluginName"
	name: string;
	version: string;
	description?: string;
	author?: string;
	license?: string;
	minCoreVersion?: string;
	contexts: Array<'content' | 'background'>;
	activation: ActivationEvent[];
	contributes?: PluginContributions;
	dependencies?: string[]; // other plugin ids
};

export type ActivationEvent =
	| { type: 'onStartup' }
	| { type: 'onCommand'; command: string }
	| { type: 'onKey'; key: string; when?: string }
	| { type: 'onHost'; host: string }
	| { type: 'onUrl'; match: string }
	| { type: 'onHintMode'; mode: 'normal' | 'newTab' | 'backgroundTab' };
```

Notes:
- `activation` drives lazy loading. A plugin can list multiple events.
- `onKey` uses the same key notation as core keymaps (`<leader>`, `<Esc>`, etc.).
- `when` is a small expression language for simple predicates (e.g. `"!input"`).

## Contributions

Plugins declare contributions in the manifest so the core can register stubs before
loading plugin code.

```ts
export type PluginContributions = {
	keymaps?: KeymapContribution[];
	commands?: CommandContribution[];
	options?: OptionsSchema;
	helpSections?: HelpSection[];
	contentScripts?: ContentBehavior[];
	backgroundTasks?: BackgroundBehavior[];
};

export type KeymapContribution = {
	lhs: string; // key sequence
	rhs: string; // command id, e.g. "author.pluginName.command"
	desc: string;
	repeatable?: boolean;
	modes?: Array<'normal'>;
	when?: string; // matches activation "when" language
};

export type CommandContribution = {
	id: string; // namespaced command id
	title: string;
	group?: string;
};
```

The core registers keymaps and commands from contributions even if the plugin is not
loaded. When a contributed command or keymap is invoked, the core loads the plugin and
replays the action.

## Entry Points

Plugins may define entry points for each context they declare:

```ts
export type PluginEntry = (ctx: PluginContext) => void | PluginDispose;
export type PluginDispose = () => void;
```

Exports:

- `manifest`: `PluginManifest` (required)
- `activateContent`: `PluginEntry` (optional)
- `activateBackground`: `PluginEntry` (optional)

A plugin may export only the entry points it needs. The loader invokes the entry for
that context once per page load or service worker start.

## Plugin Context (API Surface)

`PluginContext` provides stable, typed APIs. Direct DOM access is allowed, but the
core APIs should be preferred for consistency. `getConfig()` returns the full
application config; plugin-specific settings live under `plugins[pluginId].config`.

```ts
export type PluginContext = {
	coreVersion: string;
	context: 'content' | 'background';
	registerCommand(id: string, handler: CommandHandler): void;
	registerKeymap(map: KeymapContribution): void;
	on(event: CoreEvent, handler: EventHandler): PluginDispose;
	getOption<T>(key: string, fallback: T): T;
	setOption<T>(key: string, value: T): void;
	getConfig(): AppConfig;
	getPluginConfig(): Record<string, unknown>;
	storage: StorageApi;
	ui: UiApi;
	hints: HintsApi;
	selection: SelectionApi;
	search: SearchApi;
	log(message: string, data?: unknown): void;
};
```

Key points:
- `registerCommand` registers runtime commands, possibly not listed in the manifest.
- `registerKeymap` allows dynamic bindings after load; static keymaps must be in the
  manifest to support lazy loading before activation.
- `on` provides a Neovim-style autocommand equivalent (see Events below).
- `getConfig` returns the full app config.
- `getPluginConfig` returns `plugins[pluginId].config` with runtime overrides applied.

## Events (Autocommands)

Core emits events for behavior hooks. Examples:

- `page:ready`
- `hint:activate` / `hint:deactivate`
- `selection:change`
- `search:open` / `search:close`
- `key:sequence` (for advanced plugins)
- `tab:change` (background)

Plugins can subscribe via `ctx.on(event, handler)` and should return disposers.

## Lazy Loading Rules

1. The manifest is always loaded for enabled plugins.
2. The plugin entry point is loaded only when an activation event fires.
3. Commands and keymaps declared in the manifest trigger activation automatically.
4. Once loaded, the plugin stays loaded for the page/session unless it opts into
   unloading via its disposer.

Lazy load examples:
- `onKey` with `f` loads a plugin that overrides the hint UI.
- `onCommand` loads a plugin only when its command is invoked.

## Build-time Selection

Plugins are registered in a single build-time file so the bundler can tree-shake
unused plugins.

Example build-time registry:

```ts
// src/plugins/registry.ts
import { manifest as fooManifest } from '../plugins/foo/manifest';

export const pluginRegistry = [
	{
		manifest: fooManifest,
		load: {
			content: () => import('../plugins/foo/content'),
			background: () => import('../plugins/foo/background'),
		},
	},
];
```

Only plugins listed in the registry are bundled. Different build variants can use
different registry entries (e.g. minimal vs full).

## Configuration

Plugins declare option schemas so users can configure them in a single config file.
The core merges `appConfig` with plugin config by id.

To add type-safe plugin config, plugins extend a global registry interface and
`AppConfig` picks it up automatically.

```ts
export type OptionsSchema = {
	[id: string]: { type: 'string' | 'number' | 'boolean'; default: unknown };
};
```

User config example:

```ts
plugins: {
	'author.pluginName': {
		enabled: true,
		config: { foo: true },
	},
}
```

Type registry example (in the plugin package):

```ts
declare global {
	interface HintPluginConfigRegistry {
		'author.pluginName': { foo?: boolean };
	}
}

export {};
```

## Namespacing and IDs

- Plugin id: `author.pluginName`.
- Command id: `${pluginId}.commandName`.
- Options are stored under the plugin id.

## Error Handling

- Failed plugin activation should be logged and not crash the core.
- Errors in plugin handlers should be caught and surfaced in logs.
- Core should continue operating if a plugin fails.

## Example Plugin

```ts
// plugins/example/manifest.ts
export const manifest = {
	id: 'acme.example',
	name: 'Example Plugin',
	version: '0.1.0',
	contexts: ['content'],
	activation: [{ type: 'onCommand', command: 'acme.example.hello' }],
	contributes: {
		commands: [{ id: 'acme.example.hello', title: 'Say hello' }],
		keymaps: [
			{ lhs: 'gh', rhs: 'acme.example.hello', desc: 'Example: hello', repeatable: false },
		],
	},
} satisfies PluginManifest;

// plugins/example/content.ts
export const activateContent = (ctx: PluginContext) => {
	ctx.registerCommand('acme.example.hello', () => {
		ctx.ui.toast('Hello from plugin');
	});
};
```

## Open Questions

- How strict should the `when` expression language be (string checks vs AST)?
- Should plugins be able to override built-in commands or keymaps?
- Should background plugins be allowed to register new `chrome.commands` entries,
  or must that remain in the manifest?
