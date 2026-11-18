/**
 * `wachiman memory propose` against temporary repositories whose `origin` is a local bare repository,
 * and a fake for the GitHub pull-request calls. Nothing here touches a real remote.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { parseMemoryFile } from "./entries";
import { runMemory } from "./command";
import { applyCandidate, assertMemoryPaths, readMemoryFiles, type PullRequest, type PullRequests } from "./propose";
import { evidenceLine, newCandidate, renderEntry } from "./candidates";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A fake for `gh pr list` and `gh pr create`, with the pull requests it holds. */
function fakePulls(initial: PullRequest[] = []) {
  const prs = [...initial];
  const created: { head: string; base: string; title: string; body: string }[] = [];
  const pulls: PullRequests = {
    list: (head) => (head === "wachiman/memory" ? prs.map((p) => ({ ...p })) : []),
    createDraft: (input) => {
      created.push(input);
      const number = prs.length + 1;
      prs.push({ number, state: "OPEN", url: `https://example.test/pr/${number}` });
      return `https://example.test/pr/${number}`;
    },
  };
  return { pulls, prs, created };
}

/** A bare `origin` with `main` seeded, and a way to clone it. */
function world() {
  const bare = temp("wachiman-origin-");
  git(bare, "init", "-q", "--bare", "-b", "main");
  const seed = emptyRepo("wachiman-seed-");
  commit(seed, { "src/a.ts": "export const a = 1;\n", "docs/readme.md": "hello\n" }, "seed");
  git(seed, "remote", "add", "origin", bare);
  git(seed, "push", "-q", "origin", "main");
  const clone = (name: string) => {
    const parent = temp(`wachiman-dev-${name}-`);
    git(parent, "clone", "-q", bare, "repo");
    const dir = join(parent, "repo");
    git(dir, "config", "user.name", name);
    git(dir, "config", "user.email", `${name}@example.com`);
    git(dir, "config", "commit.gpgsign", "false");
    return dir;
  };
  return { bare, seed, clone };
}

/** One developer: a clone, a Wachiman home of their own, and the memory commands. */
function developer(w: ReturnType<typeof world>, name: string, fake = fakePulls()) {
  const dir = w.clone(name);
  const home = temp(`wachiman-home-${name}-`);
  const run = (pulls: PullRequests, ...argv: string[]) => {
    let stdout = "";
    let stderr = "";
    let code: number;
    try {
      code = runMemory(argv, dir, { stdout: (t) => (stdout += t), stderr: (l) => (stderr += `${l}\n`) }, { env: { WACHIMAN_HOME: home }, now: () => new Date("2026-11-18T10:00:00Z"), deps: { pulls, teamMemory: () => true } });
    } catch (error) {
      code = 2;
      stderr += (error as Error).message;
    }
    return { code, stdout, stderr };
  };
  const add = (rule: string, extra: string[] = ["--pr", "709"]) => {
    const r = run(fake.pulls, "add", "--kind", "convention", "--scope", "src/**", "--rule", rule, "--why", `Because: ${rule}`, ...extra);
    expect(r.code).toBe(0);
    return r.stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
  };
  return { dir, home, fake, run: (...argv: string[]) => run(fake.pulls, ...argv), add };
}

const remoteLog = (bare: string, ref = "wachiman/memory") => git(bare, "log", "--format=%H %s", `refs/heads/${ref}`).trim().split("\n");
const remoteFile = (bare: string, path = ".wachiman/memory/index.md", ref = "wachiman/memory") => git(bare, "show", `refs/heads/${ref}:${path}`);
const worktrees = (dir: string) => git(dir, "worktree", "list").trim().split("\n").length;

describe("memory propose", () => {
  test("AC8: adds exactly the shown entry as one commit on wachiman/memory and opens one draft pull request, leaving a dirty feature branch as it was", () => {
    const w = world();
    const d = developer(w, "ana");
    git(d.dir, "switch", "-q", "-c", "feat/work");
    commit(d.dir, { "src/b.ts": "export const b = 2;\n" }, "feature commit");
    // Uncommitted work of every kind: a staged edit, an unstaged edit and an untracked file.
    writeFileSync(join(d.dir, "src/a.ts"), "export const a = 100;\n");
    git(d.dir, "add", "src/a.ts");
    writeFileSync(join(d.dir, "src/b.ts"), "export const b = 200;\n");
    writeFileSync(join(d.dir, "scratch.txt"), "untracked\n");
    const before = { status: git(d.dir, "status", "--porcelain=v2", "--branch"), head: git(d.dir, "rev-parse", "HEAD"), diff: git(d.dir, "diff", "HEAD"), stash: git(d.dir, "stash", "list") };
    const id = d.add("Prefer named exports.");
    const shown = d.run("show", id).stdout;

    const r = d.run("propose", id);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^recorded: entry [0-9a-f]{7} on wachiman\/memory \([0-9a-f]{7}\)\. Draft pull request: https:\/\/example\.test\/pr\/1\n$/);

    // One commit on the branch, on top of the default branch, touching only the memory index.
    const log = remoteLog(w.bare);
    expect(log).toHaveLength(2);
    const mainHead = git(w.bare, "rev-parse", "refs/heads/main").trim();
    expect(git(w.bare, "rev-parse", "refs/heads/wachiman/memory~1").trim()).toBe(mainHead);
    expect(git(w.bare, "diff-tree", "--no-commit-id", "--name-status", "-r", "refs/heads/wachiman/memory").trim()).toBe("A\t.wachiman/memory/index.md");
    // The text written is the text shown, and it is a valid entry with the shown id.
    expect(remoteFile(w.bare)).toContain(shown);
    const parsed = parseMemoryFile("index.md", remoteFile(w.bare));
    expect(parsed.problems).toEqual([]);
    expect(parsed.entries.map((e) => e.id)).toEqual([id]);
    // One draft pull request, titled as the spec says.
    expect(d.fake.created).toHaveLength(1);
    expect(d.fake.created[0]).toMatchObject({ head: "wachiman/memory", base: "main", title: "chore(wachiman): memory" });
    // The developer's checkout is exactly as it was.
    expect(git(d.dir, "status", "--porcelain=v2", "--branch")).toBe(before.status);
    expect(git(d.dir, "rev-parse", "HEAD")).toBe(before.head);
    expect(git(d.dir, "diff", "HEAD")).toBe(before.diff);
    expect(git(d.dir, "stash", "list")).toBe(before.stash);
    expect(git(d.dir, "branch", "--show-current").trim()).toBe("feat/work");
    expect(readFileSync(join(d.dir, "scratch.txt"), "utf8")).toBe("untracked\n");
    expect(worktrees(d.dir)).toBe(1);
    // The candidate is marked as proposed.
    expect(d.run("candidates").stdout).toContain("proposed 2026-11-18");
  }, 60_000);

  test("AC8: never force-pushes: a second entry is a new commit on top of the first, and the second proposal reuses the open pull request", () => {
    const w = world();
    const d = developer(w, "ana");
    const first = d.add("Prefer named exports.");
    const second = d.add("Keep modules small.");
    expect(d.run("propose", first).code).toBe(0);
    const firstHead = git(w.bare, "rev-parse", "refs/heads/wachiman/memory").trim();
    expect(d.run("propose", second).code).toBe(0);
    expect(git(w.bare, "merge-base", "--is-ancestor", firstHead, "refs/heads/wachiman/memory")).toBeDefined();
    expect(remoteLog(w.bare)).toHaveLength(3);
    expect(d.fake.created).toHaveLength(1);
    expect(parseMemoryFile("index.md", remoteFile(w.bare)).entries.map((e) => e.id)).toEqual([first, second]);
  }, 60_000);

  test("AC8: a candidate that is not proposable is refused and nothing is pushed", () => {
    const w = world();
    const d = developer(w, "ana");
    const r = d.run("add", "--kind", "convention", "--scope", "src/**", "--rule", "Prefer named exports.", "--why", "w", "--source", "judged", "--finding", "x");
    expect(r.code).toBe(2); // no such finding in the history: not evidence at all
    // A candidate with one piece of tool-found evidence, written directly to the store through a loop-free route.
    const id = d.add("Weak one.");
    const store = join(d.home, "memory-candidates");
    const dirs = readdirSync(store);
    const file = join(store, dirs[0], `${id}.json`);
    const c = JSON.parse(readFileSync(file, "utf8"));
    c.evidence = [{ date: "2026-11-18", source: "judged", pr: 1, agent: false, finding: "f" }];
    writeFileSync(file, JSON.stringify(c));
    const out = d.run("propose", id);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("is not proposable");
    expect(out.stdout).not.toContain("recorded");
    expect(git(w.bare, "branch", "--list", "wachiman/memory").trim()).toBe("");
    expect(d.fake.created).toHaveLength(0);
  }, 60_000);

  test("AC15: two developers proposing different entries end with two commits on the one branch and one pull request", () => {
    const w = world();
    const fake = fakePulls();
    const ana = developer(w, "ana", fake);
    const ben = developer(w, "ben", fake);
    const a = ana.add("Prefer named exports.");
    const b = ben.add("Keep modules small.");
    expect(ana.run("propose", a).code).toBe(0);
    // Ben's clone has not fetched yet; propose fetches by itself.
    expect(ben.run("propose", b).code).toBe(0);
    const log = remoteLog(w.bare);
    expect(log).toHaveLength(3); // seed + two entries
    expect(parseMemoryFile("index.md", remoteFile(w.bare)).entries.map((e) => e.id)).toEqual([a, b]);
    expect(fake.created).toHaveLength(1);
    expect(fake.prs).toHaveLength(1);
  }, 60_000);

  test("AC15: the same entry proposed twice is written once and the second developer's evidence is added to it", () => {
    const w = world();
    const fake = fakePulls();
    const ana = developer(w, "ana", fake);
    const ben = developer(w, "ben", fake);
    const a = ana.add("Prefer named exports.", ["--pr", "709"]);
    const b = ben.add("Prefer named exports.", ["--pr", "812"]);
    expect(b).toBe(a);
    expect(ana.run("propose", a).code).toBe(0);
    const second = ben.run("propose", b);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain(`evidence for entry ${a}, which was already there`);
    const entries = parseMemoryFile("index.md", remoteFile(w.bare)).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].evidence).toEqual(["2026-11-18 operator instruction, pull request 709", "2026-11-18 operator instruction, pull request 812"]);
    expect(remoteLog(w.bare)).toHaveLength(3);
    // The id did not change, and proposing it a third time with nothing new writes nothing.
    expect(entries[0].id).toBe(a);
    const again = ben.run("propose", b);
    expect(again.stdout).toContain("already recorded");
    expect(remoteLog(w.bare)).toHaveLength(3);
    expect(fake.created).toHaveLength(1);
  }, 60_000);

  test("an entry that is only on the default branch is not reported as on wachiman/memory, and no pull request is opened for it", () => {
    const w = world();
    const fake = fakePulls();
    const d = developer(w, "ana", fake);
    const id = d.add("Prefer named exports.");
    expect(d.run("propose", id).code).toBe(0);
    // The pull request is merged and its branch deleted: the entry now lives on main only.
    git(w.bare, "update-ref", "refs/heads/main", "refs/heads/wachiman/memory");
    git(w.bare, "update-ref", "-d", "refs/heads/wachiman/memory");
    fake.prs.length = 0;
    const again = d.run("propose", id);
    expect(again.code).toBe(0);
    expect(again.stdout).toBe(`already recorded: ${id} is on main with the same evidence; nothing was written and no pull request is needed.\n`);
    expect(again.stderr).toBe("");
    expect(fake.created).toHaveLength(1); // only the first proposal's pull request
    expect(git(w.bare, "branch", "--list", "wachiman/memory").trim()).toBe("");
  }, 60_000);

  test("evidence added while the push is in flight is kept when the candidate is marked proposed", () => {
    const w = world();
    const fake = fakePulls();
    const d = developer(w, "ana", fake);
    const id = d.add("Prefer named exports.", ["--pr", "709"]);
    // The pull request step runs after the push: a second `memory add` of the same entry lands there.
    const racing: PullRequests = {
      list: fake.pulls.list,
      createDraft: (input, cwd) => {
        d.add("Prefer named exports.", ["--pr", "812"]);
        return fake.pulls.createDraft(input, cwd);
      },
    };
    expect(d.run("candidates").stdout).not.toContain("proposed");
    let out = "";
    const code = runMemory(["propose", id], d.dir, { stdout: (t) => (out += t), stderr: () => {} }, { env: { WACHIMAN_HOME: d.home }, now: () => new Date("2026-11-18T10:00:00Z"), deps: { pulls: racing, teamMemory: () => true } });
    expect(code).toBe(0);
    const shown = d.run("show", id).stdout;
    expect(shown).toContain("pull request 709");
    expect(shown).toContain("pull request 812");
    expect(d.run("candidates").stdout).toContain("proposed 2026-11-18");
  }, 60_000);

  test("when the proposed mark cannot be saved after the push the entry stays recorded, the exit is 0 and the reason is said", () => {
    const w = world();
    const fake = fakePulls();
    const d = developer(w, "ana", fake);
    const id = d.add("Prefer named exports.", ["--pr", "709"]);
    // A lock held by a live run while the pull request step runs makes the mark fail.
    const locking: PullRequests = {
      list: fake.pulls.list,
      createDraft: (input, cwd) => {
        mkdirSync(join(d.home, "memory-candidates", readdirSync(join(d.home, "memory-candidates"))[0]!, `${id}.lock`));
        return fake.pulls.createDraft(input, cwd);
      },
    };
    let err = "";
    const code = runMemory(["propose", id], d.dir, { stdout: () => {}, stderr: (l) => (err += `${l}\n`) }, { env: { WACHIMAN_HOME: d.home }, now: () => new Date("2026-11-18T10:00:00Z"), deps: { pulls: locking } });
    expect(code).toBe(0);
    expect(err).toContain("the entry was recorded, but candidate");
    expect(remoteLog(w.bare)).toHaveLength(2);
  }, 60_000);

  test("a push refused for a reason other than a race is reported once, not retried or blamed on colleagues", () => {
    const w = world();
    const d = developer(w, "ana");
    const id = d.add("Prefer named exports.");
    writeFileSync(join(w.bare, "hooks", "pre-receive"), `#!/bin/sh\necho "policy: no memory today" >&2\necho x >> "$GIT_DIR/refusals"\nexit 1\n`);
    chmodSync(join(w.bare, "hooks", "pre-receive"), 0o755);
    const r = d.run("propose", id);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("the push to wachiman/memory was refused");
    expect(r.stderr).toContain("policy: no memory today");
    expect(r.stderr).not.toContain("colleagues");
    expect(readFileSync(join(w.bare, "refusals"), "utf8").trim().split("\n")).toHaveLength(1);
    expect(d.run("candidates").stdout).not.toContain("proposed");
    expect(worktrees(d.dir)).toBe(1);
  }, 60_000);

  test("a push rejected because a colleague pushed first is retried on the new head with the same entry", () => {
    const w = world();
    const d = developer(w, "ana");
    const id = d.add("Prefer named exports.");
    // The first push to the bare repository loses a race: the hook lands a colleague's commit on the branch and rejects the push.
    const colleague = "### abcdef0 Colleague entry\n\n- kind: convention\n- scope: src/**\n- rule: r\n- why: w\n- evidence:\n  - 2026-11-18 operator instruction, pull request 5\n- added: 2026-11-18\n";
    writeFileSync(join(w.bare, "colleague.md"), `# Wachiman memory\n\n${colleague}`);
    writeFileSync(
      join(w.bare, "hooks", "pre-receive"),
      `#!/bin/sh
# Objects written during a push sit in a quarantine that a rejection discards, so write to the real store.
G=$(cd "$GIT_DIR" && pwd)
unset GIT_QUARANTINE_PATH GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_OBJECT_DIRECTORY="$G/objects"
if [ ! -f "$G/raced" ]; then
  touch "$G/raced"
  blob=$(git hash-object -w "$G/colleague.md")
  inner=$(printf '100644 blob %s\\tindex.md\\n' "$blob" | git mktree)
  mid=$(printf '040000 tree %s\\tmemory\\n' "$inner" | git mktree)
  top=$(printf '040000 tree %s\\t.wachiman\\n' "$mid" | git mktree)
  main=$(git rev-parse refs/heads/main)
  c=$(GIT_AUTHOR_NAME=c GIT_AUTHOR_EMAIL=c@x GIT_COMMITTER_NAME=c GIT_COMMITTER_EMAIL=c@x git commit-tree "$top" -p "$main" -m "colleague")
  git update-ref refs/heads/wachiman/memory "$c"
  exit 1
fi
`,
    );
    chmodSync(join(w.bare, "hooks", "pre-receive"), 0o755);
    const r = d.run("propose", id);
    expect(r.code).toBe(0);
    const log = remoteLog(w.bare);
    expect(log.map((l) => l.split(" ").slice(1).join(" "))).toEqual([expect.stringContaining(id), "colleague", "seed"]);
    expect(parseMemoryFile("index.md", remoteFile(w.bare)).entries.map((e) => e.id)).toEqual(["abcdef0", id]);
    expect(worktrees(d.dir)).toBe(1);
  }, 60_000);

  test("a pull request closed without merging is reported and nothing is written", () => {
    const w = world();
    const fake = fakePulls([{ number: 3, state: "CLOSED", url: "https://example.test/pr/3" }]);
    git(w.seed, "push", "-q", "origin", "main:refs/heads/wachiman/memory");
    const before = git(w.bare, "rev-parse", "refs/heads/wachiman/memory");
    const d = developer(w, "ana", fake);
    const id = d.add("Prefer named exports.");
    const r = d.run("propose", id);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("#3 for wachiman/memory was closed without merging, so nothing was written");
    expect(git(w.bare, "rev-parse", "refs/heads/wachiman/memory")).toBe(before);
    expect(fake.created).toHaveLength(0);
    expect(worktrees(d.dir)).toBe(1);
  }, 60_000);

  test("after a merge the next proposal starts from the default branch and opens a new pull request", () => {
    const w = world();
    // The memory branch is left over at an older commit; main has moved on (the pull request was merged).
    git(w.seed, "push", "-q", "origin", "main:refs/heads/wachiman/memory");
    commit(w.seed, { "src/c.ts": "export const c = 3;\n" }, "main moves on");
    git(w.seed, "push", "-q", "origin", "main");
    const fake = fakePulls([{ number: 3, state: "MERGED", url: "https://example.test/pr/3" }]);
    const d = developer(w, "ana", fake);
    const id = d.add("Prefer named exports.");
    expect(d.run("propose", id).code).toBe(0);
    expect(git(w.bare, "rev-parse", "refs/heads/wachiman/memory~1").trim()).toBe(git(w.bare, "rev-parse", "refs/heads/main").trim());
    expect(fake.created).toHaveLength(1);
  }, 60_000);

  test("refuses to write through a symbolic link, writes nothing and removes its worktree", () => {
    const w = world();
    mkdirSync(join(w.seed, ".wachiman"), { recursive: true });
    symlinkSync("../docs", join(w.seed, ".wachiman/memory"));
    git(w.seed, "add", "-A");
    git(w.seed, "commit", "-q", "-m", "memory is a link");
    git(w.seed, "push", "-q", "origin", "main");
    const d = developer(w, "ana");
    const id = d.add("Prefer named exports.");
    const r = d.run("propose", id);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not a plain directory");
    expect(git(w.bare, "branch", "--list", "wachiman/memory").trim()).toBe("");
    expect(worktrees(d.dir)).toBe(1);
    // The link points at docs/: the remote's default branch still holds the same file and the same head.
    expect(git(w.bare, "show", "refs/heads/main:docs/readme.md")).toBe("hello\n");
    expect(git(w.bare, "rev-parse", "refs/heads/main").trim()).toBe(git(w.seed, "rev-parse", "HEAD").trim());
  }, 60_000);

  test("the developer's git hooks do not run in the temporary worktree, and the checkout's own hooks are left alone", () => {
    const w = world();
    const d = developer(w, "ana");
    const marker = join(d.dir, "..", "hook-ran");
    const hook = (name: string) => {
      writeFileSync(join(d.dir, ".git", "hooks", name), `#!/bin/sh\necho ${name} >> "${marker}"\nexit 1\n`);
      chmodSync(join(d.dir, ".git", "hooks", name), 0o755);
    };
    for (const name of ["pre-commit", "commit-msg", "pre-push", "post-checkout"]) hook(name);
    const id = d.add("Prefer named exports.");
    const r = d.run("propose", id);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(remoteLog(w.bare)).toHaveLength(2);
    // The developer's own commits still run them.
    expect(existsSync(join(d.dir, ".git", "hooks", "pre-commit"))).toBe(true);
  }, 60_000);

  test("removing its own worktree leaves the developer's other registered worktrees alone, even one whose folder is missing", () => {
    const w = world();
    const d = developer(w, "ana");
    const away = join(temp("wachiman-away-"), "feature");
    git(d.dir, "worktree", "add", "-q", "--detach", away);
    rmSync(away, { recursive: true, force: true });
    expect(worktrees(d.dir)).toBe(2);
    const id = d.add("Prefer named exports.");
    const r = d.run("propose", id);
    expect(r.code).toBe(0);
    // Only the temporary worktree's registration is gone; the missing one is still registered.
    expect(worktrees(d.dir)).toBe(2);
    expect(git(d.dir, "worktree", "list", "--porcelain")).toContain("feature");
  }, 60_000);

  test("an entry whose scope matches no file would fail memory check, so it is refused before anything is committed", () => {
    const w = world();
    const d = developer(w, "ana");
    const r = d.run("add", "--kind", "convention", "--scope", "nothing/**", "--rule", "Rule.", "--why", "Because.", "--pr", "1");
    const id = r.stdout.match(/candidate ([0-9a-f]{7}) saved/)![1];
    const out = d.run("propose", id);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("would make `wachiman memory check` fail");
    expect(out.stderr).toContain("scope `nothing/**` of entry matches no file in the repository");
    expect(git(w.bare, "branch", "--list", "wachiman/memory").trim()).toBe("");
    expect(worktrees(d.dir)).toBe(1);
  }, 60_000);

  test("when only the draft pull request fails the entry stays recorded, the exit is 1, and a re-run opens the pull request without writing again", () => {
    const w = world();
    const fake = fakePulls();
    let failures = 1;
    const flaky: PullRequests = {
      list: fake.pulls.list,
      createDraft: (input, cwd) => {
        if (failures-- > 0) throw new Error("gh: not logged in");
        return fake.pulls.createDraft(input, cwd);
      },
    };
    const d = developer(w, "ana", fake);
    const id = d.add("Prefer named exports.");
    const run = (...argv: string[]) => {
      let stdout = "";
      let stderr = "";
      const code = runMemory(argv, d.dir, { stdout: (t) => (stdout += t), stderr: (l) => (stderr += `${l}\n`) }, { env: { WACHIMAN_HOME: d.home }, now: () => new Date("2026-11-18T10:00:00Z"), deps: { pulls: flaky, teamMemory: () => true } });
      return { code, stdout, stderr };
    };
    const first = run("propose", id);
    expect(first.code).toBe(1);
    expect(first.stdout).toMatch(/^recorded: entry [0-9a-f]{7} on wachiman\/memory \([0-9a-f]{7}\)\.\n$/);
    expect(first.stderr).toContain("the draft pull request could not be opened (gh: not logged in)");
    expect(remoteLog(w.bare)).toHaveLength(2);
    expect(fake.created).toHaveLength(0);
    expect(d.run("candidates").stdout).toContain("proposed 2026-11-18");
    const second = run("propose", id);
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(/^already recorded: .*nothing was written\. Draft pull request: https:\/\/example\.test\/pr\/1\n$/);
    expect(remoteLog(w.bare)).toHaveLength(2);
    expect(fake.created).toHaveLength(1);
  }, 60_000);
});

describe("two approvals racing to open the draft pull request", () => {
  test("a job whose create fails because another job opened the pull request meanwhile reports that one, and records no failure", () => {
    const w = world();
    const fake = fakePulls();
    const racing: PullRequests = {
      list: fake.pulls.list,
      createDraft: (input, cwd) => {
        // The other job's create lands first; GitHub then refuses this one.
        fake.pulls.createDraft(input, cwd);
        throw new Error("a pull request for branch wachiman/memory into branch main already exists");
      },
    };
    const d = developer(w, "ana", fake);
    const id = d.add("Prefer named exports.");
    let stdout = "";
    const code = runMemory(["propose", id], d.dir, { stdout: (t) => (stdout += t), stderr: () => {} }, { env: { WACHIMAN_HOME: d.home }, now: () => new Date("2026-11-18T10:00:00Z"), deps: { pulls: racing, teamMemory: () => true } });
    expect(code).toBe(0);
    expect(stdout).toContain("Draft pull request: https://example.test/pr/1");
    expect(fake.created).toHaveLength(1);
  }, 60_000);
});

describe("reading the memory folder", () => {
  test("only a missing folder is empty; any other failure to read it is reported", () => {
    const dir = temp("wachiman-readmem-");
    expect(readMemoryFiles(dir)).toEqual({});
    mkdirSync(join(dir, ".wachiman", "memory"), { recursive: true });
    writeFileSync(join(dir, ".wachiman", "memory", "index.md"), "# m\n");
    expect(readMemoryFiles(dir)).toEqual({ "index.md": "# m\n" });
    // Root reads through a mode 000 folder, so that check only runs for other users.
    if (process.getuid?.() !== 0) {
      chmodSync(join(dir, ".wachiman"), 0o000);
      try {
        expect(() => readMemoryFiles(dir)).toThrow("cannot read .wachiman/memory");
      } finally {
        chmodSync(join(dir, ".wachiman"), 0o755);
      }
    }
  });

  test("a memory folder that is a plain file is refused whoever runs it", () => {
    const dir = temp("wachiman-readmem-file-");
    mkdirSync(join(dir, ".wachiman"));
    writeFileSync(join(dir, ".wachiman", "memory"), "not a folder");
    expect(() => readMemoryFiles(dir)).toThrow("is not a plain directory");
  });
});

describe("the write rules", () => {
  test("only files directly under .wachiman/memory/ may be written", () => {
    expect(() => assertMemoryPaths([".wachiman/memory/index.md", ".wachiman/memory/apps-desktop.md"])).not.toThrow();
    for (const bad of ["src/a.ts", ".wachiman/other.md", ".wachiman/memory/sub/x.md", ".wachiman/memory/../x.md", ".github/workflows/ci.yml", "wachiman/memory/index.md"]) {
      expect(() => assertMemoryPaths([bad])).toThrow("only files under");
    }
  });

  test("a new entry is appended to index.md as the shown text; an existing id only gains the evidence it lacks, in any file", () => {
    const c = newCandidate({ kind: "convention", scope: "src/**", rule: "Prefer named exports.", why: "Renames show up." }, { date: "2026-11-18", source: "instruction", pr: 1, agent: false }, "2026-11-18");
    const created = applyCandidate({}, c);
    expect(created).toMatchObject({ outcome: "inserted", file: "index.md" });
    expect(created.files["index.md"].startsWith("# Wachiman memory\n\n### ")).toBe(true);
    const withTable = "# Memory\n\n| Glob | File |\n| --- | --- |\n| `src/**` | `src.md` |\n";
    const appended = applyCandidate({ "index.md": withTable }, c).files["index.md"];
    expect(appended).toBe(`${withTable}\n${renderEntry(c)}`);
    // The same id in an area file: evidence is appended there, and the rest of the file is untouched.
    const other = { ...c, evidence: [{ date: "2026-11-19", source: "instruction" as const, pr: 2, agent: true }] };
    const area = `${renderEntry(c)}\n### 1234567 Later entry\n\n- kind: convention\n`;
    const extended = applyCandidate({ "index.md": withTable, "src.md": area }, other);
    expect(extended).toMatchObject({ outcome: "evidence-added", file: "src.md" });
    expect(extended.files["src.md"]).toContain(`  - ${evidenceLine(c.evidence[0])}\n  - 2026-11-19 operator instruction, pull request 2, written by an agent\n- added: 2026-11-18\n`);
    expect(extended.files["src.md"].endsWith("### 1234567 Later entry\n\n- kind: convention\n")).toBe(true);
    expect(applyCandidate({ "src.md": area }, c).outcome).toBe("unchanged");
  });
});
