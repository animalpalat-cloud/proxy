#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x ./target/release/openrelay-bare ]]; then
  echo "Building openrelay-bare (release)…"
  cargo build --release
fi
exec ./target/release/openrelay-bare
