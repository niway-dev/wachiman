/**
 * A fake toolchain for the account and doctor tests: answers `bun`, `git`, `tar` and `claude` the
 * way their version and `auth status` probes do, and records every call. No real `claude` (or
 * `bun`, `git`, `tar`) is started by anything that uses it.
 */
import type { SpawnFn } from "../../src/accounts/confirm";

export interface Tools {
  bun?: string | null;
  git?: string | null;
  tar?: string | null;
  claudeVersion?: string | null;
  /** What `claude auth status` prints, per configuration directory (undefined: the shell's own). */
  auth?: (configDir: string | undefined) => { status: number; stdout: string };
}

export interface RecordedCall {
  binary: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/** A signed-in `claude.ai` status with an e-mail address the report must never repeat. */
export const signedIn = (configDir: string | undefined, extra: Record<string, unknown> = {}) => ({
  status: 0,
  stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", ...(configDir ? { configDirectory: configDir } : {}), email: "me@example.com", ...extra }),
});

export function fakeToolchain(tools: Tools = {}) {
  const calls: RecordedCall[] = [];
  const spawn: SpawnFn = (binary, args, options) => {
    calls.push({ binary, args, cwd: options.cwd, env: options.env });
    const answer = (value: string | null | undefined, fallback: string) => {
      const text = value === undefined ? fallback : value;
      return text === null ? { status: null, stdout: "", stderr: "", error: new Error(`spawn ${binary} ENOENT`) } : { status: 0, stdout: `${text}\n`, stderr: "" };
    };
    if (binary === "bun") return answer(tools.bun, "1.4.2");
    if (binary === "git") return answer(tools.git, "git version 2.43.0");
    if (binary === "tar") return answer(tools.tar, "bsdtar 3.5.3 - libarchive 3.5.3");
    if (args[0] === "--version") return answer(tools.claudeVersion, "2.1.321 (Claude Code)");
    if (args[0] === "auth" && args[1] === "status") {
      const out = (tools.auth ?? ((dir) => signedIn(dir)))(options.env.CLAUDE_CONFIG_DIR);
      return { status: out.status, stdout: out.stdout, stderr: "" };
    }
    throw new Error(`unexpected spawn ${binary} ${args.join(" ")}`);
  };
  return { spawn, calls };
}
