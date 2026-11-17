/**
 * Every release pin (`@vX.Y.Z`) in the install docs and the caller template must be kept current by
 * release-please, or be listed here with a reason. A pin is kept current when it sits between
 * `<!-- x-release-please-start-version -->` and `<!-- x-release-please-end -->` on lines of their own
 * (Markdown; the updater ignores an end marker on the same line as the start), or on a line that ends
 * with `<!-- x-release-please-version -->` (Markdown) or `# x-release-please-version` (YAML), and the file is in `extra-files` of
 * release-please-config.json. Without that, the pin goes stale on the first release after it is written.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PIN = /@v\d+\.\d+\.\d+/;
const START = "<!-- x-release-please-start-version -->";
const END = "<!-- x-release-please-end -->";
/** A marker counts only on a line of its own, as the updater needs; prose that quotes one does not. */
const isStart = (line: string) => line.trim() === START;
const isEnd = (line: string) => line.trim() === END;
const LINE = /(# |<!-- )x-release-please-version( -->)?\s*$/;

/** Pins that are deliberately not updated. `contains` must be found on the line, so a moved line still matches. */
const ALLOWLIST: { file: string; contains: string; reason: string }[] = [
  {
    file: "docs/releasing.md",
    contains: "`review.yml@v1.3.0`",
    reason: "Names the tag format in a sentence about why tags are a trust boundary; any exact tag would do.",
  },
  {
    file: "docs/releasing.md",
    contains: "`@v1.2.3` is the recommended pin",
    reason: "A format example (X.Y.Z), not a version a user copies.",
  },
];

function files(): string[] {
  const docs = readdirSync(join(ROOT, "docs"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => `docs/${n}`);
  const templates = readdirSync(join(ROOT, "templates"), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(ROOT.length + 1));
  return ["README.md", "SECURITY.md", ...docs, ...templates].filter((f) => existsSync(join(ROOT, f)));
}

/** Lines holding a pin that neither a marker block nor an annotation covers. */
export function unmanagedPins(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlock = false;
  text.split("\n").forEach((raw, i) => {
    const opens = isStart(raw);
    const closes = isEnd(raw);
    const covered = inBlock || opens || LINE.test(raw);
    if (opens && !closes) inBlock = true;
    if (closes) inBlock = false;
    if (PIN.test(raw) && !covered) out.push({ line: i + 1, text: raw });
  });
  return out;
}

describe("release pins are kept current by release-please", () => {
  const config = JSON.parse(readFileSync(join(ROOT, "release-please-config.json"), "utf8"));
  const extra: string[] = config.packages["."]["extra-files"].map((e: { path: string }) => e.path);

  test("every pin is marked or allowlisted", () => {
    const loose: string[] = [];
    for (const file of files()) {
      for (const hit of unmanagedPins(readFileSync(join(ROOT, file), "utf8"))) {
        const allowed = ALLOWLIST.some((a) => a.file === file && hit.text.includes(a.contains));
        if (!allowed) loose.push(`${file}:${hit.line}: ${hit.text.trim()}`);
      }
    }
    expect(loose, "wrap these in the release-please markers, or add them to ALLOWLIST with a reason").toEqual([]);
  });

  test("every file with a marker is listed in extra-files, and the reverse", () => {
    const marked = files().filter((f) => {
      const t = readFileSync(join(ROOT, f), "utf8");
      return t.split("\n").some(isStart) || /(# |<!-- )x-release-please-version( -->)?\s*$/m.test(t);
    });
    for (const f of marked) expect(extra, `${f} has markers but is not in extra-files`).toContain(f);
    for (const f of extra.filter((p) => p !== "src/init/options.ts")) {
      expect(marked, `${f} is in extra-files but has no marker`).toContain(f);
    }
  });

  // `src/init/options.ts` is left out on purpose: until a release pull request merges, the pins written for
  // the release being cut are ahead of DEFAULT_WORKFLOW_REF, which names the last release.
  test("every marked pin in the docs and the template names the same version", () => {
    const versions = new Set<string>();
    for (const f of extra.filter((p) => p.endsWith(".md") || p.endsWith(".yml"))) {
      let inBlock = false;
      for (const raw of readFileSync(join(ROOT, f), "utf8").split("\n")) {
        if (isStart(raw)) inBlock = true;
        else if (isEnd(raw)) inBlock = false;
        else if (inBlock || LINE.test(raw)) for (const m of raw.matchAll(/@v(\d+\.\d+\.\d+)/g)) versions.add(m[1]);
      }
    }
    expect([...versions], "a hand edit moved one marked pin away from the others").toHaveLength(1);
  });

  test("every start marker has an end marker", () => {
    for (const f of files()) {
      const t = readFileSync(join(ROOT, f), "utf8");
      const lines = t.split("\n");
      expect(lines.filter(isEnd).length, f).toBe(lines.filter(isStart).length);
    }
  });

  test("every allowlist entry still matches a line, and has a reason", () => {
    for (const a of ALLOWLIST) {
      expect(a.reason.length).toBeGreaterThan(10);
      const text = readFileSync(join(ROOT, a.file), "utf8");
      expect(text.includes(a.contains), `${a.file} no longer contains ${a.contains}`).toBe(true);
    }
  });

  test("the scanner finds an unmarked pin and ignores a marked one", () => {
    const text = [
      "uses: x/review.yml@v1.2.3",
      "<!-- x-release-please-start-version -->",
      "uses: x/review.yml@v1.2.3",
      "<!-- x-release-please-end -->",
      "uses: x/review.yml@v1.2.3 # x-release-please-version",
    ].join("\n");
    expect(unmanagedPins(text).map((h) => h.line)).toEqual([1]);
  });
});
