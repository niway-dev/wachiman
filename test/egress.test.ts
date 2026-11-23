/**
 * `docs/on-your-machine.md` promises a complete list of where Wachiman can reach the network. This
 * test keeps that promise from drifting. It reads every source file of the shipped tool and its
 * scripts (`src/`, `bin/`, `scripts/`, `templates/`; not `*.test.ts`, not fixtures) and applies two
 * rules:
 *
 * 1. A file with a network call site must be named, in backticks, in the last column of a row of
 *    the first table (header `Destination`) of the page's "Who it talks to" section. Prose in that
 *    section does not count. A call site is a line (outside comments) that matches one of
 *    `SITE_RULES`: `fetch(`, a network program (`curl`, `wget`, `ssh`...), a git or package-manager
 *    network verb, a `gh` or provider (`claude`, `codex`) invocation, or a raw socket module. A file
 *    that matches but spawns nothing goes in `NOT_A_CALL`, with the rule it may match and the
 *    reason; any other rule matching in that file still needs a table citation. An entry there that
 *    no longer matches fails too, so the list cannot go stale.
 * 2. Every host in an `http(s)://` literal must be named, as an exact backticked token, in a row of
 *    that first table or of the second table (header `Address`, hosts that are printed and never
 *    requested), and that row's last column must cite the file the host is found in. Prose does not
 *    count. A template (`https://${...}`) has no host and is skipped. Hosts are also read from
 *    comments under `templates/`, because those files are written into the user's repository; a
 *    comment in `src/` or `scripts/` is not scanned.
 *
 * The test checks per file, not per call: a new `fetch` in a file the table already cites passes
 * rule 1. A new URL host fails rule 2 unless a row names that host for that file.
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
const NOT_A_CALL: { file: string; rules: string[]; reason: string }[] = [
  {
    file: "src/install-kind.ts",
    rules: ["package manager"],
    reason: 'Names the install kind "npm" (found under node_modules); it spawns nothing.',
  },
  {
    file: "bin/launcher-args.js",
    rules: ["package manager in a script"],
    reason: 'Prints "npm install -g bun" as a hint when Bun is missing; it only runs `bun --version` and Bun itself.',
  },
];

const SITE_RULES: { name: string; pattern: RegExp }[] = [
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "network program", pattern: /["'](curl|wget|ssh|scp|nc|ncat|telnet)["']/ },
  { name: "network program in a script", pattern: /\b(curl|wget)\s+["$-]/ },
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
    // Files under templates/ are written into the user's repository, so a URL in their comments counts.
    const keepComments = file.startsWith("templates/");
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const isComm = isComment(raw);
      if (isComm && !keepComments) continue;
      const line = isComm ? raw : code(raw);
      for (const { name, pattern } of SITE_RULES) {
        if (isComm) break; // call-site rules never apply to comments
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

const PATH_IN_BACKTICKS = /`((?:src|bin|scripts|templates)\/[A-Za-z0-9_./-]+)`/g;
const pathsIn = (text: string): string[] => [...text.matchAll(PATH_IN_BACKTICKS)].map((m) => m[1]);

/** The rows of the section's tables whose first header cell is `firstHeader`, as lists of cells. */
function tableRows(firstHeader: string): string[][] {
  const lines = tableSection().split("\n");
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c))) continue;
    if (!inTable) {
      inTable = cells[0] === firstHeader; // the header row: start (or skip) this table
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

/** Files cited in the last column of the requests table. */
const citedPaths = (): Set<string> => new Set(tableRows("Destination").flatMap((r) => pathsIn(r[r.length - 1])));

const HOST_IN_BACKTICKS = /`((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}|localhost|127\.0\.0\.1|\[::1\])`/g;

/**
 * (host, file) pairs the tables name. A row names a host when the host is, alone, between backticks
 * anywhere in the row (an exact token, not a substring); it covers the files in backticks in the
 * row's last column. Both tables count: requested hosts and printed-only hosts.
 */
function namedPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const header of ["Destination", "Address"]) {
    for (const row of tableRows(header)) {
      const rowHosts = [...row.join(" | ").matchAll(HOST_IN_BACKTICKS)].map((m) => m[1]);
      for (const host of rowHosts) for (const file of pathsIn(row[row.length - 1])) pairs.add(`${host} ${file}`);
    }
  }
  return pairs;
}

describe("network egress is listed on docs/on-your-machine.md", () => {
  const { sites, hosts } = scan();
  const exempt = (file: string, rule: string) => NOT_A_CALL.some((e) => e.file === file && e.rules.includes(rule));

  test("the scan finds call sites (guards against a broken scanner)", () => {
    expect(sites.size).toBeGreaterThan(10);
    expect(sites.has("src/ledger.ts")).toBe(true);
    expect(sites.has("src/ledger-read/pull.ts")).toBe(true);
  });

  test("every file with a network call site is cited in the Who it talks to table", () => {
    const cited = citedPaths();
    const missing = [...sites]
      .map(([file, rules]) => [file, [...rules].filter((r) => !exempt(file, r))] as const)
      .filter(([file, rules]) => rules.length > 0 && !cited.has(file))
      .map(([file, rules]) => `${file} (${rules.join(", ")})`);
    expect(missing, `add these files to the table in docs/on-your-machine.md, or explain them in NOT_A_CALL:\n${missing.join("\n")}`).toEqual([]);
  });

  test("every NOT_A_CALL entry still matches a rule", () => {
    const stale = NOT_A_CALL.filter((e) => !e.rules.every((r) => sites.get(e.file)?.has(r))).map((e) => e.file);
    expect(stale).toEqual([]);
  });

  test("every host in a URL literal is named, exactly, in a table row that cites the file it is found in", () => {
    const named = namedPairs();
    const unnamed: string[] = [];
    for (const [host, files] of hosts) {
      for (const file of files) if (!named.has(`${host} ${file}`)) unnamed.push(`${host} in ${file}`);
    }
    expect(unnamed, `name these in a table row of docs/on-your-machine.md:\n${unnamed.join("\n")}`).toEqual([]);
  });

  test("every source path the tables cite exists", () => {
    const all = new Set([...citedPaths(), ...[...namedPairs()].map((p) => p.split(" ")[1])]);
    const gone = [...all].filter((p) => !existsSync(join(ROOT, p)));
    expect(gone).toEqual([]);
  });
});
