#!/bin/bash
# Sign the built Magnetar.app so macOS stops re-asking for your Keychain password.
#
# Run after every build:  bash scripts/sign-app.sh
# One-time setup first:   bash scripts/setup-signing.sh

set -euo pipefail

APP="src-tauri/target/release/bundle/macos/Magnetar.app"
CERT_NAME="Magnetar Dev"
BUNDLE_ID="com.hamidkazimov.magnetar"

[ -d "$APP" ] || { echo "❌ Not found: $APP — build first (npm run tauri build)"; exit 1; }

if security find-identity -v -p codesigning | grep -q "$CERT_NAME"; then
  echo "▸ Signing with \"$CERT_NAME\" (stable identity across rebuilds)"
  codesign --force --deep --options runtime \
    --identifier "$BUNDLE_ID" \
    --sign "$CERT_NAME" "$APP"
  STABLE=1
else
  echo "⚠️  No \"$CERT_NAME\" identity — falling back to ad-hoc signing."
  echo "   Ad-hoc changes on every build, so the Keychain will keep asking."
  echo "   Fix it once with: bash scripts/setup-signing.sh"
  codesign --force --deep --identifier "$BUNDLE_ID" --sign - "$APP"
  STABLE=0
fi

# Strip the quarantine flag so the first launch does not need right-click → Open.
xattr -cr "$APP" 2>/dev/null || true

echo
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Authority|Signature" || true

if [ "$STABLE" = "1" ]; then
  echo
  echo "✅ Signed. On the next Keychain prompt choose \"Always Allow\" —"
  echo "   it will now be remembered across rebuilds."
fi
