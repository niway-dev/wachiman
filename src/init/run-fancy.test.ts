import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fakeUi } from "../../test/support/fake-ui";
import { commit, emptyRepo, removeTempRepos } from "../../test/support/temp-repo";
import { createPrompter } from "../wizard/prompt";
import { parseInitFlags } from "./args";
import { runInitCommand } from "./run";

afterAll(removeTempRepos);

const NOW = "2026-11-09T12:00:00.000Z";

function world(answers: (number | string | boolean | null)[]) {
  const repo = emptyRepo();
  commit(repo, { "README.md": "hello\n" }, "init");
  const ui = fakeUi(answers);
  const prompter = createPrompter({ input: new PassThrough(), output: new PassThrough() }, { WACHIMAN_INTRO_DONE: "1" }, ui);
  const err: string[] = [];
  const out: string[] = [];
  const io = { stdout: (t: string) => void out.push(t), stderr: (l: string) => void err.push(l) };
  const run = () => runInitCommand(parseInitFlags(["--mode", "github", "--version", "v1.5.0"], repo), {}, io, { now: () => NOW, version: "1.9.0", defaultWorkflowRef: "v1.5.0", interactive: true, cwd: "/elsewhere", prompter });
  return { repo, ui, err, out, run, target: join(repo, ".github", "workflows", "wachiman-review.yml") };
}

describe("init on a terminal session", () => {
  test("asks through the Ui, shows the workflow as a titled note, and writes the file on confirm", async () => {
    const w = world([0, "octocat", true]); // kind (Monorepo), operator, Write it?
    expect(await w.run()).toBe(0);
    const note = w.ui.of("note")[0];
    expect(note.title).toBe(".github/workflows/wachiman-review.yml (new)");
    expect(note.message).toContain('operator: "octocat"');
    expect(w.ui.of("confirm")[0].message).toBe("Write it?");
    expect(readFileSync(w.target, "utf8")).toContain('operator: "octocat"');
    // The settings file is a second titled note, written under the same confirm.
    expect(w.ui.of("note")[1].title).toBe(".wachiman.yml (new)");
    expect(readFileSync(join(w.repo, ".wachiman.yml"), "utf8")).toContain("kind: monorepo\n");
    // The old `--- path` preview lines are for the plain session only.
    expect(w.err.join("\n")).not.toContain("--- .github/workflows");
  });

  test("declining writes nothing and says so inside the frame", async () => {
    const w = world([0, "octocat", false]);
    expect(await w.run()).toBe(0);
    expect(existsSync(w.target)).toBe(false);
    expect(w.ui.of("log").some((e) => e.message === "not written.")).toBe(true);
    // The session ends with what happened, not with "All set".
    expect(w.ui.of("outro").map((e) => e.message)).toEqual(["Nothing was written."]);
  });

  test("cancelling the confirmation exits 130 and writes nothing", async () => {
    const w = world([0, "octocat", null]);
    expect(await w.run()).toBe(130);
    expect(existsSync(w.target)).toBe(false);
    expect(existsSync(join(w.repo, ".wachiman.yml"))).toBe(false);
  });

  test("status lines go through the Ui, not loose to stderr", async () => {
    const w = world([0, "octocat", true]);
    await w.run();
    const drawn = w.ui.of("log").map((e) => e.message).join("\n");
    expect(drawn).toContain("wrote ");
    expect(w.err.join("\n")).not.toContain("wrote ");
  });

});
