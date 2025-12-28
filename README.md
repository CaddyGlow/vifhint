# Link Hints Chrome Extension

A minimal keyboard-driven link navigation extension for Chrome, inspired by SurfingKeys but focused solely on link hints.

## Features

- **Link Hints**: Press `Alt+F` to show hint labels on all clickable elements
- Type the hint characters to navigate
- Press `Escape` to cancel
- Press `Backspace` to undo characters

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
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
2. Find "Link Hints"
3. Set your preferred shortcut

### Change Hint Characters

Edit `src/content.ts` and modify the `hintChars` property:

```typescript
private hintChars = 'asdfghjkl'; // Change to your preferred characters
```

### Change Hint Styling

Edit `hints.css` to customize the appearance of hint labels.

## Development

Watch mode for development:
```bash
npm run watch
```

After making changes, rebuild and reload the extension in Chrome.

## License

MIT
