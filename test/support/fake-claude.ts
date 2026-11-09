/**
 * A fake `claude`, compiled to a real executable (`claude` or `claude.exe`): the resolver spawns the
 * binary by name and never through a shell, so a script or a `.cmd` shim would not be found on
 * Windows. It answers `--version` and `auth status`, records every call, and for a review call
 * copies the file named by `--settings` while it exists. Create a file named `hang` in its state
 * directory and a review call writes `ready` and then waits forever, for the Ctrl-C proof. No
 * model, no network. The state directory is baked in: the child environment is an allowlist, so no
 * variable would reach the fake.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FAKE_REVIEW = {
  is_error: false,
  subtype: "success",
  num_turns: 1,
  total_cost_usd: 0.01,
  duration_ms: 5,
  structured_output: {
    files_reviewed: ["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"],
    files_skipped: [],
    findings: [{ path: "src/a.ts", line: 2, severity: "fix", topic: "bug", confidence: "high", title: "Fake finding", body: "Body of the fake finding." }],
    contracts: [],
    thread_replies: [],
    summary: "Reviewed by the fake provider.",
  },
};

const source = (state: string) => `
import { appendFileSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
const state = ${JSON.stringify(state)};
const args = process.argv.slice(2);
appendFileSync(state + "/calls.log", args.join(" ") + "\\n");
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  // An external profile is confirmed by the directory the binary says it uses.
  const dir = process.env.CLAUDE_CONFIG_DIR;
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", ...(dir ? { configDirectory: dir } : {}) }));
  process.exit(0);
}
const at = args.indexOf("--settings");
if (at >= 0) {
  writeFileSync(state + "/settings-path.txt", args[at + 1]);
  copyFileSync(args[at + 1], state + "/settings-seen.json");
}
await Bun.stdin.text();
if (existsSync(state + "/hang")) { writeFileSync(state + "/ready", "1"); setInterval(() => {}, 1000); await new Promise(() => {}); }
console.log(${JSON.stringify(JSON.stringify(FAKE_REVIEW))});
`;

export interface FakeClaude {
  /** The directory to put first on PATH. */
  binDir: string;
  stateDir: string;
  /** The executable's full path, for a profile's `--binary`. */
  exe: string;
  calls(): string[];
  /** A file the fake wrote in its state directory, or undefined. */
  read(name: "settings-path.txt" | "settings-seen.json" | "ready"): Buffer | undefined;
  hang(): void;
  /** Forgets the calls and everything the fake recorded or was told, for the next scenario. */
  reset(): void;
}

/** Compiles the fake into `<dir>/bin`, with its state in `<dir>/state`. `bun` is the Bun that compiles. */
export function buildFakeClaude(dir: string, bun: string = process.execPath): FakeClaude {
  const binDir = join(dir, "bin");
  const stateDir = join(dir, "state");
  const src = join(dir, "src");
  for (const d of [binDir, stateDir, src]) mkdirSync(d, { recursive: true });
  const entry = join(src, "fake-claude.ts");
  writeFileSync(entry, source(stateDir));
  const exe = join(binDir, process.platform === "win32" ? "claude.exe" : "claude");
  const built = Bun.spawnSync([bun, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", entry, "--outfile", exe]);
  if (built.exitCode !== 0) throw new Error(`could not compile the fake claude: ${built.stderr.toString()}`);
  return {
    binDir,
    stateDir,
    exe,
    calls: () => (existsSync(join(stateDir, "calls.log")) ? readFileSync(join(stateDir, "calls.log"), "utf8").split(/\r?\n/).filter(Boolean) : []),
    read: (name) => (existsSync(join(stateDir, name)) ? readFileSync(join(stateDir, name)) : undefined),
    hang: () => writeFileSync(join(stateDir, "hang"), "1"),
    reset: () => {
      for (const name of ["calls.log", "settings-path.txt", "settings-seen.json", "ready", "hang"]) rmSync(join(stateDir, name), { force: true });
    },
  };
}
