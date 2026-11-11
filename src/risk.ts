/**
 * The risk map of a review (ADR 0031). The level is computed here from path rules and from the
 * risk facts the batch calls reported; the model never states a level. Judgement items say where
 * a person must decide, and they never change the level. Pure: no I/O, so every rule is tested
 * directly.
 */
import { fileKind, JUDGEMENT_KINDS, neutralise, RISK_KINDS, riskScore, RISK_RULES } from "./engine";

export { JUDGEMENT_KINDS, RISK_KINDS };
export type RiskKind = (typeof RISK_KINDS)[number];
export type JudgementKind = (typeof JUDGEMENT_KINDS)[number];

export type RiskLevel = "low" | "medium" | "high";

export interface RiskFact {
  kind: RiskKind;
  path: string;
  line: number;
  why: string;
}

export interface JudgementItem {
  kind: JudgementKind;
  path: string;
  line: number;
  why: string;
}

/** The level a fact kind sets, whatever its path (ADR 0031). */
export const KIND_LEVEL: Record<RiskKind, RiskLevel> = {
  "data-migration": "high",
  irreversible: "high",
  auth: "high",
  money: "high",
  concurrency: "medium",
  "public-contract": "medium",
  "config-or-ci": "medium",
  dependency: "low",
};

/*
 * Uncalibrated defaults (ADR 0031). The plan calibrates them on merged pull requests of the
 * consumer repositories before release; change them together with their tests.
 */
export const HIGH_PATH_WEIGHT = 8;
export const MEDIUM_PATH_WEIGHT = 6;

/** At most this many judgement items are kept per review. */
const JUDGEMENT_CAP = 3;
/** At most this many paths are listed under "Read first". */
const READ_FIRST_CAP = 5;

const LEVEL_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const LEVEL_WORD: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };

export function pathLevel(weight: number): RiskLevel {
  if (weight >= HIGH_PATH_WEIGHT) return "high";
  if (weight >= MEDIUM_PATH_WEIGHT) return "medium";
  return "low";
}

/*
 * Built on first use, not at load: `RISK_RULES` lives in `engine.ts`, which imports this module,
 * so reading it while this module loads could find it not yet initialised.
 */
let riskGlobs: { weight: number; why: string; matcher: Bun.Glob }[] | undefined;

/**
 * The RISK_RULES entry that sets a file's `riskScore`: the highest-weight match, the first one on
 * a tie. Undefined for tests and docs, which score by their kind, not by a rule.
 */
export function matchingRule(path: string): { weight: number; why: string } | undefined {
  if (fileKind(path) !== "code") return undefined;
  riskGlobs ??= RISK_RULES.map((r) => ({ weight: r.weight, why: r.why, matcher: new Bun.Glob(r.glob) }));
  let best: { weight: number; why: string } | undefined;
  for (const r of riskGlobs) {
    if (r.matcher.match(path) && (!best || r.weight > best.weight)) {
      best = { weight: r.weight, why: r.why };
    }
  }
  return best;
}

export interface RiskMap {
  level: RiskLevel;
  /** True when some files were not reviewed: the level is then "at least" `level`. */
  floor: boolean;
  /** Kept facts, most severe kind first. */
  facts: RiskFact[];
  /** Kept judgement items, at most three. */
  judgement: JudgementItem[];
  /** Files whose path rule gives medium or high. */
  pathReasons: { path: string; why: string }[];
  /** Up to five paths, most worth reading first. */
  readFirst: string[];
  unreadFiles: number;
  /** Facts and judgement items dropped because their path or line is not in the change. */
  droppedFacts: number;
}

export function buildRiskMap(input: {
  files: { path: string; changedLines: number }[];
  facts: RiskFact[];
  judgement: JudgementItem[];
  unreadFiles: number;
  lineExists: (path: string, line: number) => boolean;
}): RiskMap {
  const paths = new Set(input.files.map((f) => f.path));
  const anchored = (item: { path: string; line: number }) =>
    paths.has(item.path) && input.lineExists(item.path, item.line);

  let droppedFacts = 0;
  const seen = new Set<string>();
  const facts: RiskFact[] = [];
  for (const fact of input.facts) {
    if (!anchored(fact)) {
      droppedFacts++;
      continue;
    }
    const key = `${fact.kind}\u0000${fact.path}\u0000${fact.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
  }
  // Array.prototype.sort is stable: facts of one severity keep the order the model gave them.
  facts.sort((a, b) => LEVEL_RANK[KIND_LEVEL[b.kind]] - LEVEL_RANK[KIND_LEVEL[a.kind]]);

  const judgement: JudgementItem[] = [];
  for (const item of input.judgement) {
    if (!anchored(item)) {
      droppedFacts++;
      continue;
    }
    judgement.push(item);
  }

  let level: RiskLevel = "low";
  for (const f of input.files) {
    const fromPath = pathLevel(riskScore(f.path));
    if (LEVEL_RANK[fromPath] > LEVEL_RANK[level]) level = fromPath;
  }
  for (const f of facts) {
    if (LEVEL_RANK[KIND_LEVEL[f.kind]] > LEVEL_RANK[level]) level = KIND_LEVEL[f.kind];
  }

  const pathReasons: { path: string; why: string }[] = [];
  for (const f of input.files) {
    const rule = matchingRule(f.path);
    if (rule && pathLevel(rule.weight) !== "low") pathReasons.push({ path: f.path, why: rule.why });
  }

  // Each path's most severe kept fact, as a rank; -1 for a path with no fact.
  const factRank = new Map<string, number>();
  for (const f of facts) {
    const rank = LEVEL_RANK[KIND_LEVEL[f.kind]];
    factRank.set(f.path, Math.max(rank, factRank.get(f.path) ?? -1));
  }
  const readFirst = [...input.files]
    .sort(
      (a, b) =>
        (factRank.get(b.path) ?? -1) - (factRank.get(a.path) ?? -1) ||
        riskScore(b.path) - riskScore(a.path) ||
        b.changedLines - a.changedLines ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .slice(0, READ_FIRST_CAP)
    .map((f) => f.path);

  return {
    level,
    floor: input.unreadFiles > 0,
    facts,
    judgement: judgement.slice(0, JUDGEMENT_CAP),
    pathReasons,
    readFirst,
    unreadFiles: input.unreadFiles,
    droppedFacts,
  };
}

/**
 * Keeps the well-formed items of a batch's `risk_facts` or `judgement` array. The schema makes the
 * arrays optional, so a missing one is empty; a malformed item is ignored, never guessed at.
 */
export function wellFormed<T extends { kind: string; path: string; line: number; why: string }>(
  items: unknown,
  kinds: readonly string[],
): T[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is T =>
      item !== null &&
      typeof item === "object" &&
      kinds.includes((item as T).kind) &&
      typeof (item as T).path === "string" &&
      Number.isInteger((item as T).line) &&
      (item as T).line >= 1 &&
      typeof (item as T).why === "string",
  );
}

/** How the map's words are marked up: Markdown for GitHub and the Markdown file, plain for the terminal. */
export interface RiskMapStyle {
  strong(text: string): string;
  code(text: string): string;
}

export const MARKDOWN_STYLE: RiskMapStyle = {
  strong: (text) => `**${text}**`,
  code: (text) => `\`${neutralise(text)}\``,
};

export const PLAIN_STYLE: RiskMapStyle = { strong: (text) => text, code: (text) => neutralise(text) };

const notReviewed = (n: number) => (n === 1 ? "1 file was not reviewed." : `${n} files were not reviewed.`);

/**
 * The map as text: `heading` is the title line when the map has content (`### Risk map` on GitHub,
 * `## Risk map` in Markdown, `Risk map:` in the terminal); the two-line form for a change with no
 * facts has none. `pushOnly` puts "This push only." in front of the level line, for a review that
 * covers one push of a pull request (ADR 0011).
 */
export function renderRiskMap(
  map: RiskMap,
  heading: string,
  opts: { pushOnly?: boolean; style?: RiskMapStyle } = {},
): string {
  const { strong, code } = opts.style ?? MARKDOWN_STYLE;
  const lead = opts.pushOnly ? "This push only. " : "";
  const readFirst =
    map.readFirst.length > 0
      ? `${strong("Read first:")} ${map.readFirst.map(code).join(", ")}.`
      : undefined;

  if (map.facts.length === 0 && map.judgement.length === 0 && map.pathReasons.length === 0) {
    const summary = map.floor
      ? `${lead}${strong("Risk map:")} at least ${map.level} — no risk facts in the files read; ${notReviewed(map.unreadFiles)}`
      : `${lead}${strong("Risk map:")} ${map.level} — no risk facts in this change.`;
    return [summary, readFirst].filter((line) => line !== undefined).join("\n");
  }

  const covered = new Set(map.facts.map((f) => f.path));
  const bullets = [
    ...map.facts.map((f) => `- ${code(f.kind)} · ${code(`${f.path}:${f.line}`)} — ${neutralise(f.why)}`),
    ...map.pathReasons
      .filter((r) => !covered.has(r.path))
      .map((r) => `- ${code(r.path)} — ${neutralise(r.why)}`),
  ];

  const level = map.floor
    ? `${lead}${strong(`At least ${map.level}.`)} ${notReviewed(map.unreadFiles)}`
    : `${lead}${strong(`${LEVEL_WORD[map.level]}.`)}`;

  const blocks = [heading, level];
  if (bullets.length > 0) blocks.push(bullets.join("\n"));
  if (map.judgement.length > 0) {
    const items = map.judgement.map(
      (j) => `- ${code(`${j.path}:${j.line}`)} (${code(j.kind)}) — ${neutralise(j.why)}`,
    );
    blocks.push(`${strong("Needs a person:")}\n\n${items.join("\n")}`);
  }
  if (readFirst !== undefined) blocks.push(readFirst);
  return blocks.join("\n\n");
}
