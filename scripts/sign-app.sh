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

# Keep the installed copy in step with the build.
#
# Two copies of the app is how you end up testing yesterday's code: the bundle
# under target/ is what you just built, but Launchpad, Spotlight and the Dock
# all open /Applications. An unsigned three-day-old copy sat there for a while,
# and nothing on screen said which one was running.
#
# Only an existing installation is refreshed — this never installs the app
# behind the user's back.
INSTALLED="/Applications/$(basename "$APP")"
if [ -d "$INSTALLED" ]; then
  rm -rf "$INSTALLED" && cp -R "$APP" /Applications/
  echo "↻ Updated $INSTALLED"
fi

if [ "$STABLE" = "1" ]; then
  echo
  echo "✅ Signed. On the Keychain prompt choose \"Always Allow\"."
  echo "   It holds for this build: reopening the app will not ask again."
  echo "   A rebuild asks once more — macOS re-asks even though the signature"
  echo "   is unchanged. One prompt, not one per key."
fi
