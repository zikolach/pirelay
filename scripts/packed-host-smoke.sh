#!/usr/bin/env bash
set -euo pipefail
root=$(pwd)
fixture=$(mktemp -d /tmp/pirelay-host.XXXXXXXX)
trap 'rm -r "$fixture"' EXIT
version=${1:-1.6.0}
archive=$(npm pack --silent --pack-destination "$fixture")
# Install as a consumer, not a workspace link. Pin the whole host family together.
npm install --prefix "$fixture" --no-audit --no-fund "$fixture/$archive" \
  "@earendil-works/pi-coding-agent@$version" "@earendil-works/pi-ai@$version" \
  "@earendil-works/pi-agent-core@$version" "@earendil-works/pi-tui@$version"
node "$root/scripts/packed-host-roundtrip.mjs" "$fixture" "$version"
