#!/usr/bin/env bash
# Compiles the mdinput event injector. Requires Xcode command line tools.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install Xcode command line tools:  xcode-select --install" >&2
  exit 1
fi

echo "building mdinput…"
swiftc -O -o mdinput mdinput.swift
echo "done → $(pwd)/mdinput"
