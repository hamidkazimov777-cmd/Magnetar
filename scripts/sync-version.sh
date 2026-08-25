#!/usr/bin/env bash
# The version lives in three files and drifts if edited by hand. This keeps them
# in lockstep.
#
#   ./scripts/sync-version.sh 0.2.0   # set all three to 0.2.0
#   ./scripts/sync-version.sh --check # exit non-zero if they disagree
set -euo pipefail

cd "$(dirname "$0")/.."

PKG=package.json
CARGO=src-tauri/Cargo.toml
CONF=src-tauri/tauri.conf.json

get_pkg()   { grep -m1 '"version"' "$PKG"   | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
get_cargo() { grep -m1 '^version'   "$CARGO" | sed -E 's/.*"([^"]+)".*/\1/'; }
get_conf()  { grep -m1 '"version"' "$CONF"  | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }

if [ "${1:-}" = "--check" ]; then
  p=$(get_pkg); c=$(get_cargo); t=$(get_conf)
  echo "package.json=$p  Cargo.toml=$c  tauri.conf.json=$t"
  if [ "$p" = "$c" ] && [ "$c" = "$t" ]; then
    echo "versions in sync ($p)"
    exit 0
  fi
  echo "version mismatch" >&2
  exit 1
fi

V="${1:-}"
[ -n "$V" ] || { echo "usage: sync-version.sh <version> | --check" >&2; exit 2; }
echo "$V" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+' || { echo "not a semver: $V" >&2; exit 2; }

# The first version match in each file is the package's own.
sed -i '' -E "0,/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]+\"/s//\"version\": \"$V\"/" "$PKG"
sed -i '' -E "0,/^version[[:space:]]*=[[:space:]]*\"[^\"]+\"/s//version = \"$V\"/" "$CARGO"
sed -i '' -E "0,/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]+\"/s//\"version\": \"$V\"/" "$CONF"
echo "set version to $V in all three files"
