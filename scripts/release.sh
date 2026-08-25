#!/usr/bin/env bash
# Build, sign, notarize and staple a universal Magnetar release DMG.
#
# Tauri does the signing and notarization itself when the credentials are in the
# environment; this script's job is to fail early and clearly when something is
# missing, keep the version in sync, and always build the universal binary so
# Apple Silicon does not run through Rosetta.
#
# Required environment:
#   APPLE_SIGNING_IDENTITY   "Developer ID Application: Name (TEAMID)"
# And ONE notarization method:
#   API key:  APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH
#   Apple ID: APPLE_ID, APPLE_PASSWORD (app-specific), APPLE_TEAM_ID
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "release: $1" >&2; exit 1; }

# --- Credentials -------------------------------------------------------------
[ -n "${APPLE_SIGNING_IDENTITY:-}" ] || fail "APPLE_SIGNING_IDENTITY is not set (Developer ID Application cert)."

if [ -n "${APPLE_API_KEY:-}" ]; then
  [ -n "${APPLE_API_ISSUER:-}" ] || fail "APPLE_API_ISSUER is required with APPLE_API_KEY."
  [ -n "${APPLE_API_KEY_PATH:-}" ] || fail "APPLE_API_KEY_PATH is required with APPLE_API_KEY."
elif [ -n "${APPLE_ID:-}" ]; then
  [ -n "${APPLE_PASSWORD:-}" ] || fail "APPLE_PASSWORD (app-specific) is required with APPLE_ID."
  [ -n "${APPLE_TEAM_ID:-}" ] || fail "APPLE_TEAM_ID is required with APPLE_ID."
else
  fail "No notarization credentials: set the APPLE_API_KEY trio or the APPLE_ID trio."
fi

# --- Version must be in sync across the three files --------------------------
./scripts/sync-version.sh --check || fail "version mismatch — run ./scripts/sync-version.sh <version> first."

# --- Both targets for the universal build ------------------------------------
for t in aarch64-apple-darwin x86_64-apple-darwin; do
  rustup target list --installed | grep -q "$t" || fail "missing rust target $t (rustup target add $t)."
done

echo "release: building signed, notarized universal DMG…"
npm ci
npx tauri build --target universal-apple-darwin

echo "release: done. Artifacts:"
ls -1 src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null || true
ls -1 src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app 2>/dev/null || true
