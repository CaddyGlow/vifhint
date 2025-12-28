#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd "$script_dir/.." && pwd)

svg="$root_dir/icons/vifhint.svg"
output_dir="$root_dir/icons"

if [[ ! -f "$svg" ]]; then
  echo "SVG not found: $svg" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required to generate icons." >&2
  exit 1
fi

sizes=(16 32 48 128)

for size in "${sizes[@]}"; do
  out="$output_dir/icon${size}.png"
  magick "$svg" \
    -background none \
    -resize "${size}x${size}" \
    -fuzz 5% -transparent white \
    "PNG32:${out}"
  echo "Generated ${out}"
done
