import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { fakeUi } from "../../test/support/fake-ui";
import { createPrompter, openPrompter } from "./prompt";

const choices = [
  { label: "alpha", value: "a", description: "first" },
  { label: "beta", value: "b" },
  { label: "gamma", value: "c" },
];
const streams = () => ({ input: new PassThrough(), output: new PassThrough() });

describe("the terminal session on a scripted Ui", () => {
  test("select, autocomplete, text and confirm map answers back to the caller's values and defaults", async () => {
    const ui = fakeUi([2, 1, "", " typed ", true]);
    const p = createPrompter(streams(), {}, ui);
    expect(p.fancy).toBe(true);
    expect(await p.select("Pick", choices, 0)).toBe("c");
    expect(await p.autocomplete("Pick another", choices, 1)).toBe("b");
    expect(await p.text("Base", "origin/main")).toBe("origin/main");
    expect(await p.text("Name", undefined)).toBe("typed");
    expect(await p.confirm("Go?", false)).toBe(true);
    expect(ui.of("select")[0]).toMatchObject({ message: "Pick", initial: 0, options: [{ value: 0, label: "alpha", hint: "first" }, { value: 1, label: "beta" }, { value: 2, label: "gamma" }] });
    expect(ui.of("autocomplete")[0].initial).toBe(1);
    expect(ui.of("text")[0]).toMatchObject({ placeholder: "origin/main", defaultValue: "origin/main" });
    expect(ui.of("confirm")[0].initial).toBe(false);
  });

  test("a validation problem is shown and the question is asked again; the default is validated as typed", async () => {
    const ui = fakeUi(["", "good"]);
    const p = createPrompter(streams(), {}, ui);
    const answer = await p.text("Login", undefined, (v) => (v === "" ? "A login is required." : v === "good" ? undefined : "bad"));
    expect(answer).toBe("good");
    expect(ui.of("log")[0]).toMatchObject({ level: "error", message: "A login is required." });
    const withDefault = fakeUi([""]);
    expect(await createPrompter(streams(), {}, withDefault).text("Tag", "v1", (v) => (v === "v1" ? undefined : "no"))).toBe("v1");
  });

  test("one cancel ends the whole session: later questions return null without asking", async () => {
    const ui = fakeUi([null]);
    const p = createPrompter(streams(), {}, ui);
    expect(await p.select("Pick", choices, 0)).toBeNull();
    expect(await p.confirm("Go?", true)).toBeNull();
    expect(await p.text("Name", undefined)).toBeNull();
    expect(await p.autocomplete("Pick", choices, 0)).toBeNull();
    expect(ui.events.map((e) => e.kind)).toEqual(["select"]);
  });

  test("say keeps its tone: success, warning and error use the matching log, an empty line draws nothing", () => {
    const ui = fakeUi();
    const p = createPrompter(streams(), {}, ui);
    p.say("");
    p.say("fine", "success");
    p.say("careful", "warning");
    p.say("broken", "error");
    p.say("plain");
    p.step("Project", 1);
    p.step("Account", 3, 5);
    expect(ui.of("log").map((e) => [e.level, e.message])).toEqual([
      ["success", "fine"],
      ["warn", "careful"],
      ["error", "broken"],
      ["message", "plain"],
      ["step", "Project  step 1"],
      ["step", "Account  step 3 of 5"],
    ]);
  });

  test("status lines from the wizards are drawn inside the frame", () => {
    const ui = fakeUi();
    const p = createPrompter(streams(), {}, ui);
    p.report!("bound: x", "success");
    p.report!("cancelled: y", "warning");
    p.report!("hello", "info");
    expect(ui.of("log").map((e) => e.level)).toEqual(["success", "warn", "message"]);
  });

  test("a task runs its work behind a spinner and ends with a check, or with a warning when the result is bad", async () => {
    const ui = fakeUi();
    const p = createPrompter(streams(), {}, ui);
    expect(await p.task("Checking", async () => 1)).toBe(1);
    expect(await p.task("Probing", async () => "bad", (r) => r !== "bad")).toBe("bad");
    await expect(p.task("Crashing", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(ui.of("spinner").map((e) => [e.action, e.message])).toEqual([
      ["start", "Checking"],
      ["stop", "Checking"],
      ["start", "Probing"],
      ["fail", "Probing: needs attention"],
      ["start", "Crashing"],
      ["fail", "Crashing"],
    ]);
  });

  test("close prints the next steps as a note, then one outro; a second close prints nothing", () => {
    const ui = fakeUi();
    const p = createPrompter(streams(), {}, ui);
    p.nextStep("wachiman doctor");
    p.nextAction("Open a pull request.", ["git push"]);
    p.close("done");
    p.close("done");
    const note = ui.of("note")[0];
    expect(note.title).toBe("Next steps");
    expect(note.message).toContain("1. See which checks need attention");
    expect(note.message).toContain("wachiman doctor");
    expect(note.message).toContain("2. Open a pull request.");
    expect(ui.of("outro")).toHaveLength(1);
    expect(ui.of("cancel")).toHaveLength(0);
  });

  test("on Windows the PowerShell and Git Bash forms of one hint are one titled step", () => {
    const ui = fakeUi();
    const p = createPrompter(streams(), {}, ui);
    p.nextStep("PowerShell: wachiman setup");
    p.nextStep("Git Bash: wachiman setup");
    p.close("done");
    const message = ui.of("note")[0].message;
    expect(message).toContain("1. Bind this repository to a Claude account");
    expect(message).toContain("PowerShell: wachiman setup");
    expect(message).toContain("Git Bash: wachiman setup");
    expect(message).not.toContain("2.");
    expect(message).not.toContain("Run");
  });

  test("a cancelled or failed run ends with the cancel line, not the outro", () => {
    for (const [outcome, text] of [["cancelled", "Cancelled."], ["failed", "Stopped."]] as const) {
      const ui = fakeUi();
      createPrompter(streams(), {}, ui).close(outcome);
      expect(ui.of("cancel")[0].message).toBe(text);
      expect(ui.of("outro")).toHaveLength(0);
    }
    const custom = fakeUi();
    createPrompter(streams(), {}, custom).close("cancelled", "Cancelled. Nothing was run.");
    expect(custom.of("cancel")[0].message).toBe("Cancelled. Nothing was run.");
  });

  test("the intro is skipped when a caller already played it, and a first intro prints the chip and the scene", async () => {
    const skipped = fakeUi();
    await createPrompter(streams(), { WACHIMAN_INTRO_DONE: "1" }, skipped).intro("1.2.3");
    expect(skipped.events).toEqual([]);
    const ui = fakeUi();
    const term = streams();
    let drawn = "";
    term.output.on("data", (chunk) => (drawn += String(chunk)));
    await createPrompter(term, { NO_COLOR: "1" }, ui).intro("1.2.3");
    expect(ui.of("intro")[0].title).toBe("wachiman  On watch. v1.2.3");
    expect(drawn).toContain("Wachi: Shift started. Let's watch this repo.");
  });
});

describe("which session a command gets", () => {
  test("without a terminal, openPrompter is the plain session and loads nothing", async () => {
    const p = await openPrompter(streams(), {});
    expect(p.fancy).toBe(false);
  });

  test("a Ui given by the caller makes the session a terminal one, whatever the streams are", async () => {
    const p = await openPrompter(streams(), {}, { ui: fakeUi() });
    expect(p.fancy).toBe(true);
  });
});
