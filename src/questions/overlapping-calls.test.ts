import { describe, expect, test } from "bun:test";
import { QUESTION } from "./overlapping-calls";

const SETTINGS_FILE = "apps/kaipu-record/src/main/workspaces/workspace-settings.ts";

// Positive fixtures: the real added lines of kaipu-record, copied verbatim from the commits named
// on each one (the files were new in those pull requests, so every line was an added line).

// kaipu-record #482, commit 833ca60 (first reviewed head), workspace-settings.ts:218-248.
// `applyFolder` reads the file, awaits, writes it and records the hash; two edits of one
// workspace interleave and lose a key (audit D2/F10).
const APPLY_FOLDER_482: string[] = [
  "  private async applyFolder(",
  "    ws: { id: string; path: string },",
  "    keys: FolderOverrideKey[],",
  "    changes: Changes,",
  "  ): Promise<\"pending\" | \"unreadable\" | null> {",
  "    // Always from the disk: the cache may predate a sync.",
  "    const read = await this.read(ws.path);",
  "    this.reads.set(ws.id, read);",
  "    const state = folderState(read, this.deps.machine.get(ws.id).folderOverrides);",
  "    if (state === \"unreadable\") return \"unreadable\";",
  "    // The user has not seen these values: writing now would activate them by the back door.",
  "    if (state === \"pending\") return \"pending\";",
  "    // An ignored file is replaced by the keys this Mac now writes (spec, decision 26).",
  "    const base: FolderOverrides = state === \"active\" && read.kind === \"ok\" ? read.overrides : {};",
  "    const next: Record<string, unknown> = { ...base };",
  "    for (const key of keys) {",
  "      if (changes[key] === null) delete next[key];",
  "      else next[key] = changes[key];",
  "    }",
  "    const unchanged =",
  "      JSON.stringify(next) === JSON.stringify(base) &&",
  "      (state === \"active\" || Object.keys(next).length === 0);",
  "    if (unchanged) return null;",
  "    const sha256 = await writeFolderOverrides(ws.path, next as FolderOverrides);",
  "    this.reads.set(ws.id, { kind: \"ok\", overrides: next as FolderOverrides, sha256 });",
  "    await this.deps.machine.update(ws.id, (entry) => ({",
  "      ...entry,",
  "      folderOverrides: { sha256, decision: \"use\", at: this.deps.now() },",
  "    }));",
  "    return null;",
  "  }",
];

// kaipu-record #482, commit 833ca60, workspace-settings.ts:88-98.
// `refresh` caches a read after two awaits; a slow one can overwrite a newer write (F12-F15).
const REFRESH_482: string[] = [
  "  async refresh(id: string): Promise<void> {",
  "    const ws = this.known(id);",
  "    if (!ws) return;",
  "    const before = JSON.stringify(this.overridesOf(id));",
  "    this.reads.set(",
  "      id,",
  "      (await this.deps.isAvailable(id)) ? await this.read(ws.path) : { kind: \"unreadable\" },",
  "    );",
  "    if (id === this.deps.activeId() && before !== JSON.stringify(this.overridesOf(id))) {",
  "      this.deps.changed();",
  "    }",
];

// kaipu-record #449, commit 1eb06389 (the commit Wachiman reviewed), registry.ts:507-518.
// `setActive` sets `this.key.activeId`, awaits `persist`, then rolls back (audit F4, second scenario).
const SET_ACTIVE_449: string[] = [
  "  async setActive(id: string): Promise<void> {",
  "    if (this.readOnly) throw new Error(\"workspaces: preferences are read-only this session\");",
  "    if (!this.get(id)) throw new Error(`workspaces: unknown workspace ${id}`);",
  "    const previous = this.key.activeId;",
  "    this.key.activeId = id;",
  "    try {",
  "      await this.persist({ mirrorVault: true });",
  "    } catch (error) {",
  "      this.key.activeId = previous;",
  "      throw error;",
  "    }",
  "  }",
];

// kaipu-record #449, commit 1eb06389, index.ts:99-140. `requireCaptureWorkspace` and `listState`
// compare the probed id with the gate stamp after an `await`; `rebindAfterAdoption` rewrites the
// gate (audit F4, the check Wachiman did find: the positive example of this reasoning).
const ADOPTION_449: string[] = [
  "",
  "/**",
  " * The active workspace, checked to be connected, for a capture that is about to start.",
  " * Throws `WorkspaceNotConnectedError` otherwise; a switch in progress counts as stale.",
  " */",
  "export async function requireCaptureWorkspace(): Promise<WorkspaceEntry> {",
  "  const reg = requireRegistry();",
  "  if (workspaceGate().switching) throw new StaleWorkspaceError();",
  "  const active = reg.active();",
  "  const { availability, id } = await reg.availability(active.id);",
  "  if (id !== workspaceGate().stamp.workspaceId) rebindAfterAdoption(id);",
  "  if (availability.state !== \"available\") throw new WorkspaceNotConnectedError(active.name);",
  "  return reg.active();",
  "}",
  "",
  "/** Every workspace whose folder is reachable, for the startup and quit sweeps. */",
  "export async function availableWorkspacePaths(): Promise<string[]> {",
  "  const reg = requireRegistry();",
  "  const paths: string[] = [];",
  "  // A copy: a probe may update an entry (a pending one adopting its folder's id).",
  "  for (const entry of reg.entries().slice()) {",
  "    const { availability } = await reg.availability(entry.id);",
  "    if (availability.state === \"available\") paths.push(entry.path);",
  "  }",
  "  return paths;",
  "}",
  "",
  "/** A pending active entry adopted its folder's id: windows must take the new stamp. */",
  "function rebindAfterAdoption(id: string): void {",
  "  workspaceGate().rebind(id);",
  "  void broadcastState();",
  "}",
  "",
  "async function listState(): Promise<WorkspacesState> {",
  "  const reg = requireRegistry();",
  "  const views: WorkspaceView[] = [];",
  "  for (const entry of reg.entries().slice()) {",
  "    const { availability, id } = await reg.availability(entry.id);",
  "    if (entry.id === reg.active().id && id !== workspaceGate().stamp.workspaceId) {",
  "      rebindAfterAdoption(id);",
  "    }",
  "    const count =",
];

describe("overlapping-calls: applies to real shared-state writes around an await", () => {
  test("kaipu-record #482 applyFolder (read, await, write, record)", () => {
    expect(QUESTION.applies(APPLY_FOLDER_482, SETTINGS_FILE)).toBe(true);
  });

  test("kaipu-record #482 refresh (cache set after awaits)", () => {
    expect(QUESTION.applies(REFRESH_482, SETTINGS_FILE)).toBe(true);
  });

  test("kaipu-record #449 setActive (field set, await persist, roll back)", () => {
    expect(QUESTION.applies(SET_ACTIVE_449, "apps/kaipu-record/src/main/workspaces/registry.ts")).toBe(true);
  });

  test("kaipu-record #449 adoption check (gate rebound after an await)", () => {
    expect(QUESTION.applies(ADOPTION_449, "apps/kaipu-record/src/main/workspaces/index.ts")).toBe(true);
  });

  test("small synthetic shapes: map set after await, file write after await, Python", () => {
    const mapWrite = ["const cache = new Map();", "export async function load(id) {", "  const v = await fetchOne(id);", "  cache.set(id, v);", "}"];
    const fileWrite = ["async function save(path, text) {", "  const old = await Bun.file(path).text();", "  await writeFile(path, old + text);", "}"];
    const pyWrite = ["async def save(path, text):", "    old = await read(path)", "    path.write_text(old + text)"];
    expect(QUESTION.applies(mapWrite, "src/cache.ts")).toBe(true);
    expect(QUESTION.applies(fileWrite, "src/save.js")).toBe(true);
    expect(QUESTION.applies(pyWrite, "app/save.py")).toBe(true);
  });
});

describe("overlapping-calls: stays quiet when there is no shared-state write", () => {
  test("a React component with await fetch and setState", () => {
    const component = [
      "export function Users() {",
      "  const [users, setUsers] = useState<User[]>([]);",
      "  const [loading, setLoading] = useState(true);",
      "  useEffect(() => {",
      "    (async () => {",
      "      const res = await fetch('/api/users');",
      "      const json = await res.json();",
      "      setUsers(json);",
      "      setLoading(false);",
      "    })();",
      "  }, []);",
      "  return <List items={users} loading={loading} />;",
      "}",
    ];
    expect(QUESTION.applies(component, "src/components/Users.tsx")).toBe(false);
  });

  test("a React class component that calls this.setState after an await", () => {
    const lines = ["async componentDidMount() {", "  const res = await fetch(this.props.url);", "  this.setState({ data: await res.json() });", "}"];
    expect(QUESTION.applies(lines, "src/Legacy.jsx")).toBe(false);
  });

  test("a pure async helper with local variables only", () => {
    const helper = [
      "export async function readConfig(path: string): Promise<Config> {",
      "  const text = await Bun.file(path).text();",
      "  const parsed = JSON.parse(text);",
      "  const out: Record<string, unknown> = {};",
      "  for (const key of Object.keys(parsed)) out[key] = parsed[key];",
      "  return out as Config;",
      "}",
    ];
    expect(QUESTION.applies(helper, "src/config.ts")).toBe(false);
  });

  test("constructor injection next to an await is not shared-state mutation", () => {
    const lines = [
      "class Service {",
      "  constructor(deps: Deps) {",
      "    this.deps = deps;",
      "    this.items = new Map();",
      "  }",
      "  async get(id: string) { return await this.deps.fetch(id); }",
      "}",
    ];
    expect(QUESTION.applies(lines, "src/service.ts")).toBe(false);
  });

  test("a store write without any await", () => {
    expect(QUESTION.applies(["export function put(id, v) {", "  cache.set(id, v);", "}"], "src/cache.ts")).toBe(false);
  });

  test("an await that only appears in a comment", () => {
    expect(QUESTION.applies(["// we await the read, then cache.set(id, v)", "cache.set(id, v);"], "src/cache.ts")).toBe(false);
  });

  test("CSS, markdown, JSON and YAML lines", () => {
    const css = [".panel { display: flex; }", "/* await the layout, then this.cache.set */", ".panel > .row { gap: 4px; }"];
    const docs = ["## Caching", "We await the read and then call `cache.set(id, value)`.", "- `this.reads.set(id, read)` after the await"];
    expect(QUESTION.applies(css, "src/panel.css")).toBe(false);
    expect(QUESTION.applies(docs, "docs/caching.md")).toBe(false);
    expect(QUESTION.applies(docs, "package.json")).toBe(false);
    expect(QUESTION.applies(docs, ".github/workflows/ci.yml")).toBe(false);
  });

  test("the same code in a test file or declaration file", () => {
    expect(QUESTION.applies(APPLY_FOLDER_482, "src/workspace-settings.test.ts")).toBe(false);
    expect(QUESTION.applies(APPLY_FOLDER_482, "src/__tests__/settings.ts")).toBe(false);
    expect(QUESTION.applies(APPLY_FOLDER_482, "src/settings.d.ts")).toBe(false);
  });

  test("comparisons and arrow functions are not assignments", () => {
    const lines = ["if (this.state.ready === true) await go();", "const f = this.handler => 1;", "if (this.a >= 1 && this.b != 2) await go();"];
    expect(QUESTION.applies(lines, "src/x.ts")).toBe(false);
  });

  test("empty input", () => {
    expect(QUESTION.applies([], "src/x.ts")).toBe(false);
  });
});

describe("overlapping-calls: the question itself", () => {
  test("id and shape", () => {
    expect(QUESTION.id).toBe("overlapping-calls");
    expect(QUESTION.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(QUESTION.title.length).toBeGreaterThan(0);
    expect(QUESTION.title).not.toContain("\n");
  });

  test("text is at most 120 words, plain prose with no heading", () => {
    const words = QUESTION.text.trim().split(/\s+/);
    expect(words.length).toBeLessThanOrEqual(120);
    expect(QUESTION.text).not.toMatch(/^\s*#/m);
  });

  test("applies is pure and fast on a large batch", () => {
    const big = Array.from({ length: 20000 }, (_, i) => `  const value${i} = compute(${i}, "some text to scan");`);
    const before = [...big];
    const start = performance.now();
    QUESTION.applies(big, "src/big.ts");
    expect(performance.now() - start).toBeLessThan(500);
    expect(big).toEqual(before);
  });
});
