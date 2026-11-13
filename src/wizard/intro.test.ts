import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CAR_SPRITE, FRAME_MS, GUARD_SPRITE, canAnimate, frameGrid, headerLine, introFrames, playIntro, renderFrame, sceneWidth, type IntroTerminal } from "./intro";
import { stripAnsi } from "./style";

const WIDTH = sceneWidth(80);

describe("the art", () => {
  test("every sprite row has the same width and uses only known palette keys", () => {
    for (const sprite of [CAR_SPRITE, GUARD_SPRITE.idle, GUARD_SPRITE.wave]) {
      expect(new Set(sprite.map((row) => row.length)).size).toBe(1);
      for (const row of sprite) expect(row).toMatch(/^[.OWSCHYBKFLM]+$/);
    }
    expect(GUARD_SPRITE.wave.length).toBe(GUARD_SPRITE.idle.length);
  });

  test("a frame is five text rows of half blocks, all the same visible width", () => {
    for (const frame of introFrames(WIDTH)) {
      const lines = renderFrame(frame, WIDTH).map(stripAnsi);
      expect(lines).toHaveLength(5);
      for (const line of lines) {
        expect([...line]).toHaveLength(WIDTH);
        expect(line).toMatch(/^[ ▀▄█]+$/);
      }
    }
  });

  test("without color the shapes stay and no escape code is written", () => {
    const lines = renderFrame(introFrames(WIDTH).at(-1)!, WIDTH, false);
    expect(lines.join("")).not.toContain("\x1b");
    expect(lines.join("").trim().length).toBeGreaterThan(20);
  });

  test("the first frame has the car off screen to the left, the last one has it parked next to the guard with the arm raised", () => {
    const frames = introFrames(WIDTH);
    const first = frames[0];
    const last = frames.at(-1)!;
    expect(first.carX).toBeLessThan(0);
    expect(last.wave).toBe(true);
    expect(first.wave).toBe(false);
    // The car's right edge stops before the guard, with a gap.
    expect(last.carX + CAR_SPRITE[0].length).toBeLessThan(WIDTH - GUARD_SPRITE.idle[0].length);
    expect(last.carX).toBeGreaterThan(0);
  });

  test("the car only moves forward and slows down as it arrives", () => {
    const xs = introFrames(WIDTH).map((f) => f.carX);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(xs[1] - xs[0]).toBeGreaterThan(xs.at(-1)! - xs.at(-9)!);
  });

  test("the two lights are red and blue, and they swap", () => {
    const frames = introFrames(WIDTH);
    const lightRow = (i: number) => frameGrid(frames[i], WIDTH)[0].filter((c) => c !== ".").join("");
    const a = lightRow(frames.findIndex((f) => f.carX >= 0 && f.lights === 0));
    const b = lightRow(frames.findIndex((f) => f.carX >= 0 && f.lights === 1));
    expect(new Set(a + b)).toEqual(new Set(["R", "U"]));
    expect(a).not.toBe(b);
  });
});

describe("timing and flashing", () => {
  test("the whole intro lasts between 1.0 and 1.5 seconds", () => {
    const ms = introFrames(WIDTH).length * FRAME_MS;
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThanOrEqual(1500);
  });

  test("the lights change at most 3 times in any second, and are never dark", () => {
    const frames = introFrames(WIDTH);
    const changes = frames.map((f, i) => (i > 0 && f.lights !== frames[i - 1].lights ? i * FRAME_MS : -1)).filter((t) => t >= 0);
    for (const t of changes) expect(changes.filter((u) => u >= t && u < t + 1000).length).toBeLessThanOrEqual(3);
    for (const f of frames.filter((f) => f.carX >= 0)) {
      const row = frameGrid(f, WIDTH)[0];
      expect(row).toContain("R");
      expect(row).toContain("U");
    }
  });

  test("a narrow terminal still gets a scene that fits", () => {
    expect(sceneWidth(40)).toBeLessThanOrEqual(40);
    expect(sceneWidth(200)).toBe(56);
  });
});

/** A terminal that records what is written to it and lets a test press keys. */
function fakeTerminal(opts: { isTTY?: boolean; columns?: number; input?: boolean } = {}) {
  const input = Object.assign(new PassThrough(), { isTTY: opts.input ?? true, isRaw: false, rawCalls: [] as boolean[] });
  Object.assign(input, {
    setRawMode(mode: boolean) {
      input.isRaw = mode;
      input.rawCalls.push(mode);
      return input;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: opts.isTTY ?? true, columns: opts.columns ?? 80 });
  let written = "";
  output.on("data", (d) => (written += d.toString()));
  return { input, output, written: () => written, term: { input, output } as unknown as IntroTerminal };
}

describe("gating", () => {
  const fake = fakeTerminal();
  test.each([
    ["a terminal with color", {}, true],
    ["NO_COLOR", { NO_COLOR: "1" }, false],
    ["CI", { CI: "true" }, false],
    ["any CI value", { CI: "yes" }, false],
    ["WACHIMAN_NO_ANIMATION", { WACHIMAN_NO_ANIMATION: "1" }, false],
    ["TERM=dumb", { TERM: "dumb" }, false],
  ])("%s", (_name, env, expected) => {
    expect(canAnimate(fake.term, env)).toBe(expected);
  });

  test("a piped output, a piped input and a very narrow terminal do not animate", () => {
    expect(canAnimate(fakeTerminal({ isTTY: false }).term, {})).toBe(false);
    expect(canAnimate(fakeTerminal({ input: false }).term, {})).toBe(false);
    expect(canAnimate(fakeTerminal({ columns: 30 }).term, {})).toBe(false);
  });

  test.each([
    ["NO_COLOR", { NO_COLOR: "1" }],
    ["CI", { CI: "true" }],
    ["WACHIMAN_NO_ANIMATION", { WACHIMAN_NO_ANIMATION: "1" }],
  ])("%s prints the static header only: no cursor control, no frames", async (_name, env) => {
    const t = fakeTerminal();
    const result = await playIntro({ term: t.term, env, version: "1.2.3" });
    expect(result).toBe("static");
    expect(stripAnsi(t.written())).toBe("👮 wachiman v1.2.3 · on watch\n");
    expect(t.written()).not.toContain("\x1b[?25");
    expect(t.input.rawCalls).toEqual([]);
  });

  test("the header reads the same without color", () => {
    expect(headerLine("1.14.0", { NO_COLOR: "1" }, { isTTY: true })).toBe("👮 wachiman v1.14.0 · on watch");
  });
});

describe("the player", () => {
  const instant = () => Promise.resolve();

  test("plays every frame, wipes them, restores the cursor and leaves the header", async () => {
    const t = fakeTerminal();
    const result = await playIntro({ term: t.term, env: {}, version: "1.2.3", sleep: instant });
    expect(result).toBe("played");
    const out = t.written();
    expect(out.startsWith("\x1b[?25l")).toBe(true);
    expect(out.split("\x1b[5A").length - 1).toBe(introFrames(WIDTH).length); // one move back per frame after the first, plus the wipe
    expect(out).toContain("\x1b[5A\x1b[J");
    expect(out.lastIndexOf("\x1b[?25h")).toBeGreaterThan(out.lastIndexOf("\x1b[J"));
    expect(stripAnsi(out).endsWith("👮 wachiman v1.2.3 · on watch\n")).toBe(true);
    // Raw mode was on while playing and is back to what it was.
    expect(t.input.rawCalls).toEqual([true, false]);
    expect(t.input.isRaw).toBe(false);
  });

  test("any key skips it, right away, and still cleans up", async () => {
    const t = fakeTerminal();
    let frames = 0;
    const result = await playIntro({
      term: t.term,
      env: {},
      version: "1.2.3",
      sleep: () => {
        frames++;
        if (frames === 3) t.input.write("x");
        return new Promise((r) => setTimeout(r, 5));
      },
    });
    expect(result).toBe("skipped");
    expect(frames).toBeLessThan(introFrames(WIDTH).length);
    expect(t.written()).toContain("\x1b[?25h");
    expect(stripAnsi(t.written()).endsWith("👮 wachiman v1.2.3 · on watch\n")).toBe(true);
    expect(t.input.isRaw).toBe(false);
  });

  test("Ctrl-C ends it as an interruption, with the cursor back", async () => {
    const t = fakeTerminal();
    let frames = 0;
    const result = await playIntro({
      term: t.term,
      env: {},
      version: "1.2.3",
      sleep: () => {
        if (++frames === 2) t.input.write("\u0003");
        return new Promise((r) => setTimeout(r, 5));
      },
    });
    expect(result).toBe("interrupted");
    expect(t.written().lastIndexOf("\x1b[?25h")).toBeGreaterThan(t.written().lastIndexOf("\x1b[?25l"));
    expect(t.input.isRaw).toBe(false);
  });

  test("an error while playing still restores the cursor and raw mode", async () => {
    const t = fakeTerminal();
    await expect(
      playIntro({
        term: t.term,
        env: {},
        version: "1.2.3",
        sleep: () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(t.written()).toContain("\x1b[?25h");
    expect(t.input.isRaw).toBe(false);
  });
});
