#!/usr/bin/env bash
# Renders one run's output.json as readable markdown next to it: render.sh <raw/<batch>/<arm-rN>>
set -euo pipefail
d="$1"
{
  echo "# $(basename "$(dirname "$d")") $(basename "$d")"
  echo
  jq -r '"questions: \(.questions // "none (arm A engine)" | if type=="array" then (join(", ") | if .=="" then "none" else . end) else . end)"' "$d/info.json"
  jq -r '"cost_usd: \(.costUsd), turns: \(.turns), terminal: \(.terminalReason), duration_ms: \(.durationMs)"' "$d/result.json"
  echo
  echo "## Summary"
  echo
  jq -r '.summary // "(no output)"' "$d/output.json"
  echo
  echo "## Findings"
  echo
  jq -r '(.findings // [])[] | "### [\(.severity)/\(.topic)/\(.confidence // "-")] `\(.path):\(.line)` \(.title)\n\n\(.body)\n"' "$d/output.json"
  echo "## Contracts"
  echo
  jq -r '(.contracts // [])[] | "- **\(.status)** `\(.location)`: \(.action)\n  - failure_mode: \(.failure_mode // "")\n  - before_after: \(.before_after // "")\n  - open_question: \(.open_question // "")"' "$d/output.json"
} > "$d/review.md"
