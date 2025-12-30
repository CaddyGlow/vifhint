# VifHint Chrome Extension

A minimal keyboard-driven link navigation extension for Chrome, inspired by SurfingKeys but focused solely on link hints.

## Features

- **VifHint**: Press `Alt+F` to show hint labels on all clickable elements
- Type the hint characters to navigate
- Press `Escape` to cancel
- Press `Backspace` to undo characters

## Installation

1. Install dependencies:
```bash
bun install
```

2. Build the extension:
```bash
bun run build
```

3. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## Usage

1. Press `Alt+F` (or your configured shortcut) to activate link hints
2. Type the characters shown in the yellow labels
3. The link will be clicked when you complete a hint
4. Press `Escape` to cancel at any time

## Customization

### Change Keyboard Shortcut

1. Go to `chrome://extensions/shortcuts`
2. Find "VifHint"
3. Set your preferred shortcut

### Change Hint Characters

Edit `src/content.ts` and modify `config.hintChars`:

```typescript
const config: HintConfig = {
	hintChars: 'asdfghjkl', // Change to your preferred characters
	// ...
};
```

### Keymaps and Notation

Keymaps live in `src/config.ts` under `appConfig.keymaps`. They use nvim-style key notation:

- `<leader>` (defaults to space via `appConfig.options.leader`)
- `<Esc>`, `<CR>`, `<Tab>`, `<BS>`
- `<C-x>`, `<A-x>`, `<S-Tab>` for modifiers

Example:

```typescript
{ lhs: '<leader>nh', rhs: 'find:nohl', desc: 'Clear search highlights', repeatable: false },
```

### Options

Edit `src/config.ts` to tweak defaults:

| Option | Default | Description |
| --- | --- | --- |
| `options.leader` | `' '` | Leader key for `<leader>` mappings. |
| `options.timeoutlen` | `500` | Time to wait for the next key in a sequence (ms). |
| `options.noautofocus` | `true` | Prevent focus on inputs when the page loads. |
| `options.findmode` | `'custom'` | `native` uses the browser find UI when supported. |
| `options.scroll` | `0.5` | Scroll amount for `d`/`u` as a fraction of the viewport height. |

### Build-time Overrides (No Repo Edits)

Provide a JSON config at build time and it will be bundled as `user-config.json` in `dist/`:

```bash
VIFHINT_USER_CONFIG_PATH=/path/to/vifhint.json bun run build
```

Or inline JSON:

```bash
VIFHINT_USER_CONFIG_JSON='{"options":{"leader":","}}' bun run build
```

Or export a TypeScript config module:

```bash
VIFHINT_USER_CONFIG_TS=/path/to/vifhint.config.ts bun run build
```

Example `vifhint.config.ts`:

```ts
export default {
	plugins: {
		'hint.whichKey': { enabled: false },
	},
	options: {
		leader: ',',
	},
};
```

The user config merges on top of defaults. For keymaps, set `keymapMode` to `replace` to
fully override defaults (otherwise it merges by `lhs`).

### Build-time User Plugin (TypeScript/JavaScript)

You can also inject a TypeScript/JavaScript module that is bundled as `user-plugin.js`
and executed via the plugin system (no repo edits required):

```bash
VIFHINT_USER_PLUGIN_TS=/path/to/user-plugin.ts bun run build
```

JavaScript works too:

```bash
VIFHINT_USER_PLUGIN_PATH=/path/to/user-plugin.js bun run build
```

### Build-time Plugin Filtering (Reduce Bundle Size)

Allowlist mode (only include these plugins):

```bash
VIFHINT_PLUGINS="hint.user hint.whichKey" bun run build
```

Disablelist mode (include everything except these):

```bash
VIFHINT_DISABLE_PLUGINS=hint.whichKey bun run build
```

Comma/space separated values are supported:

```bash
VIFHINT_DISABLE_PLUGINS="hint.whichKey hint.user" bun run build
```

Notes:
- Allowlist is strict: plugins not listed are omitted from the bundle.
- Disablelist starts from all known plugins and removes the listed ones.
- Do not set both `VIFHINT_PLUGINS` and `VIFHINT_DISABLE_PLUGINS`.

The module can export `activateContent` / `activateBackground` (same signature as plugins),
or a default function used for both contexts.

```ts
import type { PluginContext } from './src/plugins/types';

export const activateContent = (ctx: PluginContext) => {
	ctx.log('user plugin loaded');
};
```

Enable/disable it via config:

```json
{ "plugins": { "hint.user": { "enabled": true } } }
```

### Runtime Overrides

Set `chrome.storage.local` key `hint.userConfig` to override at runtime. Changes are
watched and applied automatically (content scripts restart with the new config).

Example shape:

```json
{
	"keymapMode": "merge",
	"keymaps": [{ "lhs": "ff", "rhs": "hints:activate", "desc": "Hints", "repeatable": false }],
	"options": { "leader": " ", "timeoutlen": 5000 },
	"hints": { "hintChars": "asdfghjkl" },
	"plugins": { "hint.whichKey": { "enabled": true, "config": { "delay": 150 } } }
}
```

### Change Hint Styling

Edit `style.css` to customize the appearance of hint labels.

## Development

Watch mode for development:
```bash
bun run watch
```

Formatting, linting, and type checking:
```bash
bun run format
bun run lint
bun run typecheck
```

After making changes, rebuild and reload the extension in Chrome.

Internal API reference: `docs/INTERNAL_API.md`.

## License

MIT
