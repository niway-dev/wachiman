#!/usr/bin/env bash
# Build and install a development build of this checkout as `wachiman-dev`, next to the released
# `wachiman`, without publishing anything. It packs the checkout the way a release does (same
# `files` list, same Node launcher, the real dependencies from npm), with the version
# `<package version>-dev-<commit>`, and installs that tarball into a prefix of its own.
#
#   scripts/dev-build.sh                 build the current checkout (a branch, a worktree) and install it
#   scripts/dev-build.sh --as-wachiman   the same, and the `wachiman` command runs this build too
#   scripts/dev-build.sh --uninstall     remove wachiman-dev and its prefix; give `wachiman` back
#
# Then: `wachiman-dev --version`, `wachiman-dev` (the launcher), `wachiman-dev init`, and so on.
# Run it again after each change you want to try; the newest build replaces the previous one only
# once it installed, so a failed build leaves the previous one working.
#
# --as-wachiman points `~/.local/bin/wachiman` at the build, so hooks, skills and anything else
# that calls `wachiman` use it. The link that was there before is saved and put back by
# --uninstall. Once set, later builds keep it until --uninstall.
#
# Uncommitted changes are included, and the version says so (`-dev-<commit>.dirty`).
# wachiman-dev reads the same ~/.wachiman configuration and profiles as `wachiman`: a review
# run with it is a real review on your account. Needs bash, git, node and npm; the first build
# downloads the dependencies from the npm registry.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
state="${WACHIMAN_DEV_HOME:-$HOME/.local/share/wachiman-dev}"
bindir="${WACHIMAN_DEV_BIN:-$HOME/.local/bin}"
link="$bindir/wachiman-dev"
main_link="$bindir/wachiman"
# What `wachiman` pointed at before --as-wachiman (empty when there was nothing).
saved="$state/previous-wachiman"

ours() { [[ -L "$1" && "$(readlink "$1")" == "$state/"* ]]; }

as_wachiman=0
case "${1:-}" in
  "") ;;
  --as-wachiman) as_wachiman=1 ;;
  --uninstall)
    # Only what a build made: the links and the prefix; the directory goes too if nothing else is in it.
    if ours "$link"; then rm "$link"; echo "removed $link"; fi
    if [[ -f "$saved" ]]; then
      if ours "$main_link"; then
        rm "$main_link"
        previous="$(cat "$saved")"
        if [[ -n "$previous" ]]; then ln -s "$previous" "$main_link"; echo "restored $main_link -> $previous"; else echo "removed $main_link"; fi
      fi
      rm "$saved"
    fi
    if [[ -d "$state/prefix" ]]; then rm -rf "$state/prefix"; echo "removed $state/prefix"; fi
    rm -rf "$state/prefix.new" # what a failed build left
    rmdir "$state" 2>/dev/null || true
    exit 0
    ;;
  *) echo "usage: dev-build.sh [--as-wachiman | --uninstall]" >&2; exit 2 ;;
esac

if [[ -e "$link" || -L "$link" ]] && ! ours "$link"; then
  echo "dev-build: $link exists and was not made by this script; move it away first." >&2
  exit 1
fi
if (( as_wachiman )) && [[ -e "$main_link" && ! -L "$main_link" ]]; then
  echo "dev-build: $main_link is a file, not a link; move it away first, or skip --as-wachiman." >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/wachiman-dev.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# The files a release would pack, from npm itself.
(cd "$root" && npm pack --dry-run --json --ignore-scripts --loglevel=error) \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s)[0].files)console.log(f.path)})' \
  > "$work/files"
[[ -s "$work/files" ]] || { echo "dev-build: npm pack listed no files in $root" >&2; exit 1; }

# "dev-<hash>" is one alphanumeric identifier, valid semver even when the hash is all digits.
commit="$(git -C "$root" rev-parse --short HEAD)"
dirty=""
packed=()
while IFS= read -r f; do packed+=("$f"); done < "$work/files"
[[ -n "$(cd "$root" && git status --porcelain -- "${packed[@]}")" ]] && dirty=".dirty"
base="$(node -p 'require(process.argv[1]).version' "$root/package.json")"
version="$base-dev-$commit$dirty"

# Pack a copy, so the checkout's package.json keeps its real version.
mkdir "$work/src"
while IFS= read -r f; do
  mkdir -p "$work/src/$(dirname "$f")"
  cp "$root/$f" "$work/src/$f"
done < "$work/files"
node -e 'const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p));j.version=process.argv[2];fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")' \
  "$work/src/package.json" "$version"
tarball="$(cd "$work/src" && npm pack --pack-destination "$work" --ignore-scripts --silent)"

# Install into a new prefix and swap it in only when the install worked, so a failed build (the
# registry offline, a failed download) leaves the previous build in place and working.
mkdir -p "$state" "$bindir"
rm -rf "$state/prefix.new"
npm install --global --prefix "$state/prefix.new" --no-audit --no-fund --loglevel=error "$work/$tarball"
rm -rf "$state/prefix"
mv "$state/prefix.new" "$state/prefix"
ln -sfn "$state/prefix/bin/wachiman" "$link"

if (( as_wachiman )) && ! ours "$main_link"; then
  # Saved once: the link from before the first --as-wachiman, never a link of ours.
  if [[ -L "$main_link" ]]; then readlink "$main_link" > "$saved"; else : > "$saved"; fi
  ln -sfn "$state/prefix/bin/wachiman" "$main_link"
  echo "wachiman now runs this build; --uninstall gives back $(if [[ -s "$saved" ]]; then cat "$saved"; else echo "no wachiman"; fi)"
fi

echo "installed wachiman-dev $version from $root"
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "note: $bindir is not on PATH; add it, or run $link directly." ;;
esac
"$link" --version
