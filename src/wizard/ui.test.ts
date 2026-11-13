import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { stripAnsi } from "./style";
import { loadUi } from "./ui";

const KINDS = ["message", "info", "success", "step", "warn", "error"] as const;

/** The real Clack adapter over in-memory streams; `keys` are what a person would press, one batch per question. */
async function session() {
  const input = new PassThrough();
  const output = new PassThrough();
  let drawn = "";
  output.on("data", (chunk) => (drawn += String(chunk)));
  const ui = await loadUi({ input, output });
  const press = async (keys: string) => {
    await new Promise((r) => setTimeout(r, 20));
    input.write(keys);
  };
  return { ui, press, screen: () => stripAnsi(drawn) };
}

describe("the Clack adapter", () => {
  test("every log kind the wrapper offers exists in Clack", async () => {
    const clack = await import("@clack/prompts");
    for (const kind of KINDS) expect(typeof clack.log[kind]).toBe("function");
  });

  test("draws the frame: intro, note with a title, a log line and the outro", async () => {
    const s = await session();
    s.ui.intro("wachiman");
    s.ui.note("body text", "A title");
    s.ui.log("success", "it worked");
    s.ui.log("warn", "careful");
    s.ui.outro("bye");
    for (const text of ["wachiman", "A title", "body text", "it worked", "careful", "bye"]) expect(s.screen()).toContain(text);
  });

  test("confirm: Enter takes the initial answer, and the other key flips it", async () => {
    const s = await session();
    const yes = s.ui.confirm({ message: "Go?", initial: true });
    await s.press("\r");
    expect(await yes).toBe(true);
    const no = s.ui.confirm({ message: "Go?", initial: true });
    await s.press("n");
    await s.press("\r");
    expect(await no).toBe(false);
  });

  test("select answers with the option's index, starting at the initial one", async () => {
    const s = await session();
    const options = [
      { value: 0, label: "alpha", hint: "first" },
      { value: 1, label: "beta" },
      { value: 2, label: "gamma" },
    ];
    const picked = s.ui.select({ message: "Pick", options, initial: 1 });
    await s.press("\x1b[B"); // down
    await s.press("\r");
    expect(await picked).toBe(2);
    // Clack lists every label and shows a hint only beside the focused option.
    expect(s.screen()).toContain("alpha");
    expect(s.screen()).toContain("gamma");
  });

  test("text: the raw answer comes back (the prompter trims it), and validation sees the trimmed text or the default", async () => {
    const s = await session();
    const seen: string[] = [];
    const validate = (v: string) => (seen.push(v), undefined);
    const typed = s.ui.text({ message: "Name", validate });
    await s.press("  abc  ");
    await s.press("\r");
    expect(await typed).toBe("  abc  ");
    const dflt = s.ui.text({ message: "Base", defaultValue: "main", placeholder: "main", validate });
    await s.press("\r");
    expect(await dflt).toBe("main");
    // The validator sees what the caller will get: trimmed text, or the default for an empty answer.
    expect(seen).toEqual(["abc", "main"]);
  });

  test("Ctrl-C is a cancel: null", async () => {
    const s = await session();
    const answer = s.ui.confirm({ message: "Go?", initial: true });
    await s.press("\x03");
    expect(await answer).toBeNull();
  });

  test("the spinner stops with a message, and fail ends it as an error", async () => {
    const s = await session();
    const ok = s.ui.spinner();
    ok.start("Working");
    ok.stop("Worked");
    const bad = s.ui.spinner();
    bad.start("Probing");
    bad.fail("Probing: needs attention");
    expect(s.screen()).toContain("Worked");
    expect(s.screen()).toContain("needs attention");
  });
});
