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

### Change Hint Styling

Edit `hints.css` to customize the appearance of hint labels.

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

## License

MIT
