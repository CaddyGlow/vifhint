#!/usr/bin/env bash
set -euo pipefail

REPO="caddyglow/vifhint"
BRANCH="dev/v0.1"
EXT_ID="gfhhpkidmnaglkonpomfpgcgknmpmchh"

MODE="${1:-dev}"

if [[ "${OSTYPE:-}" == "darwin"* ]]; then
	DEST="$HOME/Library/Application Support/vifhint/$EXT_ID"
else
	DEST="$HOME/.local/share/vifhint/$EXT_ID"
fi

AUTH_HEADER=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
	AUTH_HEADER=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

PYTHON="python3"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
	PYTHON="python"
fi

case "$MODE" in
	release)
		API="https://api.github.com/repos/${REPO}/releases/latest"
		URL="$(
			curl -sL -H "Accept: application/vnd.github+json" "${AUTH_HEADER[@]}" "$API" |
			"$PYTHON" - <<'PY'
import json, re, sys
raw = sys.stdin.read()
if not raw.strip():
	print("Error: empty response from GitHub API (rate-limited or network issue)", file=sys.stderr)
	sys.exit(1)
try:
	data = json.loads(raw)
except json.JSONDecodeError as e:
	print(f"Error: invalid JSON from GitHub API: {e}", file=sys.stderr)
	print(f"Response: {raw[:200]}", file=sys.stderr)
	sys.exit(1)
if "message" in data and "assets" not in data:
	print(f"Error: GitHub API: {data['message']}", file=sys.stderr)
	sys.exit(1)
rx = re.compile(r'^vifhint-.*\.zip$')
for asset in data.get("assets", []):
	name = asset.get("name", "")
	if rx.match(name) and "firefox" not in name:
		print(asset["browser_download_url"])
		break
PY
		)"
		if [[ -z "$URL" ]]; then
			echo "No matching release asset found." >&2
			echo "Try: $0 dev" >&2
			exit 1
		fi
		;;
	dev)
		URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip"
		;;
	*)
		echo "Usage: $0 [dev|release]" >&2
		echo "  dev      Install from latest commit on $BRANCH (default)" >&2
		echo "  release  Install from latest GitHub release" >&2
		exit 1
		;;
esac

TMP="$(mktemp -t vifhint.XXXXXX.zip)"
HTTP_CODE="$(curl -sL "${AUTH_HEADER[@]}" -o "$TMP" -w '%{http_code}' "$URL")"

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
	echo "Download failed (HTTP $HTTP_CODE): $URL" >&2
	rm -f "$TMP"
	exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"

if [[ "$MODE" == "dev" ]]; then
	# GitHub archive zips contain a top-level directory; strip it
	unzip -q "$TMP" -d "$DEST"
	INNER="$(find "$DEST" -mindepth 1 -maxdepth 1 -type d)"
	if [[ -d "$INNER/dist" ]]; then
		# Pre-built dist exists in the repo
		mv "$INNER/dist"/* "$DEST"/
		rm -rf "$INNER"
	else
		# Source-only: need to build
		echo "Building from source..." >&2
		if ! command -v bun >/dev/null 2>&1; then
			echo "Error: bun is required to build from source. Install it from https://bun.sh" >&2
			rm -rf "$DEST" "$TMP"
			exit 1
		fi
		(cd "$INNER" && bun install && bun run build)
		mv "$INNER/dist"/* "$DEST"/
		rm -rf "$INNER"
	fi
else
	unzip -q "$TMP" -d "$DEST"
fi

rm -f "$TMP"

echo "Installed to $DEST (mode: $MODE)"
echo "First install: chrome://extensions -> Developer mode -> Load unpacked -> $DEST"
echo "Update: re-run this script, then click Reload on the extension."
