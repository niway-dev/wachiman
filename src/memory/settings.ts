/** The memory settings of the repository at `repoDir`, from the working tree's `.wachiman.yml` (capture is the author's own act, so the file as they have it now). */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRepoSettings, resolveMemorySettings, SETTINGS_PATH, type MemorySettings } from "../repo-settings";

/** The repository's top level for `dir`, or `dir` when git cannot say. */
export function repositoryRoot(dir: string): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
  const top = r.status === 0 ? r.stdout.trim() : "";
  return top === "" ? dir : top;
}

export function loadMemorySettings(repoDir: string, notice: (text: string) => void = () => {}): MemorySettings {
  const path = join(repositoryRoot(repoDir), SETTINGS_PATH);
  const settings = existsSync(path) ? parseRepoSettings(readFileSync(path, "utf8")) : undefined;
  const resolved = resolveMemorySettings(settings);
  for (const n of resolved.notices) notice(n);
  return resolved.settings;
}
