import { spawnSync } from "node:child_process";

/** The login of the account `gh` is signed in as, or undefined when `gh` is missing, signed out or fails. Only ever a suggestion. */
export function ghLogin(): string | undefined {
  try {
    const run = spawnSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
    if (run.error || run.status !== 0) return undefined;
    const login = run.stdout.trim();
    return login === "" ? undefined : login;
  } catch {
    return undefined;
  }
}
