#!/bin/zsh
set -eu
cd "${0:A:h}"
if [[ -x "$PWD/.tools/node-v26.13.0-darwin-arm64/bin/node" ]]; then
  export PATH="$PWD/.tools/node-v26.13.0-darwin-arm64/bin:$PATH"
fi
if ! command -v node >/dev/null; then
  echo 'Node 22.12+ is required. See README.md.'
  exit 1
fi
echo 'FSL personal practice → http://localhost:5173 (on this Mac)'
if ! curl -fsS http://127.0.0.1:5173/health.json >/dev/null; then
  npm run start:local
fi
open 'http://localhost:5173'
