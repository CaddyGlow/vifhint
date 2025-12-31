# Internal API

This document describes the internal runtime API surface for the extension. It is
intended for maintainers and power users who inject build-time config or user plugins.

## Entry Points

- `src/content.ts`: content-script runtime (hints, keymaps, selection, search).
- `src/background.ts`: service worker runtime (tab ops, shortcuts, plugin host).
- `src/popup.ts`: popup UI and site/global enable toggles.

## Config Pipeline

Defaults live in:

- `src/config.ts` (core options, keymaps, plugin defaults, hint defaults)

Runtime resolution happens in `src/user-config.ts`:

1. Load `user-config.json` if present in the build output (bundled at build time).
2. Load `chrome.storage.local` or `chrome.storage.sync` key `hint.userConfig` (local wins).
3. Merge on top of defaults (keymaps support `keymapMode: 'merge' | 'replace'`).

Resolved type: `ResolvedConfig` (`AppConfig` + `hints`).

## Build-time Injection

### User Config (JSON/TS)

Bundled as `user-config.json` in `dist/` or `dist-firefox/`.

- `VIFHINT_USER_CONFIG_JSON`: inline JSON
- `VIFHINT_USER_CONFIG_PATH`: JSON file path
- `VIFHINT_USER_CONFIG_TS`: TS module path (exports default / `userConfig` / `config`)

### User Plugin (TS/JS)

Bundled as `user-plugin.js` and loaded as plugin id `hint.user`.

- `VIFHINT_USER_PLUGIN_TS`: TS module path
- `VIFHINT_USER_PLUGIN_PATH`: JS module path

The module can export:

- `activateContent(ctx)` and/or `activateBackground(ctx)`
- or a default function (used for both contexts)

## Plugin Registry Filtering

Build-time inclusion is controlled by `scripts/generate-plugin-registry.ts`:

- `VIFHINT_PLUGINS`: allowlist (only these plugin IDs are bundled)
- `VIFHINT_DISABLE_PLUGINS`: disablelist (bundle everything except these)

Only one can be set at a time.

## Plugin System (Internal API)

### Manifest Shape

Defined in `src/plugins/types.ts` as `PluginManifest`.

Key fields:

- `id`: `author.pluginName`
- `contexts`: `['content' | 'background']`
- `activation`: `onStartup` / `onCommand` / `onKey` / `onHost` / `onUrl` / `onHintMode`
- `contributes`: `commands`, `keymaps`, `options`, `helpSections`, etc.

### Plugin Host

The `PluginHost` in `src/plugins/host.ts` handles:

- activation and dependency loading
- command and keymap registration
- event fan-out (`hint:activate`, `key:sequence`, etc.)
- config merging and runtime option overrides

### Plugin Context

From `src/plugins/types.ts` (`PluginContext`):

Core methods:

- `registerCommand(id, handler)`
- `registerKeymap(map)`
- `on(event, handler)`
- `getKeymaps()`
- `getOption(key, fallback)`
- `setOption(key, value)`
- `getConfig()`
- `getPluginConfig()`
- `storage.get/set/remove`
- `ui.toast(message)`
- `log(message, data?)`

Content-only APIs:

- `hints.isActive() / activate()`
- `selection.*` (caret/selection ops)
- `search.*` (find UI ops)

### Events

Core events are in `CoreEventMap`:

- `page:ready`
- `hint:activate` / `hint:deactivate`
- `search:open` / `search:close`
- `key:sequence` (`match` / `partial` / `none`)

## Internal Runtime Components

- `LinkHints` (`src/content-link-hints.ts`): hint generation and UI.
- `KeyBindings` (`src/keybindings.ts`): key sequence parsing + command execution.
- `NormalModeController` (`src/normal-mode-controller.ts`): caret movement + caret UI.
- `VisualModeController` (`src/visual-mode-controller.ts`): visual/linewise selection.
- `CustomFindController` / `NativeFindController` (`src/content-find.ts`): search UX.
- `HelpOverlay` (`src/content-help-overlay.ts`): keymap UI.

Each component takes config values via `ResolvedConfig` in `src/content.ts`.

## Feature Plugins

Incremental selection plugin removed.

## Example: User Plugin (Internal)

```ts
import type { PluginContext } from '../src/plugins/types';

export const activateContent = (ctx: PluginContext) => {
	ctx.on('page:ready', () => ctx.log('ready'));
	ctx.registerCommand('hint.user.ping', () => ctx.ui.toast('pong'));
	ctx.registerKeymap({
		lhs: 'gp',
		rhs: 'hint.user.ping',
		desc: 'Ping',
		repeatable: false,
	});
};
```
