/**
 * ADR 0002, amendment 2026-11-13: `chalk` and `@clack/prompts` are for the terminal screens only.
 * The review engine and the providers handle the API key and run in GitHub Actions without a
 * `node_modules`, so they must never import either package, directly or through another module.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
/** The approved UI packages, and the packages they pull in. */
const UI_PACKAGE = /^(chalk|@clack\/[\w-]+|sisteransi|fast-wrap-ansi|fast-string-width|fast-string-truncated-width)(\/|$)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** Every module specifier a file loads, with how: a static import, or a dynamic import()/require(). */
function specifiers(file: string): { spec: string; kind: "static" | "dynamic" }[] {
  return specifiersOf(readFileSync(file, "utf8"));
}

function specifiersOf(source: string): { spec: string; kind: "static" | "dynamic" }[] {
  const text = source
    // Comments are not imports.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const found: { spec: string; kind: "static" | "dynamic" }[] = [];
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    if (!m[2]) found.push({ spec: m[3], kind: "static" });
  }
  for (const m of text.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) found.push({ spec: m[1], kind: "dynamic" });
  return found;
}

function resolveLocal(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  return [`${base}.ts`, join(base, "index.ts"), base].find((p) => existsSync(p) && statSync(p).isFile());
}

/** Files reachable from `roots` through static imports only (what loads when the root loads). */
function staticClosure(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { spec, kind } of specifiers(file)) {
      if (kind === "static" && spec.startsWith(".")) {
        const next = resolveLocal(file, spec);
        if (next) queue.push(next);
      }
    }
  }
  return seen;
}

const rel = (p: string) => relative(ROOT, p);

describe("chalk and @clack/* stay in the terminal screens", () => {
  test("only files under src/wizard/ import them", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.startsWith(join(SRC, "wizard") + "/"))
      .filter((f) => specifiers(f).some(({ spec }) => UI_PACKAGE.test(spec)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test("no module that sees the API key loads them: engine, providers and the review paths of the CLI", () => {
    const roots = sourceFiles(SRC).filter((f) => /\/providers\//.test(f) || /\/(engine|review-core|threads|spend|verify|local|local-ask|ask)\.ts$/.test(f));
    expect(roots.length).toBeGreaterThan(5);
    const loads = [...staticClosure(roots)].filter((f) => specifiers(f).some(({ spec, kind }) => kind === "static" && UI_PACKAGE.test(spec)));
    expect(loads.map(rel)).toEqual([]);
  });

  test("src/cli.ts reaches them only through a dynamic import, so GitHub Actions needs no node_modules", () => {
    const loads = [...staticClosure([join(SRC, "cli.ts")])].filter((f) => specifiers(f).some(({ spec, kind }) => kind === "static" && UI_PACKAGE.test(spec)));
    expect(loads.map(rel)).toEqual([]);
  });

  test("the scanner itself: static imports and re-exports count, type-only imports and comments do not, dynamic ones are marked", () => {
    const sample = [
      'import chalk from "chalk";',
      'import { intro } from "@clack/prompts";',
      'import type { X } from "chalk";',
      'export { y } from "sisteransi";',
      '// import z from "chalk";',
      'const m = await import("fast-wrap-ansi");',
    ].join("\n");
    expect(specifiersOf(sample)).toEqual([
      { spec: "chalk", kind: "static" },
      { spec: "@clack/prompts", kind: "static" },
      { spec: "sisteransi", kind: "static" },
      { spec: "fast-wrap-ansi", kind: "dynamic" },
    ]);
    expect(["chalk", "@clack/prompts", "sisteransi", "fast-wrap-ansi", "node:fs", "./x"].filter((s) => UI_PACKAGE.test(s))).toEqual(["chalk", "@clack/prompts", "sisteransi", "fast-wrap-ansi"]);
  });
});
