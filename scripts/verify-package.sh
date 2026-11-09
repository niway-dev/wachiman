#!/usr/bin/env bash
# Install the packed tarball the way a user would and check that it runs. No model call, no
# registry write, and no registry read for the package: the tarball is installed from a file, the
# npm cache is empty, and the registry is pointed at a closed port, so anything that needed the
# network would fail loudly.
#
#   scripts/verify-package.sh [--tarball FILE]   with Bun on PATH: version, npm exec, doctor, isolation
#   scripts/verify-package.sh --without-bun      Bun hidden from PATH: the launcher exits 2 with the install line
#
# Needs bash, node and npm. Run it from a checkout (it packs the checkout unless --tarball is given).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
tarball=""
without_bun=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball) tarball="${2:?--tarball needs a file}"; shift 2 ;;
    --without-bun) without_bun=1; shift ;;
    *) echo "usage: verify-package.sh [--tarball FILE] [--without-bun]" >&2; exit 2 ;;
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

prefix="$work/prefix"
npm install --global --prefix "$prefix" --offline --registry "$dead_registry" --ignore-scripts --no-audit --no-fund "$tarball" >/dev/null
installed="$prefix/lib/node_modules/wachiman"
[[ -f "$installed/package.json" ]] || installed="$prefix/node_modules/wachiman" # Windows layout
version="$(node -p 'require(process.argv[1]).version' "$installed/package.json")"
ok "npm i -g of the tarball installed wachiman $version without a registry"

bin="$prefix/bin"
[[ -e "$bin/wachiman" ]] || bin="$prefix"

if [[ "$without_bun" == 1 ]]; then
  # PATH holds node and nothing else, so no `bun` (and nothing that could shim one) is found.
  nobun="$work/node-only"
  mkdir "$nobun"
  ln -s "$(command -v node)" "$nobun/node"
  set +e
  out="$(PATH="$nobun" "$bin/wachiman" --version 2>"$work/stderr")"
  code=$?
  set -e
  [[ "$code" == 2 ]] || fail "without Bun the launcher exited $code, expected 2"
  [[ -z "$out" ]] || fail "without Bun the launcher wrote to stdout: $out"
  grep -qx "wachiman needs Bun 1.3 or later: https://bun.sh" "$work/stderr" || fail "without Bun the install line is missing: $(cat "$work/stderr")"
  ok "without Bun: exit 2 and the line: $(cat "$work/stderr")"
  exit 0
fi

command -v bun >/dev/null || fail "bun is not on PATH (use --without-bun to check that case)"

got="$("$bin/wachiman" --version)"
[[ "$got" == "$version" ]] || fail "wachiman --version printed '$got', expected '$version'"
ok "wachiman --version -> $got"
got="$("$bin/agent-review" --version)"
[[ "$got" == "$version" ]] || fail "agent-review --version printed '$got', expected '$version'"
ok "agent-review --version -> $got"

# An npm exec run that can only succeed from an installed copy: the tarball goes into a project's
# node_modules, the registry is a closed port and the cache is empty, so a registry download
# would fail with ENOTCACHED instead of being the thing under test.
project="$work/project"
mkdir "$project"
(
  cd "$project"
  npm init -y >/dev/null
  npm install --offline --registry "$dead_registry" --ignore-scripts --no-audit --no-fund "$tarball" >/dev/null
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
