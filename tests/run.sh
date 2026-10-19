#!/bin/bash
# Serves the app locally (so the CSP behaves like on GitHub Pages) and runs the smoke tests.
cd "$(dirname "$0")/.."
python3 tools/csp.py >/dev/null || exit 1
python3 -m http.server 8799 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
python3 tests/test_prices.py || exit 1
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node tests/smoke.js
