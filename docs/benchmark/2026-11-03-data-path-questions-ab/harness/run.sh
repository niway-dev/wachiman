#!/usr/bin/env bash
# One run of one arm on one batch: run.sh <batch-id> <A|B> <repeat> [--dry-run]
# Needs: engine checkouts in $ENGINE_A (origin/main, 47933f0) and $ENGINE_B
# (origin/feat/data-path-questions), a kaipu-record clone in $KAIPU_CLONE, and one detached
# worktree of it per head in $HEADS/kaipu-<short sha>. Claude Code must be logged in
# (CLAUDE_CONFIG_DIR is passed through the provider's environment allowlist).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
id="$1"; arm="$2"; rep="$3"; shift 3
ENGINE_A="${ENGINE_A:-/tmp/abdp/engine-A}"
ENGINE_B="${ENGINE_B:-/tmp/abdp/engine-B}"
KAIPU_CLONE="${KAIPU_CLONE:-$HOME/Documents/Workspace/Personal/kaipu-record-monorepo}"
HEADS="${HEADS:-/tmp/abdp}"
line="$(grep -v '^#' "$here/batches.tsv" | awk -F'\t' -v id="$id" '$1==id')"
[ -n "$line" ] || { echo "unknown batch $id" >&2; exit 2; }
IFS=$'\t' read -r _ pr base head file <<<"$line"
case "$arm" in A) engine="$ENGINE_A" ;; B) engine="$ENGINE_B" ;; *) echo "arm A or B" >&2; exit 2 ;; esac
out="$here/../raw/$id/$arm-r$rep"
exec bun "$here/ab.ts" run --engine "$engine" --clone "$KAIPU_CLONE" --repo-dir "$HEADS/kaipu-${head:0:7}" \
  --pr "$pr" --base "$base" --head "$head" --bug-file "$file" --meta "$here/../raw/meta/pr-$pr.json" --binary "$here/claude-with-user.sh" --out "$out" "$@"
