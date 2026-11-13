import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CTRL_C, ESC, scripted } from "../../test/support/scripted-prompt";
import { createPrompter } from "./prompt";

const choices = [
  { label: "alpha", value: "a" },
  { label: "beta", value: "b" },
  { label: "gamma", value: "c" },
];

describe("select", () => {
  test("Enter takes the default that was printed with (default)", async () => {
    const io = scripted([""]);
    const p = createPrompter(io);
    const picked = await p.select("Pick one", choices, 1);
    expect(picked).toBe("b");
    expect(io.printed()).toMatch(/2\. beta.*\(default\)/);
    expect(io.printed()).not.toMatch(/1\. alpha.*\(default\)/);
  });

  test("a number picks that row; an invalid answer is asked again", async () => {
    const io = scripted(["9", "x", "3"]);
    const picked = await createPrompter(io).select("Pick one", choices, 0);
    expect(picked).toBe("c");
    expect(io.printed()).toContain("Enter a number from 1 to 3");
  });

  test.each([
    ["Escape", [ESC]],
    ["Ctrl-C", [CTRL_C]],
    ["Ctrl-D (end of input)", []],
  ])("%s cancels with null", async (_name, lines) => {
    const picked = await createPrompter(scripted(lines)).select("Pick one", choices, 0);
    expect(picked).toBeNull();
  });
});

describe("text", () => {
  test("Enter takes the default printed in brackets", async () => {
    const io = scripted([""]);
    expect(await createPrompter(io).text("Name", "isolated")).toBe("isolated");
    expect(io.printed()).toContain("Name [isolated]");
  });

  test("a typed value wins over the default and is trimmed", async () => {
    expect(await createPrompter(scripted(["  mine  "])).text("Name", "isolated")).toBe("mine");
  });

  test("a validation error is shown and the question is asked again until valid", async () => {
    const io = scripted(["Bad", "ok"]);
    const value = await createPrompter(io).text("Name", undefined, (v) => (v === "ok" ? undefined : `"${v}" is not allowed`));
    expect(value).toBe("ok");
    expect(io.printed()).toContain('"Bad" is not allowed');
  });

  test("without a default an empty answer is validated like any other", async () => {
    const io = scripted(["", "me"]);
    const value = await createPrompter(io).text("Login", undefined, (v) => (v === "" ? "a value is required" : undefined));
    expect(value).toBe("me");
    expect(io.printed()).toContain("a value is required");
  });

  test("cancelling during a validation loop ends it", async () => {
    expect(await createPrompter(scripted(["bad", ESC])).text("Name", undefined, () => "never valid")).toBeNull();
  });
});

describe("confirm", () => {
  test("Enter takes the printed default: [Y/n] is yes, [y/N] is no", async () => {
    const yes = scripted([""]);
    expect(await createPrompter(yes).confirm("Go?", true)).toBe(true);
    expect(yes.printed()).toContain("[Y/n]");
    const no = scripted([""]);
    expect(await createPrompter(no).confirm("Go?", false)).toBe(false);
    expect(no.printed()).toContain("[y/N]");
  });

  test("y, yes, n, no in any case; anything else is asked again", async () => {
    const p = createPrompter(scripted(["YES", "n", "maybe", "y"]));
    expect(await p.confirm("a", false)).toBe(true);
    expect(await p.confirm("b", true)).toBe(false);
    expect(await p.confirm("c", false)).toBe(true);
  });

  test("Escape cancels with null", async () => {
    expect(await createPrompter(scripted([ESC])).confirm("Go?", true)).toBeNull();
  });
});

describe("one session", () => {
  test("answers typed ahead of the question are not lost between prompts", async () => {
    const p = createPrompter(scripted(["2", "me", "y"]));
    expect(await p.select("s", choices, 0)).toBe("b");
    expect(await p.text("t", undefined)).toBe("me");
    expect(await p.confirm("c", false)).toBe(true);
  });

  test("once cancelled, every later prompt is cancelled too", async () => {
    const p = createPrompter(scripted([ESC, "y"]));
    expect(await p.confirm("a", true)).toBeNull();
    expect(await p.confirm("b", true)).toBeNull();
  });

  test("a stream that ends while a question waits cancels it", async () => {
    const input = new PassThrough();
    const p = createPrompter({ input, output: new PassThrough() });
    const pending = p.confirm("Go?", true);
    input.end();
    expect(await pending).toBeNull();
  });
});

describe("suspend", () => {
  test("answers typed ahead survive giving the terminal away and taking it back", async () => {
    const p = createPrompter(scripted(["first", "second", "third"]));
    expect(await p.text("a", undefined)).toBe("first");
    p.suspend();
    expect(await p.text("b", undefined)).toBe("second");
    p.suspend();
    p.suspend();
    expect(await p.text("c", undefined)).toBe("third");
  });

  test("a script that ran out is still cancellation after a suspend", async () => {
    const p = createPrompter(scripted(["only"]));
    expect(await p.text("a", undefined)).toBe("only");
    p.suspend();
    expect(await p.text("b", undefined)).toBeNull();
  });
});

describe("a terminal", () => {
  test("redirected prompt output stays plain even when stdin is a terminal", async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => input });
    const output = new PassThrough();
    let written = "";
    output.on("data", (d) => (written += d.toString()));
    const p = createPrompter({ input, output }, { TERM: "xterm-256color" });
    try {
      const answer = p.confirm("Continue?", true);
      input.end("y\n");
      expect(await answer).toBe(true);
      expect(written).toBe("Continue? [Y/n] ");
    } finally {
      p.close();
    }
  });
});
