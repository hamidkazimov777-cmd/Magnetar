#!/bin/bash
# Create a local, self-signed code-signing identity for Magnetar.
#
# Why this exists: an unsigned app has no stable identity, so macOS treats every
# rebuild as a different program. The Keychain then re-asks for your password and
# "Always Allow" never sticks. Signing every build with the SAME local identity
# gives the app a stable designated requirement, so you approve once and never
# again.
#
# This is a LOCAL developer certificate. It is not an Apple Developer ID: the app
# still is not notarized, and it cannot be distributed to other machines this way.
#
# Run once:   bash scripts/setup-signing.sh
# Then build: npm run tauri build && bash scripts/sign-app.sh

set -euo pipefail

CERT_NAME="Magnetar Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Use the SYSTEM openssl, not whatever is first on PATH. Homebrew's OpenSSL 3
# writes PKCS#12 with modern algorithms (AES + SHA-256 MAC) that macOS's
# Security framework cannot read — the import fails with "MAC verification
# failed during PKCS12 import (wrong password?)", which is misleading: the
# password is fine, the container format is not. LibreSSL, which ships with
# macOS, produces a container Keychain accepts.
OPENSSL="/usr/bin/openssl"
[ -x "$OPENSSL" ] || OPENSSL="openssl"

# An empty PKCS#12 password is another thing the importer handles badly, so the
# bundle gets a throwaway one. It never leaves this script.
P12_PASS="magnetar-local"

if security find-identity -v -p codesigning | grep -q "$CERT_NAME"; then
  echo "✅ Identity \"$CERT_NAME\" already exists — nothing to do."
  echo "   Build, then run: bash scripts/sign-app.sh"
  exit 0
fi

echo "▸ Creating a self-signed code-signing certificate: $CERT_NAME"

# A code-signing certificate needs the codeSigning extended key usage; without
# it `codesign` refuses to use the identity.
cat > "$TMP/openssl.cnf" <<'CNF'
[ req ]
distinguished_name = dn
x509_extensions    = ext
prompt             = no

[ dn ]
CN = Magnetar Dev

[ ext ]
basicConstraints       = critical,CA:false
keyUsage               = critical,digitalSignature
extendedKeyUsage       = critical,codeSigning
subjectKeyIdentifier   = hash
CNF

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -days 3650 -config "$TMP/openssl.cnf" >/dev/null 2>&1

# Bundle key + certificate so both land in the Keychain together. The explicit
# SHA-1/3DES algorithms are what Keychain's importer understands.
"$OPENSSL" pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/identity.p12" -name "$CERT_NAME" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 \
  -passout "pass:$P12_PASS" >/dev/null 2>&1

echo "▸ Importing into your login keychain"
echo "  (macOS may ask for your password once — this is that one time.)"
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$P12_PASS" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null

# Let codesign use the key without a prompt on every signature.
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || true

echo "▸ Marking the certificate as trusted for code signing"
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem" \
  >/dev/null 2>&1 || {
    echo "⚠️  Could not mark it trusted automatically."
    echo "   Open Keychain Access → login → Certificates → \"$CERT_NAME\" →"
    echo "   Get Info → Trust → Code Signing: Always Trust."
  }

if security find-identity -v -p codesigning | grep -q "$CERT_NAME"; then
  echo
  echo "✅ Done. Now sign builds with: bash scripts/sign-app.sh"
else
  echo
  echo "⚠️  The identity is not usable yet — set Code Signing to \"Always Trust\""
  echo "   for \"$CERT_NAME\" in Keychain Access, then re-run this script."
fi
