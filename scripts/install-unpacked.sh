#!/usr/bin/env bash
set -euo pipefail

REPO="caddyglow/vifhint"
EXT_ID="gfhhpkidmnaglkonpomfpgcgknmpmchh"
ASSET_REGEX='^vifhint-.*\.zip$'

if [[ "${OSTYPE:-}" == "darwin"* ]]; then
	DEST="$HOME/Library/Application Support/vifhint/$EXT_ID"
else
	DEST="$HOME/.local/share/vifhint/$EXT_ID"
fi

API="https://api.github.com/repos/${REPO}/releases/latest"
AUTH_HEADER=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
	AUTH_HEADER=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

PYTHON="python3"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
	PYTHON="python"
fi

URL="$(
	curl -sL -H "Accept: application/vnd.github+json" "${AUTH_HEADER[@]}" "$API" |
	"$PYTHON" - <<'PY'
import json, re, sys
data = json.load(sys.stdin)
rx = re.compile(r'^vifhint-.*\.zip$')
for asset in data.get("assets", []):
	name = asset.get("name", "")
	if rx.match(name) and "firefox" not in name:
		print(asset["browser_download_url"])
		break
PY
)"

if [[ -z "$URL" ]]; then
	echo "No release asset matching $ASSET_REGEX" >&2
	exit 1
fi

TMP="$(mktemp -t vifhint.XXXXXX.zip)"
curl -L "${AUTH_HEADER[@]}" -o "$TMP" "$URL"

rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q "$TMP" -d "$DEST"

echo "Extracted to $DEST"
echo "First install: chrome://extensions -> Developer mode -> Load unpacked -> $DEST"
echo "Update: re-run this script, then click Reload on the extension."
