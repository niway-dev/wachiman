#!/usr/bin/env bash
# Build and install a development build of this checkout as `wachiman-dev`, next to the released
# `wachiman`, without publishing anything. It packs the checkout the way a release does (same
# `files` list, same Node launcher, the real dependencies from npm), with the version
# `<package version>-dev-<commit>`, and installs that tarball into a prefix of its own.
#
#   scripts/dev-build.sh               build the current checkout (a branch, a worktree) and install it
#   scripts/dev-build.sh --uninstall   remove wachiman-dev and its prefix
#
# Then: `wachiman-dev --version`, `wachiman-dev` (the launcher), `wachiman-dev init`, and so on.
# Run it again after each change you want to try; the newest build replaces the previous one.
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

case "${1:-}" in
  "") ;;
  --uninstall)
    # rm -rf only on a directory this script would have made.
    case "$(basename "$state")" in
      wachiman-dev*) ;;
      *) echo "dev-build: refusing to remove $state (its name does not start with wachiman-dev)" >&2; exit 1 ;;
    esac
    if [[ -L "$link" && "$(readlink "$link")" == "$state/"* ]]; then rm "$link"; echo "removed $link"; fi
    rm -rf "$state"
    echo "removed $state"
    exit 0
    ;;
  *) echo "usage: dev-build.sh [--uninstall]" >&2; exit 2 ;;
esac

if [[ -e "$link" && ! -L "$link" ]] || { [[ -L "$link" ]] && [[ "$(readlink "$link")" != "$state/"* ]]; }; then
  echo "dev-build: $link exists and was not made by this script; move it away first." >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/wachiman-dev.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# The files a release would pack, from npm itself.
(cd "$root" && npm pack --dry-run --json --ignore-scripts 2>/dev/null) \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const f of JSON.parse(s)[0].files)console.log(f.path)})' \
  > "$work/files"

# "dev-<hash>" is one alphanumeric identifier, valid semver even when the hash is all digits.
commit="$(git -C "$root" rev-parse --short HEAD)"
dirty=""
packed=()
while IFS= read -r f; do packed+=("$f"); done < "$work/files"
[[ -n "$(cd "$root" && git status --porcelain -- "${packed[@]}")" ]] && dirty=".dirty"
base="$(node -p "require('$root/package.json').version")"
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

# A fresh prefix each time, so nothing from an older build is left behind.
rm -rf "$state/prefix"
mkdir -p "$state" "$bindir"
npm install --global --prefix "$state/prefix" --no-audit --no-fund --loglevel=error "$work/$tarball"
ln -sfn "$state/prefix/bin/wachiman" "$link"

echo "installed wachiman-dev $version from $root"
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "note: $bindir is not on PATH; add it, or run $link directly." ;;
esac
"$link" --version
