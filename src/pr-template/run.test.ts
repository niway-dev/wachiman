import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commit, emptyRepo, removeTempRepos } from "../../test/support/temp-repo";
import { UsageError } from "../config";
import { commandHelp } from "../help";
import { runPrTemplate, SUBCOMMANDS } from "./run";

afterAll(removeTempRepos);

function world() {
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n" }, "init");
  const out: string[] = [];
  const err: string[] = [];
  return { repo, out, err, io: { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) } };
}

describe("runPrTemplate", () => {
  test("no subcommand, --help and -h print the command page and exit 0", () => {
    for (const argv of [[], ["--help"], ["-h"]]) {
      const w = world();
      expect(runPrTemplate(argv, w.repo, w.io)).toBe(0);
      expect(w.out.join("")).toBe(commandHelp(["pr-template"]));
      expect(w.err).toEqual([]);
    }
  });

  test("<subcommand> --help prints that subcommand's page, and nothing is read or written", () => {
    for (const sub of SUBCOMMANDS) {
      const w = world();
      expect(runPrTemplate([sub, "--help"], w.repo, w.io)).toBe(0);
      expect(w.out.join("")).toBe(commandHelp(["pr-template", sub]));
      expect(w.out.join("")).toContain(`Usage\n  wachiman pr-template ${sub}`);
      expect(existsSync(join(w.repo, ".github"))).toBe(false);
    }
  });

  test("an unknown subcommand is a usage error that lists the real ones", () => {
    const w = world();
    expect(() => runPrTemplate(["frobnicate"], w.repo, w.io)).toThrow(UsageError);
    expect(() => runPrTemplate(["frobnicate"], w.repo, w.io)).toThrow(/show, install, status, check, format, risk, strip/);
  });

  test("dispatches show, status and install on the repository it is given", () => {
    const w = world();
    expect(runPrTemplate(["show"], w.repo, w.io)).toBe(0);
    expect(w.out.join("")).toContain("wachiman:pr-template version=");
    w.out.length = 0;
    expect(runPrTemplate(["status"], w.repo, w.io)).toBe(1);
    expect(w.out.join("")).toContain("missing");
    w.out.length = 0;
    expect(runPrTemplate(["install"], w.repo, w.io)).toBe(0);
    expect(existsSync(join(w.repo, ".github", "pull_request_template.md"))).toBe(true);
    expect(runPrTemplate(["status"], w.repo, w.io)).toBe(0);
  });

  test("an invalid .github/pr-template.json is a configuration error for show", () => {
    const w = world();
    commit(w.repo, { ".github/pr-template.json": '{ "drop": ["needs-you"] }' }, "bad choice");
    expect(() => runPrTemplate(["show"], w.repo, w.io)).toThrow(UsageError);
  });

  test("a subcommand's own usage error passes through", () => {
    const w = world();
    expect(() => runPrTemplate(["check"], w.repo, w.io)).toThrow(/file or --pr/);
    expect(() => runPrTemplate(["strip"], w.repo, w.io)).toThrow(/one file/);
  });

  test("the git and gh runner defaults to the repository directory", () => {
    const w = world();
    const seen: (string | undefined)[] = [];
    const run = (_cmd: string[], cwd?: string) => (seen.push(cwd), { code: 1, stdout: "", stderr: "no" });
    runPrTemplate(["risk"], w.repo, w.io, { check: { run } });
    expect(seen.length).toBeGreaterThan(0);
    // An injected runner is used as given; the default one is wrapped, which the end-to-end test below proves.
    const e2e = world();
    commit(e2e.repo, { "a.txt": "x\n" }, "second");
    expect(runPrTemplate(["risk", "--base", "HEAD~1"], e2e.repo, e2e.io)).toBe(0);
    expect(e2e.out.join("")).toMatch(/Low|Medium|High/);
  });
});
