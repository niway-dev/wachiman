/**
 * Temporary git repositories for the local-git connector and the `local` command tests. Every
 * commit passes its own identity and turns signing off: the owner's global git has
 * `user.useConfigOnly`, and a developer may sign commits by default.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];

/** Runs git in `dir` and returns stdout; throws with stderr on a non-zero exit. */
export function git(dir: string, ...args: string[]) {
  const run = spawnSync("git", ["-c", "init.defaultBranch=main", ...IDENTITY, ...args], { cwd: dir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${dir}: ${run.stderr}`);
  return run.stdout;
}

export function write(dir: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

export function commit(dir: string, files: Record<string, string | Buffer>, message: string) {
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD").trim();
}

const made: string[] = [];

/** An empty repository on `main`, removed by `removeTempRepos`. */
export function emptyRepo(prefix = "wachiman-repo-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  git(dir, "init", "-q");
  return dir;
}

export function removeTempRepos() {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const PNG_BASE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
export const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02, 0x03]);
export const A_BASE = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n";
export const A_HEAD = "export const a = 1;\nexport const b = 20;\nexport const c = 3;\nexport const d = 4;\n";
export const OLD_TS = "export function old() {\n  return 'unchanged';\n}\n";

export interface BranchRepo {
  dir: string;
  /** The branch point: the merge-base of `main` and `feat/x`. */
  mergeBase: string;
  /** `main`'s tip, one commit after the branch point. */
  mainTip: string;
  head: string;
  subjects: string[];
}

/**
 * `main` with `CLAUDE.md`, `src/a.ts`, `img.png` and `src/old.ts`; `feat/x` edits `src/a.ts`,
 * adds `src/b.ts`, renames `src/old.ts` to `src/new.ts` unchanged, changes `img.png` and edits
 * `CLAUDE.md`; `main` then moves on, so the merge-base is not its tip. Checked out at `feat/x`.
 */
export function branchRepo(): BranchRepo {
  const dir = emptyRepo();
  const mergeBase = commit(
    dir,
    { "CLAUDE.md": "RULES-FROM-BASE\n", "src/a.ts": A_BASE, "img.png": PNG_BASE, "src/old.ts": OLD_TS },
    "base",
  );
  git(dir, "switch", "-q", "-c", "feat/x");
  commit(dir, { "src/a.ts": A_HEAD, "src/b.ts": "export const b = 'new';\n" }, "edit a and add b");
  git(dir, "mv", "src/old.ts", "src/new.ts");
  const head = commit(dir, { "img.png": PNG_HEAD, "CLAUDE.md": "RULES-FROM-HEAD\n" }, "rename old, change the image and the rules");
  git(dir, "switch", "-q", "main");
  const mainTip = commit(dir, { "docs/later.md": "after the branch point\n" }, "later on main");
  git(dir, "switch", "-q", "feat/x");
  return { dir, mergeBase, mainTip, head, subjects: ["edit a and add b", "rename old, change the image and the rules"] };
}

/** `count` empty commits on the current branch; returns the new tip. */
export function emptyCommits(dir: string, count: number) {
  for (let i = 1; i <= count; i++) git(dir, "commit", "-q", "--allow-empty", "-m", `step ${i}`);
  return git(dir, "rev-parse", "HEAD").trim();
}
