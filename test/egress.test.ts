/**
 * `docs/on-your-machine.md` promises a complete list of where Wachiman can reach the network. This
 * test keeps that promise from drifting. It reads every source file of the shipped tool and its
 * scripts (`src/`, `bin/`, `scripts/`, `templates/`; not `*.test.ts`, not fixtures) and applies two
 * rules:
 *
 * 1. A file with a network call site must be named, in backticks, in the table of the page's
 *    "Who it talks to" section. A call site is a line (outside comments) that matches one of
 *    `SITE_RULES`: `fetch(`, a network program (`curl`, `wget`, `ssh`...), a git or package-manager
 *    network verb, a `gh` or provider (`claude`, `codex`) invocation, or a raw socket module. A file
 *    that matches but spawns nothing goes in `NOT_A_CALL`, with the reason. An entry there that no
 *    longer matches fails too, so the list cannot go stale.
 * 2. Every host in an `http(s)://` literal must appear on the page. A host that is only a template
 *    (`https://${...}`) is skipped.
 *
 * It also fails when the table cites a path that does not exist.
 *
 * The rules are text patterns, on purpose: simple and deterministic. They catch a new `fetch(` or
 * `curl` call and a new URL host. They cannot catch a network call built in a way the patterns do
 * not name (for example a program name assembled from pieces); the page says so under "What is not
 * verified". To add a legitimate call site, describe it in the table first, then run this test.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PAGE = readFileSync(join(ROOT, "docs/on-your-machine.md"), "utf8");
const SCANNED = ["src", "bin", "scripts", "templates"];

/** Files that match a rule without making a network call. Each reason is checked by a person; the match is checked here. */
const NOT_A_CALL: { file: string; reason: string }[] = [
  {
    file: "src/install-kind.ts",
    reason: 'Names the install kind "npm" (found under node_modules); it spawns nothing.',
  },
];

const SITE_RULES: { name: string; pattern: RegExp }[] = [
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "network program", pattern: /["'](curl|wget|ssh|scp|nc|ncat|telnet)["']/ },
  { name: "network program in a script", pattern: /\b(curl|wget)\s+-/ },
  { name: "git network verb", pattern: /["'](ls-remote|fetch|push|clone)["']/ },
  { name: "gh", pattern: /["']gh["']/ },
  { name: "package manager", pattern: /["'](npm|npx|pnpm|yarn)["']/ },
  { name: "package manager in a script", pattern: /\b(npm|npx)\s+(pack|install|view|exec|publish|i)\b/ },
  { name: "provider CLI", pattern: /["'](claude|codex)["']/ },
  { name: "raw socket", pattern: /\b(Bun\.connect|Bun\.listen|WebSocket|node:(net|http|https|dns|tls|dgram|http2))\b/ },
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "fixtures" && entry.name !== "node_modules") walk(path);
      } else if (!entry.name.endsWith(".test.ts")) {
        out.push(path);
      }
    }
  };
  for (const dir of SCANNED) if (existsSync(join(ROOT, dir))) walk(join(ROOT, dir));
  return out.sort();
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|#)/.test(line);
/** Drops a trailing `// comment`; the whitespace before `//` keeps `https://` intact. */
const code = (line: string) => line.replace(/(?<!:)\s\/\/\s.*$/, "");

/** Network call sites by file (rule names) and URL hosts by host (files), for the current source. */
function scan(): { sites: Map<string, Set<string>>; hosts: Map<string, Set<string>> } {
  const sites = new Map<string, Set<string>>();
  const hosts = new Map<string, Set<string>>();
  for (const path of sourceFiles()) {
    const file = relative(ROOT, path).split("\\").join("/");
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      if (isComment(raw)) continue;
      const line = code(raw);
      for (const { name, pattern } of SITE_RULES) {
        if (pattern.test(line)) {
          if (!sites.has(file)) sites.set(file, new Set());
          sites.get(file)!.add(name);
        }
      }
      for (const m of line.matchAll(/https?:\/\/(\[::1\]|[A-Za-z0-9][A-Za-z0-9.-]*)/g)) {
        if (!hosts.has(m[1])) hosts.set(m[1], new Set());
        hosts.get(m[1])!.add(file);
      }
    }
  }
  return { sites, hosts };
}

/** The "Who it talks to" section: from its heading to the next `## ` heading. */
function tableSection(): string {
  const start = PAGE.indexOf("\n## Who it talks to\n");
  expect(start).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const end = rest.indexOf("\n## ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

const citedPaths = (): Set<string> =>
  new Set([...tableSection().matchAll(/`((?:src|bin|scripts|templates)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]));

describe("network egress is listed on docs/on-your-machine.md", () => {
  const { sites, hosts } = scan();
  const ignored = new Set(NOT_A_CALL.map((e) => e.file));

  test("the scan finds call sites (guards against a broken scanner)", () => {
    expect(sites.size).toBeGreaterThan(10);
    expect(sites.has("src/ledger.ts")).toBe(true);
    expect(sites.has("src/ledger-read/pull.ts")).toBe(true);
  });

  test("every file with a network call site is cited in the Who it talks to table", () => {
    const cited = citedPaths();
    const missing = [...sites]
      .filter(([file]) => !ignored.has(file) && !cited.has(file))
      .map(([file, rules]) => `${file} (${[...rules].join(", ")})`);
    expect(missing, `add these files to the table in docs/on-your-machine.md, or explain them in NOT_A_CALL:\n${missing.join("\n")}`).toEqual([]);
  });

  test("every NOT_A_CALL entry still matches a rule", () => {
    const stale = NOT_A_CALL.filter((e) => !sites.has(e.file)).map((e) => e.file);
    expect(stale).toEqual([]);
  });

  test("every host in a URL literal is named on the page", () => {
    const unnamed = [...hosts]
      .filter(([host]) => !PAGE.includes(host))
      .map(([host, files]) => `${host} (${[...files].join(", ")})`);
    expect(unnamed, `name these hosts in docs/on-your-machine.md:\n${unnamed.join("\n")}`).toEqual([]);
  });

  test("every source path the table cites exists", () => {
    const gone = [...citedPaths()].filter((p) => !existsSync(join(ROOT, p)));
    expect(gone).toEqual([]);
  });
});
