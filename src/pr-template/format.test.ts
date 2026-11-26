import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "../config";
import { loadCatalog, loadRepoChoice } from "./catalog";
import { checkDescription, withLockedFromCatalog } from "./check";
import type { PrTemplateIo } from "./check-run";
import { parseDescription } from "./describe";
import { formatDescription, parseFormatArgs, runFormat } from "./format";
import { resolveTemplate } from "./resolve";

const here = join(import.meta.dir, "fixtures", "format");
const read = (name: string) => readFileSync(join(here, name), "utf8");

const catalog = loadCatalog();
const defaultTemplate = withLockedFromCatalog(resolveTemplate(catalog, null), catalog);
const customTemplate = withLockedFromCatalog(resolveTemplate(catalog, loadRepoChoice(read("custom-template.json"), catalog)), catalog);

const CASES: { name: string; template: typeof defaultTemplate; changes: boolean }[] = [
  { name: "in-order", template: defaultTemplate, changes: false },
  { name: "sections-shuffled", template: defaultTemplate, changes: true },
  { name: "status-rows-shuffled", template: defaultTemplate, changes: true },
  { name: "missing-required", template: defaultTemplate, changes: true },
  { name: "unknown-section", template: defaultTemplate, changes: true },
  { name: "unknown-section-new-notes", template: defaultTemplate, changes: true },
  { name: "unknown-details", template: defaultTemplate, changes: true },
  { name: "repo-comment", template: defaultTemplate, changes: true },
  { name: "wachiman-middle", template: defaultTemplate, changes: true },
  { name: "custom-template", template: customTemplate, changes: true },
];

/** Every non-blank line of `input`, exactly as written, must be in `output` at least as many times. */
function lostLines(input: string, output: string): string[] {
  const count = (text: string) => {
    const m = new Map<string, number>();
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (line.trim() !== "") m.set(line, (m.get(line) ?? 0) + 1);
    }
    return m;
  };
  const have = count(output);
  return [...count(input)].filter(([line, n]) => (have.get(line) ?? 0) < n).map(([line]) => line);
}

describe("parseFormatArgs", () => {
  test("a file, with or without --write, or no file at all", () => {
    expect(parseFormatArgs(["body.md"])).toEqual({ file: "body.md", write: false });
    expect(parseFormatArgs(["--write", "body.md"])).toEqual({ file: "body.md", write: true });
    expect(parseFormatArgs(["body.md", "--write"])).toEqual({ file: "body.md", write: true });
    expect(parseFormatArgs([])).toEqual({ write: false });
  });

  test("help in either spelling", () => {
    expect(parseFormatArgs(["--help"])).toEqual({ help: true });
    expect(parseFormatArgs(["body.md", "-h"])).toEqual({ help: true });
  });

  test("bad input is a usage error", () => {
    expect(() => parseFormatArgs(["--write"])).toThrow(UsageError);
    expect(() => parseFormatArgs(["--write"])).toThrow("--write needs a file");
    expect(() => parseFormatArgs(["a.md", "b.md"])).toThrow(UsageError);
    expect(() => parseFormatArgs(["--in-place", "a.md"])).toThrow(UsageError);
    expect(() => parseFormatArgs(["--write=yes", "a.md"])).toThrow(UsageError);
  });
});

describe("formatDescription on the fixtures", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const input = read(`${c.name}.md`);
      const output = formatDescription(input, c.template);

      test("gives the expected description", () => {
        expect(output).toBe(read(`${c.name}.expected.md`));
      });

      test("keeps every line of the input", () => {
        expect(lostLines(input, output)).toEqual([]);
      });

      test("is idempotent", () => {
        expect(formatDescription(output, c.template)).toBe(output);
      });

      test(c.changes ? "changes the description" : "returns it byte for byte", () => {
        if (c.changes) expect(output).not.toBe(input);
        else expect(output).toBe(input);
      });
    });
  }

  test("the output has no ordering problem left for check", () => {
    for (const c of CASES) {
      const result = checkDescription({
        body: formatDescription(read(`${c.name}.md`), c.template),
        title: "fix: label",
        template: c.template,
        catalog,
      });
      const codes = result.findings.map((f) => f.code);
      for (const code of ["heading-order", "details-order", "heading-unknown", "status-row-missing"] as const) {
        expect(codes, `${c.name}: ${code}`).not.toContain(code);
      }
    }
  });

  test("an unknown section moved into Notes is no longer a heading, and an unknown details block stays flagged", () => {
    const moved = parseDescription(formatDescription(read("unknown-section.md"), defaultTemplate));
    expect(moved.headings.map((h) => h.name)).toEqual(["Needs you", "What", "Why", "Evidence"]);
    expect(moved.details.map((d) => d.name)).toEqual(["Notes"]);
    const kept = parseDescription(formatDescription(read("unknown-details.md"), defaultTemplate));
    expect(kept.details.map((d) => d.name)).toEqual(["How to test", "Timings"]);
  });

  test("a moved section keeps its heading line exactly as written, indent and trailing space included", () => {
    const input = read("unknown-section.md").replace("## Rollout plan\n", "  ## Rollout plan  \n");
    expect(input).toContain("  ## Rollout plan  \n");
    const out = formatDescription(input, defaultTemplate);
    expect(out.split("\n")).toContain("  ## Rollout plan  ");
    expect(lostLines(input, out)).toEqual([]);
    expect(out).not.toContain("    ##");
    expect(formatDescription(out, defaultTemplate)).toBe(out);
    expect(parseDescription(out).headings.map((h) => h.name)).toEqual(["Needs you", "What", "Why", "Evidence"]);
    expect(
      checkDescription({ body: out, title: "fix: label", template: defaultTemplate, catalog }).findings.map((f) => f.code),
    ).not.toContain("heading-unknown");
  });

  test("a ## heading already inside a details block is not moved, and check does not count it as a section", () => {
    const input = read("in-order.md").replace(
      "<details><summary><b>Notes</b></summary>\n",
      "<details><summary><b>Notes</b></summary>\n\n## Inside notes\n\nkept here\n",
    );
    expect(input).toContain("## Inside notes");
    expect(formatDescription(input, defaultTemplate)).toBe(input);
    expect(parseDescription(input).headings.map((h) => h.name)).not.toContain("Inside notes");
    const codes = checkDescription({ body: input, title: "fix: label", template: defaultTemplate, catalog }).findings.map((f) => f.code);
    expect(codes).not.toContain("heading-unknown");
    expect(codes).not.toContain("heading-order");
  });

  test("a missing required status row is added with an empty value, a missing section with an empty body", () => {
    const out = formatDescription(read("missing-required.md"), defaultTemplate);
    const parsed = parseDescription(out);
    expect(parsed.statusRows.map((r) => r.label)).toEqual(["Type", "Issue", "Risk", "Rollout", "Release", "Evidence", "Decisions"]);
    expect(parsed.statusRows[0]!.value).toBe("");
    expect(out).toContain("## Needs you\n\n## What");
  });

  test("a table is created when the preface has none", () => {
    const out = formatDescription("Some intro text.\n", defaultTemplate);
    expect(out.startsWith("Some intro text.\n\n| | |\n|---|---|\n| **Type** | |\n")).toBe(true);
    expect(formatDescription(out, defaultTemplate)).toBe(out);
    expect(lostLines("Some intro text.\n", out)).toEqual([]);
  });

  test("rows are added under the separator of a table that has none", () => {
    const out = formatDescription("| | |\n|---|---|\n\n## What\nx\n", defaultTemplate);
    expect(out.startsWith("| | |\n|---|---|\n| **Type** | |\n| **Issue** | |\n")).toBe(true);
    expect(formatDescription(out, defaultTemplate)).toBe(out);
  });

  test("an unknown status row stays after the row it followed", () => {
    const input = "| | |\n|---|---|\n| **Risk** | 🟢 Low |\n| **Mood** | fine |\n| **Type** | Fix |\n";
    const out = formatDescription(input, defaultTemplate);
    const rows = out.split("\n").filter((l) => l.startsWith("| **"));
    expect(rows.map((r) => /\*\*(.+?)\*\*/.exec(r)![1])).toEqual([
      "Type",
      "Issue",
      "Risk",
      "Mood",
      "Rollout",
      "Release",
      "Evidence",
      "Decisions",
    ]);
    expect(formatDescription(out, defaultTemplate)).toBe(out);
  });

  test("text before the first structural element stays at the top", () => {
    const input = `Please read this first.\n\n${read("sections-shuffled.md")}`;
    const out = formatDescription(input, defaultTemplate);
    expect(out.startsWith("Please read this first.\n\n- [ ] **Outside contributors only:**")).toBe(true);
    expect(lostLines(input, out)).toEqual([]);
  });

  test("a description with no heading at all keeps its text", () => {
    const out = formatDescription("just words\nmore words\n", defaultTemplate);
    expect(out).toContain("just words\nmore words\n");
    expect(out).toContain("## Needs you");
  });

  test("an empty description gets the required skeleton", () => {
    const out = formatDescription("", defaultTemplate);
    expect(out).toContain("## What");
    expect(formatDescription(out, defaultTemplate)).toBe(out);
  });

  test("text after a collapsed block stays with it", () => {
    const input = `${read("in-order.md").replace("</details>\n\n<details><summary><b>How", "</details>\n\nA note about the table.\n\n<details><summary><b>How")}`;
    const swapped = input.replace(
      /(<details><summary><b>Changes[\s\S]*?A note about the table\.)\n\n([\s\S]*?How to test[\s\S]*?<\/details>)/,
      "$2\n\n$1",
    );
    const out = formatDescription(swapped, defaultTemplate);
    expect(out).toBe(input);
  });

  test("a footer-like <sub> inside a section is text, not the footer", () => {
    const input = read("in-order.md").replace("## Why\n", "## Why\n<sub>a small aside</sub>\n");
    expect(formatDescription(input, defaultTemplate)).toBe(input);
    const shuffled = input.replace("## What", "## Why-first").replace("## Why-first", "## What");
    expect(formatDescription(shuffled, defaultTemplate)).toBe(input);
  });

  test("a heading inside a code fence is not a section", () => {
    const input = read("in-order.md").replace(
      "Users could not find the export.\n",
      "Users could not find the export.\n\n```md\n## Pretend heading\n```\n",
    );
    expect(formatDescription(input, defaultTemplate)).toBe(input);
  });

  test("with no Notes in the template an unknown section stays where it is, after the known ones", () => {
    const noNotes = withLockedFromCatalog(resolveTemplate(catalog, loadRepoChoice('{"drop":["notes"]}', catalog)), catalog);
    const input = read("unknown-section.md").replace(/<details><summary><b>Notes[\s\S]*?<\/details>\n\n/, "");
    const out = formatDescription(input, noNotes);
    expect(out).toContain("## Rollout plan");
    expect(parseDescription(out).headings.map((h) => h.name)).toEqual([
      "Needs you",
      "What",
      "Why",
      "Evidence",
      "Rollout plan",
      "Open questions",
    ]);
    expect(formatDescription(out, noNotes)).toBe(out);
    expect(lostLines(input, out)).toEqual([]);
  });

  test("a Notes block closed on a content line cannot take text, so the section stays", () => {
    const input = read("unknown-section.md").replace(
      /<details><summary><b>Notes[\s\S]*?<\/details>/,
      "<details><summary><b>Notes</b></summary>Checked on the preview.</details>",
    );
    const out = formatDescription(input, defaultTemplate);
    expect(out).toContain("\n## Rollout plan\n");
    expect(out).toContain("<details><summary><b>Notes</b></summary>Checked on the preview.</details>");
    expect(formatDescription(out, defaultTemplate)).toBe(out);
  });

  test("a required details block that is missing is added empty", () => {
    const required = withLockedFromCatalog(
      resolveTemplate(catalog, loadRepoChoice('{"custom":[{"id":"audit","kind":"details","summary":"Audit","required":true}]}', catalog)),
      catalog,
    );
    const out = formatDescription(read("in-order.md"), required);
    expect(out).toContain("<details><summary><b>Audit</b></summary>\n\n</details>");
    expect(parseDescription(out).details.map((d) => d.name)).toEqual(["Changes", "How to test", "Notes", "Audit"]);
    expect(formatDescription(out, required)).toBe(out);
  });
});

describe("line endings and the last newline", () => {
  const crlf = (text: string) => text.replace(/\n/g, "\r\n");

  test("CRLF stays CRLF, in order or not", () => {
    for (const name of ["in-order", "sections-shuffled", "unknown-section", "missing-required"]) {
      const out = formatDescription(crlf(read(`${name}.md`)), defaultTemplate);
      expect(out, name).toBe(crlf(read(`${name}.expected.md`)));
      expect(out.replace(/\r\n/g, "").includes("\n"), name).toBe(false);
      expect(formatDescription(out, defaultTemplate), name).toBe(out);
    }
  });

  test("a missing last newline stays missing, and a present one stays present", () => {
    for (const name of ["in-order", "sections-shuffled", "unknown-section", "wachiman-middle"]) {
      const input = read(`${name}.md`).replace(/\n$/, "");
      const out = formatDescription(input, defaultTemplate);
      expect(out, name).toBe(read(`${name}.expected.md`).replace(/\n$/, ""));
      expect(out.endsWith("\n"), name).toBe(false);
      expect(formatDescription(out, defaultTemplate), name).toBe(out);
      expect(formatDescription(`${input}\n`, defaultTemplate).endsWith("\n"), name).toBe(true);
    }
  });
});

describe("shuffled input", () => {
  /** A small seeded generator, so a failure can be replayed. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  const shuffle = <T>(items: T[], next: () => number): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  const ordered = read("in-order.md");
  const parsed = parseDescription(ordered);
  const trimmed = (from: number, to: number) => {
    const lines = parsed.lines.slice(from, to);
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    return lines;
  };
  const pieces = parsed.segments.filter((s) => s.kind !== "text" && s.kind !== "preface").map((s) => trimmed(s.startLine, s.endLine));
  const preface = parsed.segments[0]!;
  const prefaceLines = trimmed(preface.startLine, preface.endLine);
  const rowAt = parsed.statusRows.map((r) => r.line);
  const unknownSection = ["## Appendix", "Extra figures.", "", "- one", "- two"];
  const unknownDetails = ["<details><summary><b>Raw numbers</b></summary>", "", "1, 2, 3", "", "</details>"];

  test("pieces in any order come back as the ordered description", () => {
    const next = rng(20261114);
    for (let n = 0; n < 200; n++) {
      const body = shuffle(pieces, next);
      const rows = shuffle(
        rowAt.map((l) => parsed.lines[l]!),
        next,
      );
      const head = prefaceLines.map((l, i) => (rowAt.includes(i + preface.startLine) ? rows.shift()! : l));
      const input = `${[head, ...body].map((p) => p.join("\n")).join("\n\n")}\n`;
      const out = formatDescription(input, defaultTemplate);
      expect(out, `seed iteration ${n}`).toBe(ordered);
    }
  });

  test("with parts dropped and unknown parts added: nothing is lost and a second run changes nothing", () => {
    const next = rng(777);
    let changed = 0;
    for (let n = 0; n < 300; n++) {
      const kept = pieces.filter(() => next() > 0.25);
      const extra = [
        ...(next() > 0.5 ? [unknownSection] : []),
        ...(next() > 0.5 ? [unknownDetails] : []),
        ...(next() > 0.5 ? [["Loose text between blocks."]] : []),
      ];
      const dropRows = parsed.statusRows.filter(() => next() > 0.2).map((r) => r.raw);
      const head = [...prefaceLines.filter((_, i) => !rowAt.includes(i + preface.startLine)), ...shuffle(dropRows, next)];
      const body = shuffle([...kept, ...extra], next);
      const joiner = next() > 0.5 ? "\n\n" : "\n\n\n";
      let input = `${[head, ...body].map((p) => p.join("\n")).join(joiner)}${next() > 0.5 ? "\n" : ""}`;
      if (next() > 0.7) input = input.replace(/\n/g, "\r\n");

      const out = formatDescription(input, defaultTemplate);
      const tag = `iteration ${n}`;
      expect(lostLines(input, out), tag).toEqual([]);
      expect(formatDescription(out, defaultTemplate), tag).toBe(out);
      if (out !== input) changed += 1;
      expect(out.includes("\r\n"), tag).toBe(input.includes("\r\n"));
    }
    expect(changed).toBeGreaterThan(250);
  });
});

describe("runFormat", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-template-format-"));
    dirs.push(dir);
    return dir;
  };
  const put = (dir: string, path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    const io: PrTemplateIo = { stdout: (t) => out.push(t), stderr: (l) => err.push(l) };
    return { io, out: () => out.join(""), err: () => err.join("\n") };
  }
  /** GitHub must never be reached. */
  const noTools = {
    run: () => {
      throw new Error("format ran a tool");
    },
  };

  test("a file is printed in template order and left alone", () => {
    const dir = tmp();
    put(dir, "body.md", read("sections-shuffled.md"));
    const c = capture();
    expect(runFormat({ file: "body.md", write: false }, dir, c.io, noTools)).toBe(0);
    expect(c.out()).toBe(read("sections-shuffled.expected.md"));
    expect(c.err()).toBe("");
    expect(readFileSync(join(dir, "body.md"), "utf8")).toBe(read("sections-shuffled.md"));
  });

  test("with no file the description comes from standard input", () => {
    const c = capture();
    expect(runFormat({ write: false }, tmp(), c.io, { ...noTools, stdin: () => read("status-rows-shuffled.md") })).toBe(0);
    expect(c.out()).toBe(read("status-rows-shuffled.expected.md"));
  });

  test("an already ordered description comes back unchanged with exit 0", () => {
    const c = capture();
    expect(runFormat({ write: false }, tmp(), c.io, { stdin: () => read("in-order.md") })).toBe(0);
    expect(c.out()).toBe(read("in-order.md"));
  });

  test("the repository's template.json decides the order", () => {
    const dir = tmp();
    put(dir, ".github/pr-template.json", read("custom-template.json"));
    const c = capture();
    expect(runFormat({ write: false }, dir, c.io, { stdin: () => read("custom-template.md") })).toBe(0);
    expect(c.out()).toBe(read("custom-template.expected.md"));
  });

  test("--write rewrites the file, prints nothing on stdout and one line on stderr", () => {
    const dir = tmp();
    put(dir, "body.md", read("unknown-section.md"));
    const c = capture();
    expect(runFormat({ file: "body.md", write: true }, dir, c.io, noTools)).toBe(0);
    expect(c.out()).toBe("");
    expect(c.err().split("\n")).toHaveLength(1);
    expect(c.err()).toContain("reordered body.md");
    expect(readFileSync(join(dir, "body.md"), "utf8")).toBe(read("unknown-section.expected.md"));
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("--write leaves no temporary file behind when writing it fails, and the file is untouched", () => {
    const dir = tmp();
    put(dir, "body.md", read("unknown-section.md"));
    const c = capture();
    const writeTemp = (path: string) => {
      writeFileSync(path, "partial");
      throw new Error("no space left on device");
    };
    expect(() => runFormat({ file: "body.md", write: true }, dir, c.io, { ...noTools, writeTemp })).toThrow("no space left on device");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readFileSync(join(dir, "body.md"), "utf8")).toBe(read("unknown-section.md"));
  });

  test("--write refuses a file that is not valid UTF-8 and leaves its bytes alone", () => {
    const dir = tmp();
    const bytes = Buffer.concat([Buffer.from(read("unknown-section.md")), Buffer.from([0xff, 0xfe, 0x0a])]);
    writeFileSync(join(dir, "body.md"), bytes);
    const c = capture();
    expect(runFormat({ file: "body.md", write: true }, dir, c.io, noTools)).toBe(2);
    expect(c.err()).toContain("not valid UTF-8");
    expect(readFileSync(join(dir, "body.md")).equals(bytes)).toBe(true);
  });

  test("--write on an ordered file changes nothing and says so", () => {
    const dir = tmp();
    put(dir, "body.md", read("in-order.md"));
    const before = lstatSync(join(dir, "body.md"));
    const c = capture();
    expect(runFormat({ file: "body.md", write: true }, dir, c.io, noTools)).toBe(0);
    expect(c.out()).toBe("");
    expect(c.err()).toContain("already in the template's order");
    expect(lstatSync(join(dir, "body.md")).mtimeMs).toBe(before.mtimeMs);
  });

  test("--write refuses a symbolic link and writes nothing", () => {
    const dir = tmp();
    put(dir, "real.md", read("sections-shuffled.md"));
    symlinkSync(join(dir, "real.md"), join(dir, "link.md"));
    const c = capture();
    expect(runFormat({ file: "link.md", write: true }, dir, c.io, noTools)).toBe(2);
    expect(c.err()).toContain("symbolic link");
    expect(readFileSync(join(dir, "real.md"), "utf8")).toBe(read("sections-shuffled.md"));
    expect(lstatSync(join(dir, "link.md")).isSymbolicLink()).toBe(true);
  });

  test("printing through a symbolic link is fine, it only reads", () => {
    const dir = tmp();
    put(dir, "real.md", read("sections-shuffled.md"));
    symlinkSync(join(dir, "real.md"), join(dir, "link.md"));
    const c = capture();
    expect(runFormat({ file: "link.md", write: false }, dir, c.io, noTools)).toBe(0);
    expect(c.out()).toBe(read("sections-shuffled.expected.md"));
  });

  test("an invalid .github/pr-template.json exits 2 naming the problem, and reads nothing else", () => {
    const dir = tmp();
    put(dir, ".github/pr-template.json", '{"drop": ["no-such-section"]}');
    let read = false;
    const c = capture();
    expect(
      runFormat({ write: false }, dir, c.io, {
        stdin: () => {
          read = true;
          return "";
        },
      }),
    ).toBe(2);
    expect(c.err()).toContain("no-such-section");
    expect(c.out()).toBe("");
    expect(read).toBe(false);
    put(dir, ".github/pr-template.json", "{not json");
    const d = capture();
    expect(runFormat({ write: false }, dir, d.io, { stdin: () => "" })).toBe(2);
    expect(d.err()).toContain("not valid JSON");
  });

  test("a file that is not there exits 2", () => {
    const c = capture();
    expect(runFormat({ file: "missing.md", write: false }, tmp(), c.io, {})).toBe(2);
    expect(c.err()).toContain("cannot read missing.md");
  });

  test("a failing standard input exits 2", () => {
    const c = capture();
    expect(
      runFormat({ write: false }, tmp(), c.io, {
        stdin: () => {
          throw new Error("closed");
        },
      }),
    ).toBe(2);
    expect(c.err()).toContain("standard input");
  });
});
