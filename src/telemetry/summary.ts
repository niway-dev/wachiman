/**
 * The usage summary (`wachiman.telemetry/1`). It is built field by field from numbers and from values
 * checked against a fixed list; no object from the run is ever copied into it, so a field added to a
 * run later cannot reach the network. The page that lists the fields is docs/telemetry-api.md, and a
 * test keeps the two together.
 */
import type { TokenUsage } from "../cost";

export const TELEMETRY_FORMAT = "wachiman.telemetry/1";
/** A summary over this many bytes is not sent. */
export const MAX_SUMMARY_BYTES = 4096;

/** The top-level keys of a summary, in document order. */
export const SUMMARY_KEYS = [
  "format",
  "installation",
  "version",
  "mode",
  "model",
  "diff",
  "chunks",
  "tokens",
  "duration_s",
  "outcome",
  "error",
  "findings",
  "languages",
  "layout",
  "day",
] as const;

export const MODES = ["local", "ask"] as const;
export const MODEL_FAMILIES = ["opus", "sonnet", "haiku", "other"] as const;
export const OUTCOMES = ["complete", "partial", "failed"] as const;
/** `git` is part of the contract; the two call sites today send a summary only after a provider ran, so it is not emitted yet. */
export const ERRORS = ["auth", "quota", "timeout", "provider", "git", "other"] as const;
export const LAYOUTS = ["single", "monorepo", "distributed", "unknown"] as const;
/** The engine's own severity keys (`SEVERITY` in src/engine.ts), lowercase, highest first. */
export const SEVERITY_KEYS = ["blocker", "fix", "consider", "info"] as const;
export const MAX_LANGUAGES = 5;

export type Mode = (typeof MODES)[number];
export type ModelFamily = (typeof MODEL_FAMILIES)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type ErrorCategory = (typeof ERRORS)[number];
export type Layout = (typeof LAYOUTS)[number];

/** What the call sites hand over: plain facts of one run. Only the fields below are ever read. */
export interface TelemetryRun {
  mode: Mode;
  /** The model name as the provider reported it. Only its family is kept. */
  model: string;
  /** Only the extension of `filename` and the two counts are read. */
  files: readonly { filename: string; additions: number; deletions: number }[];
  chunks: { planned: number; completed: number };
  /** Absent when the provider reported nothing. */
  usage: TokenUsage | undefined;
  durationMs: number;
  outcome: Outcome;
  retries: number;
  error: ErrorCategory | null;
  /** One entry per finding; only the four known severities are counted. */
  severities: readonly string[];
  /** The run read sibling repositories from the workspace manifest. */
  distributed: boolean;
}

export interface TelemetrySummary {
  format: typeof TELEMETRY_FORMAT;
  installation: string;
  version: string;
  mode: Mode;
  model: ModelFamily;
  diff: { files: number; added: number; removed: number };
  chunks: { planned: number; completed: number };
  tokens: { input: number | null; output: number | null; cache_read: number | null; cache_write: number | null };
  duration_s: number;
  outcome: { state: Outcome; retries: number };
  error: ErrorCategory | null;
  findings: Record<(typeof SEVERITY_KEYS)[number], number>;
  languages: string[];
  layout: Layout;
  day: string;
}

/** A non-negative whole number; anything else (negative, NaN, infinite) is 0. */
const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Two significant figures: 124 is 120, 1234 is 1200, 7 stays 7. */
export function roundTwoFigures(n: number): number {
  const whole = count(n);
  if (whole < 100) return whole;
  const step = 10 ** (String(whole).length - 2);
  return Math.round(whole / step) * step;
}

/** The family of the model, from its name; anything unknown is `other`. */
export function modelFamily(model: string): ModelFamily {
  const name = typeof model === "string" ? model.toLowerCase() : "";
  for (const family of ["opus", "sonnet", "haiku"] as const) if (name.includes(family)) return family;
  return "other";
}

/** The fixed extension-to-language table. A file whose extension is not here adds nothing. */
const EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  scala: "scala",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  mdx: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  dart: "dart",
  lua: "lua",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  tf: "terraform",
  proto: "protobuf",
};

/** Every language name the table can produce. */
export const LANGUAGES: readonly string[] = [...new Set(Object.values(EXTENSIONS))].sort();

/** The extension of the last path segment, lowercased; empty for a dotfile, a name with no dot or a trailing slash. */
function extensionOf(filename: string): string {
  const name = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Up to five language names, the most changed files first and then alphabetical. Computed from extensions only; no path leaves this function. */
export function languagesOf(files: readonly { filename: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const { filename } of files) {
    const language = Object.hasOwn(EXTENSIONS, extensionOf(filename)) ? EXTENSIONS[extensionOf(filename)] : undefined;
    if (language !== undefined) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LANGUAGES)
    .map(([language]) => language);
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]{1,30})?$/;

/** Builds the document from `run`, field by field. Nothing is spread or copied from `run`. */
export function buildSummary(run: TelemetryRun, ctx: { installation: string; version: string; now: Date }): TelemetrySummary {
  const usage = run.usage;
  const tokenOrNull = (n: number | undefined) => (count(n) > 0 ? count(n) : null);
  const findings = { blocker: 0, fix: 0, consider: 0, info: 0 };
  for (const severity of run.severities) if (Object.hasOwn(findings, severity)) findings[severity as keyof typeof findings]++;
  return {
    format: TELEMETRY_FORMAT,
    installation: ctx.installation,
    version: VERSION.test(ctx.version) ? ctx.version : "unknown",
    mode: run.mode === "ask" ? "ask" : "local",
    model: modelFamily(run.model),
    diff: {
      files: roundTwoFigures(run.files.length),
      added: roundTwoFigures(run.files.reduce((sum, f) => sum + count(f.additions), 0)),
      removed: roundTwoFigures(run.files.reduce((sum, f) => sum + count(f.deletions), 0)),
    },
    chunks: { planned: count(run.chunks.planned), completed: count(run.chunks.completed) },
    tokens: {
      input: tokenOrNull(usage?.input),
      output: tokenOrNull(usage?.output),
      cache_read: tokenOrNull(usage?.cacheRead),
      cache_write: tokenOrNull(usage?.cacheWrite),
    },
    duration_s: Math.round(count(run.durationMs) / 1000),
    outcome: {
      state: (OUTCOMES as readonly string[]).includes(run.outcome) ? run.outcome : "failed",
      retries: count(run.retries),
    },
    error: run.error !== null && (ERRORS as readonly string[]).includes(run.error) ? run.error : null,
    findings,
    languages: languagesOf(run.files),
    layout: run.distributed ? "distributed" : "unknown",
    day: ctx.now.toISOString().slice(0, 10),
  };
}

/** The JSON body, or `null` when it is over the size cap (it is then not sent). */
export function serialiseSummary(summary: TelemetrySummary): string | null {
  const text = JSON.stringify(summary);
  return Buffer.byteLength(text) > MAX_SUMMARY_BYTES ? null : text;
}
