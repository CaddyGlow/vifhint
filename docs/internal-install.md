# Internal Install (Unpacked)

These scripts download the latest GitHub release zip and extract it to a stable
user folder for Chrome's "Load unpacked" flow. Updates are manual: re-run the
script and then click Reload in `chrome://extensions`.

Notes:
- This is not an auto-update path. Chrome only auto-updates self-hosted
  extensions on Linux with system-level policies.
- The extracted folder name uses the extension ID for convenience, but Chrome
  still treats this as an unpacked install.

## All platforms (recommended)

```bash
bun run install:unpacked
```

## Windows (direct)

```powershell
.\scripts\install-unpacked.ps1
```

## macOS / Linux (direct)

```bash
chmod +x scripts/install-unpacked.sh
./scripts/install-unpacked.sh
```

## First-time install

1) Open `chrome://extensions`
2) Enable Developer mode
3) Click "Load unpacked"
4) Select the extracted folder printed by the script
