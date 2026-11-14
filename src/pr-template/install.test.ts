import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { snapshotTree } from "../../test/support/tree-snapshot";
import { UsageError } from "../config";
import { PrTemplateConfigError, loadCatalog, loadRepoChoice } from "./catalog";
import { installUsage, parseInstallArgs, parseShowArgs, parseStatusArgs, runInstall, runShow, runStatus, showUsage, statusUsage, type GitRunner } from "./install";
import { renderTemplate } from "./render";
import { resolveTemplate } from "./resolve";

const scratch: string[] = [];
afterAll(() => {
  scratch.forEach((d) => rmSync(d, { recursive: true, force: true }));
  removeTempRepos();
});

const NOW = "2026-11-14T10:00:00.000Z";
const STAMP = "20261114-100000";
const catalog = loadCatalog();
const MARKER = ["BREAKING", "CHANGE"].join(" ");
const fixture = (name: string) => join(import.meta.dir, "fixtures", "adopt", name);
const defaultTemplate = renderTemplate(resolveTemplate(catalog, null), catalog.version);

function world() {
  const repo = emptyRepo();
  git(repo, "config", "user.name", "Tester");
  git(repo, "config", "user.email", "tester@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "hello\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const out: string[] = [];
  const err: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "wachiman-from-"));
  scratch.push(dir);
  return {
    repo,
    out,
    err,
    io: { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) },
    deps: (extra = {}) => ({ now: () => NOW, cwd: dir, ...extra }),
    path: (rel: string) => join(repo, rel),
    read: (rel: string) => readFileSync(join(repo, rel), "utf8"),
    put: (rel: string, text: string) => {
      mkdirSync(join(repo, rel, ".."), { recursive: true });
      writeFileSync(join(repo, rel), text);
    },
    scratchFile: (name: string, text: string) => {
      const file = join(dir, name);
      writeFileSync(file, text);
      return file;
    },
    ls: (rel = ".github") => readdirSync(join(repo, rel)).sort(),
  };
}
type World = ReturnType<typeof world>;

const install = (w: World, argv: string[] = [], extra = {}) => {
  const opts = parseInstallArgs(argv);
  if (opts.help) throw new Error("unexpected help");
  return runInstall(opts, w.repo, w.io, w.deps(extra));
};
const status = (w: World, argv: string[] = []) => {
  const opts = parseStatusArgs(argv);
  if (opts.help) throw new Error("unexpected help");
  return runStatus(opts, w.repo, w.io, w.deps());
};
const show = (w: World, argv: string[] = []) => {
  const opts = parseShowArgs(argv);
  if (opts.help) throw new Error("unexpected help");
  return runShow(opts, w.repo, w.io, w.deps());
};
const refused = (run: () => unknown, type: new (...a: never[]) => Error = UsageError as never) => {
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(type);
  return (error as Error).message;
};
const commits = (w: World) => git(w.repo, "log", "--format=%s").trim().split("\n");
const TEMPLATE = ".github/pull_request_template.md";
const CHOICE = ".github/pr-template.json";
const stampLine = (text: string) => text.split("\n")[0]!;

describe("arguments", () => {
  test("flags of each command", () => {
    expect(parseShowArgs([])).toEqual({});
    expect(parseShowArgs(["--from", "a.json"])).toEqual({ from: "a.json" });
    expect(parseInstallArgs([])).toEqual({ force: false, commit: false });
    expect(parseInstallArgs(["--from=a.json", "--force", "--commit"])).toEqual({ from: "a.json", force: true, commit: true });
    expect(parseStatusArgs(["--json"])).toEqual({ json: true });
    expect(parseStatusArgs([])).toEqual({ json: false });
  });
  test("help, in either spelling, for each command", () => {
    for (const parse of [parseShowArgs, parseInstallArgs, parseStatusArgs]) {
      expect(parse(["--help"])).toEqual({ help: true });
      expect(parse(["-h"])).toEqual({ help: true });
    }
    expect([showUsage, installUsage, statusUsage].every((u) => u.startsWith("wachiman pr-template "))).toBe(true);
  });
  test("a bad flag or an argument is a usage error", () => {
    expect(() => parseInstallArgs(["--nope"])).toThrow(UsageError);
    expect(() => parseInstallArgs(["--from"])).toThrow(UsageError);
    expect(() => parseInstallArgs(["file"])).toThrow(UsageError);
    expect(() => parseShowArgs(["--force"])).toThrow(UsageError);
    expect(() => parseStatusArgs(["--commit"])).toThrow(UsageError);
    expect(() => parseStatusArgs(["--json=1"])).toThrow(UsageError);
  });
});

describe("show", () => {
  test("prints the default template when the repository has no definition", () => {
    const w = world();
    expect(show(w)).toBe(0);
    expect(w.out.join("")).toBe(defaultTemplate);
  });

  test("prints the repository's template when .github/pr-template.json exists", () => {
    const w = world();
    w.put(CHOICE, JSON.stringify({ preamble: ["- [ ] Read CLA.md"], drop: ["decisions"] }));
    show(w);
    expect(w.out.join("")).toContain("- [ ] Read CLA.md");
    expect(w.out.join("")).not.toContain("## Decisions");
  });

  test("--from previews a definition and writes nothing", () => {
    const w = world();
    const from = w.scratchFile("choice.json", JSON.stringify({ preamble: ["- [ ] Preview line"] }));
    const before = snapshotTree(w.repo);
    expect(show(w, ["--from", from])).toBe(0);
    expect(w.out.join("")).toContain("- [ ] Preview line");
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(existsSync(w.path(".github"))).toBe(false);
  });

  test("an invalid definition is a configuration error, with no fallback to the default", () => {
    const w = world();
    w.put(CHOICE, "{ not json");
    expect(refused(() => show(w), PrTemplateConfigError)).toContain(".github/pr-template.json is not valid JSON");
    expect(w.out).toEqual([]);
  });
});

describe("install: missing, current, outdated", () => {
  test("a missing template is written, with no backup, and status says current", () => {
    const w = world();
    expect(install(w)).toBe(0);
    expect(w.read(TEMPLATE)).toBe(defaultTemplate);
    expect(w.ls()).toEqual(["pull_request_template.md"]);
    expect(status(w)).toBe(0);
    expect(w.out.join("")).toContain("current:");
  });

  test("a current template needs nothing and nothing changes", () => {
    const w = world();
    install(w);
    const before = snapshotTree(w.repo);
    w.err.length = 0;
    expect(install(w)).toBe(0);
    expect(w.err.join("\n")).toContain("already current; nothing to do");
    expect(snapshotTree(w.repo)).toEqual(before);
  });

  test("an outdated template is rewritten without a backup", () => {
    const w = world();
    install(w);
    w.put(CHOICE, JSON.stringify({ preamble: ["- [ ] Read CLA.md"] }));
    expect(status(w)).toBe(1);
    expect(w.out.join("")).toContain("outdated:");
    expect(install(w)).toBe(0);
    expect(w.read(TEMPLATE)).toContain("- [ ] Read CLA.md");
    expect(w.ls()).toEqual(["pr-template.json", "pull_request_template.md"]);
    expect(w.out.length).toBeGreaterThan(0);
    w.out.length = 0;
    expect(status(w)).toBe(0);
  });

  test("a template from an older catalog version is outdated and is rewritten without a backup", () => {
    const w = world();
    const old = defaultTemplate.replace("version=1 ", "version=0 ");
    w.put(TEMPLATE, old);
    // The stamp line changed, the body did not: the hash still matches, the file differs from what is generated.
    expect(status(w)).toBe(1);
    expect(w.out.join("")).toContain("outdated:");
    install(w);
    expect(w.read(TEMPLATE)).toBe(defaultTemplate);
    expect(w.ls()).toEqual(["pull_request_template.md"]);
  });
});

describe("install: edited by hand", () => {
  const edit = (w: World) => w.put(TEMPLATE, `${w.read(TEMPLATE)}\nAn extra line by hand.\n`);

  test("is refused without --force and left as it was", () => {
    const w = world();
    install(w);
    edit(w);
    const before = snapshotTree(w.repo);
    expect(refused(() => install(w))).toContain("edited by hand");
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(status(w)).toBe(1);
    expect(w.out.join("")).toContain("edited by hand:");
  });

  test("--force replaces it and keeps the edited file as a .bak-<stamp> copy; a second one gets -2", () => {
    const w = world();
    install(w);
    edit(w);
    const edited = w.read(TEMPLATE);
    expect(install(w, ["--force"])).toBe(0);
    expect(w.read(TEMPLATE)).toBe(defaultTemplate);
    expect(w.read(`${TEMPLATE}.bak-${STAMP}`)).toBe(edited);
    edit(w);
    const second = w.read(TEMPLATE);
    install(w, ["--force"]);
    expect(w.read(`${TEMPLATE}.bak-${STAMP}-2`)).toBe(second);
    expect(w.ls()).toEqual(["pull_request_template.md", `pull_request_template.md.bak-${STAMP}`, `pull_request_template.md.bak-${STAMP}-2`]);
  });

  test("--force on a current template does nothing", () => {
    const w = world();
    install(w);
    install(w, ["--force"]);
    expect(w.ls()).toEqual(["pull_request_template.md"]);
  });
});

describe("install: adopting an unmanaged template", () => {
  test("the version-0 copy: both checkboxes in the preamble, a backup, idempotent afterwards", () => {
    const w = world();
    const old = readFileSync(fixture("version-0.md"), "utf8");
    w.put(TEMPLATE, old);
    expect(status(w)).toBe(1);
    expect(w.out.join("")).toContain("unmanaged:");
    w.err.length = 0;
    expect(install(w)).toBe(0);
    const choice = JSON.parse(w.read(CHOICE));
    expect(choice.preamble).toHaveLength(2);
    expect(choice.preamble.join("\n")).toContain("I said whether an AI tool wrote part of this change");
    expect(choice.preamble.join("\n")).toContain("**Outside contributors only:**");
    expect(choice.custom).toBeUndefined();
    const out = w.read(TEMPLATE);
    expect(out).not.toMatch(/<model>|<sha>/);
    expect(out).not.toContain("pr_body.py");
    expect(out).toContain("<sub>Describes commit {sha}.</sub>");
    expect(w.read(`${TEMPLATE}.bak-${STAMP}`)).toBe(old);
    const log = w.err.join("\n");
    expect(log).toContain("adopting the unmanaged");
    expect(log).toContain("moved to preamble: - [ ] I said whether");
    expect(log).toContain("treated as a guide comment and replaced");
    expect(log).toContain("wrote .github/pr-template.json");
    // Idempotent: current now, a second install changes nothing and makes no new backup.
    w.out.length = 0;
    expect(status(w)).toBe(0);
    const before = snapshotTree(w.repo);
    install(w);
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(w.ls()).toEqual(["pr-template.json", "pull_request_template.md", `pull_request_template.md.bak-${STAMP}`]);
  });

  test("the team template: the reminder is in the preamble, the section and the row are custom entries", () => {
    const w = world();
    w.put(TEMPLATE, readFileSync(fixture("team-template.md"), "utf8"));
    install(w);
    const choice = JSON.parse(w.read(CHOICE));
    expect(choice.preamble[0]).toContain("outside contributors sign the contributor agreement");
    expect(choice.custom.map((c: { id: string; after: string }) => [c.id, c.after])).toEqual([["ticket", "type"], ["migration-notes", "why"]]);
    expect(() => loadRepoChoice(w.read(CHOICE), catalog)).not.toThrow();
    const out = w.read(TEMPLATE);
    const headings = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings.indexOf("Migration notes")).toBe(headings.indexOf("Why") + 1);
    expect(headings.indexOf("Migration notes")).toBeLessThan(headings.indexOf("Evidence"));
    expect(out).toContain("| **Ticket** |");
    w.out.length = 0;
    expect(status(w)).toBe(0);
  });

  test("an old file with an existing pr-template.json is refused; --force backs both up and merges", () => {
    const w = world();
    w.put(TEMPLATE, "- [ ] An old repository line\n\n## Notes from the team\n");
    const json = JSON.stringify({ preamble: ["- [ ] Already here"] }, null, 2);
    w.put(CHOICE, json);
    const before = snapshotTree(w.repo);
    expect(refused(() => install(w))).toContain("already exists");
    expect(snapshotTree(w.repo)).toEqual(before);
    install(w, ["--force"]);
    const choice = JSON.parse(w.read(CHOICE));
    expect(choice.preamble).toEqual(["- [ ] Already here", "", "- [ ] An old repository line"]);
    expect(choice.custom.map((c: { id: string }) => c.id)).toEqual(["notes-from-the-team"]);
    expect(w.read(`${CHOICE}.bak-${STAMP}`)).toBe(json);
    expect(w.read(`${TEMPLATE}.bak-${STAMP}`)).toBe("- [ ] An old repository line\n\n## Notes from the team\n");
  });

  test("an unmanaged file that adds nothing writes no pr-template.json", () => {
    const w = world();
    w.put(TEMPLATE, "## What\n\n## Why\n");
    install(w);
    expect(existsSync(w.path(CHOICE))).toBe(false);
    expect(w.read(TEMPLATE)).toBe(defaultTemplate);
    expect(w.ls()).toEqual(["pull_request_template.md", `pull_request_template.md.bak-${STAMP}`]);
  });

  test("an old file that holds the breaking-change marker is refused and nothing is written", () => {
    const w = world();
    w.put(TEMPLATE, `- [ ] Remember: ${MARKER}: describe it here\n`);
    const before = snapshotTree(w.repo);
    expect(refused(() => install(w), PrTemplateConfigError)).toContain("breaking-change marker");
    expect(snapshotTree(w.repo)).toEqual(before);
  });
});

describe("install: invalid definitions and the breaking-change marker", () => {
  test("invalid JSON: install throws a configuration error and writes nothing; status says invalid and exits 1", () => {
    const w = world();
    w.put(CHOICE, '{ "drop": ["risk"] }');
    const before = snapshotTree(w.repo);
    expect(refused(() => install(w), PrTemplateConfigError)).toContain('"risk" is locked');
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(status(w)).toBe(1);
    expect(w.out.join("")).toContain("invalid:");
    w.out.length = 0;
    expect(status(w, ["--json"])).toBe(1);
    expect(JSON.parse(w.out.join(""))).toEqual({ state: "invalid", version: 1, installedVersion: null });
  });

  test("a preamble line with the marker is refused with exit 2 and nothing is written", () => {
    const w = world();
    w.put(CHOICE, JSON.stringify({ preamble: [`- ${MARKER}: removes the flag`] }));
    const before = snapshotTree(w.repo);
    expect(refused(() => install(w), PrTemplateConfigError)).toContain("breaking-change marker");
    expect(snapshotTree(w.repo)).toEqual(before);
    expect(existsSync(w.path(TEMPLATE))).toBe(false);
  });
});

describe("status", () => {
  test("missing exits 1 with the next step; --json carries the three fields", () => {
    const w = world();
    expect(status(w)).toBe(1);
    expect(w.out.join("")).toMatch(/^missing:.*\nNext: run `wachiman pr-template install`/);
    w.out.length = 0;
    status(w, ["--json"]);
    expect(JSON.parse(w.out.join(""))).toEqual({ state: "missing", version: 1, installedVersion: null });
  });

  test("the json state is in kebab form and carries the installed version", () => {
    const w = world();
    install(w);
    w.put(TEMPLATE, `${w.read(TEMPLATE)}x\n`);
    w.out.length = 0;
    expect(status(w, ["--json"])).toBe(1);
    expect(JSON.parse(w.out.join(""))).toEqual({ state: "edited-by-hand", version: 1, installedVersion: 1 });
  });

  test("unmanaged", () => {
    const w = world();
    w.put(TEMPLATE, "plain\n");
    status(w, ["--json"]);
    expect(JSON.parse(w.out.join("")).state).toBe("unmanaged");
  });

  test("a custom template is not outdated for being custom", () => {
    const w = world();
    w.put(CHOICE, JSON.stringify({ drop: ["decisions"], preamble: ["- [ ] Read CLA.md"] }));
    install(w);
    w.out.length = 0;
    expect(status(w)).toBe(0);
  });
});

describe("install --from", () => {
  const choiceJson = JSON.stringify({ preamble: ["- [ ] From the file"] });

  test("copies the JSON into .github/pr-template.json before generating", () => {
    const w = world();
    const from = w.scratchFile("c.json", choiceJson);
    expect(install(w, ["--from", from])).toBe(0);
    expect(w.read(CHOICE)).toBe(choiceJson);
    expect(w.read(TEMPLATE)).toContain("- [ ] From the file");
    expect(w.ls()).toEqual(["pr-template.json", "pull_request_template.md"]);
  });

  test("a relative path is resolved from the working directory", () => {
    const w = world();
    w.scratchFile("rel.json", choiceJson);
    install(w, ["--from", "rel.json"]);
    expect(w.read(CHOICE)).toBe(choiceJson);
  });

  test("an invalid definition is refused and nothing is written", () => {
    const w = world();
    const from = w.scratchFile("c.json", '{ "add": ["nope"] }');
    const before = snapshotTree(w.repo);
    refused(() => install(w, ["--from", from]), PrTemplateConfigError);
    expect(snapshotTree(w.repo)).toEqual(before);
  });

  test("over a different existing JSON it is refused; --force backs the old one up", () => {
    const w = world();
    const old = JSON.stringify({ preamble: ["- [ ] Older"] });
    w.put(CHOICE, old);
    const from = w.scratchFile("c.json", choiceJson);
    const before = snapshotTree(w.repo);
    expect(refused(() => install(w, ["--from", from]))).toContain("already exists and differs");
    expect(snapshotTree(w.repo)).toEqual(before);
    install(w, ["--from", from, "--force"]);
    expect(w.read(CHOICE)).toBe(choiceJson);
    expect(w.read(`${CHOICE}.bak-${STAMP}`)).toBe(old);
  });

  test("over the same JSON, whatever its spacing, it is not refused and not rewritten", () => {
    const w = world();
    w.put(CHOICE, JSON.stringify({ preamble: ["- [ ] From the file"] }, null, 4));
    const from = w.scratchFile("c.json", choiceJson);
    expect(install(w, ["--from", from])).toBe(0);
    expect(w.ls()).toEqual(["pr-template.json", "pull_request_template.md"]);
    expect(w.read(CHOICE)).toContain("    ");
  });
});

describe("links are refused", () => {
  test("a .github that is a symbolic link is refused and its destination is untouched", () => {
    const w = world();
    const outside = mkdtempSync(join(tmpdir(), "wachiman-outside-"));
    scratch.push(outside);
    symlinkSync(outside, w.path(".github"));
    expect(refused(() => install(w))).toContain("symbolic link");
    expect(readdirSync(outside)).toEqual([]);
    expect(refused(() => status(w))).toContain("symbolic link");
    expect(refused(() => show(w))).toContain("symbolic link");
  });

  test("a target that is a symbolic link is refused", () => {
    const w = world();
    w.put("other.md", "elsewhere\n");
    mkdirSync(w.path(".github"));
    symlinkSync(w.path("other.md"), w.path(TEMPLATE));
    expect(refused(() => install(w, ["--force"]))).toContain("symbolic link");
    expect(w.read("other.md")).toBe("elsewhere\n");
  });
});

describe("--commit", () => {
  test("without the flag nothing is committed", () => {
    const w = world();
    install(w);
    expect(commits(w)).toEqual(["init"]);
    expect(git(w.repo, "status", "--short")).toContain("?? .github/");
  });

  test("one commit holds only the template, with the install message, and its hash is printed", () => {
    const w = world();
    expect(install(w, ["--commit"])).toBe(0);
    expect(commits(w)).toEqual(["docs: install the Wachiman PR description template", "init"]);
    expect(git(w.repo, "show", "--name-only", "--format=").trim()).toBe(".github/pull_request_template.md");
    expect(w.out.join("").trim()).toBe(git(w.repo, "rev-parse", "HEAD").trim());
    expect(git(w.repo, "status", "--short")).toBe("");
  });

  test("another file that is already staged is not swept in", () => {
    const w = world();
    w.put("notes.txt", "staged for another reason\n");
    git(w.repo, "add", "notes.txt");
    install(w, ["--commit"]);
    expect(git(w.repo, "show", "--name-only", "--format=").trim()).toBe(".github/pull_request_template.md");
    expect(git(w.repo, "diff", "--cached", "--name-only").trim()).toBe("notes.txt");
  });

  test("the JSON is committed with the template when it was written, backups never", () => {
    const w = world();
    w.put(TEMPLATE, "- [ ] Mine\n");
    git(w.repo, "add", "-A");
    git(w.repo, "commit", "-q", "-m", "old template");
    install(w, ["--commit"]);
    expect(commits(w)[0]).toBe("docs: install the Wachiman PR description template");
    expect(git(w.repo, "show", "--name-only", "--format=").trim().split("\n").sort()).toEqual([".github/pr-template.json", ".github/pull_request_template.md"]);
    expect(w.ls()).toContain(`pull_request_template.md.bak-${STAMP}`);
    expect(git(w.repo, "status", "--short").trim()).toBe(`?? .github/pull_request_template.md.bak-${STAMP}`);
  });

  test("when a stamped template already existed the message names the version", () => {
    const w = world();
    install(w, ["--commit"]);
    w.put(CHOICE, JSON.stringify({ preamble: ["- [ ] Read CLA.md"] }));
    install(w, ["--commit"]);
    expect(commits(w)[0]).toBe("docs: update the PR description template to version 1");
    // The JSON was put there by hand, not written by install, so it is not part of the commit.
    expect(git(w.repo, "show", "--name-only", "--format=").trim()).toBe(".github/pull_request_template.md");
  });

  test("when install writes the JSON as well as an update, both are in the commit", () => {
    const w = world();
    install(w, ["--commit"]);
    const from = w.scratchFile("c.json", JSON.stringify({ preamble: ["- [ ] Read CLA.md"] }));
    install(w, ["--from", from, "--commit"]);
    expect(commits(w)[0]).toBe("docs: update the PR description template to version 1");
    expect(git(w.repo, "show", "--name-only", "--format=").trim().split("\n").sort()).toEqual([".github/pr-template.json", ".github/pull_request_template.md"]);
  });

  test("a failure while writing the temporary file leaves no temporary file behind", () => {
    const w = world();
    const writeTemp = (path: string) => {
      writeFileSync(path, "partial");
      throw new Error("no space left on device");
    };
    expect(() => install(w, [], { hooks: { writeTemp } })).toThrow("no space left on device");
    expect(readdirSync(join(w.repo, ".github")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("when nothing was written there is nothing to commit", () => {
    const w = world();
    install(w, ["--commit"]);
    w.err.length = 0;
    expect(install(w, ["--commit"])).toBe(0);
    expect(commits(w)).toEqual(["docs: install the Wachiman PR description template", "init"]);
    expect(w.err.join("\n")).toContain("nothing to commit");
  });

  test("git is called with argument lists, never pushes and never skips hooks", () => {
    const w = world();
    const calls: string[][] = [];
    const fake: GitRunner = (args) => {
      calls.push(args);
      return { status: 0, stdout: "abc123\n", stderr: "" };
    };
    install(w, ["--commit"], { git: fake });
    expect(calls.map((c) => c[0])).toEqual(["add", "commit", "rev-parse"]);
    const flat = calls.flat();
    expect(flat).not.toContain("--no-verify");
    expect(flat).not.toContain("-n");
    expect(flat).not.toContain("push");
    expect(calls[1]![calls[1]!.indexOf("--") - 1]).toBe("docs: install the Wachiman PR description template");
    expect(w.out.join("").trim()).toBe("abc123");
  });

  test("when git fails it is reported, the exit code is 1 and the files stay written", () => {
    const w = world();
    const fake: GitRunner = (args) => (args[0] === "commit" ? { status: 1, stdout: "", stderr: "hook said no" } : { status: 0, stdout: "", stderr: "" });
    expect(install(w, ["--commit"], { git: fake })).toBe(1);
    expect(w.read(TEMPLATE)).toBe(defaultTemplate);
    expect(w.err.join("\n")).toContain("git commit failed");
    expect(w.err.join("\n")).toContain("hook said no");
    expect(w.out).toEqual([]);
  });

  test("outside a git repository --commit reports it and the files stay", () => {
    const w = world();
    rmSync(w.path(".git"), { recursive: true });
    expect(install(w, ["--commit"])).toBe(1);
    expect(existsSync(w.path(TEMPLATE))).toBe(true);
    expect(stampLine(w.read(TEMPLATE))).toContain("wachiman:pr-template");
  });
});
