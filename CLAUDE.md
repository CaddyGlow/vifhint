# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
bun install        # Install dependencies
bun run build      # Compile TypeScript and copy assets to dist/
bun run watch      # Watch mode for development
```

After building, load the extension in Chrome via `chrome://extensions/` with Developer mode enabled, selecting the `dist` folder.

## Architecture

This is a Chrome Manifest V3 extension for keyboard-driven link navigation.

**Two-script architecture:**
- `src/background.ts` - Service worker that listens for the `Alt+F` command and sends messages to content scripts
- `src/content.ts` - Content script containing the `LinkHints` class that handles all hint display and interaction logic

**Message flow:** Chrome command -> background.ts -> content.ts (via `chrome.tabs.sendMessage`)

**Key configuration points:**
- `hintChars` property in `LinkHints` class controls which keys are used for hints (default: `asdfghjkl`)
- `style.css` controls hint label appearance
- `manifest.json` defines the keyboard shortcut (`Alt+F`) under `commands`
