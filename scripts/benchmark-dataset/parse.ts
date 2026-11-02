/**
 * Parsers for the benchmark dataset: Wachiman's comment header and review body, the "What the
 * change connects to" contracts block, Pullfrog's and CodeRabbit's comments, and the engine lines
 * of a GitHub Actions log. Pure functions over strings, unit-tested against real snapshots.
 *
 * The formats are the ones `src/engine.ts` writes (`label`, `branded`, `buildReview`,
 * `renderContracts`); this file reads them back and imports nothing from `src/`, so the dataset
 * scripts cannot change engine behaviour.
 */

export const WACHIMAN_SIGNATURE = /👮 \*\*Wachiman\*\*|<!-- wachi:|<!-- (?:agent-review|claude-review) sha=/;
export const hasWachimanSignature = (body: string) => WACHIMAN_SIGNATURE.test(body);

export const SEVERITIES = ["blocker", "fix", "consider", "info"] as const;
export const TOPICS = ["bug", "security", "rules", "adr", "docs", "tests", "perf", "cleanup", "question"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export type WSeverity = (typeof SEVERITIES)[number];
export type WTopic = (typeof TOPICS)[number];
export type WConfidence = (typeof CONFIDENCES)[number];

export interface WachimanLabel {
  severity: WSeverity;
  topic: WTopic;
  confidence: WConfidence | "";
  title: string;
}

/**
 * The label inside a Wachiman header, with or without its leading brand:
 * `🟠🐛 **Fix · bug: <title> (confidence medium)**`. Both emojis, the severity word, the topic word,
 * the title, and the model's confidence when it gave one (absent before v1.4.0 and on engine notices).
 */
const LABEL = /(?:^|\s)\S+? \*\*(Blocker|Fix|Consider|Info) · (bug|security|rules|adr|docs|tests|perf|cleanup|question): (.+?)(?: \(confidence (high|medium|low)\))?\*\*/u;

export function parseLabelAt(text: string): { label: WachimanLabel; end: number } | null {
  const m = LABEL.exec(text);
  if (!m) return null;
  return {
    label: {
      severity: (m[1] as string).toLowerCase() as WSeverity,
      topic: m[2] as WTopic,
      confidence: (m[4] ?? "") as WConfidence | "",
      title: (m[3] as string).trim(),
    },
    end: m.index + m[0].length,
  };
}

export const parseLabel = (text: string): WachimanLabel | null => parseLabelAt(text)?.label ?? null;

const BRAND_PREFIX = "👮 **Wachiman** · ";
/** Before the brand existed (engine up to v1.2.x) a finding started with the label itself: `🟡🧪 **Consider · tests: …**`. */
const BRANDLESS = /^\S+ \*\*(?:Blocker|Fix|Consider|Info) · (?:bug|security|rules|adr|docs|tests|perf|cleanup|question): /u;

/**
 * The first line of an inline comment: `👮 **Wachiman** · <label>`, or the bare label of the older
 * engine. Null when it is not a Wachiman finding.
 */
export function parseWachimanHeader(body: string): WachimanLabel | null {
  const first = body.split("\n", 1)[0] ?? "";
  if (first.startsWith(BRAND_PREFIX)) return parseLabel(first.slice(BRAND_PREFIX.length));
  return BRANDLESS.test(first) ? parseLabel(first) : null;
}

/**
 * The engine's first labels (v1.0.x) were `**Note (correctness): title**`: a category and no
 * severity. They are kept as the engine wrote them, in the native_* columns.
 */
export function parseLegacyNote(body: string): { category: string; title: string } | null {
  const m = /^\*\*Note \(([^)\n]+)\): (.+)\*\*\s*$/u.exec(body.split("\n", 1)[0] ?? "");
  return m ? { category: (m[1] as string).trim(), title: (m[2] as string).trim() } : null;
}

/** A Wachiman finding comment: branded, or (older engines) a bare label or a `Note (category)` posted by the Actions bot. */
export function isWachimanComment(body: string, login: string): boolean {
  if (body.startsWith(BRAND_PREFIX)) return true;
  const first = body.split("\n", 1)[0] ?? "";
  return /^github-actions/i.test(login) && (BRANDLESS.test(first) || parseLegacyNote(body) !== null);
}

// ---------------------------------------------------------------------------------------------
// Wachiman review body

export interface BodyFinding extends WachimanLabel {
  path: string;
  line: number;
  /** Which section of the body listed it. */
  section: "outside-diff" | "for-your-information" | "moved-from-lines";
  text: string;
}

export interface Contract {
  action: string;
  location: string;
  /**
   * The rendered line shows one of `visible_effect`, `before_after` or `equivalent_path` (in that
   * order of preference), so the three cannot be told apart from a review body.
   */
  effect: string;
  failure_mode: string;
  status: "closed" | "open";
  evidence: string[];
  open_question: string;
  candidates: string[];
  /** False when the review flagged "A citation did not resolve in the head". */
  evidence_checked: boolean;
}

export interface BatchRow {
  batch: string;
  files: number;
  lines: number;
  risk: number;
  status: string;
  turns: number;
  cost_usd: number;
}

export interface WachimanReview {
  head_sha_short: string;
  scope: string;
  files_reviewed: string;
  partial: boolean;
  findings_total: number | null;
  inline_count: number | null;
  count_line: string;
  body_findings: BodyFinding[];
  contracts: Contract[];
  contracts_header: string;
  contracts_hidden: number;
  batches: BatchRow[];
  model_label: string;
  claude_code_version: string;
  effort: string;
  batch_count: number | null;
  cost_usd: number | null;
  review_sha: string;
  attempt_id: string;
  has_summary: boolean;
}

const SECTION_HEADINGS: [RegExp, BodyFinding["section"]][] = [
  [/^### Outside the diff\s*$/, "outside-diff"],
  [/^### For (?:your information|awareness)\s*$/, "for-your-information"],
  [/^### On their lines \(GitHub refused them inline\)\s*$/, "moved-from-lines"],
];

/** `- <label> (`path:line`): text` (the form `listed` writes) or `- `path:line`: 👮 **Wachiman** · <label> text` (moved). */
function parseListItem(first: string, section: BodyFinding["section"]): (Omit<BodyFinding, "text"> & { rest: string }) | null {
  if (section === "moved-from-lines") {
    const m = /^- `([^`]+?)(?::(\d+))?`: 👮 \*\*Wachiman\*\* · (.*)$/u.exec(first);
    if (!m) return null;
    const at = parseLabelAt(m[3] as string);
    return at ? { ...at.label, path: m[1] as string, line: Number(m[2] ?? 0), section, rest: (m[3] as string).slice(at.end).trim() } : null;
  }
  const at = parseLabelAt(first.replace(/^- /, ""));
  if (!at) return null;
  // The location follows the label's closing `**`.
  const after = first.replace(/^- /, "").slice(at.end);
  const loc = /^ \(`([^`]+?)(?::(\d+))?`\):/u.exec(after);
  return { ...at.label, path: loc?.[1] ?? "", line: Number(loc?.[2] ?? 0), section, rest: loc ? after.slice(loc[0].length).trim() : after.trim() };
}

export function parseBodyFindings(body: string): BodyFinding[] {
  const lines = body.split("\n");
  const out: BodyFinding[] = [];
  let section: BodyFinding["section"] | null = null;
  let current: { head: Omit<BodyFinding, "text">; text: string[] } | null = null;
  const flush = () => {
    if (current) out.push({ ...current.head, text: current.text.join("\n").trim() });
    current = null;
  };
  for (const line of lines) {
    const heading = SECTION_HEADINGS.find(([re]) => re.test(line));
    if (heading) {
      flush();
      section = heading[1];
      continue;
    }
    if (/^### /.test(line) || /^<details>|^<sub>|^<!-- /.test(line)) {
      flush();
      section = null;
      continue;
    }
    if (!section) continue;
    if (/^- … and \d+ more not shown/.test(line)) {
      flush();
      continue;
    }
    if (line.startsWith("- ")) {
      const head = parseListItem(line, section);
      if (head) {
        flush();
        const { rest, ...fields } = head;
        current = { head: fields, text: [rest] };
        continue;
      }
    }
    if (current) current.text.push(line);
  }
  flush();
  return out;
}

const UNRESOLVED = "⚠️ A citation did not resolve in the head.";
const tickList = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);

/** One bullet of the contracts block back into the fields `renderContracts` printed. */
export function parseContractLine(line: string, status: "closed" | "open"): Contract | null {
  let text = line.replace(/^- /, "").trim();
  let checked = true;
  if (text.endsWith(UNRESOLVED)) {
    checked = false;
    text = text.slice(0, -UNRESOLVED.length).trim();
  }
  const loc = / \(`([^`\s]+:\d+(?:-\d+)?|[^`\s]+)`\)(?= — |$| If it fails: | Evidence: | Files that would)/u.exec(text);
  if (!loc) return null;
  const action = text.slice(0, loc.index).trim();
  let rest = text.slice(loc.index + loc[0].length);
  const c: Contract = {
    action,
    location: loc[1] as string,
    effect: "",
    failure_mode: "",
    status,
    evidence: [],
    open_question: "",
    candidates: [],
    evidence_checked: checked,
  };
  if (status === "open") {
    const cand = rest.lastIndexOf(" Files that would answer it: ");
    if (cand >= 0) {
      c.candidates = tickList(rest.slice(cand));
      rest = rest.slice(0, cand);
    }
    c.open_question = rest.replace(/^ — /, "").trim();
    return c;
  }
  const ev = rest.lastIndexOf(" Evidence: ");
  if (ev >= 0) {
    c.evidence = tickList(rest.slice(ev));
    rest = rest.slice(0, ev);
  }
  const fail = rest.indexOf(" If it fails: ");
  if (fail >= 0) {
    c.failure_mode = rest.slice(fail + " If it fails: ".length).trim();
    rest = rest.slice(0, fail);
  }
  c.effect = rest.replace(/^ — /, "").trim();
  return c;
}

export function parseContracts(body: string): { header: string; contracts: Contract[]; hidden: number } {
  const m = /<details><summary>What the change connects to \(([^)]*)\)<\/summary>([\s\S]*?)<\/details>/.exec(body);
  if (!m) return { header: "", contracts: [], hidden: 0 };
  const contracts: Contract[] = [];
  let status: "closed" | "open" | null = null;
  let hidden = 0;
  for (const line of (m[2] as string).split("\n")) {
    if (line.startsWith("**Open:")) status = "open";
    else if (line.startsWith("**Closed")) status = "closed";
    else if (line.startsWith("- … and ")) hidden = Number(/and (\d+) more/.exec(line)?.[1] ?? 0);
    else if (line.startsWith("- ") && status) {
      const c = parseContractLine(line, status);
      if (c) contracts.push(c);
    }
  }
  return { header: m[1] as string, contracts, hidden };
}

export function parseWachimanReview(body: string): WachimanReview | null {
  if (!hasWachimanSignature(body)) return null;
  const head = /review\*{0,2} of (.+?), at `([0-9a-f]+)`: all (\d+) files reviewed/.exec(body);
  const partial = /Partial review\*\*: the agent reviewed (\d+) of (\d+) files of (.+?), at `([0-9a-f]+)`/.exec(body);
  const count = /(\d+) finding\(s\)(?:: [^;\n]*)?; (\d+) on their lines/.exec(body);
  const countLine = /^.*finding\(s\).*$/m.exec(body)?.[0] ?? "";
  const sub = /<sub>(.+?) via ([^·<]+?)(?: · effort (\w+))?(?: · (\d+) batches)? · \$([\d.]+)<\/sub>/.exec(body);
  const { header, contracts, hidden } = parseContracts(body);
  const batches: BatchRow[] = [];
  for (const row of body.matchAll(/^\| (Batch [^|]+?) \| (\d+) \| (\d+) \| (\d+) \| ([^|]+?) \| (\d+) \| \$([\d.]+) \|$/gm)) {
    batches.push({
      batch: row[1] as string, files: Number(row[2]), lines: Number(row[3]), risk: Number(row[4]),
      status: row[5] as string, turns: Number(row[6]), cost_usd: Number(row[7]),
    });
  }
  return {
    head_sha_short: head?.[2] ?? partial?.[4] ?? "",
    scope: head?.[1] ?? partial?.[3] ?? "",
    files_reviewed: head ? `${head[3]}/${head[3]}` : partial ? `${partial[1]}/${partial[2]}` : "",
    partial: Boolean(partial),
    findings_total: count ? Number(count[1]) : null,
    inline_count: count ? Number(count[2]) : null,
    count_line: countLine,
    body_findings: parseBodyFindings(body),
    contracts,
    contracts_header: header,
    contracts_hidden: hidden,
    batches,
    model_label: sub?.[1] ?? "",
    claude_code_version: /Claude Code ([\d.]+)/.exec(sub?.[2] ?? "")?.[1] ?? "",
    effort: sub?.[3] ?? "",
    batch_count: sub?.[4] ? Number(sub[4]) : batches.length > 0 ? batches.length : null,
    cost_usd: sub ? Number(sub[5]) : null,
    review_sha: /<!-- (?:agent-review|claude-review) sha=([0-9a-f]+) -->/.exec(body)?.[1] ?? "",
    attempt_id: /<!-- wachi:attempt id=([\w-]+) -->/.exec(body)?.[1] ?? "",
    has_summary: body.includes("### Summary"),
  };
}

// ---------------------------------------------------------------------------------------------
// Pullfrog and CodeRabbit

export interface NativeComment {
  native_severity: string;
  native_category: string;
  native_tags: string;
  title: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * CodeRabbit: `**<picture><img …/amber-16.svg …></picture> Minor** · **Stability & Availability** · **Quick win**`,
 * then the title as a bold line. Severity, category and tags are kept as CodeRabbit wrote them.
 */
export function parseCodeRabbit(body: string): NativeComment {
  const lines = body.split("\n");
  const headerAt = lines.findIndex((l) => /^\*\*<picture>/.test(l));
  const parts = headerAt < 0 ? [] : squash((lines[headerAt] as string).replace(/<[^>]+>/g, "").replaceAll("**", "")).split(" · ").map((x) => x.trim());
  const rest = (headerAt < 0 ? lines : lines.slice(headerAt + 1)).join("\n");
  const t = /^\s*\*\*([^\n]+?)\*\*\s*$/m.exec(rest);
  const fallback = squash(rest.replace(/<[^>]+>/g, " ")).slice(0, 140);
  return {
    native_severity: parts[0] ?? "",
    native_category: parts[1] ?? "",
    native_tags: parts.slice(2).join(" · "),
    title: t ? squash(t[1] as string) : fallback,
  };
}

export interface CodeRabbitBodyFinding extends NativeComment {
  path: string;
  line: number;
  /** The section heading of the review body, as CodeRabbit wrote it without markup. */
  section: string;
}

/**
 * Findings CodeRabbit lists only in its review body: "Outside diff range comments", "Nitpick
 * comments" and "Duplicate comments" are quoted blocks, each opened by a `path:lines` line and the
 * same severity header an inline comment has.
 */
export function parseCodeRabbitBody(body: string): CodeRabbitBodyFinding[] {
  const lines = body.split("\n").map((l) => l.replace(/^>\s?/, ""));
  const out: CodeRabbitBodyFinding[] = [];
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    const heading = /^\*\*(?:[^\w*]*\s)?((?:Outside diff range|Nitpick|Duplicate|Follow-up)[^*]*?)\s*(?:\(\d+\))?\*\*$/.exec(line);
    if (heading) {
      section = (heading[1] as string).trim();
      continue;
    }
    if (!section) continue;
    const loc = /^`([^`\n]+?):(\d+)(?:-(\d+))?`$/.exec(line);
    if (!loc) continue;
    const next = (lines[i + 1] ?? "").trim();
    if (!next.startsWith("**<picture>")) continue;
    out.push({ ...parseCodeRabbit(lines.slice(i + 1).join("\n")), path: loc[1] as string, line: Number(loc[2]), section });
  }
  return out;
}

/** Pullfrog posts plain prose with no labels: severity stays empty, the title is the first sentence. */
export function parsePullfrog(body: string): NativeComment {
  const text = squash(body.replace(/^>\s*/gm, ""));
  const nit = /^(Nit|Correction|Note)\b:?/i.exec(text);
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return { native_severity: nit ? (nit[1] as string).toLowerCase() : "", native_category: "", native_tags: "", title: cut(sentence, 160) };
}

// ---------------------------------------------------------------------------------------------
// GitHub Actions logs

export interface BatchCall {
  turns: number;
  cost_usd: number;
  duration_ms: number;
  is_error: boolean;
  terminal_reason: string;
}

export interface RunLog {
  workflow_ref: string;
  version: string;
  model: string;
  effort: string;
  provider: string;
  claude_code_version: string;
  started_at: string;
  ended_at: string;
  calls: BatchCall[];
  cost_usd: number | null;
  duration_ms: number | null;
  confidence_rule: string[];
  engine_lines: string[];
}

/** `review / Agent on demand\tUNKNOWN STEP\t2026-11-02T03:13:20.97Z text` → its timestamp and text. */
export function splitLogLine(raw: string): { ts: string; text: string } {
  const m = /^[^\t]*\t[^\t]*\t﻿?(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/.exec(raw);
  return m ? { ts: m[1] as string, text: m[2] as string } : { ts: "", text: raw };
}

const RUNNER_NOISE = /^(##\[(group|endgroup|debug)\]|\[command\]|Post job cleanup|Cleaning up orphan|Temporarily overriding|Adding repository|Removing |remote: )/;

/**
 * Model, version, cost, duration and every engine line of a run log. Engine lines are what the
 * engine printed during its step: everything after the `AGENT_REVIEW_*` environment block up to
 * the first post-step cleanup, minus runner noise. Cost and duration are summed over the per-batch
 * `{"cost_usd": …}` result lines; the review's own footer total is the check.
 */
export function extractRunLog(log: string): RunLog {
  const rows = log.split("\n").filter((l) => l.length > 0).map(splitLogLine);
  const out: RunLog = {
    workflow_ref: "", version: "", model: "", effort: "", provider: "", claude_code_version: "",
    started_at: rows[0]?.ts ?? "", ended_at: rows.at(-1)?.ts ?? "", calls: [], cost_usd: null, duration_ms: null,
    confidence_rule: [], engine_lines: [],
  };
  let inEngine = false;
  let sawEnv = false;
  let done = false;
  for (const { text } of rows) {
    const uses = /^Uses: (\S+\/review\.yml@\S+)/.exec(text);
    if (uses) {
      out.workflow_ref = uses[1] as string;
      out.version = /@refs\/tags\/(\S+)$/.exec(out.workflow_ref)?.[1] ?? /@(\S+)$/.exec(out.workflow_ref)?.[1] ?? "";
    }
    const env = /^\s*AGENT_REVIEW_(MODEL|EFFORT|PROVIDER):\s*(\S*)/.exec(text);
    if (env) {
      sawEnv = true;
      if (env[1] === "MODEL" && !out.model) out.model = env[2] as string;
      if (env[1] === "EFFORT" && !out.effort) out.effort = env[2] as string;
      if (env[1] === "PROVIDER" && !out.provider) out.provider = env[2] as string;
    }
    const cc = /^\s*CLAUDE_CODE_VERSION:\s*(\S+)/.exec(text);
    if (cc && !out.claude_code_version) out.claude_code_version = cc[1] as string;
    if (sawEnv && /^##\[endgroup\]/.test(text) && !inEngine && !done) {
      inEngine = true;
      continue;
    }
    if (inEngine && /^Post job cleanup/.test(text)) {
      inEngine = false;
      done = true;
    }
    if (inEngine && !RUNNER_NOISE.test(text) && text.trim().length > 0) {
      out.engine_lines.push(text);
      const call = /^\{"is_error":.*"cost_usd":.*\}$/.exec(text);
      if (call) {
        try {
          const j = JSON.parse(text) as Record<string, unknown>;
          out.calls.push({
            turns: Number(j.turns ?? 0), cost_usd: Number(j.cost_usd ?? 0), duration_ms: Number(j.duration_ms ?? 0),
            is_error: Boolean(j.is_error), terminal_reason: String(j.terminal_reason ?? ""),
          });
        } catch {
          // A malformed result line stays in engine_lines; it just does not count.
        }
      }
      if (/Confidence rule:/.test(text)) out.confidence_rule.push(text);
    }
  }
  if (out.calls.length > 0) {
    out.cost_usd = Math.round(out.calls.reduce((s, c) => s + c.cost_usd, 0) * 10000) / 10000;
    out.duration_ms = out.calls.reduce((s, c) => s + c.duration_ms, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// CSV

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(columns: readonly string[], rows: Record<string, unknown>[]): string {
  return `${[columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n")}\n`;
}

/** Reads CSV text written by `toCsv` (quotes, doubled quotes, embedded newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const [header = [], ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
