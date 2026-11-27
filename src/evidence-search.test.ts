import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  collectEvidence,
  defaultEvidenceIo,
  gitSymbolSearch,
  type GitRunner,
  planEvidence,
  serializeEvidence,
  type EvidencePlan,
  type PlannedSymbol,
} from "./evidence";
import {
  EvidenceSearcher,
  BINARY_PROBE_BYTES,
  MatchCollector,
  NameIndex,
  binaryFiles,
  RowSplitter,
  holdsWord,
  looksBinary,
  parseRipgrepRow,
  ripgrepArgs,
  ripgrepMissingLine,
  runRipgrep,
  startEvidenceRun,
  type EvidenceTally,
} from "./evidence-search";
import {
  RIPGREP_ASSETS,
  RIPGREP_ENV,
  RIPGREP_VERSION,
  ensureRipgrep,
  installRipgrep,
  parseRipgrepVersion,
  pathCandidateNames,
  resolveRipgrep,
  type RipgrepFound,
  type VersionProbe,
} from "./ripgrep";

const scratch: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));

// The real binary, when this machine has a qualifying one: CI installs it; elsewhere these tests skip.
const real = resolveRipgrep(process.env);
const withRipgrep = real.found ? test : test.skip;

describe("the CI environment", () => {
  // Without it the rg-vs-git-grep differential tests would all skip silently when the download failed.
  test("CI always has a usable ripgrep, so the differential tests run", () => {
    if (!process.env.CI) return;
    expect(real.found).toBe(true);
  });
});

describe("parseRipgrepRow", () => {
  test("splits at the NUL, so spaces and colons in a path stay in the path", () => {
    expect(parseRipgrepRow("./src/with space/c:o.ts\u000012:const a = b:c;")).toEqual({
      file: "src/with space/c:o.ts",
      line: 12,
      text: "const a = b:c;",
    });
  });

  test("keeps a hidden directory and strips only the leading ./", () => {
    expect(parseRipgrepRow("./.hidden/h.ts\u00001:x")?.file).toBe(".hidden/h.ts");
    expect(parseRipgrepRow("./a/./b.ts\u00001:x")?.file).toBe("a/./b.ts");
  });

  test("a row that is not path, NUL, line and colon is dropped", () => {
    expect(parseRipgrepRow("rg: some message")).toBeUndefined();
    expect(parseRipgrepRow("./a.ts\0no colon")).toBeUndefined();
    expect(parseRipgrepRow("./a.ts\0x:1")).toBeUndefined();
    expect(parseRipgrepRow("\u00001:x")).toBeUndefined();
  });

  test("a line with a CR or a Unicode line separator is dropped, as the git backend's parser drops it", () => {
    expect(parseRipgrepRow("./a.ts\u00001:x(1);\r")).toBeUndefined();
    expect(parseRipgrepRow("./a.ts\u00001:x\u2028y")).toBeUndefined();
    expect(parseRipgrepRow("./a.ts\u00001:x(1);")).toBeDefined();
  });

  test("a line of text that holds colons and an empty text are kept whole", () => {
    expect(parseRipgrepRow("./a.ts\u00003:")?.text).toBe("");
    expect(parseRipgrepRow("./a.ts\u00003:a:1:b")?.text).toBe("a:1:b");
  });

  test("a very long line is kept whole: the ranking reads all of it", () => {
    const text = "x".repeat(2_000_000);
    expect(parseRipgrepRow(`./bundle.ts\u00001:${text}`)!.text).toHaveLength(text.length);
  });
});

describe("looksBinary", () => {
  const file = (bytes: Uint8Array | string) => {
    const path = join(temp("evidence-bin-"), "f.ts");
    writeFileSync(path, bytes);
    return path;
  };

  test("a NUL in the first 8000 bytes makes a file binary, as for git grep -I", () => {
    expect(looksBinary(file("a\0b"))).toBe(true);
    expect(looksBinary(file(Buffer.concat([Buffer.from("x".repeat(BINARY_PROBE_BYTES - 1)), Buffer.from([0])])))).toBe(true);
  });

  test("a NUL after the first 8000 bytes does not, nor does text, nor an empty file", () => {
    expect(looksBinary(file(Buffer.concat([Buffer.from("x".repeat(BINARY_PROBE_BYTES)), Buffer.from([0])])))).toBe(false);
    expect(looksBinary(file("plain text\n"))).toBe(false);
    expect(looksBinary(file(""))).toBe(false);
  });

  test("a file that cannot be read counts as binary, so it is never reported", () => {
    expect(looksBinary("/nonexistent/f.ts")).toBe(true);
  });
});

describe("RowSplitter", () => {
  const collect = (chunks: Uint8Array[]) => {
    const rows: string[] = [];
    const splitter = new RowSplitter((r) => rows.push(r));
    for (const c of chunks) splitter.push(c);
    splitter.finish();
    return rows;
  };

  test("a row cut across chunks, and a multi-byte character cut in the middle, come out whole", () => {
    const bytes = new TextEncoder().encode("./a.ts\u00001:café(1)\n./b.ts\u00002:naïve\n./c.ts\u00003:last");
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(collect([bytes.slice(0, cut), bytes.slice(cut)])).toEqual([
        "./a.ts\u00001:café(1)",
        "./b.ts\u00002:naïve",
        "./c.ts\u00003:last",
      ]);
    }
  });

  test("an empty stream gives no row", () => {
    expect(collect([])).toEqual([]);
  });
});

describe("holdsWord", () => {
  test("a name inside a longer word does not count, a name beside punctuation does", () => {
    expect(holdsWord("foo(1)", "foo")).toBe(true);
    expect(holdsWord("xfoo(1)", "foo")).toBe(false);
    expect(holdsWord("foo_bar(1)", "foo")).toBe(false);
    expect(holdsWord("a.foo.b", "foo")).toBe(true);
    expect(holdsWord("foo2", "foo")).toBe(false);
  });

  test("a later occurrence counts when the first one is inside a word", () => {
    expect(holdsWord("xfoo foo", "foo")).toBe(true);
  });

  test("a non-ASCII letter is not a word character, as under git grep with LC_ALL=C", () => {
    expect(holdsWord("éfoo(1)", "foo")).toBe(true);
    expect(holdsWord("fooé", "foo")).toBe(true);
  });

  test("$ is not a word character either, but part of a name that has it", () => {
    expect(holdsWord("x$foo", "foo")).toBe(true);
    expect(holdsWord("x$foo", "$foo")).toBe(false);
    expect(holdsWord("a $foo(1)", "$foo")).toBe(true);
    expect(holdsWord("$(el)", "$")).toBe(true);
    expect(holdsWord("a$b", "$")).toBe(false);
    expect(holdsWord("a $ b", "$")).toBe(true);
  });
});

describe("NameIndex", () => {
  test("a line that holds several names is attributed to each of them", () => {
    const index = new NameIndex(["startFileDrag", "markCopySeen", "other"]);
    expect(index.namesIn("startFileDrag(markCopySeen(id));").sort()).toEqual(["markCopySeen", "startFileDrag"]);
  });

  test("names that overlap are both found: foo inside foo.bar", () => {
    const index = new NameIndex(["foo", "foo.bar", "bar"]);
    expect(index.namesIn("x = foo.bar(1)").sort()).toEqual(["bar", "foo", "foo.bar"]);
  });

  test("channel names with separators are found as whole words", () => {
    const index = new NameIndex(["recording-ready:show"]);
    expect(index.namesIn('ipc.send("recording-ready:show", id)')).toEqual(["recording-ready:show"]);
    expect(index.namesIn('ipc.send("recording-ready:shown", id)')).toEqual([]);
    expect(index.namesIn('ipc.send("xrecording-ready:show", id)')).toEqual([]);
    // A hyphen is not a word character, so a longer name that ends the same way still holds it.
    expect(index.namesIn('ipc.send("x-recording-ready:show", id)')).toEqual(["recording-ready:show"]);
  });

  test("word boundaries: a name inside a longer identifier is not attributed", () => {
    const index = new NameIndex(["get", "set"]);
    expect(index.namesIn("getter(); xset(); get(); a.set(1)").sort()).toEqual(["get", "set"]);
    expect(index.namesIn("getter(); xset(); target")).toEqual([]);
  });

  test("a name with $ at either end, and a name with no word character", () => {
    const index = new NameIndex(["$store", "foo$", "$"]);
    expect(index.namesIn("$store(1)")).toEqual(["$store"]);
    expect(index.namesIn("x$store(1)")).toEqual([]);
    expect(index.namesIn("foo$ = 1")).toEqual(["foo$"]);
    expect(index.namesIn("foo$bar")).toEqual([]);
    expect(index.namesIn("$(el)").sort()).toEqual(["$"]);
  });

  test("a name is listed once however many times the line holds it", () => {
    expect(new NameIndex(["foo"]).namesIn("foo(foo(foo))")).toEqual(["foo"]);
  });

  test("agrees with holdsWord on every name and a spread of lines", () => {
    const names = ["a", "ab", "a_b", "a.b", "$a", "a$", "a-b:c"];
    const lines = ["a", "ab a", "xa a$", "a.b(1)", "$a $a", "a_b a", "a-b:c", "xa-b:c", "a-b:cx", "é a é", "a$b", "$$a"];
    const index = new NameIndex(names);
    for (const line of lines) {
      expect(index.namesIn(line).sort()).toEqual(names.filter((n) => holdsWord(line, n)).sort());
    }
  });
});

describe("binaryFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "wachiman-binfiles-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "nul.txt"), "a\0b");
  writeFileSync(join(dir, "plain.txt"), "plain\n");
  // `git check-attr -z --stdin diff` prints `path NUL diff NUL value NUL` per file.
  const answering =
    (values: Record<string, string>, calls: string[][] = []): GitRunner =>
    (args, opts) => {
      calls.push(args);
      const out = (opts.input ?? "")
        .split("\0")
        .filter(Boolean)
        .map((f) => `${f}\0diff\0${values[f] ?? "unspecified"}\0`);
      return { status: 0, stdout: out.join("") };
    };

  test("the diff attribute decides first: unset is binary, set is text, even against the bytes", () => {
    const calls: string[][] = [];
    const out = binaryFiles(dir, ["nul.txt", "plain.txt"], answering({ "plain.txt": "unset", "nul.txt": "set" }, calls));
    expect([...out]).toEqual(["plain.txt"]);
    expect(calls[0]).toEqual(["check-attr", "-z", "--stdin", "diff"]);
  });

  test("a driver name or an unspecified attribute falls back to the NUL rule", () => {
    const out = binaryFiles(dir, ["nul.txt", "plain.txt"], answering({ "nul.txt": "custom", "plain.txt": "unspecified" }));
    expect([...out]).toEqual(["nul.txt"]);
    expect([...binaryFiles(dir, ["nul.txt", "plain.txt"], answering({}))]).toEqual(["nul.txt"]);
  });

  test("a check-attr that fails, times out or is cut logs one line and the NUL rule decides", () => {
    for (const [run, why] of [
      [{ status: 128, stdout: "" }, "exit status 128"],
      [{ status: null, stdout: "", timedOut: true }, "timed out"],
      [{ status: null, stdout: "", outputCut: true }, "output cut"],
      [{ status: null, stdout: "", error: "spawn git ENOENT" }, "spawn git ENOENT"],
    ] as const) {
      const lines: string[] = [];
      const out = binaryFiles(
        dir,
        ["nul.txt", "plain.txt"],
        () => run,
        (l) => lines.push(l),
      );
      expect([...out]).toEqual(["nul.txt"]);
      expect(lines).toEqual([`evidence: git check-attr failed (${why}); binary files decided by the NUL rule`]);
    }
  });

  test("no files, no git", () => {
    expect(
      binaryFiles(dir, [], () => {
        throw new Error("must not run");
      }).size,
    ).toBe(0);
  });
});

describe("MatchCollector", () => {
  test("sorts a name's matches by path in byte order, then line, as git grep lists them", () => {
    const c = new MatchCollector(["f"]);
    for (const [file, line] of [
      ["a/b.ts", 1],
      ["a.ts", 2],
      ["a-b.ts", 1],
      ["a.ts", 1],
      ["a.b.ts", 1],
      ["A.ts", 1],
      ["a dir/x.ts", 1],
    ] as const) {
      c.add(`./${file}\0${line}:f(1)`);
    }
    expect(
      c
        .result()
        .get("f")!
        .map((m) => `${m.file}:${m.line}`),
    ).toEqual(["A.ts:1", "a dir/x.ts:1", "a-b.ts:1", "a.b.ts:1", "a.ts:1", "a.ts:2", "a/b.ts:1"]);
  });

  test("a name far into a very long line is found, with the whole text", () => {
    const c = new MatchCollector(["late"]);
    const text = `${"x ".repeat(500_000)}late(1)`;
    c.add(`./bundle.ts\u00007:${text}`);
    expect(c.result().get("late")).toEqual([{ file: "bundle.ts", line: 7, text }]);
  });

  test("a name nothing matched has an empty list, and a line with two names is in both", () => {
    const c = new MatchCollector(["one", "two", "none"]);
    c.add("./x.ts\u00001:one(two())");
    const result = c.result();
    expect(result.get("one")).toHaveLength(1);
    expect(result.get("two")![0]).toBe(result.get("one")![0]);
    expect(result.get("none")).toEqual([]);
    expect(c.lines).toBe(1);
  });
});

describe("ripgrepArgs", () => {
  const args = ripgrepArgs("/tmp/patterns");

  test("ignores the user's configuration and reads patterns from a file, never the command line", () => {
    expect(args).toContain("--no-config");
    expect(args[args.indexOf("--file") + 1]).toBe("/tmp/patterns");
    expect(args.slice(-1)).toEqual(["."]);
  });

  test("searches what git grep -n -I -w -F searches", () => {
    for (const flag of [
      "--hidden",
      "--no-ignore",
      "--null",
      "--line-number",
      "--word-regexp",
      "--fixed-strings",
      "--no-unicode",
      "--text",
    ]) {
      expect(args).toContain(flag);
    }
    const globs = args.flatMap((a, i) => (args[i - 1] === "--glob" ? [a] : []));
    expect(globs).toEqual(
      expect.arrayContaining([
        "*.ts",
        "*.tsx",
        "*.go",
        "!node_modules/",
        "!dist/",
        "!build/",
        "!.next/",
        "!vendor/",
        "!.git/",
        "!*.min.js",
        "!*.d.ts",
      ]),
    );
    // The exclusions come after the extensions, because the last matching glob wins.
    expect(globs.indexOf("!node_modules/")).toBeGreaterThan(globs.indexOf("*.svelte"));
  });
});

/** Runs `fn` with a TMPDIR that does not exist, so `mkdtempSync(join(tmpdir(), ...))` throws. */
async function withMissingTmpdir<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = join(tmpdir(), "wachiman-no-such-dir", "nested");
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
}

describe("runRipgrep", () => {
  withRipgrep("it abandons the search when the matching lines pass the memory ceiling", async () => {
    const dir = temp("evidence-cap-");
    writeFileSync(join(dir, "big.ts"), Array.from({ length: 2000 }, (_, n) => `alpha(${n});`).join("\n") + "\n");
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
    const run = await runRipgrep((real as RipgrepFound).path, ["alpha"], dir, { maxRetainedChars: 1000 });
    expect(run.ok).toBe(false);
    expect(run).toMatchObject({ failed: expect.stringContaining("matching lines") });
    // The same search under the real ceiling succeeds, so the failure above came from the cap.
    const fine = await runRipgrep((real as RipgrepFound).path, ["alpha"], dir);
    expect(fine.ok).toBe(true);
  });

  function repo() {
    const dir = temp("evidence-rg-");
    const write = (path: string, text: string | Uint8Array) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    write("src/with space/c:o.ts", "formatDuration(1)\n");
    write(".hidden/h.ts", "formatDuration(2) + parse(3)\n");
    write("src/a.ts", "formatDuration(4)\n");
    write("src/a/b.ts", "formatDuration(5)\n");
    write("node_modules/dep/n.ts", "formatDuration(6)\n");
    write("vendor/v.ts", "formatDuration(7)\n");
    write("sub/dist/d.ts", "formatDuration(8)\n");
    write("x.min.js", "formatDuration(9)\n");
    write("x.d.ts", "formatDuration(10)\n");
    write("bin.ts", Buffer.from("formatDuration(11)\0binary"));
    // A NUL past the first 8000 bytes: `git grep -I` still treats the file as text, both lines count.
    write("late-nul.ts", `formatDuration(14)\n${"// pad\n".repeat(2000)}\0\nformatDuration(15)\n`);
    write("notes.md", "formatDuration is documented\n");
    write("src/words.ts", "xformatDuration(12); formatDuration_2(13);\n");
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
    // Not tracked, as the CI job's `.ci-main/` checkout: `git grep` never reads it, so neither may rg.
    write(".ci-main/scripts/u.ts", "formatDuration(16)\n");
    write("untracked.ts", "formatDuration(17)\n");
    return dir;
  }

  withRipgrep("finds what git grep would: hidden dirs and odd paths in, exclusions, binary files and other extensions out", async () => {
    const run = await runRipgrep((real as RipgrepFound).path, ["formatDuration", "parse"], repo());
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const files = (name: string) => run.byName.get(name)!.map((m) => m.file);
    expect(files("formatDuration")).toEqual([
      ".hidden/h.ts",
      "late-nul.ts",
      "late-nul.ts",
      "src/a.ts",
      "src/a/b.ts",
      "src/with space/c:o.ts",
    ]);
    expect(files("parse")).toEqual([".hidden/h.ts"]);
  });

  withRipgrep("rg is always started with --no-config, so a user's configuration file cannot change a search", async () => {
    const dir = repo();
    // A wrapper that refuses to run without the flag, then hands over to the real binary.
    const wrapper = join(temp("evidence-rgwrap-"), "rg");
    writeFileSync(
      wrapper,
      `#!/bin/sh\ncase " $* " in *" --no-config "*) exec "${(real as RipgrepFound).path}" "$@" ;; esac\necho "--no-config missing" >&2\nexit 2\n`,
    );
    chmodSync(wrapper, 0o755);
    const run = await runRipgrep(wrapper, ["formatDuration"], dir);
    expect(run.ok && run.byName.get("formatDuration")!.length).toBe(6);
    // And the wrapper does fail without the flag, so the check above can fail.
    expect(Bun.spawnSync([wrapper, "--version"]).exitCode).toBe(2);
  });

  withRipgrep("a directory git cannot list is a failure, so the review uses git grep instead", async () => {
    const dir = temp("evidence-rg-nogit-");
    writeFileSync(join(dir, "a.ts"), "formatDuration(1)\n");
    const run = await runRipgrep((real as RipgrepFound).path, ["formatDuration"], dir);
    expect(run).toMatchObject({ ok: false, failed: expect.stringContaining("git ls-files failed") });
  });

  test("a temporary directory that cannot be made is a failure, never a throw", async () => {
    const dir = temp("evidence-rg-");
    const run = await withMissingTmpdir(() => runRipgrep("/nonexistent/rg", ["x"], dir));
    expect(run).toMatchObject({ ok: false, failed: expect.stringContaining("could not run") });
  });

  test("a binary that cannot run is a failure, never a throw", async () => {
    const run = await runRipgrep("/nonexistent/rg", ["x"], temp("evidence-rg-"));
    expect(run).toMatchObject({ ok: false, failed: expect.stringContaining("could not run") });
  });

  test("a search past its time box is killed and reported as timed out", async () => {
    const dir = temp("evidence-rg-slow-");
    const slow = join(dir, "rg");
    writeFileSync(slow, "#!/bin/sh\nexec sleep 5\n");
    chmodSync(slow, 0o755);
    const started = Date.now();
    const run = await runRipgrep(slow, ["x"], dir, { timeoutMs: 100 });
    expect(run).toMatchObject({ ok: false, timedOut: true });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("an exit status of 2 is not trusted, even with output", async () => {
    const dir = temp("evidence-rg-fail-");
    const bad = join(dir, "rg");
    writeFileSync(bad, "#!/bin/sh\nprintf './a.ts\\0001:x(1)\\n'\necho 'rg: boom' >&2\nexit 2\n");
    chmodSync(bad, 0o755);
    const run = await runRipgrep(bad, ["x"], dir);
    expect(run).toMatchObject({ ok: false, failed: "ripgrep exited with status 2: rg: boom" });
  });
});

// -----------------------------------------------------------------------------------------------
// Backend choice
// -----------------------------------------------------------------------------------------------

const answers =
  (table: Record<string, string | null>): VersionProbe =>
  (binary) => {
    const out = table[binary];
    if (out === undefined || out === null) return { status: null, stdout: "", error: new Error(`spawn ${binary} ENOENT`) };
    return { status: 0, stdout: out };
  };
const RG15 = "ripgrep 15.2.0 (rev e89fff89ac)\n\nfeatures:+pcre2\n";

describe("resolveRipgrep", () => {
  const home = "/home/u/.wachiman";
  const env = (extra: Record<string, string> = {}) => ({ WACHIMAN_HOME: home, PATH: "/usr/bin", ...extra });
  const installed = `${home}/bin/rg`;

  test("the override wins over the installed copy and over PATH", () => {
    const found = resolveRipgrep(env({ [RIPGREP_ENV]: "/opt/rg" }), answers({ "/opt/rg": RG15, [installed]: RG15, rg: RG15 }), () => true);
    expect(found).toMatchObject({ found: true, path: "/opt/rg", source: "env", version: "15.2.0" });
  });

  test("then the copy Wachiman installed, then rg on PATH", () => {
    expect(resolveRipgrep(env(), answers({ [installed]: RG15, "/usr/bin/rg": RG15 }), (p) => p === installed)).toMatchObject({
      found: true,
      path: installed,
      source: "installed",
    });
    expect(resolveRipgrep(env(), answers({ "/usr/bin/rg": RG15 }), () => true)).toMatchObject({
      found: true,
      path: "/usr/bin/rg",
      source: "path",
    });
  });

  test("on Windows the PATH walk also tries rg.exe, first", () => {
    const probed: string[] = [];
    const probe: VersionProbe = (b) => (probed.push(b), { status: 0, stdout: RG15 });
    const found = resolveRipgrep(env({ PATH: "/tools" }), probe, (p) => p.endsWith("rg.exe"), "win32");
    expect(pathCandidateNames("win32")).toEqual(["rg.exe", "rg"]);
    expect(pathCandidateNames("linux")).toEqual(["rg"]);
    expect(probed).toHaveLength(1);
    expect(found).toMatchObject({ found: true, source: "path" });
  });

  test("an installed copy that does not exist is not probed", () => {
    const probed: string[] = [];
    const probe: VersionProbe = (b) => (probed.push(b), { status: 0, stdout: RG15 });
    resolveRipgrep(env(), probe, (p) => p === "/usr/bin/rg");
    expect(probed).toEqual(["/usr/bin/rg"]);
  });

  test("a relative or empty PATH entry is skipped, and the path returned is absolute", () => {
    const probed: string[] = [];
    const probe: VersionProbe = (b) => (probed.push(b), b === "/usr/bin/rg" ? { status: 0, stdout: RG15 } : { status: 1, stdout: "" });
    const found = resolveRipgrep(
      env({ PATH: ["tools", "", ".", "/usr/bin"].join(delimiter) }),
      probe,
      (p) => p.endsWith("/rg") && !p.startsWith("/home"),
    );
    expect(probed).toEqual(["/usr/bin/rg"]);
    expect(found).toMatchObject({ found: true, path: "/usr/bin/rg" });
    // Never the bare name, which would resolve against the repository the search runs in.
    expect(probed).not.toContain("rg");
    expect(resolveRipgrep(env({ PATH: ["tools", "."].join(delimiter) }), probe, (p) => !p.startsWith("/home"))).toMatchObject({
      found: false,
    });
    expect(probed).toEqual(["/usr/bin/rg"]);
  });

  test("a repository-local rg in the working directory is never chosen", () => {
    const repo = mkdtempSync(join(tmpdir(), "wachiman-rg-local-"));
    try {
      mkdirSync(join(repo, "tools"));
      writeFileSync(join(repo, "tools", "rg"), "#!/bin/sh\necho 'ripgrep 99.0.0'\n", { mode: 0o755 });
      const previous = process.cwd();
      process.chdir(repo);
      try {
        const found = resolveRipgrep({ WACHIMAN_HOME: "/nonexistent/home", PATH: "tools" });
        expect(found.found).toBe(false);
      } finally {
        process.chdir(previous);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("a broken override is skipped and the next source is tried", () => {
    const found = resolveRipgrep(env({ [RIPGREP_ENV]: "/opt/rg" }), answers({ "/opt/rg": null, "/usr/bin/rg": RG15 }), () => true);
    expect(found).toMatchObject({ found: true, source: "path" });
    expect(resolveRipgrep(env({ [RIPGREP_ENV]: "relative/rg" }), answers({}), () => false)).toMatchObject({
      found: false,
      tried: expect.arrayContaining([expect.stringContaining("must be an absolute path")]),
    });
  });

  test("a version older than the pinned major, an unknown version and a program that is not ripgrep are not used", () => {
    for (const out of ["ripgrep 14.1.1 (rev abc)\n", "ripgrep unknown\n", "grep (BSD grep) 2.6.0\n", ""]) {
      const found = resolveRipgrep(env(), answers({ "/usr/bin/rg": out }), (p) => p === "/usr/bin/rg");
      expect(found.found).toBe(false);
    }
    expect(resolveRipgrep(env(), answers({ "/usr/bin/rg": "ripgrep 16.0.0\n" }), (p) => p === "/usr/bin/rg")).toMatchObject({
      found: true,
      version: "16.0.0",
    });
  });

  test("nothing found says what was tried", () => {
    const found = resolveRipgrep(env(), answers({ "/usr/bin/rg": "ripgrep 14.1.1\n" }), (p) => p === "/usr/bin/rg");
    expect(found).toEqual({ found: false, tried: ["/usr/bin/rg is ripgrep 14.1.1; 15 or newer is needed"] });
  });

  test("parseRipgrepVersion reads the first line only", () => {
    expect(parseRipgrepVersion(RG15)).toBe("15.2.0");
    expect(parseRipgrepVersion("not ripgrep 15.2.0")).toBeUndefined();
  });
});

describe("startEvidenceRun", () => {
  const files = [{ filename: "src/new.ts", patch: "@@ -0,0 +1,2 @@\n+const a = markCopySeen(id);\n+startFileDrag(a);\n" }];
  const base = { repoDir: "/nowhere", batches: [files], log: () => {} };
  const never = () => {
    throw new Error("ripgrep must not be resolved");
  };

  test("with a runner the test injected there is no ripgrep search at all", async () => {
    const run = await startEvidenceRun({ ...base, customGit: true, ripgrep: never });
    expect(run.searcher).toBeUndefined();
    expect(run.tally.backend).toBe("git grep");
  });

  test("an error while starting the search falls back to git grep instead of ending the review", async () => {
    const logs: string[] = [];
    const run = await startEvidenceRun({ ...base, customGit: false, ripgrep: never, log: (l) => logs.push(l) });
    expect(run.searcher).toBeUndefined();
    expect(run.tally).toEqual({ backend: "git grep", searches: 0, ms: 0 });
    expect(logs).toEqual(["evidence: could not start the search (ripgrep must not be resolved); using git grep (slower)"]);
  });

  test("a batch with no symbol to search never resolves ripgrep and says nothing", async () => {
    const logs: string[] = [];
    const run = await startEvidenceRun({
      ...base,
      batches: [[{ filename: "README.md", patch: "@@\n+hello\n" }]],
      customGit: false,
      ripgrep: never,
      log: (l) => logs.push(l),
    });
    expect(run.searcher).toBeUndefined();
    expect(logs).toEqual([]);
  });

  test("without a qualifying ripgrep it falls back to git grep and logs one clear line", async () => {
    const logs: string[] = [];
    const run = await startEvidenceRun({
      ...base,
      customGit: false,
      ripgrep: () => ({ found: false, tried: ["rg did not answer --version (spawn rg ENOENT)"] }),
      log: (l) => logs.push(l),
    });
    expect(run.searcher).toBeUndefined();
    expect(run.tally.backend).toBe("git grep");
    expect(logs).toEqual(["evidence: ripgrep not found, using git grep (slower); run `wachiman setup`"]);
  });

  test("a skipped override is logged once when a later source works", async () => {
    const logs: string[] = [];
    const found: RipgrepFound = {
      path: "/h/bin/rg",
      version: "15.2.0",
      source: "installed",
      skipped: ["/opt/rg is ripgrep 14.1.1; 15 or newer is needed"],
    };
    const run = await startEvidenceRun({
      ...base,
      repoDir: temp("evidence-run-"),
      customGit: false,
      ripgrep: () => ({ found: true, ...found }),
      log: (l) => logs.push(l),
    });
    expect(run.searcher).toBeDefined();
    expect(logs[0]).toBe("evidence: /opt/rg is ripgrep 14.1.1; 15 or newer is needed; using ripgrep 15.2.0 (/h/bin/rg) instead");
    expect(logs.filter((l) => l.startsWith("evidence: /opt/rg"))).toHaveLength(1);
  });

  test("resolveRipgrep reports the sources it skipped before the one that works", () => {
    const hit = resolveRipgrep(
      { WACHIMAN_HOME: "/h", PATH: "/usr/bin", [RIPGREP_ENV]: "/opt/rg" },
      answers({ "/opt/rg": null, "/usr/bin/rg": RG15 }),
      (p) => p === "/usr/bin/rg",
    );
    expect(hit).toMatchObject({ found: true, source: "path", skipped: [expect.stringContaining("/opt/rg")] });
  });

  test("the warning names why an existing candidate was skipped", () => {
    expect(ripgrepMissingLine(["rg is ripgrep 14.1.1; 15 or newer is needed"])).toBe(
      "evidence: ripgrep not found, using git grep (slower); run `wachiman setup` (rg is ripgrep 14.1.1; 15 or newer is needed)",
    );
  });

  withRipgrep("with ripgrep it searches the names of every batch in one call before any batch runs", async () => {
    const dir = temp("evidence-run-");
    writeFileSync(join(dir, "other.ts"), "markCopySeen(1);\nstartFileDrag(2);\n");
    // A repository, so that `git check-attr` answers and the one log line is the search's own.
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
    const logs: string[] = [];
    const second = [{ filename: "src/two.ts", patch: "@@\n+  window.api.startFileDrag(x);\n+  refreshAll();\n" }];
    const run = await startEvidenceRun({
      ...base,
      repoDir: dir,
      batches: [files, second],
      customGit: false,
      ripgrep: () => ({
        found: true as const,
        path: (real as RipgrepFound).path,
        version: (real as RipgrepFound).version,
        source: (real as RipgrepFound).source,
      }),
      log: (l) => logs.push(l),
    });
    expect(run.tally.searches).toBe(1);
    expect(run.searcher!.search("startFileDrag", 1000)).toMatchObject({ matches: [{ file: "other.ts", line: 2 }] });
    expect(run.searcher!.search("refreshAll", 1000)).toEqual({ matches: [] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^evidence: ripgrep \d+\.\d+\.\d+ searched 3 name\(s\) in \d+ ms \(2 matching lines\)$/);
    // A later batch that needs a name nobody planned gets one more search; names already known are not searched again.
    await run.searcher!.ensure(["startFileDrag", "late"]);
    expect(run.tally.searches).toBe(2);
    expect(run.searcher!.search("late", 1000)).toEqual({ matches: [] });
    await run.searcher!.ensure(["startFileDrag", "late"]);
    expect(run.tally.searches).toBe(2);
  });
});

describe("EvidenceSearcher", () => {
  const found: RipgrepFound = { path: "/nonexistent/rg", version: "15.2.0", source: "env" };
  const tally = (): EvidenceTally => ({ backend: "ripgrep", searches: 0, ms: 0 });

  test("a ripgrep that fails turns the searcher unusable, once, and logs the fallback", async () => {
    const logs: string[] = [];
    const searcher = new EvidenceSearcher(found, temp("evidence-s-"), (l) => logs.push(l), tally());
    await searcher.ensure(["a"]);
    expect(searcher.usable).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("using git grep (slower)");
    await searcher.ensure(["b"]);
    expect(logs).toHaveLength(1);
  });

  test("a search that runs out of its time box turns the searcher unusable, so each batch uses git grep", async () => {
    const dir = temp("evidence-s-slow-");
    const slow = join(dir, "rg");
    writeFileSync(slow, "#!/bin/sh\nexec sleep 5\n");
    chmodSync(slow, 0o755);
    const logs: string[] = [];
    const searcher = new EvidenceSearcher({ ...found, path: slow }, dir, (l) => logs.push(l), tally(), { timeoutMs: 100 });
    await searcher.ensure(["a"]);
    expect(searcher.usable).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^evidence: ripgrep ran out of its 0\.1 s time box after \d+ ms; using git grep \(slower\)$/);
    // The next batch does not run rg again.
    await searcher.ensure(["b"]);
    expect(logs).toHaveLength(1);
  });

  test("after a failure a name already searched is served from memory and only a never-searched name falls back", async () => {
    const dir = temp("evidence-s-part-");
    const marker = join(dir, "ran");
    const script = join(dir, "rg");
    // The first run answers (no matches); every later run fails.
    writeFileSync(script, `#!/bin/sh\nif [ -e "${marker}" ]; then exit 2; fi\ntouch "${marker}"\nexit 1\n`);
    chmodSync(script, 0o755);
    const searcher = new EvidenceSearcher({ ...found, path: script }, dir, () => {}, tally());
    await searcher.ensure(["a"]);
    await searcher.ensure(["b"]);
    expect(searcher.usable).toBe(false);
    const asked: string[] = [];
    const search = searcher.withFallback((symbol) => {
      asked.push(symbol);
      return { matches: [] };
    });
    expect(search("a", 1000)).toEqual({ matches: [] });
    expect(asked).toEqual([]);
    search("b", 1000);
    expect(asked).toEqual(["b"]);
  });

  test("a name that was never searched is a failure, not an empty answer", () => {
    const searcher = new EvidenceSearcher(found, "/x", () => {}, tally());
    expect(searcher.search("never", 1000)).toEqual({ failed: "never was not searched" });
  });

  withRipgrep("concurrent calls are served one at a time and a name is searched once", async () => {
    const dir = temp("evidence-s-");
    writeFileSync(join(dir, "a.ts"), "alpha(1);\nbeta(2);\n");
    // A repository, so `git ls-files` answers and the first search succeeds.
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
    const t = tally();
    const searcher = new EvidenceSearcher(real as RipgrepFound, dir, () => {}, t);
    await Promise.all([searcher.ensure(["alpha", "beta"]), searcher.ensure(["alpha"]), searcher.ensure(["beta", "alpha"])]);
    expect(searcher.usable).toBe(true);
    expect(searcher.search("alpha", 1000)).toMatchObject({ matches: [{ file: "a.ts", line: 1 }] });
    expect(t.searches).toBe(1);
  });
});

// -----------------------------------------------------------------------------------------------
// The installer
// -----------------------------------------------------------------------------------------------

describe("the pinned table", () => {
  test("every platform has an asset of the pinned version and a SHA-256", () => {
    expect(Object.keys(RIPGREP_ASSETS).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
    for (const { asset, sha256 } of Object.values(RIPGREP_ASSETS)) {
      expect(asset).toContain(`ripgrep-${RIPGREP_VERSION}-`);
      expect(asset.endsWith(".tar.gz")).toBe(true);
      expect(sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(new Set(Object.values(RIPGREP_ASSETS).map((a) => a.sha256)).size).toBe(4);
  });

  test("the pin is a release the search was tested against, not the newest one", () => {
    expect(RIPGREP_VERSION).toBe("15.2.0");
  });
});

describe("installRipgrep", () => {
  /** A real .tar.gz with the layout of a ripgrep release: `<name>/rg`. */
  function archive(script = "#!/bin/sh\necho 'ripgrep 15.2.0 (rev fake)'\n") {
    const dir = temp("evidence-archive-");
    const name = "ripgrep-15.2.0-fake-linux";
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "rg"), script);
    chmodSync(join(dir, name, "rg"), 0o755);
    const made = Bun.spawnSync(["tar", "-czf", `${name}.tar.gz`, name], { cwd: dir });
    if (made.exitCode !== 0) throw new Error(made.stderr.toString());
    const bytes = new Uint8Array(readFileSync(join(dir, `${name}.tar.gz`)));
    return { bytes, asset: `${name}.tar.gz`, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  const homeEnv = () => ({ WACHIMAN_HOME: join(temp("evidence-home-"), ".wachiman"), PATH: "" });

  test("a download whose SHA-256 differs from the pinned one is refused, and nothing is written or made executable", async () => {
    const good = archive();
    const tampered = archive("#!/bin/sh\necho 'evil'\n");
    const env = homeEnv();
    const result = await installRipgrep(env, {
      platform: "linux",
      arch: "x64",
      assets: { "linux-x64": { asset: good.asset, sha256: good.sha256 } },
      download: async () => tampered.bytes,
    });
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toContain(`expected ${good.sha256}`);
    expect((result as { reason: string }).reason).toContain(`got ${tampered.sha256}`);
    expect(existsSync(env.WACHIMAN_HOME)).toBe(false);
  });

  test("a refusal leaves the binary that was already installed untouched", async () => {
    const good = archive();
    const env = homeEnv();
    mkdirSync(join(env.WACHIMAN_HOME, "bin"), { recursive: true });
    writeFileSync(join(env.WACHIMAN_HOME, "bin", "rg"), "OLD");
    const result = await installRipgrep(env, {
      platform: "linux",
      arch: "x64",
      assets: { "linux-x64": { asset: good.asset, sha256: good.sha256 } },
      download: async () => new Uint8Array([1, 2, 3]),
    });
    expect(result.status).toBe("refused");
    expect(readFileSync(join(env.WACHIMAN_HOME, "bin", "rg"), "utf8")).toBe("OLD");
  });

  test("a matching download is unpacked, made executable and installed under the Wachiman home", async () => {
    const good = archive();
    const env = homeEnv();
    const urls: string[] = [];
    const result = await installRipgrep(env, {
      platform: "linux",
      arch: "x64",
      assets: { "linux-x64": { asset: good.asset, sha256: good.sha256 } },
      releaseUrl: "https://example.test/releases/15.2.0",
      download: async (url) => (urls.push(url), good.bytes),
    });
    expect(urls).toEqual([`https://example.test/releases/15.2.0/${good.asset}`]);
    expect(result).toEqual({ status: "installed", path: join(env.WACHIMAN_HOME, "bin", "rg"), version: RIPGREP_VERSION });
    const target = join(env.WACHIMAN_HOME, "bin", "rg");
    expect(statSync(target).mode & 0o111).not.toBe(0);
    expect(Bun.spawnSync([target, "--version"]).stdout.toString()).toContain("ripgrep 15.2.0");
    // No staging file is left behind.
    expect(readdirSync(join(env.WACHIMAN_HOME, "bin"))).toEqual(["rg"]);
  });

  test("a temporary directory that cannot be made installs nothing and says why, never a throw", async () => {
    const good = archive();
    const env = homeEnv();
    const result = await withMissingTmpdir(() =>
      installRipgrep(env, {
        platform: "linux",
        arch: "x64",
        assets: { "linux-x64": { asset: good.asset, sha256: good.sha256 } },
        download: async () => good.bytes,
      }),
    );
    expect(result.status).toBe("unavailable");
    expect((result as { reason: string }).reason).toContain("could not install ripgrep");
    expect(existsSync(env.WACHIMAN_HOME)).toBe(false);
  });

  test("an unsupported platform and a failed download install nothing and say why", async () => {
    const env = homeEnv();
    expect(await installRipgrep(env, { platform: "freebsd", arch: "x64" })).toMatchObject({ status: "unsupported" });
    const down = await installRipgrep(env, {
      platform: "linux",
      arch: "x64",
      download: async () => {
        throw new Error("offline");
      },
    });
    expect(down).toMatchObject({ status: "unavailable" });
    expect((down as { reason: string }).reason).toContain("offline");
    expect(existsSync(env.WACHIMAN_HOME)).toBe(false);
  });

  test("an archive with no rg inside is unavailable, not installed", async () => {
    const dir = temp("evidence-archive-");
    mkdirSync(join(dir, "ripgrep-15.2.0-empty"));
    writeFileSync(join(dir, "ripgrep-15.2.0-empty", "README"), "x");
    Bun.spawnSync(["tar", "-czf", "e.tar.gz", "ripgrep-15.2.0-empty"], { cwd: dir });
    const bytes = new Uint8Array(readFileSync(join(dir, "e.tar.gz")));
    const result = await installRipgrep(homeEnv(), {
      platform: "linux",
      arch: "x64",
      assets: { "linux-x64": { asset: "ripgrep-15.2.0-empty.tar.gz", sha256: createHash("sha256").update(bytes).digest("hex") } },
      download: async () => bytes,
    });
    expect(result).toMatchObject({ status: "unavailable" });
  });
});

describe("ensureRipgrep", () => {
  const env = { WACHIMAN_HOME: "/h/.wachiman", PATH: "/usr/bin" };

  test("a bad WACHIMAN_HOME is an unavailable install, never a throw", async () => {
    const lines: string[] = [];
    const out = await ensureRipgrep({ WACHIMAN_HOME: "relative/home", PATH: "" }, (l) => lines.push(l), {
      probe: answers({}),
      exists: () => false,
    });
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("could not install ripgrep: WACHIMAN_HOME must be an absolute path"),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Reviews still work; the call-site evidence uses git grep");
  });

  test("a ripgrep that is already there is reported, and nothing is downloaded", async () => {
    const lines: string[] = [];
    const out = await ensureRipgrep(env, (l) => lines.push(l), {
      probe: answers({ "/usr/bin/rg": RG15 }),
      exists: (p) => p === "/usr/bin/rg",
      download: async () => {
        throw new Error("must not download");
      },
    });
    expect(out.ok).toBe(true);
    expect(lines).toEqual(["ripgrep 15.2.0 found (on PATH): /usr/bin/rg"]);
  });

  test("a missing one is announced before it is installed, with the pinned version and the directory", async () => {
    const lines: string[] = [];
    const out = await ensureRipgrep(env, (l) => lines.push(l), {
      probe: answers({}),
      exists: () => false,
      platform: "freebsd",
      arch: "x64",
    });
    expect(lines[0]).toBe("Installing ripgrep 15.2.0 (fast search for call-site evidence) into /h/.wachiman/bin...");
    // No build for this platform: not a failure, the review runs on git grep, and the line says so.
    expect(out.ok).toBe(true);
    expect(lines[1]).toContain("Reviews still work; the call-site evidence uses git grep");
  });

  test("a hash mismatch is the one outcome that is not ok", async () => {
    const lines: string[] = [];
    const out = await ensureRipgrep(env, (l) => lines.push(l), {
      probe: answers({}),
      exists: () => false,
      platform: "linux",
      arch: "x64",
      download: async () => new Uint8Array([9]),
    });
    expect(out.ok).toBe(false);
    expect(lines.at(-1)).toContain("ripgrep was NOT installed: SHA-256 mismatch");
  });
});

// -----------------------------------------------------------------------------------------------
// The differential test: the two backends must produce the same evidence
// -----------------------------------------------------------------------------------------------

const sym = (name: string, extra: Partial<PlannedSymbol> = {}): PlannedSymbol => ({
  name,
  kind: "call",
  qualified: false,
  files: ["src/new.ts"],
  occurrences: 1,
  ...extra,
});

/** Evidence of `plan` with `git grep`, and with ripgrep over the union of `allNames`, as the engine does; both serialized. */
async function bothBackends(repoDir: string, plan: EvidencePlan, batchFiles: string[], allNames: string[]) {
  const ctx = { repoDir, batchFiles };
  const viaGit = collectEvidence(plan, ctx, defaultEvidenceIo);
  const searcher = new EvidenceSearcher(real as RipgrepFound, repoDir, () => {}, { backend: "ripgrep", searches: 0, ms: 0 });
  await searcher.ensure(allNames);
  expect(searcher.usable).toBe(true);
  const viaRg = collectEvidence(plan, ctx, defaultEvidenceIo, undefined, searcher.search);
  return { git: viaGit, rg: viaRg, gitText: serializeEvidence(viaGit.doc), rgText: serializeEvidence(viaRg.doc) };
}

describe("differential: ripgrep and git grep give the same evidence", () => {
  function fixtureRepo() {
    const repo = temp("evidence-diff-");
    const write = (path: string, text: string | Uint8Array) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };
    const git = (...args: string[]) => {
      const run = Bun.spawnSync(["git", ...args], { cwd: repo, stderr: "pipe" });
      if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
    };
    write(
      "src/preload.ts",
      "export const api = {\n  startFileDrag: (p: string) => ipc.send('drag', p),\n};\nexport function formatDuration(ms: number) {\n  return ms;\n}\n",
    );
    write(
      "src/export-status-cards.tsx",
      "export function Card() {\n  const drag = () => {\n    markCopySeen(id);\n    window.electronAPI.startFileDrag(path);\n  };\n}\n",
    );
    write("src/new.ts", "formatDuration(1);\nstartFileDrag(2);\n");
    // Path order: byte order of the whole path, which the ranking tie-break follows.
    for (const p of [
      "src/a.ts",
      "src/a/b.ts",
      "src/a-b.ts",
      "src/a.b.ts",
      "src/A.ts",
      "src/a b.ts",
      "src/with space/c:o.ts",
      ".hidden/h.ts",
      "src/_u.ts",
    ]) {
      write(p, "const d = formatDuration(7);\n");
    }
    // More callers than the cap, tests among them, and mentions that are not calls.
    for (let i = 0; i < 9; i++) write(`src/pop${i}.ts`, `import { popular } from "./lib";\nconst v = popular(${i});\n`);
    // The only call of a name far into one very long line (a minified bundle): the ranking must see the whole text.
    write("src/minified.ts", `${"x ".repeat(60_000)}popular(99);\n`);
    write("src/popular.test.ts", "popular(1);\n");
    write("test/popular.ts", "popular(2);\n");
    write("src/mention.ts", "const ref = popular;\n// popular(3) in a comment\n/* popular(4) */\n * popular(5)\n# popular(6)\n");
    write("src/lib.ts", "export function popular(n: number) {\n  return n;\n}\n");
    write("src/both.ts", "markCopySeen(startFileDrag(1));\nconst s = $store(1) + $(el);\n");
    write("src/channel.ts", "ipc.send('recording-ready:show', id);\nipc.on(\"recording-ready:show\", cb);\n");
    write("src/words.ts", "xformatDuration(1); formatDuration_2(2); éformatDuration(3); formatDuration(4)é;\n");
    write("src/long.ts", `formatDuration(${"9".repeat(300)});\n`);
    write("src/crlf.ts", "line one\r\nformatDuration(1);\r\nline three\r\n");
    write("src/defs.ts", "class Widget {\n  render(): void {\n  }\n}\nconst helper = () => 1;\nhelper();\n");
    write("go/main.go", "func formatDuration(ms int) int { return ms }\nfunc run() { formatDuration(2) }\n");
    // None of these is searched.
    write("node_modules/dep/index.ts", "formatDuration(1); popular(1);\n");
    write("vendor/v.ts", "formatDuration(1);\n");
    write("sub/dist/d.ts", "formatDuration(1);\n");
    write("build/b.ts", "formatDuration(1);\n");
    write(".next/n.ts", "formatDuration(1);\n");
    write("src/x.min.js", "formatDuration(1);\n");
    write("src/types.d.ts", "declare function formatDuration(): void;\n");
    write("README.md", "formatDuration is documented\n");
    write("src/bin.ts", Buffer.from("formatDuration(1)\0binary"));
    write("src/late-nul.ts", `formatDuration(1)\n${"// pad\n".repeat(2000)}\0\nformatDuration(2)\n`);
    write("src/utf16.ts", Buffer.from("\xff\xfef\0o\0r\0m\0a\0t\0D\0u\0r\0a\0t\0i\0o\0n\0(\0)\0\n\0", "latin1"));
    git("init", "-q");
    git("add", "-A", "-f");
    return repo;
  }

  const plans: { name: string; symbols: PlannedSymbol[]; batchFiles: string[] }[] = [
    {
      name: "a call and its definition",
      symbols: [sym("formatDuration"), sym("startFileDrag", { qualified: true, qualifier: "window.electronAPI.startFileDrag" })],
      batchFiles: ["src/new.ts"],
    },
    { name: "more callers than the cap", symbols: [sym("popular")], batchFiles: [] },
    {
      name: "names on the same line",
      symbols: [sym("markCopySeen"), sym("startFileDrag"), sym("$store"), sym("$")],
      batchFiles: ["src/new.ts"],
    },
    { name: "channel names", symbols: [sym("recording-ready:show", { kind: "channel" })], batchFiles: [] },
    {
      name: "a name nothing else holds, and one only a definition holds",
      symbols: [sym("nobodyCallsThis"), sym("Widget"), sym("helper")],
      batchFiles: [],
    },
    {
      name: "the batch's own files are dropped",
      symbols: [sym("formatDuration")],
      batchFiles: ["src/a.ts", "src/a/b.ts", "src/new.ts", "src/preload.ts"],
    },
  ];

  withRipgrep("every plan gives byte-identical evidence.json, whatever else the search carries", async () => {
    const repo = fixtureRepo();
    // The union holds names no plan below uses, as the union of a whole review does.
    const union = [...new Set([...plans.flatMap((p) => p.symbols.map((s) => s.name)), "spare", "formatDuration_2"])];
    for (const plan of plans) {
      const result = await bothBackends(repo, { symbols: plan.symbols, omitted: [] }, plan.batchFiles, union);
      expect(result.rgText, plan.name).toBe(result.gitText);
      expect(result.rg.warnings, plan.name).toEqual(result.git.warnings);
    }
  });

  withRipgrep("git attributes decide what is binary, as for git grep -I", async () => {
    const repo = temp("evidence-attr-");
    const git = (...args: string[]) => {
      const run = Bun.spawnSync(["git", ...args], { cwd: repo, stderr: "pipe" });
      if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
    };
    const write = (path: string, text: string | Uint8Array) => writeFileSync(join(repo, path), text);
    write(".gitattributes", "a.ts binary\nb.ts -diff\nc.js diff\nd.js diff=custom\n");
    write("a.ts", "formatDuration(1)\n");
    write("b.ts", "formatDuration(2)\n");
    write("c.js", "formatDuration(3)\0x\n");
    write("d.js", "formatDuration(4)\0x\n");
    write("e.ts", "formatDuration(5)\0x\n");
    write("f.ts", "formatDuration(6)\n");
    git("init", "-q");
    git("add", "-A", "-f");
    const plan = { symbols: [sym("formatDuration")], omitted: [] };
    const { git: viaGit, rg, gitText, rgText } = await bothBackends(repo, plan, [], ["formatDuration"]);
    expect(rgText).toBe(gitText);
    const files = viaGit.doc.symbols[0].call_sites.map((c) => c.file).sort();
    expect(files).toEqual(["c.js", "f.ts"]);
    expect(rg.doc.symbols[0].call_sites.map((c) => c.file).sort()).toEqual(files);
  });

  withRipgrep("the fixture exercises what it claims: sites, definitions, truncation, ranking", async () => {
    const repo = fixtureRepo();
    const [one] = plans;
    const { rg } = await bothBackends(repo, { symbols: one.symbols, omitted: [] }, one.batchFiles, [
      "formatDuration",
      "startFileDrag",
      "popular",
    ]);
    const duration = rg.doc.symbols.find((s) => s.symbol === "formatDuration")!;
    expect(duration.definition_guess).toMatchObject({ file: "go/main.go" });
    expect(duration.status).toBe("truncated");
    expect(duration.call_sites).toHaveLength(6);
    // The hidden directory is searched, and its file ranks first among equals by path order.
    expect(duration.call_sites[0].file).toBe(".hidden/h.ts");
    const popular = (await bothBackends(repo, { symbols: [sym("popular")], omitted: [] }, [], ["popular"])).rg.doc.symbols[0];
    expect(popular.call_sites.some((c) => c.file.includes("test"))).toBe(false);
    expect(popular.total_matches).toBeGreaterThan(9);
    expect(popular.call_sites.map((c) => c.file)).toContain("src/minified.ts");
    expect(rg.doc.symbols.map((s) => s.symbol)).toContain("startFileDrag");
  });

  withRipgrep("a search that was never run fails the way a failing git grep does", async () => {
    const repo = fixtureRepo();
    const searcher = new EvidenceSearcher(real as RipgrepFound, repo, () => {}, { backend: "ripgrep", searches: 0, ms: 0 });
    // Never searched: the lookup fails the way a failing git grep does, and the rest is not searched.
    const plan = { symbols: [sym("formatDuration"), sym("popular")], omitted: [] };
    const { doc, warnings } = collectEvidence(plan, { repoDir: repo, batchFiles: [] }, defaultEvidenceIo, undefined, searcher.search);
    expect(warnings).toEqual(["Call-site evidence skipped: formatDuration was not searched"]);
    expect(doc.not_searched).toEqual(["formatDuration", "popular"]);
    expect(doc.status).toBe("truncated");
  });

  withRipgrep("after a timed-out rg run the evidence document is the git backend's", async () => {
    const repo = fixtureRepo();
    const slow = join(temp("evidence-slow-"), "rg");
    writeFileSync(slow, "#!/bin/sh\nexec sleep 5\n");
    chmodSync(slow, 0o755);
    const logs: string[] = [];
    const searcher = new EvidenceSearcher(
      { ...(real as RipgrepFound), path: slow },
      repo,
      (l) => logs.push(l),
      {
        backend: "ripgrep",
        searches: 0,
        ms: 0,
      },
      { timeoutMs: 100 },
    );
    const plan = { symbols: [sym("formatDuration"), sym("popular")], omitted: [] };
    await searcher.ensure(plan.symbols.map((s) => s.name));
    expect(searcher.usable).toBe(false);
    expect(logs[0]).toContain("ran out of its 0.1 s time box");
    const ctx = { repoDir: repo, batchFiles: [] as string[] };
    // The engine's path after the failure: every name is new to the searcher, so each goes to git grep.
    const viaFallback = collectEvidence(
      plan,
      ctx,
      defaultEvidenceIo,
      undefined,
      searcher.withFallback(gitSymbolSearch(defaultEvidenceIo, repo)),
    );
    const viaGit = collectEvidence(plan, ctx, defaultEvidenceIo);
    expect(serializeEvidence(viaFallback.doc)).toBe(serializeEvidence(viaGit.doc));
    expect(viaFallback.warnings).toEqual(viaGit.warnings);
    expect(viaGit.doc.symbols.length).toBeGreaterThan(0);
  });

  // The same comparison over a real code base: this repository at HEAD, extracted so that
  // uncommitted files (which git grep ignores and ripgrep would read) cannot differ.
  withRipgrep(
    "every batch of a review of this repository's own sources agrees",
    async () => {
      const root = join(import.meta.dir, "..");
      const archived = Bun.spawnSync(["git", "-c", "core.quotepath=off", "archive", "--format=tar", "HEAD"], { cwd: root, stderr: "pipe" });
      // Not a git checkout (a packed install): nothing to compare, but CI must never skip this silently.
      if (process.env.CI) expect(archived.exitCode).toBe(0);
      else if (archived.exitCode !== 0) return;
      const repo = temp("evidence-self-");
      const unpacked = Bun.spawnSync(["tar", "-x", "-C", repo], { stdin: archived.stdout });
      expect(unpacked.exitCode).toBe(0);
      for (const args of [
        ["init", "-q"],
        ["add", "-A", "-f"],
      ])
        expect(Bun.spawnSync(["git", ...args], { cwd: repo }).exitCode).toBe(0);

      const sources = readdirSync(join(repo, "src"))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .sort();
      // Batches of three files, each planned from the whole text of its files as if every line were added.
      const batches: { files: string[]; plan: EvidencePlan }[] = [];
      for (let i = 0; i < sources.length; i += 3) {
        const files = sources.slice(i, i + 3).map((f) => `src/${f}`);
        const plan = planEvidence(
          files.map((filename) => ({ filename, addedLines: readFileSync(join(repo, filename), "utf8").split("\n") })),
        );
        if (plan.symbols.length > 0) batches.push({ files, plan });
      }
      expect(batches.length).toBeGreaterThan(5);
      const union = [...new Set(batches.flatMap((b) => b.plan.symbols.map((s) => s.name)))];
      const searcher = new EvidenceSearcher(real as RipgrepFound, repo, () => {}, { backend: "ripgrep", searches: 0, ms: 0 });
      await searcher.ensure(union);
      expect(searcher.usable).toBe(true);
      let compared = 0;
      let sites = 0;
      for (const { files, plan } of batches) {
        const ctx = { repoDir: repo, batchFiles: files };
        const viaGit = collectEvidence(plan, ctx, defaultEvidenceIo);
        const viaRg = collectEvidence(plan, ctx, defaultEvidenceIo, undefined, searcher.search);
        expect(serializeEvidence(viaRg.doc), files.join(",")).toBe(serializeEvidence(viaGit.doc));
        compared += 1;
        sites += viaGit.doc.symbols.reduce((n, e) => n + e.call_sites.length, 0);
      }
      expect(compared).toBe(batches.length);
      expect(sites).toBeGreaterThan(20);
    },
    120_000,
  ); // one git grep per name per batch is the slow side of this comparison
});
