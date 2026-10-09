#!/bin/sh
# Local runner: playwright from the global @playwright/mcp install and its Chromium.
export NODE_PATH="${NODE_PATH:-$APPDATA/npm/node_modules/@playwright/mcp/node_modules}"
export CHROME="${CHROME:-$LOCALAPPDATA/ms-playwright/chromium-1228/chrome-win64/chrome.exe}"
exec node "$(dirname "$0")/shots.cjs" "$@"
