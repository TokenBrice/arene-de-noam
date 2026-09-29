#!/usr/bin/env bash
# Re-measure everything. Run from anywhere (paths are repo-relative):
#   bash tools/perf/run-all.sh [label]        full run, label default "after"
#   bash tools/perf/run-all.sh smoke          reduced run (1 rep, rates 1,6, no trace/leak)
# Env: PORT (default 8181), DIST=1 (serve dist/ built by `npm run build` instead of the repo root),
#      STRESS=1 (add the 8x A14-class stress pass), SWIFTSHADER=1 (CPU raster).
# Needs node + Playwright chromium. Writes tools/perf/results/*-<label>.json + summary-<label>.md
set -euo pipefail
LABEL="${1:-after}"
PORT="${PORT:-8181}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
mkdir -p results
SERVER_ARGS=("$PORT")
[ "${DIST:-0}" = "1" ] && SERVER_ARGS+=(--dist)
node server.mjs "${SERVER_ARGS[@]}" > "results/server-$PORT.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -fs "http://127.0.0.1:$PORT/" > /dev/null 2>&1 && break
  kill -0 $SERVER 2>/dev/null || { cat "results/server-$PORT.log"; exit 1; }
  sleep 0.5
done
export PORT LABEL
if [ "$LABEL" = "smoke" ]; then
  node measure-runtime.mjs --rates 1,6 --reps 1 --only battle-idle,attack-turn,switch-overlay --label "$LABEL"
  node measure-load.mjs --reps 1 --label "$LABEL"
  {
    echo "# Perf summary ($LABEL)"
    node summarize.mjs "results/runtime-$LABEL.json"
  } > "results/summary-$LABEL.md"
else
  node measure-runtime.mjs --rates 1,4,6 --reps 3 --label "$LABEL"
  [ "${STRESS:-0}" = "1" ] && node measure-runtime.mjs --rates 8 --reps 1 --label "stress-$LABEL"
  node measure-runtime.mjs --rates 1,6 --reps 1 --trace --label "trace-$LABEL"
  node measure-load.mjs --reps 3 --label "$LABEL"
  node attribution.mjs --rate 1 --reps 3
  node audio-probe.mjs --rate 6
  node memory-leak.mjs --battles 6
  {
    echo "# Perf summary ($LABEL)"
    node summarize.mjs "results/runtime-$LABEL.json" "results/runtime-trace-$LABEL.json"
  } > "results/summary-$LABEL.md"
fi
echo "wrote $DIR/results/summary-$LABEL.md"
