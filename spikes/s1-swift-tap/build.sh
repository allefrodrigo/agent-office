#!/bin/bash
# Compila o helper com o Info.plist embutido e assina ad hoc.
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/swiftc -O -swift-version 5 -target arm64-apple-macos14.2 tap.swift -o tap \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
codesign -s - -f tap
codesign -dv tap 2>&1 | grep -E 'Identifier|Info.plist'
