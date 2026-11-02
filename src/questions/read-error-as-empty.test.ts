import { describe, expect, test } from "bun:test";
import { QUESTION } from "./read-error-as-empty";

const TS = "src/store.ts";
const applies = (lines: string[], file = TS) => QUESTION.applies(lines, file);

// --- Real fixtures -----------------------------------------------------------------------------
// Added lines taken verbatim from kaipu-record, apps/kaipu-record/src/main/workspaces/
// settings-overrides.ts (read with `git diff` from a local clone; never edited).

// kaipu-record #482, commit 2bcd0a99 (introduced the file; 833ca60 left this class unchanged):
// `MachineSettingsStore.open` does `try { text = await readFile(file) } catch { return store; }`,
// and `update` -> `write` persists the in-memory map with `atomicWriteFile`. An existing but
// unreadable file became an empty store, and the next update wrote it over. Wachiman approved
// this code; the fix landed in d9accc88.

const MACHINE_STORE_AT_2BCD0A99: string[] = [
  "/**",
  " * `userData/workspace-settings.json`: the machine-bound `uploadMode` and the record of which",
  " * folder file this Mac accepted, per workspace id. Held in memory (reads are synchronous, since",
  " * the effective settings are asked for everywhere) and written atomically on every change.",
  " */",
  "export class MachineSettingsStore {",
  "  private entries = new Map<string, MachineEntry>();",
  "  private tail: Promise<unknown> = Promise.resolve();",
  "  private corrupt = false;",
  "",
  "  private constructor(private readonly file: string) {}",
  "",
  "  static async open(file: string): Promise<MachineSettingsStore> {",
  "    const store = new MachineSettingsStore(file);",
  "    let text: string;",
  "    try {",
  "      text = await readFile(file, \"utf-8\");",
  "    } catch {",
  "      return store;",
  "    }",
  "    try {",
  "      const parsed = JSON.parse(text) as { workspaces?: unknown };",
  "      const workspaces = parsed?.workspaces;",
  "      if (workspaces && typeof workspaces === \"object\") {",
  "        for (const [id, value] of Object.entries(workspaces)) {",
  "          const entry = sanitizeEntry(value);",
  "          if (Object.keys(entry).length > 0) store.entries.set(id, entry);",
  "        }",
  "      }",
  "    } catch {",
  "      // Unusable: start empty, and keep the file aside before the first write over it.",
  "      store.corrupt = true;",
  "    }",
  "    return store;",
  "  }",
  "",
  "  get(id: string): MachineEntry {",
  "    return this.entries.get(id) ?? {};",
  "  }",
  "",
  "  /** Apply `change` to one workspace's entry and write the file. Updates run one at a time. */",
  "  update(id: string, change: (entry: MachineEntry) => MachineEntry): Promise<void> {",
  "    const run = this.tail.then(async () => {",
  "      const next = change({ ...this.get(id) });",
  "      const previous = this.entries.get(id);",
  "      if (Object.keys(next).length === 0) this.entries.delete(id);",
  "      else this.entries.set(id, next);",
  "      try {",
  "        await this.write();",
  "      } catch (error) {",
  "        // The file did not change, so memory must not either.",
  "        if (previous) this.entries.set(id, previous);",
  "        else this.entries.delete(id);",
  "        throw error;",
  "      }",
  "    });",
  "    this.tail = run.catch(() => undefined);",
  "    return run;",
  "  }",
  "",
  "  private async write(): Promise<void> {",
  "    if (this.corrupt) {",
  "      await rename(this.file, `${this.file}.corrupt-${randomUUID().slice(0, 8)}`).catch(() => {});",
  "      this.corrupt = false;",
  "    }",
  "    const workspaces: Record<string, MachineEntry> = {};",
  "    for (const [id, entry] of this.entries) workspaces[id] = entry;",
  "    await atomicWriteFile(this.file, `${JSON.stringify({ version: 1, workspaces }, null, 2)}\\n`);",
  "  }",
  "}",
];

// kaipu-record #482, commit 2bcd0a99, same file: `readFolderOverrides`, `writeFolderOverrides`,
// `mkdirOne` and `isDirectory`. The folder-file read checks `code === "ENOENT"` and returns
// `unreadable` otherwise, so it is already correct and must not match.
const FOLDER_FILE_AT_2BCD0A99: string[] = [
  "/**",
  " * Read a folder's overrides. An unknown key, a key outside the four folder-bound ones",
  " * (`uploadMode` included) or an invalid value is ignored, and the file is never rewritten by",
  " * reading it. The hash covers the exact bytes, so any edit (sync, restore, a text editor)",
  " * changes it.",
  " */",
  "export async function readFolderOverrides(root: string): Promise<FolderRead> {",
  "  let bytes: Buffer;",
  "  try {",
  "    bytes = await readFile(join(root, SETTINGS_FILE));",
  "  } catch (error) {",
  "    return (error as NodeJS.ErrnoException).code === \"ENOENT\"",
  "      ? { kind: \"absent\" }",
  "      : { kind: \"unreadable\" };",
  "  }",
  "  let parsed: unknown;",
  "  try {",
  "    parsed = JSON.parse(bytes.toString(\"utf-8\"));",
  "  } catch {",
  "    return { kind: \"unreadable\" };",
  "  }",
  "  if (!parsed || typeof parsed !== \"object\") return { kind: \"unreadable\" };",
  "  const record = parsed as Record<string, unknown>;",
  "  const stored = record[\"overrides\"];",
  "  if (record[\"version\"] !== 1 || !stored || typeof stored !== \"object\" || Array.isArray(stored)) {",
  "    return { kind: \"unreadable\" };",
  "  }",
  "  const overrides: Record<string, unknown> = {};",
  "  for (const key of FOLDER_OVERRIDE_KEYS) {",
  "    if (!Object.hasOwn(stored, key)) continue;",
  "    const checked = normalizeOverride(key, (stored as Record<string, unknown>)[key]);",
  "    if (checked.ok) overrides[key] = checked.value;",
  "  }",
  "  return { kind: \"ok\", overrides: overrides as FolderOverrides, sha256: sha256Of(bytes) };",
  "}",
  "",
  "async function isDirectory(path: string): Promise<boolean> {",
  "  try {",
  "    return (await stat(path)).isDirectory();",
  "  } catch {",
  "    return false;",
  "  }",
  "}",
  "",
  "async function mkdirOne(path: string): Promise<boolean> {",
  "  try {",
  "    await mkdir(path);",
  "    return true;",
  "  } catch (error) {",
  "    if ((error as NodeJS.ErrnoException).code === \"EEXIST\") return false;",
  "    throw error;",
  "  }",
  "}",
  "",
  "/**",
  " * Write the folder's overrides atomically and return the sha256 of the written bytes, which",
  " * the caller records so this Mac's own edit never asks for confirmation. A missing root means",
  " * \"not connected\" and throws: recreating it would turn an unplugged drive into an empty folder.",
  " */",
  "export async function writeFolderOverrides(",
  "  root: string,",
  "  overrides: FolderOverrides,",
  "): Promise<string> {",
  "  if (!(await isDirectory(root))) {",
  "    throw Object.assign(new Error(`workspace folder is missing: ${root}`), { code: \"ENOENT\" });",
  "  }",
  "  const meta = join(root, \".kaipu\");",
  "  const dir = dirname(join(root, SETTINGS_FILE));",
  "  const createdMeta = await mkdirOne(meta);",
  "  let createdDir = false;",
  "  const text = `${JSON.stringify({ version: 1, overrides }, null, 2)}\\n`;",
  "  try {",
  "    createdDir = await mkdirOne(dir);",
  "    await atomicWriteFile(join(root, SETTINGS_FILE), text);",
  "  } catch (error) {",
  "    if (createdDir) await rmdir(dir).catch(() => {});",
  "    if (createdMeta) await rmdir(meta).catch(() => {});",
  "    throw error;",
  "  }",
  "  return sha256Of(text);",
  "}",
];

// kaipu-record #482, fix commit d9accc88, same file: "Only a missing file is empty; any other
// failure keeps it untouched." These are the lines it added to `MachineSettingsStore`.
const FIX_AT_D9ACCC88: string[] = [
  " *",
  " * `beforeWrite` receives the hash of the bytes about to be written, before the file changes: a",
  " * caller that records the hash there can never end with a new file and a stale record (which",
  " * would read as \"changed by sync\" and switch this Mac's own overrides off). If recording throws,",
  " * the file is untouched.",
  "  beforeWrite?: (sha256: string) => Promise<void>,",
  "  const text = `${JSON.stringify({ version: 1, overrides }, null, 2)}\\n`;",
  "  const sha256 = sha256Of(text);",
  "  await beforeWrite?.(sha256);",
  "  return sha256;",
  "  /** The file exists and could not be read (not \"absent\"): it must not be written over. */",
  "  private unreadable = false;",
  "    await store.load();",
  "    return store;",
  "  }",
  "",
  "  /** Read the file into memory. Only a missing file is \"empty\"; any other failure keeps it untouched. */",
  "  private async load(): Promise<void> {",
  "      text = await readFile(this.file, \"utf-8\");",
  "    } catch (error) {",
  "      this.entries = new Map();",
  "      this.corrupt = false;",
  "      this.unreadable = (error as NodeJS.ErrnoException).code !== \"ENOENT\";",
  "      return;",
  "    this.unreadable = false;",
  "    this.corrupt = false;",
  "    this.entries = new Map();",
  "          if (Object.keys(entry).length > 0) this.entries.set(id, entry);",
  "      this.corrupt = true;",
  "      // A file that could not be read last time is tried again: the failure may have passed. If",
  "      // it still cannot be read, nothing is written, so the other workspaces' records survive.",
  "      if (this.unreadable) {",
  "        await this.load();",
  "        if (this.unreadable)",
  "          throw new Error(`cannot update unreadable settings file: ${this.file}`);",
  "      }",
];

// The write that stayed unchanged context when a later PR touches only the read: the batch has a
// catch-to-default and no write, so the question does not apply (see the trade-off in the module).
const READ_ONLY_CATCH = MACHINE_STORE_AT_2BCD0A99.slice(
  MACHINE_STORE_AT_2BCD0A99.findIndex((l) => l.includes("static async open")),
  MACHINE_STORE_AT_2BCD0A99.findIndex((l) => l.includes("get(id: string)")),
);

describe("read-error-as-empty: the question", () => {
  test("has a stable id, a one-line title and plain prose of at most 120 words", () => {
    expect(QUESTION.id).toBe("read-error-as-empty");
    expect(QUESTION.title).not.toContain("\n");
    expect(QUESTION.text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(120);
    expect(QUESTION.text).not.toMatch(/^#/m);
  });

  test("names what to compare: missing versus unreadable, and the write that persists the default", () => {
    expect(QUESTION.text).toContain("ENOENT");
    expect(QUESTION.text).toMatch(/EACCES/);
    expect(QUESTION.text).toMatch(/written back|persists/);
  });
});

describe("read-error-as-empty: applies (real kaipu-record lines)", () => {
  test("matches MachineSettingsStore.open: catch { return store; } plus the atomic write (#482, 2bcd0a99)", () => {
    expect(applies(MACHINE_STORE_AT_2BCD0A99, "apps/kaipu-record/src/main/workspaces/settings-overrides.ts")).toBe(true);
  });

  test("does not match the same catch when the batch has no write (read-only change)", () => {
    expect(READ_ONLY_CATCH.some((l) => l.includes("return store;"))).toBe(true);
    expect(applies(READ_ONLY_CATCH)).toBe(false);
  });

  test("does not match the folder-file read that checks ENOENT, even with its write in the batch (#482, 2bcd0a99)", () => {
    expect(FOLDER_FILE_AT_2BCD0A99.some((l) => l.includes("atomicWriteFile"))).toBe(true);
    expect(applies(FOLDER_FILE_AT_2BCD0A99)).toBe(false);
  });

  test("does not match the fix that only treats ENOENT as empty (#482, d9accc88), write still in the batch", () => {
    const write = MACHINE_STORE_AT_2BCD0A99.slice(
      MACHINE_STORE_AT_2BCD0A99.findIndex((l) => l.includes("private async write")),
    );
    expect(applies([...FIX_AT_D9ACCC88, ...write])).toBe(false);
  });
});

describe("read-error-as-empty: applies (synthetic, illustrative)", () => {
  const write = ["await writeFile(path, JSON.stringify(cache));"];

  test("matches a try/catch around readFile that assigns an empty default", () => {
    expect(
      applies(["let cache = new Map();", "try {", "  cache = parse(await readFile(path, 'utf-8'));", "} catch {", "  cache = {};", "}", ...write]),
    ).toBe(true);
  });

  test("matches a one-line try/catch with the default in the catch", () => {
    expect(applies(["try { data = JSON.parse(readFileSync(f, 'utf8')); } catch { data = []; }", ...write])).toBe(true);
  });

  test("matches a .catch(() => default) on the read, on one line or across a chain", () => {
    expect(applies(["const text = await readFile(path, 'utf-8').catch(() => '{}');", ...write])).toBe(true);
    expect(applies(["const items = await Bun.file(path)", "  .json()", "  .catch(() => []);", ...write])).toBe(true);
    expect(applies(["const raw = await readFile(path, 'utf-8').catch(() => {});", ...write])).toBe(true);
  });

  test("matches a catch that only logs and falls through with the default", () => {
    expect(applies(["try {", "  state = load(await readFile(p));", "} catch (e) {", "  console.warn('no state', e);", "}", "this.save(state);"])).toBe(true);
  });

  test("matches a catch that returns undefined/null for a localStorage read", () => {
    expect(applies(["try {", "  return JSON.parse(localStorage.getItem(KEY));", "} catch {", "  return null;", "}", "localStorage.setItem(KEY, next);"])).toBe(true);
  });

  test("works for .js, .tsx and .mjs files", () => {
    const lines = ["try { x = readFileSync(f); } catch { x = []; }", ...write];
    for (const f of ["a.js", "ui/Panel.tsx", "scripts/run.mjs"]) expect(applies(lines, f)).toBe(true);
  });
});

describe("read-error-as-empty: never matches", () => {
  const write = ["await writeFile(path, JSON.stringify(cache));"];

  test("a catch that rethrows", () => {
    expect(applies(["try {", "  cache = await readFile(path, 'utf-8');", "} catch (error) {", "  throw error;", "}", ...write])).toBe(false);
    expect(applies(["try {", "  cache = await readFile(path, 'utf-8');", "} catch (e) {", "  throw new Error(`cannot read ${path}`, { cause: e });", "}", ...write])).toBe(false);
  });

  test("a catch that checks ENOENT or the error code", () => {
    expect(
      applies(["try {", "  text = await readFile(path, 'utf-8');", "} catch (error) {", "  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};", "  throw error;", "}", ...write]),
    ).toBe(false);
    expect(applies(["const t = await readFile(p, 'utf-8').catch((e) => {", "  if (e.code === 'ENOENT') return '';", "  throw e;", "});", ...write])).toBe(false);
    expect(applies(["try { t = readFileSync(p); } catch (e) { return e.code === 'ENOENT' ? {} : null; }", ...write])).toBe(false);
  });

  test("a catch that reports the failure as an error result", () => {
    expect(applies(["try {", "  b = await readFile(p);", "} catch {", "  return { kind: 'unreadable' };", "}", ...write])).toBe(false);
    expect(applies(["try {", "  b = await readFile(p);", "} catch (e) {", "  return { ok: false, error: String(e) };", "}", ...write])).toBe(false);
  });

  test("a catch around a read when nothing in the batch writes", () => {
    expect(applies(["try {", "  cache = await readFile(path, 'utf-8');", "} catch {", "  cache = {};", "}"])).toBe(false);
    expect(applies(["const items = await readFile(path, 'utf-8').catch(() => []);", "return items.length;"])).toBe(false);
  });

  test("a catch that is not around a read (parse, stat, rename, network write)", () => {
    expect(applies(["try {", "  v = JSON.parse(text);", "} catch {", "  v = {};", "}", ...write])).toBe(false);
    expect(applies(["try { return (await stat(p)).isDirectory(); } catch { return false; }", ...write])).toBe(false);
    expect(applies(["await rename(a, b).catch(() => {});", ...write])).toBe(false);
  });

  test("a read whose catch is separate from it", () => {
    expect(applies(["const a = await readFile(p, 'utf-8');", "cleanup().catch(() => {});", ...write])).toBe(false);
  });

  test("commented-out code and prose", () => {
    expect(applies(["// } catch { return {}; }  after readFile(p)", " * try { readFile(p) } catch { x = [] } then writeFile(p)"])).toBe(false);
  });

  test("UI, CSS, docs and config files, even with matching text", () => {
    const text = ["try { x = readFileSync(f); } catch { x = []; }", "writeFile(f, x);"];
    for (const f of ["styles/app.css", "README.md", "docs/adr/0002.md", "package.json", "ui/index.html", "tailwind.config.ts.snap", "notes.txt"]) {
      expect(applies(text, f)).toBe(false);
    }
  });

  test("test files: they read and write fixtures on purpose (2 of the 4 firings on the kaipu-record data PRs)", () => {
    const text = ["try { x = readFileSync(f); } catch { x = []; }", "writeFile(f, x);"];
    for (const f of [
      "apps/kaipu-record/src/main/workspaces/move-item.test.ts",
      "src/store.spec.ts",
      "test/store.ts",
      "src/__tests__/store.ts",
      "tests/e2e/store.ts",
    ])
      expect(applies(text, f)).toBe(false);
    expect(applies(text, "src/main/latest.ts")).toBe(true);
  });

  test("UI lines without a file read", () => {
    expect(
      applies([
        "const [open, setOpen] = useState(false);",
        "try {",
        "  await navigator.clipboard.writeText(link);",
        "} catch {",
        "  setCopied(false);",
        "}",
        ".panel { color: red; }",
        "<button onClick={() => save()}>Save</button>",
      ], "src/Panel.tsx"),
    ).toBe(false);
  });

  test("no lines", () => {
    expect(applies([])).toBe(false);
  });
});

describe("read-error-as-empty: cost", () => {
  test("applies is fast on a large batch", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `const value${i} = compute(${i}); // line ${i}`);
    const start = performance.now();
    expect(applies(lines)).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });

  test("applies is pure: same input, same answer, input untouched", () => {
    const lines = [...MACHINE_STORE_AT_2BCD0A99];
    const first = applies(lines);
    expect(applies(lines)).toBe(first);
    expect(lines).toEqual(MACHINE_STORE_AT_2BCD0A99);
  });
});
