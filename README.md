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

Edit `src/content.ts` and modify the `hintChars` property:

```typescript
private hintChars = 'asdfghjkl'; // Change to your preferred characters
```

### Settings

Edit `src/settings.ts` to tweak defaults:

| Setting | Default | Description |
| --- | --- | --- |
| `settings.stealFocusOnLoad` | `true` | Prevent focus on inputs when the page loads so you can use link hints without pressing `Esc`. |

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
