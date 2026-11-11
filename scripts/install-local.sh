#!/usr/bin/env bash
# Install the global `wachiman` command and the wachiman-review, wachiman-loop and wachiman-audit skills from this clone.
# For contributors: it links the clone's files. Package users run `wachiman skills install`, which copies.
#   scripts/install-local.sh              link everything (idempotent)
#   scripts/install-local.sh --uninstall  remove the links this script made
# Never touches anything under ~/.wachiman (isolated review profiles must stay empty).
set -euo pipefail

mode=install
case "${1:-}" in
  "") ;;
  --uninstall) mode=uninstall ;;
  *) echo "usage: install-local.sh [--uninstall]" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ "$(git -C "$root" rev-parse --git-common-dir)" != "$(git -C "$root" rev-parse --git-dir)" ]]; then
  echo "install-local: $root is a linked worktree, which is temporary. Run this from your main clone." >&2
  exit 1
fi

home="${HOME%/}"
guard() {
  case "$1" in
    "$home/.wachiman"|"$home/.wachiman/"*)
      echo "install-local: refusing to touch $1 (under ~/.wachiman)" >&2
      exit 1
      ;;
  esac
}

stamp="$(date +%Y%m%d-%H%M%S)"
backup_dir="$home/.local/state/wachiman-install/backup/$stamp"

link() { # link <source> <target>
  local src="$1" target="$2"
  guard "$target"
  if [[ -L "$target" ]]; then
    if [[ "$(readlink "$target")" == "$src" ]]; then
      echo "skip    $target (already linked)"
      return
    fi
    ln -sfn "$src" "$target"
    echo "repoint $target -> $src"
    return
  fi
  if [[ -e "$target" ]]; then
    mkdir -p "$backup_dir"
    local rel="${target#"$home"/}"
    local dest="$backup_dir/${rel//\//_}"
    mv "$target" "$dest"
    echo "backup  $target -> $dest"
  fi
  mkdir -p "$(dirname "$target")"
  ln -s "$src" "$target"
  echo "link    $target -> $src"
}

unlink_ours() { # unlink_ours <source> <target>
  local src="$1" target="$2"
  guard "$target"
  if [[ -L "$target" && "$(readlink "$target")" == "$src" ]]; then
    rm "$target"
    echo "unlink  $target"
  else
    echo "skip    $target (not ours)"
  fi
}

skill_dirs=("$home/.agents/skills")
for d in "$home/.claude" "$home"/.claude-*; do
  if [[ -d "$d" ]]; then skill_dirs+=("$d/skills"); fi
done
if [[ -n "${CLAUDE_CONFIG_DIR:-}" && -d "$CLAUDE_CONFIG_DIR" ]]; then
  skill_dirs+=("${CLAUDE_CONFIG_DIR%/}/skills")
fi

# Refuse before changing anything if a target is under ~/.wachiman.
for s in "${skill_dirs[@]}"; do guard "$s/wachiman-review"; guard "$s/wachiman-loop"; guard "$s/wachiman-audit"; done

apply() { # apply <function>
  "$1" "$root/bin/wachiman" "$home/.local/bin/wachiman"
  local seen=" " s
  for s in "${skill_dirs[@]}"; do
    if [[ "$seen" == *" $s "* ]]; then continue; fi
    seen+="$s "
    "$1" "$root/skills/wachiman-review" "$s/wachiman-review"
    "$1" "$root/skills/wachiman-loop" "$s/wachiman-loop"
    "$1" "$root/skills/wachiman-audit" "$s/wachiman-audit"
  done
}

if [[ "$mode" == install ]]; then
  apply link
  echo "note    this links the skills from your clone, for contributors; if you installed the npm package, run \`wachiman skills install\` instead (it copies them)"
  case ":$PATH:" in
    *":$home/.local/bin:"*) ;;
    *) echo "warn    $home/.local/bin is not on your PATH; add it in your shell profile" >&2 ;;
  esac
else
  apply unlink_ours
fi
