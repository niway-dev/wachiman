#!/usr/bin/env bash
# Install the packed tarball the way a user would and check that it runs. No model call and no
# registry write. The package depends on the npm package `bun` (ADR 0028) and on `chalk` and
# `@clack/prompts` (ADR 0002, amendment 2026-11-13), so the default and `--without-bun` checks install
# a copy of the tarball with its `dependencies` removed (npm cannot omit a regular dependency),
# offline, from an empty cache, with the registry on a closed port and with --ignore-scripts: that is
# what an `--ignore-scripts` install leaves, a stub where Bun should be, and the stub is created here.
# The terminal-screen packages are copied in from this checkout's node_modules (run `bun install`
# first), exactly the files npm would have placed. Only `--bundled-bun` reads the registry, for the
# real dependencies.
#
#   scripts/verify-package.sh [--tarball FILE]   with Bun on PATH: stub bundled Bun falls back to it; version, npm exec, doctor, isolation
#   scripts/verify-package.sh --without-bun      no Bun on PATH, bundled Bun missing or a stub: the launcher exits 2 with the Bun message
#   scripts/verify-package.sh --bundled-bun      needs network: `npm install -g <tarball>` with its real dependencies, only node on PATH:
#                                                the launcher runs the Bun that npm installed
#
# Needs bash, node, npm and tar. Run it from a checkout with `bun install` done (it packs the checkout
# unless --tarball is given).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
tarball=""
without_bun=0
bundled_bun=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball) tarball="${2:?--tarball needs a file}"; shift 2 ;;
    --without-bun) without_bun=1; shift ;;
    --bundled-bun) bundled_bun=1; shift ;;
    *) echo "usage: verify-package.sh [--tarball FILE] [--without-bun | --bundled-bun]" >&2; exit 2 ;;
  esac
done

work="$(mktemp -d "${TMPDIR:-/tmp}/wachiman-verify.XXXXXX")"
trap 'rm -rf "$work"' EXIT
ok() { echo "ok    $*"; }
fail() { echo "FAIL  $*" >&2; exit 1; }

export npm_config_cache="$work/cache"
export npm_config_update_notifier=false
dead_registry="http://127.0.0.1:9"

if [[ -z "$tarball" ]]; then
  mkdir "$work/pack"
  name="$(cd "$root" && npm pack --pack-destination "$work/pack" --json --ignore-scripts | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].filename))')"
  tarball="$work/pack/$name"
fi
[[ -f "$tarball" ]] || fail "no tarball at $tarball"
# Absolute, because the npm exec check below runs from another directory.
tarball="$(cd "$(dirname "$tarball")" && pwd -P)/$(basename "$tarball")"
ok "tarball $(basename "$tarball") sha256 $(node -e 'const c=require("crypto"),f=require("fs");console.log(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$tarball")"

# PATH holds node and nothing else, so no `bun` (and nothing that could shim one) is found.
nobun="$work/node-only"
mkdir "$nobun"
ln -s "$(command -v node)" "$nobun/node"
BUN_LINE="wachiman needs Bun 1.3 or later: https://bun.sh"

# The packages of the terminal screens, with what they need (the closure of the two dependencies).
UI_PACKAGES=("@clack/core" "@clack/prompts" chalk fast-string-truncated-width fast-string-width fast-wrap-ansi sisteransi)
# Copies them from this checkout into <dest>/node_modules, the way npm would have laid them out.
copy_ui_packages() {
  local dest="$1" pkg
  for pkg in "${UI_PACKAGES[@]}"; do
    [[ -f "$root/node_modules/$pkg/package.json" ]] || fail "$pkg is not installed in $root/node_modules: run \`bun install\` first"
    mkdir -p "$dest/node_modules/$(dirname "$pkg")"
    cp -R "$root/node_modules/$pkg" "$dest/node_modules/$pkg"
  done
}
# Loads the real chalk and Clack through the installed copy, with the given Bun, and checks that
# color follows NO_COLOR and that Clack draws into a stream. No terminal is needed.
ui_check() {
  cat >"$work/ui-check.ts" <<'CHECK'
import { PassThrough } from "node:stream";
const installed = process.argv[2];
const { loadUi } = await import(`${installed}/src/wizard/ui.ts`);
const { terminalStyle } = await import(`${installed}/src/wizard/style.ts`);
const out = new PassThrough();
let text = "";
out.on("data", (chunk) => (text += String(chunk)));
const ui = await loadUi({ input: new PassThrough(), output: out });
ui.intro("wachiman");
ui.note("body", "Title");
ui.outro("bye");
if (!text.includes("wachiman") || !text.includes("Title") || !text.includes("bye")) throw new Error(`Clack drew nothing usable: ${JSON.stringify(text)}`);
const colored = terminalStyle({ isTTY: true }, { TERM: "xterm" })("x", "brand");
const quiet = terminalStyle({ isTTY: true }, { TERM: "xterm", NO_COLOR: "1" })("x", "brand");
if (!colored.includes("\x1b[") || quiet !== "x") throw new Error(`color: ${JSON.stringify({ colored, quiet })}`);
console.log("ui-ok");
CHECK
  local got
  got="$(cd "$work" && "$1" --no-env-file "$work/ui-check.ts" "$installed")" || fail "the terminal screens did not load from the installed copy"
  [[ "$got" == "ui-ok" ]] || fail "the terminal screens check printed '$got'"
  ok "terminal screens: chalk and @clack/prompts load from the installed copy and NO_COLOR is honored"
}

prefix="$work/prefix"
if [[ "$bundled_bun" == 1 ]]; then
  # The real thing: the dependency and its postinstall come from the registry (network needed).
  npm install --global --prefix "$prefix" --no-audit --no-fund "$tarball" >/dev/null
else
  # The tarball without its dependencies: unpack, drop `dependencies`, repack.
  mkdir "$work/unpacked"
  tar -xzf "$tarball" -C "$work/unpacked"
  node -e 'const fs=require("fs"),f=process.argv[1]+"/package/package.json",p=JSON.parse(fs.readFileSync(f,"utf8"));if(!p.dependencies||Object.keys(p.dependencies).sort().join()!=="@clack/prompts,bun,chalk")throw new Error("expected exactly @clack/prompts, bun and chalk as dependencies, found "+JSON.stringify(p.dependencies));delete p.dependencies;fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$work/unpacked"
  tar -czf "$work/wachiman-nodeps.tgz" -C "$work/unpacked" package
  npm install --global --prefix "$prefix" --offline --registry "$dead_registry" --ignore-scripts --no-audit --no-fund "$work/wachiman-nodeps.tgz" >/dev/null
fi
installed="$prefix/lib/node_modules/wachiman"
[[ -f "$installed/package.json" ]] || installed="$prefix/node_modules/wachiman" # Windows layout
version="$(node -p 'require(process.argv[1]).version' "$installed/package.json")"
if [[ "$bundled_bun" == 1 ]]; then
  ok "npm i -g of the tarball installed wachiman $version and its dependencies"
else
  ok "npm i -g of the tarball (without its dependencies) installed wachiman $version without a registry"
fi

bin="$prefix/bin"
[[ -e "$bin/wachiman" ]] || bin="$prefix"

if [[ "$bundled_bun" == 1 ]]; then
  bundled="$(find "$prefix" -path '*/node_modules/bun/bin/bun.exe' | head -n 1)"
  [[ -n "$bundled" ]] || fail "the bun dependency was not installed under $prefix"
  bundled_version="$("$bundled" --version)" || fail "the bundled bun.exe did not run: its postinstall may not have run"
  ok "the bundled Bun runs: $bundled_version"
  ui_check "$bundled"
  got="$(PATH="$nobun" "$bin/wachiman" --version)" || fail "wachiman did not run with only node on PATH"
  [[ "$got" == "$version" ]] || fail "wachiman --version printed '$got', expected '$version'"
  ok "only node on PATH: wachiman --version -> $got, through the bundled Bun"
  echo "verified wachiman $version"
  exit 0
fi

# What `npm i -g wachiman --ignore-scripts` leaves: the bun package with a stub bin/bun.exe.
stub_bun() {
  mkdir -p "$installed/node_modules/bun/bin"
  echo '{"name":"bun","version":"1.3.4"}' >"$installed/node_modules/bun/package.json"
  printf '#!/bin/sh\necho "stub: bun postinstall did not run" >&2\nexit 1\n' >"$installed/node_modules/bun/bin/bun.exe"
  chmod +x "$installed/node_modules/bun/bin/bun.exe"
}

if [[ "$without_bun" == 1 ]]; then
  # Case 1: no bundled Bun at all. Case 2: the stub. PATH holds node and nothing else in both.
  for scenario in "no bundled Bun" "a stub bundled Bun"; do
    [[ "$scenario" == "a stub bundled Bun" ]] && stub_bun
    set +e
    out="$(PATH="$nobun" "$bin/wachiman" --version 2>"$work/stderr")"
    code=$?
    set -e
    [[ "$code" == 2 ]] || fail "$scenario and no Bun on PATH: the launcher exited $code, expected 2"
    [[ -z "$out" ]] || fail "$scenario and no Bun on PATH: the launcher wrote to stdout: $out"
    grep -qxF "$BUN_LINE" "$work/stderr" || fail "$scenario: the Bun line is missing: $(cat "$work/stderr")"
    grep -qF "npm install -g bun" "$work/stderr" || fail "$scenario: the install command is missing: $(cat "$work/stderr")"
    ok "without Bun ($scenario): exit 2 and the line: $(head -n 1 "$work/stderr")"
  done
  exit 0
fi

command -v bun >/dev/null || fail "bun is not on PATH (use --without-bun to check that case)"
copy_ui_packages "$installed"

# The bundled Bun is a stub here (--ignore-scripts), so every run below also proves the fallback to PATH.
stub_bun

got="$("$bin/wachiman" --version)"
[[ "$got" == "$version" ]] || fail "wachiman --version printed '$got', expected '$version'"
ok "wachiman --version -> $got (bundled Bun is a stub, so the Bun on PATH ran)"
ui_check bun

# An npm exec run that can only succeed from an installed copy: the tarball goes into a project's
# node_modules, the registry is a closed port and the cache is empty, so a registry download
# would fail with ENOTCACHED instead of being the thing under test.
project="$work/project"
mkdir "$project"
(
  cd "$project"
  npm init -y >/dev/null
  npm install --offline --registry "$dead_registry" --ignore-scripts --no-audit --no-fund "$work/wachiman-nodeps.tgz" >/dev/null
  copy_ui_packages "$project"
  got="$(npm exec --offline --registry "$dead_registry" -- wachiman --version)"
  [[ "$got" == "$version" ]] || { echo "FAIL  npm exec wachiman --version printed '$got'" >&2; exit 1; }
)
ok "npm exec -- wachiman --version from the installed copy, no registry -> $version"

# doctor against fixture dependencies: a fake `claude` that answers --version and a claude.ai
# sign-in, a fixture home, no ambient account variable, and the real bun, git and tar. No model is called.
fixture="$work/fixture-bin"
mkdir "$fixture" "$work/home"
cat >"$fixture/claude" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then echo "2.1.321 (Claude Code)"; exit 0; fi
if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then echo '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0; fi
echo "fake claude: unexpected call: $*" >&2
exit 3
FAKE
chmod +x "$fixture/claude"
cd "$root"
set +e
env -u CLAUDE_CONFIG_DIR -u ANTHROPIC_API_KEY -u WACHIMAN_PROFILE -u WACHIMAN_HOME PATH="$fixture:$PATH" HOME="$work/home" USERPROFILE="$work/home" "$bin/wachiman" doctor --json >"$work/doctor.json" 2>"$work/doctor.err"
code=$?
set -e
[[ "$code" == 0 ]] || { cat "$work/doctor.json" "$work/doctor.err" >&2; fail "doctor exited $code against fixture dependencies"; }
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const bad = r.checks.filter((c) => c.level === "required" && c.status !== "ok");
  if (r.format !== "wachiman.doctor/1" || r.install !== "npm" || bad.length) { console.error(JSON.stringify({ format: r.format, install: r.install, bad }, null, 2)); process.exit(1); }
  console.log(`doctor: format ${r.format}, install ${r.install}, ${r.checks.length} checks, every required check ok`);
' "$work/doctor.json" || fail "doctor report is not as expected"
ok "wachiman doctor --json against fixture dependencies (exit 0)"

# The isolation flags must survive the launcher: from a directory holding a bunfig.toml with a
# preload (and a dotenv file), neither may reach the engine process.
hostile="$work/hostile"
cp -R "$root/test/fixtures/hostile" "$hostile"
(cd "$hostile" && "$bin/wachiman" --version >/dev/null)
[[ ! -e "$hostile/BUN_PRELOAD_RAN" ]] || fail "the working directory's bunfig.toml preload ran through the launcher"
ok "a hostile bunfig.toml and dotenv file in the working directory did not reach the engine"
echo "verified wachiman $version"
