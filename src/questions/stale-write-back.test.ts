import { describe, expect, test } from "bun:test";
import { QUESTION } from "./stale-write-back";

const SRC = "apps/kaipu-record/src/main/workspaces/registry.ts";
const lines = (block: string): string[] => block.split("\n");

// Real added lines, kaipu-record #478, head 07a47af (first Wachiman review; Pullfrog found the
// overwrite), file apps/kaipu-record/src/main/workspaces/registry.ts. The upgrade marks the
// entry `pendingIdentity`; `availability()` then writes the cached name and colour over the
// folder's file without comparing the name that file holds now.
const PR478_07A47AF_AVAILABILITY = `        if (entry.pendingIdentity && !this.readOnly) {
          // Edited while the folder was away: the registry is newer, so the file catches up.
          try {
            await writeIdentity(entry.path, {
              ...identity.identity,
              name: entry.name,
              color: entry.color,
              ...(entry.initials ? { initials: entry.initials } : {}),
            });
            await this.refresh(() => void delete entry.pendingIdentity);
          } catch {
            // stays pending; the next probe tries again
          }
          return { availability: { state: "available" }, id };
        }`;

// Real added lines, kaipu-record #478, head 07a47af, same file: the one-time upgrade that
// queues the write above. It has no write call of its own (the write is in `availability`).
const PR478_07A47AF_UPGRADE = `  private async upgradeDefaultColor(): Promise<void> {
    const owner = this.get(this.key.legacyCloudOwnerId);
    let upgrade = owner?.name === DEFAULT_WORKSPACE_NAME && owner.color === "rose";
    if (owner && upgrade) {
      const file = await readIdentity(owner.path);
      // The folder's own file wins; a probe will refresh the cache from it.
      if (file.kind === "ok" && file.identity.color !== "rose") upgrade = false;
      if (file.kind === "unreadable") upgrade = false;
    }
    try {
      await this.update((key) => {
        key.kaipuColorApplied = true;
        if (owner && upgrade) {
          owner.color = DEFAULT_WORKSPACE_COLOR;
          owner.pendingIdentity = true;
        }
      });
    } catch (error) {
      // preferences.json could not be written: retried on the next launch.
      console.error("workspaces: could not store the color upgrade", error);
      return;
    }
    if (owner && upgrade) await this.availability(owner.id);
  }`;

// Real added lines, kaipu-record #478, head 649c902 (Wachiman Inc-2, found no problem; CodeRabbit
// then found the deferred case). File: same registry.ts. The diff adds only the name comparison.
// The write the unplugged-folder case goes through is in unchanged code, so only rule B sees it.
const PR478_649C902 = `      // The folder's own file wins (renamed or recolored on another Mac): leave it as it is,
      // and a probe will refresh this Mac's cache from it.
      if (
        file.kind === "ok" &&
        (file.identity.color !== "rose" || file.identity.name !== DEFAULT_WORKSPACE_NAME)
      ) {
        upgrade = false;
      }`;

describe("stale-write-back question", () => {
  test("is a well-formed question", () => {
    expect(QUESTION.id).toBe("stale-write-back");
    expect(QUESTION.title.length).toBeGreaterThan(0);
    expect(QUESTION.title).not.toContain("\n");
    expect(QUESTION.text.trim().split(/\s+/).length).toBeLessThanOrEqual(120);
    expect(QUESTION.text).not.toMatch(/^\s*#/);
    expect(QUESTION.text).not.toContain("\n#");
  });

  describe("fires on the real #478 code", () => {
    test("07a47af: pendingIdentity branch writes cached values to the folder's file", () => {
      expect(QUESTION.applies(lines(PR478_07A47AF_AVAILABILITY), SRC)).toBe(true);
    });

    test("07a47af: the whole upgrade plus the write-back, as one batch sees them", () => {
      const batch = [...lines(PR478_07A47AF_UPGRADE), ...lines(PR478_07A47AF_AVAILABILITY)];
      expect(QUESTION.applies(batch, SRC)).toBe(true);
    });

    test("07a47af: the upgrade alone has no write nor another-writer wording, so it stays off", () => {
      // The honest limit: without the write-back in the diff there is only a remembered-state
      // word. The batch that adds the write is where the question rides.
      expect(QUESTION.applies(lines(PR478_07A47AF_UPGRADE), SRC)).toBe(false);
    });

    test("649c902: a guard that admits 'another Mac' and a cache fires, though no write is in the diff", () => {
      expect(QUESTION.applies(lines(PR478_649C902), SRC)).toBe(true);
    });
  });

  describe("rule A: remembered value and a persistent write", () => {
    test.each([
      [
        "a deferred snapshot written to a file",
        ["const snapshot = readCache();", "await writeFile(path, JSON.stringify(snapshot));"],
      ],
      [
        "a cached value put in a settings store",
        ["const cachedName = entry.name;", "localStorage.setItem('name', cachedName);"],
      ],
      [
        "an offline queue flushed with SQL",
        [
          "for (const pendingEdit of offlineQueue) {",
          "  db.run(`UPDATE docs SET title = ? WHERE id = ?`, [pendingEdit.title, pendingEdit.id]);",
          "}",
        ],
      ],
      [
        "a reconnect handler replacing a file",
        ["onReconnect(() => {", "  fs.rename(tmp, target);", "});"],
      ],
    ])("%s", (_name, added) => {
      expect(QUESTION.applies(added, "src/sync.ts")).toBe(true);
    });

    test("signals farther apart than the window do not count", () => {
      const filler = Array.from({ length: 60 }, (_, i) => `const x${i} = ${i};`);
      const added = ["const cached = read();", ...filler, "await writeFile(path, data);"];
      expect(QUESTION.applies(added, "src/a.ts")).toBe(false);
    });
  });

  describe("rule B: another writer named next to remembered state", () => {
    test("a comment about another device next to a cache", () => {
      const added = [
        "// The other device may have renamed it; our cache is refreshed on the next probe.",
        "refreshCache();",
      ];
      expect(QUESTION.applies(added, "src/a.ts")).toBe(true);
    });

    test("another writer with no remembered value near it stays off", () => {
      const added = ["// another window may close this dialog", "dialog.close();"];
      expect(QUESTION.applies(added, "src/a.tsx")).toBe(false);
    });
  });

  describe("never fires on", () => {
    test("a React state update from a cached query", () => {
      const added = [
        "const cached = queryClient.getQueryData<Item[]>(['items']);",
        "const [items, setItems] = useState(cached ?? []);",
        "useEffect(() => {",
        "  if (data) setItems(data);",
        "}, [data]);",
        "const { data } = useQuery({ queryKey: ['items'], staleTime: 30_000 });",
      ];
      expect(QUESTION.applies(added, "src/renderer/items.tsx")).toBe(false);
    });

    test("a pure in-memory memo", () => {
      const added = [
        "const cache = new Map<string, number>();",
        "export function memoSize(key: string): number {",
        "  const cachedSize = cache.get(key);",
        "  if (cachedSize !== undefined) return cachedSize;",
        "  const size = compute(key);",
        "  cache.set(key, size);",
        "  return size;",
        "}",
        "const total = useMemo(() => cachedRows.reduce((a, r) => a + r.n, 0), [cachedRows]);",
      ];
      expect(QUESTION.applies(added, "src/memo.ts")).toBe(false);
    });

    test("CSS lines, even with cache- and pending-flavoured class names", () => {
      const added = [
        ".pending-badge { opacity: 0.5; }",
        ".cached { color: var(--tag); }",
        ".offline::after { content: 'write'; }",
      ];
      expect(QUESTION.applies(added, "src/renderer/badge.module.css")).toBe(false);
    });

    test("docs that describe the pattern", () => {
      const added = [
        "The pendingIdentity flag makes the registry call writeIdentity(path, cached) on reconnect,",
        "which can overwrite a rename made on another Mac.",
      ];
      expect(QUESTION.applies(added, "docs/specs/workspaces.md")).toBe(false);
      expect(QUESTION.applies(added, "README.mdx")).toBe(false);
      expect(QUESTION.applies(added, "config/settings.json")).toBe(false);
    });

    test("tests, even when they build the pattern", () => {
      for (const name of [
        "src/main/registry.test.ts",
        "src/main/registry.spec.tsx",
        "src/main/__tests__/registry.ts",
        "test/registry.ts",
        "pkg/sync_test.go",
      ]) {
        expect(QUESTION.applies(lines(PR478_07A47AF_AVAILABILITY), name)).toBe(false);
      }
    });

    test("a write with no remembered value near it", () => {
      expect(QUESTION.applies(["await writeFile(path, JSON.stringify(settings));"], "src/save.ts")).toBe(false);
    });

    test("clipboard and HTTP response writes", () => {
      expect(
        QUESTION.applies(["const cached = last;", "await navigator.clipboard.writeText(cached);"], "src/c.ts"),
      ).toBe(false);
      expect(
        QUESTION.applies(["const cachedBody = body;", "res.writeHead(200);", "res.write(cachedBody);"], "src/s.ts"),
      ).toBe(false);
    });

    test("a commented-out write", () => {
      expect(QUESTION.applies(["const cached = read();", "// await writeFile(path, cached);"], "src/a.ts")).toBe(false);
    });

    test("minified or generated lines", () => {
      const huge = `const cached=1;${"x".repeat(600)};writeFile(p,cached)`;
      expect(QUESTION.applies([huge], "src/bundle.js")).toBe(false);
    });

    test("an empty batch", () => {
      expect(QUESTION.applies([], "src/a.ts")).toBe(false);
    });
  });

  test("applies is pure and fast", () => {
    const added = lines(PR478_07A47AF_AVAILABILITY);
    const copy = [...added];
    expect(QUESTION.applies(added, SRC)).toBe(QUESTION.applies(added, SRC));
    expect(added).toEqual(copy);
    const big = Array.from({ length: 20_000 }, (_, i) => `const value${i} = compute(${i});`);
    const start = performance.now();
    QUESTION.applies(big, "src/big.ts");
    expect(performance.now() - start).toBeLessThan(250);
  });
});
