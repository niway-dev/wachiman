import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { commit, emptyRepo, git, removeTempRepos } from "../../test/support/temp-repo";
import { fakeUi } from "../../test/support/fake-ui";
import { listRefs, runLauncher } from "./launcher";
import { createPrompter } from "./prompt";

const home = mkdtempSync(join(tmpdir(), "wachiman-launcher-fancy-home-"));
afterAll(() => {
  removeTempRepos();
  rmSync(home, { recursive: true, force: true });
});

const env = { WACHIMAN_HOME: home, WACHIMAN_INTRO_DONE: "1" };

function twoBranchRepo() {
  const dir = emptyRepo();
  commit(dir, { "a.txt": "1\n" }, "first");
  git(dir, "branch", "-M", "main");
  git(dir, "branch", "feature");
  return dir;
}

async function launch(answers: (number | string | boolean | null)[], dir: string) {
  const ui = fakeUi(answers);
  const prompter = createPrompter({ input: new PassThrough(), output: new PassThrough() }, env, ui);
  const calls: string[][] = [];
  const code = await runLauncher({ env, version: "1.0.0", cwd: dir, prompter, dispatch: async (argv) => (calls.push(argv), 7) });
  return { ui, code, calls };
}

describe("listRefs", () => {
  test("the detected base first, then the other branches, without HEAD or the bare remote name", () => {
    const dir = twoBranchRepo();
    const refs = listRefs(dir, "main");
    expect(refs[0]).toBe("main");
    expect(refs).toContain("feature");
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.some((r) => r === "HEAD" || r.endsWith("/HEAD"))).toBe(false);
  });

  test("when git fails, the base alone, or nothing", () => {
    const failing = () => ({ status: 1, stdout: "", stderr: "boom" });
    expect(listRefs("/nowhere", "main", failing)).toEqual(["main"]);
    expect(listRefs("/nowhere", undefined, failing)).toEqual([]);
  });
});

describe("the launcher on a terminal session", () => {
  test("Review changes on a repository with branches: a filterable list, a boxed confirmation, an outro naming the command", async () => {
    const dir = twoBranchRepo();
    const r = await launch([0, 0, 0, true], dir); // review, this branch, first base in the list, confirm
    expect(r.code).toBe(7);
    expect(r.calls).toEqual([["local", "--base", "main"]]);
    const list = r.ui.of("autocomplete")[0];
    expect(list.options.map((o) => o.label)).toEqual(expect.arrayContaining(["main", "feature", "Another branch or commit…"]));
    expect(list.options.at(-1)!.label).toBe("Another branch or commit…");
    const note = r.ui.of("note")[0];
    expect(note.title).toBe("Ready to run");
    expect(note.message).toContain("wachiman local --base main");
    expect(note.message).toContain("counts against your subscription");
    expect(r.ui.of("outro")[0].message).toBe("Running wachiman local --base main");
  });

  test("the last entry of the list asks for any other branch or commit", async () => {
    const dir = twoBranchRepo();
    const first = await launch([0, 0, 0, true], dir);
    const last = first.ui.of("autocomplete")[0].options.length - 1;
    const r = await launch([0, 0, last, "feature", true], dir);
    expect(r.calls).toEqual([["local", "--base", "feature"]]);
  });

  test("a repository with a single branch asks for the base as text, with the detected one as default", async () => {
    const dir = emptyRepo();
    commit(dir, { "a.txt": "1\n" }, "first");
    git(dir, "branch", "-M", "main");
    const r = await launch([0, 0, "", true], dir);
    expect(r.ui.of("autocomplete")).toHaveLength(0);
    expect(r.ui.of("text")[0].defaultValue).toBe("main");
    expect(r.calls).toEqual([["local", "--base", "main"]]);
  });

  test("declining the confirmation runs nothing and returns to the menu", async () => {
    const dir = twoBranchRepo();
    const r = await launch([0, 0, 0, false, 5], dir); // ..., decline, then Exit
    expect(r.calls).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.ui.of("select")).toHaveLength(3);
  });

  test("cancelling anywhere ends with the cancel line and runs nothing", async () => {
    const dir = twoBranchRepo();
    const r = await launch([null], dir);
    expect(r.code).toBe(130);
    expect(r.calls).toEqual([]);
    expect(r.ui.of("cancel")[0].message).toBe("Cancelled. Nothing was run.");
    expect(r.ui.of("outro")).toHaveLength(0);
  });

  test("init and setup keep the frame open: the launcher prints no outro and leaves it to their own", async () => {
    const dir = twoBranchRepo();
    const configure = 4; // Configure
    const r = await launch([configure, 1], dir); // Write the GitHub workflow
    expect(r.calls).toEqual([["init"]]);
    expect(r.ui.of("outro")).toHaveLength(0);
    expect(r.ui.of("cancel")).toHaveLength(0);
  });

  test("outside a git repository the review entries explain it and come back to the menu", async () => {
    const outside = mkdtempSync(join(tmpdir(), "wachiman-no-repo-"));
    try {
      const r = await launch([0, 5], outside);
      expect(r.calls).toEqual([]);
      expect(r.ui.of("log").some((e) => e.level === "error" && e.message.includes("This needs a git repository"))).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
