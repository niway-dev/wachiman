/** The blind sample of `wachiman calibrate --judge`: a seeded stratified draw and the removal of the priority word. */
import { parseInlineTable } from "../engine";
import type { Confidence, OutcomeFinding, Severity } from "./outcomes";

/** The cells whose word may move (decision 12): consider and fix at every confidence, and a low-confidence blocker. */
export const MOVABLE: readonly { severity: Severity; confidence: Confidence }[] = [
  { severity: "blocker", confidence: "low" },
  { severity: "fix", confidence: "high" },
  { severity: "fix", confidence: "medium" },
  { severity: "fix", confidence: "low" },
  { severity: "consider", confidence: "high" },
  { severity: "consider", confidence: "medium" },
  { severity: "consider", confidence: "low" },
];

export const isMovable = (severity: Severity, confidence: Confidence | undefined) =>
  confidence !== undefined && MOVABLE.some((m) => m.severity === severity && m.confidence === confidence);

/** mulberry32: a small seedable generator, so a draw can be repeated. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A uniform random draw, stratified over the movable cells: each cell's pool is shuffled, then one finding
 * is taken from each cell in turn until `count` is reached or every pool is empty. A cell with few findings
 * gives all of them and the others make up the difference. Unanswered findings are in the pool. Findings in
 * `exclude` (already drawn) are never drawn again.
 */
export function draw(pool: OutcomeFinding[], count: number, seed: number, exclude: ReadonlySet<string>): OutcomeFinding[] {
  const random = rng(seed);
  const piles = MOVABLE.map((m) => {
    const own = pool.filter((f) => f.severity === m.severity && f.confidence === m.confidence && !exclude.has(f.id));
    for (let i = own.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [own[i], own[j]] = [own[j], own[i]];
    }
    return own;
  });
  const out: OutcomeFinding[] = [];
  for (let round = 0; out.length < count && piles.some((p) => p.length > round); round++) {
    for (const pile of piles) if (pile[round] && out.length < count) out.push(pile[round]);
  }
  return out;
}

const WORD = /\b(?:Must|Should|Could|FYI|Important|Nit)\b/g;

/**
 * The finding as the judge may see it: without the Priority row and without any priority or tier word in
 * the label. An inline table loses its Priority row and the word after the severity; an older one-line
 * label loses the words from its first line. The model's own text is left as written.
 */
export function hideWord(body: string): string {
  if (parseInlineTable(body)) {
    return body
      .split("\n")
      .filter((row) => !row.startsWith("| **Priority** |"))
      .map((row) => (row.startsWith("| **Severity** |") ? row.replace(/( · (?:Must|Should|Could|FYI|Important|Nit))+(?= \|$)/, "") : row))
      .join("\n");
  }
  const [line, ...rest] = body.split("\n");
  // Only the label before the title loses its words: the model's own title is kept as written.
  const colon = line.indexOf(": ");
  const label = colon === -1 ? line : line.slice(0, colon);
  const title = colon === -1 ? "" : line.slice(colon);
  return [
    `${label
      .replace(WORD, "")
      .replace(/^\*\* +/, "**")
      .replace(/ {2,}/g, " ")
      .replace(/ ·\s*·/g, " ·")}${title}`,
    ...rest,
  ].join("\n");
}

/** The finding's title, read from its table or its one-line label. */
export function titleOf(body: string): string {
  const table = parseInlineTable(body);
  if (table) return table.title;
  const first = body.split("\n", 1)[0];
  const label = first.match(/\*\*(?:Blocker|Fix|Consider|Info) · [a-z]+: (.+?)(?: \(confidence (?:high|medium|low)\))?\*\*/);
  return (label?.[1] ?? first.replace(/[*_`]/g, "").replace(WORD, "")).replace(/\s+/g, " ").trim();
}
