#!/bin/sh
# Builds the zip to upload to the Chrome Web Store: only what the extension needs, no tests or node_modules.
set -e
cd "$(dirname "$0")/.."
OUT="../board-analyzer-$(node -p "require('./manifest.json').version").zip"
rm -f "$OUT"
zip -r -q "$OUT" . -x "node_modules/*" "test/*" "scripts/*" "package.json" "package-lock.json" "README.md" ".DS_Store" "*/.DS_Store"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
