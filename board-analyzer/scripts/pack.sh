#!/bin/sh
# Builds the zip to upload to the Chrome Web Store (and Edge Add-ons): only what the extension needs.
# No tests, node_modules, docs or store artwork. The licence notices (engine/, scanner/NOTICE.md) stay in.
set -e
cd "$(dirname "$0")/.."
OUT="../pawnshot-$(node -p "require('./manifest.json').version").zip"
rm -f "$OUT"
zip -r -q "$OUT" . -x "node_modules/*" "test/*" "scripts/*" "store/*" "package.json" "package-lock.json" \
  "README.md" "PUBLISHING.md" "PRIVACY.md" ".DS_Store" "*/.DS_Store"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
