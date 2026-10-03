#!/usr/bin/env bash
# Package the browser extension into a store-ready zip.
# Output: browser-extension/dist/knowledge-inbox-zero-extension-<version>.zip
# Usage:  ./package.sh         (run from anywhere; resolves its own dir)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

version="$(node -p "require('./manifest.json').version")"
out_dir="dist"
zip_name="knowledge-inbox-zero-extension-${version}.zip"

mkdir -p "$out_dir"
rm -f "$out_dir/$zip_name"

# Only ship what the browser needs — never node_modules, dist, or dotfiles.
zip -r -q "$out_dir/$zip_name" \
  manifest.json \
  src \
  icons \
  -x '*.DS_Store'

echo "✅ Packaged: $out_dir/$zip_name"
echo "   Upload this zip to the Chrome Web Store / Firefox AMO / Edge Add-ons."
