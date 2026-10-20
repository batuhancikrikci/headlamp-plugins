#!/usr/bin/env bash
#
# Builds and installs the Headlamp plugins of this repository into the local Headlamp app.
#
#   ./scripts/deploy-all.sh                      # every plugin
#   ./scripts/deploy-all.sh envoy-gateway inference-hub
#   SKIP_CHECKS=1 ./scripts/deploy-all.sh        # skip tsc/lint/test
#   HEADLAMP_PLUGINS_DIR=/path ./scripts/deploy-all.sh
#
# Each plugin is installed with its own `npm run deploy` (scripts/deploy.mjs).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGINS=(agentrouter cilium envoy-gateway gateway headlamp-plus inference-hub monitoring multi-cluster)

if [ "$#" -gt 0 ]; then
  plugins=("$@")
else
  plugins=("${PLUGINS[@]}")
fi

failed=()
for plugin in "${plugins[@]}"; do
  dir="$ROOT/$plugin"
  printf '\n\033[1;35m━━ %s ━━\033[0m\n' "$plugin"
  if [ ! -f "$dir/package.json" ]; then
    echo "No package.json in $dir" >&2
    failed+=("$plugin")
    continue
  fi
  (
    cd "$dir"
    [ -d node_modules ] || npm ci
    npm run deploy
  ) || failed+=("$plugin")
done

echo
if [ "${#failed[@]}" -gt 0 ]; then
  echo "❌ Failed: ${failed[*]}" >&2
  exit 1
fi
echo "✅ Deployed: ${plugins[*]}"
echo "ℹ️  Reload Headlamp (Ctrl+Shift+R / Cmd+Shift+R) to pick up the changes."
