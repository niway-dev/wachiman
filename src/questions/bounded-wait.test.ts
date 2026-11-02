import { describe, expect, test } from "bun:test";
import { QUESTION } from "./bounded-wait";

const wordCount = (text: string) => text.trim().split(/\s+/).length;

// kaipu-record #482, commit 833ca60 (first head), apps/kaipu-record/src/main/workspaces/workspace-settings.ts.
// Verbatim added lines of the read timeout and `refresh`; `isAvailable` is awaited outside the race (D1/F8).
const KAIPU_482_ADDED: string[] = [
  "/** How long a capture waits for a folder file before it counts as unreadable (an evicted file). */",
  "const READ_TIMEOUT_MS = 2000;",
  "",
  "  private async read(path: string): Promise<FolderRead> {",
  "    const timeout = this.deps.readTimeoutMs ?? READ_TIMEOUT_MS;",
  "    let timer: ReturnType<typeof setTimeout> | undefined;",
  "    try {",
  "      return await Promise.race([",
  "        readFolderOverrides(path),",
  "        new Promise<FolderRead>((resolve) => {",
  '          timer = setTimeout(() => resolve({ kind: "unreadable" }), timeout);',
  "        }),",
  "      ]);",
  "    } catch {",
  '      return { kind: "unreadable" };',
  "    } finally {",
  "      clearTimeout(timer);",
  "    }",
  "  }",
  "",
  "  /**",
  "   * Read a workspace's folder file into the cache. A workspace that is not connected has no",
  "   * readable file. When the active workspace's overrides change because of it (a sync wrote",
  "   * the file), everyone is told.",
  "   */",
  "  async refresh(id: string): Promise<void> {",
  "    const ws = this.known(id);",
  "    if (!ws) return;",
  "    const before = JSON.stringify(this.overridesOf(id));",
  "    this.reads.set(",
  "      id,",
  '      (await this.deps.isAvailable(id)) ? await this.read(ws.path) : { kind: "unreadable" },',
  "    );",
  "    if (id === this.deps.activeId() && before !== JSON.stringify(this.overridesOf(id))) {",
  "      this.deps.changed();",
  "    }",
  "  }",
];

// kaipu-record #483, commit 443a9b0 (first head), apps/kaipu-record/src/main/library/dataless.ts.
// Verbatim added lines: per-batch stat timeout, sequential batches, unbounded lstat fallback (D11).
const KAIPU_483_ADDED: string[] = [
  "/** How long one `stat` batch may take. Answered in milliseconds in the spike; never hangs here. */",
  "export const STAT_TIMEOUT_MS = 5_000;",
  "function runStatCli(paths: string[]): Promise<{ stdout: string; failed: boolean }> {",
  "  return new Promise((resolve) => {",
  "    execFile(",
  '      "/usr/bin/stat",',
  '      ["-f", "%f %N", "--", ...paths],',
  "      { timeout: STAT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },",
  '      (error, stdout) => resolve({ stdout: String(stdout ?? ""), failed: error !== null }),',
  "    );",
  "  });",
  "}",
  "",
  "/** Which of `paths` are evicted. A missing path is not. Never reads a file's data; never throws. */",
  "export async function datalessPaths(",
  "  paths: readonly string[],",
  "  deps: DatalessDeps = defaultDatalessDeps,",
  "): Promise<Set<string>> {",
  "  const evicted = new Set<string>();",
  "  for (let start = 0; start < paths.length; start += BATCH) {",
  "    const batch = paths.slice(start, start + BATCH);",
  '    const { stdout } = await deps.runStat(batch).catch(() => ({ stdout: "", failed: true }));',
  "    const flags = parseStatFlags(stdout);",
  "    if (flags.size > 0) {",
  "      // stat answered: its flags are the truth, and a path it did not print is missing.",
  "      for (const [path, value] of flags) {",
  "        if ((value & SF_DATALESS) !== 0) evicted.add(path);",
  "      }",
  "      continue;",
  "    }",
  "    // stat gave nothing at all (not there, killed by the timeout): the block count is a guess.",
  "    for (const path of batch) {",
  "      const info = await deps.lstat(path).catch(() => null);",
  "      if (info && info.blocks === 0 && info.size > 0) evicted.add(path);",
  "    }",
  "  }",
  "  return evicted;",
  "}",
  "",
];

// kaipu-record #449, commit 1eb0638 (head), apps/kaipu-record/src/main/workspaces/index.ts.
// Verbatim added lines: the 120 s prepare wait that a closing window never answers (F5; Wachiman found it).
const KAIPU_449_ADDED: string[] = [
  "const PREPARE_TIMEOUT_MS = 120_000;",
  "",
  "/**",
  " * Ask every window to prepare (flush, ask about unsaved work, close editors) and wait for",
  " * all of them. A window that does not answer in time cancels the switch.",
  " */",
  "function prepareWindows(): Promise<boolean> {",
  "  const windows = BrowserWindow.getAllWindows().filter(",
  "    (w) => !w.isDestroyed() && !w.webContents.isCrashed(),",
  "  );",
  "  return Promise.all(",
  "    windows.map(",
  "      (window) =>",
  "        new Promise<boolean>((resolve) => {",
  "          const requestId = ++nextRequestId;",
  "          const timer = setTimeout(() => {",
  "            pendingPrepares.delete(requestId);",
  "            resolve(false);",
  "          }, PREPARE_TIMEOUT_MS);",
  "          pendingPrepares.set(requestId, (ok) => {",
  "            clearTimeout(timer);",
  "            pendingPrepares.delete(requestId);",
  "            resolve(ok);",
  "          });",
  "          window.webContents.send(IPC_CHANNELS.workspacesPrepare, { requestId });",
  "        }),",
  "    ),",
];

describe("bounded-wait question", () => {
  test("has the contract shape and stays within 120 words", () => {
    expect(QUESTION.id).toBe("bounded-wait");
    expect(QUESTION.title.length).toBeGreaterThan(0);
    expect(QUESTION.title).not.toContain("\n");
    expect(wordCount(QUESTION.text)).toBeLessThanOrEqual(120);
    expect(QUESTION.text).not.toMatch(/^#/m);
  });

  describe("applies to the real kaipu-record patterns", () => {
    test("#482: availability awaited outside the 2 s read race", () => {
      expect(
        QUESTION.applies(
          KAIPU_482_ADDED,
          "apps/kaipu-record/src/main/workspaces/workspace-settings.ts",
        ),
      ).toBe(true);
    });
    test("#483: per-batch stat timeout over sequential batches with an lstat fallback", () => {
      expect(
        QUESTION.applies(KAIPU_483_ADDED, "apps/kaipu-record/src/main/library/dataless.ts"),
      ).toBe(true);
    });
    test("#449: the 120 s prepare wait", () => {
      expect(
        QUESTION.applies(KAIPU_449_ADDED, "apps/kaipu-record/src/main/workspaces/index.ts"),
      ).toBe(true);
    });
  });

  describe("applies to other timeout, deadline, race, probe, poll and retry code", () => {
    const cases: [string, string[]][] = [
      [
        "AbortSignal.timeout",
        ["const res = await fetch(url, { signal: AbortSignal.timeout(5000) });"],
      ],
      [
        "deadline variable",
        ["const deadline = Date.now() + 10_000;", "if (Date.now() >= deadline) break;"],
      ],
      ["timeout option", ["execFile(bin, args, { timeout: 5_000 }, cb);"]],
      ["Promise.race", ["await Promise.race([work(), gaveUp]);"]],
      ["poll loop", ["while (!(await isReady())) await poll();"]],
      [
        "retry with backoff",
        ["for (let n = 0; n < retries; n++) {", "  await sleep(backoff * 2 ** n);"],
      ],
      ["probe", ["const evicted = await probeDataless(paths);"]],
    ];
    for (const [name, lines] of cases) {
      test(name, () => expect(QUESTION.applies(lines, "src/main/sync.ts")).toBe(true));
    }
  });

  describe("never applies to the near misses", () => {
    test("a UI debounce setTimeout", () => {
      const lines = [
        "const timer = setTimeout(() => setQuery(value), 300);",
        "return () => clearTimeout(timer);",
      ];
      expect(QUESTION.applies(lines, "src/lib/use-debounce.ts")).toBe(false);
      expect(QUESTION.applies(lines, "src/components/search.tsx")).toBe(false);
    });
    test("a debounce handle named like a timeout", () => {
      const lines = [
        "const timeoutId = setTimeout(() => flush(), DEBOUNCE_MS);",
        "if (timeoutRef.current) clearTimeout(timeoutRef.current);",
        "const debounceTimeout = setTimeout(save, 250);",
      ];
      expect(QUESTION.applies(lines, "src/lib/save.ts")).toBe(false);
    });
    test("a bare setTimeout and a sleep helper in source", () => {
      const lines = [
        "const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));",
        "setTimeout(() => el.focus(), 0);",
      ];
      expect(QUESTION.applies(lines, "src/lib/sleep.ts")).toBe(false);
    });
    test("a CSS transition", () => {
      const css = ["  transition: opacity 200ms ease-in;", "  animation-timeout: 2s;"];
      expect(QUESTION.applies(css, "src/styles/app.css")).toBe(false);
      const inJs = ['el.style.transition = "opacity 200ms";', "const hoverTimeout = 200;"];
      expect(QUESTION.applies(inJs, "src/lib/fade.ts")).toBe(false);
    });
    test("an await sleep in a test", () => {
      const lines = [
        "await sleep(50);",
        "const result = await Promise.race([run(), timeout(100)]);",
      ];
      for (const file of [
        "src/sync.test.ts",
        "src/sync.spec.js",
        "src/__tests__/sync.ts",
        "test/sync.ts",
        "e2e/flow.ts",
        "src/sync_test.go",
        "tests/test_sync.py",
        "src/__mocks__/clock.ts",
        "src/Button.stories.ts",
      ]) {
        expect(QUESTION.applies(lines, file)).toBe(false);
      }
    });
    test("documentation lines", () => {
      const lines = [
        "The probe has a 2 s timeout and a deadline of 10 s; retry with backoff.",
        "Poll every second until Promise.race settles.",
      ];
      for (const file of [
        "docs/adr/0034-probe.md",
        "README.mdx",
        "docs/spec.txt",
        "config.yaml",
        "package.json",
      ]) {
        expect(QUESTION.applies(lines, file)).toBe(false);
      }
    });
    test("comment-only lines in source", () => {
      const lines = [
        "// retry with a timeout and a deadline",
        " * The probe polls until the deadline.",
        "# retry",
      ];
      expect(QUESTION.applies(lines, "src/main/sync.ts")).toBe(false);
    });
    test("ordinary code without a wait", () => {
      const lines = [
        "export const add = (a: number, b: number) => a + b;",
        "const names = users.map((u) => u.name);",
        "",
      ];
      expect(QUESTION.applies(lines, "src/util.ts")).toBe(false);
      expect(QUESTION.applies([], "src/util.ts")).toBe(false);
    });
  });

  test("a batch pays only when one of its lines shows the pattern", () => {
    const mixed = [
      "const a = 1;",
      "const t = setTimeout(() => x(), 100);",
      "const READ_TIMEOUT_MS = 2000;",
    ];
    expect(QUESTION.applies(mixed, "src/main/a.ts")).toBe(true);
    expect(QUESTION.applies(mixed.slice(0, 2), "src/main/a.ts")).toBe(false);
  });
});
