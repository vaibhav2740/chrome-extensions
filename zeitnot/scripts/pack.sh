#!/bin/sh
# Builds the zip to upload to the Chrome Web Store: only what the extension needs (no tests, docs, scripts or node_modules).
set -e
cd "$(dirname "$0")/.."
OUT="../zeitnot-$(node -p "require('./manifest.json').version").zip"
rm -f "$OUT"
zip -r -q "$OUT" . -x "node_modules/*" "test/*" "scripts/*" "package.json" "package-lock.json" \
  "README.md" "PRIVACY.md" ".DS_Store" "*/.DS_Store" "icons/*.svg"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
