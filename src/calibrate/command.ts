/**
 * `wachiman calibrate`: reads what happened to Wachiman's findings on GitHub, draws a blind sample to judge,
 * and proposes the next calibration table from those judgements. It never writes anything the engine reads:
 * the proposal is a file under the Wachiman home, and `src/priority.ts` changes only when a person commits it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wachimanHome } from "../accounts/config";
import { movedWord, wilsonInterval } from "../calibration";
import { UsageError } from "../config";
import { defaultGh, GhError, type GhFn } from "../engine";
import { TABLE_V1, type Priority } from "../priority";
import { readFindings, type Confidence, type OutcomeFinding, type Severity } from "./outcomes";
import { aggregateOutcomes, answeredOf, formatReport, RATES_NOTE } from "./report";
import { draw, hideWord, isMovable, MOVABLE, titleOf } from "./sample";

export const calibrateUsage = `wachiman calibrate <owner/repo> [--prs <n>] [--json]
wachiman calibrate <owner/repo> --judge [--count <n>] [--seed <n>] [--prs <n>]
wachiman calibrate <owner/repo> --propose [--prs <n>]`;

export interface CalibrateArgs {
  repo: string;
  prs: number;
  json: boolean;
  judge: boolean;
  propose: boolean;
  count: number;
  seed?: number;
}

const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** The arguments after `calibrate`. Both `--x v` and `--x=v`. */
export function parseCalibrateArgs(argv: string[]): CalibrateArgs {
  const args: CalibrateArgs = { repo: "", prs: 50, json: false, judge: false, propose: false, count: 40 };
  let countGiven = false;
  const integer = (name: string, v: string, min: number) => {
    if (!/^\d+$/.test(v) || Number(v) < min) throw new UsageError(`${name} takes a whole number of at least ${min}, got "${v}".`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (args.repo !== "") throw new UsageError(`calibrate takes one repository, got "${args.repo}" and "${arg}".`);
      args.repo = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = () => {
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined || v === "" || (eq === -1 && v.startsWith("--"))) throw new UsageError(`${name} needs a value.`);
      return v;
    };
    const flag = () => {
      if (eq !== -1) throw new UsageError(`${name} takes no value.`);
    };
    if (name === "--json") {
      flag();
      args.json = true;
    } else if (name === "--judge") {
      flag();
      args.judge = true;
    } else if (name === "--propose") {
      flag();
      args.propose = true;
    } else if (name === "--prs") args.prs = integer(name, value(), 1);
    else if (name === "--count") {
      args.count = integer(name, value(), 1);
      countGiven = true;
    } else if (name === "--seed") args.seed = integer(name, value(), 0);
    else throw new UsageError(`Unknown option ${name} for calibrate.`);
  }
  if (!REPO.test(args.repo)) throw new UsageError("calibrate needs a repository as <owner/repo>.");
  if (args.judge && args.propose) throw new UsageError("--judge and --propose are separate steps: run one, then the other.");
  if (args.json && (args.judge || args.propose)) throw new UsageError("--json only goes with the outcome table.");
  if (!args.judge && (countGiven || args.seed !== undefined)) throw new UsageError("--count and --seed only go with --judge.");
  return args;
}

export interface CalibrateIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  now?: () => Date;
}

type Word = Exclude<Priority, "must">;

/** One line of a judging file. `wouldAct` is the judge's answer: would a careful reviewer act on this finding. */
export interface Judgement {
  id: string;
  repo: string;
  pr: number;
  url: string;
  path: string;
  line: number | null;
  title: string;
  body: string;
  cell: { severity: Severity; confidence: Confidence };
  wouldAct: boolean | null;
}

const repoKey = (repo: string) => repo.replace("/", "__");
const calibrationDir = (home: string, repo: string) => join(home, "calibration", repoKey(repo));
const isJudgingFile = (name: string) => /^judging-\d{4}-\d{2}-\d{2}(?:-\d+)?\.jsonl$/.test(name);

function readJudgements(dir: string, warn: (line: string) => void): Judgement[] {
  if (!existsSync(dir)) return [];
  const seen = new Set<string>();
  const out: Judgement[] = [];
  for (const file of readdirSync(dir).filter(isJudgingFile).sort()) {
    readFileSync(join(dir, file), "utf8")
      .split("\n")
      .forEach((text, index) => {
        if (text.trim() === "") return;
        try {
          const row = JSON.parse(text) as Judgement;
          if (typeof row.id !== "string" || !row.cell || (row.wouldAct !== null && typeof row.wouldAct !== "boolean"))
            throw new Error("not a judgement");
          if (seen.has(row.id)) return;
          seen.add(row.id);
          out.push(row);
        } catch {
          warn(`wachiman: ${file} line ${index + 1} is not a judgement line; skipped.`);
        }
      });
  }
  return out;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

function runJudge(args: CalibrateArgs, home: string, gh: GhFn, io: CalibrateIo): number {
  const now = (io.now ?? (() => new Date()))();
  const dir = calibrationDir(home, args.repo);
  const drawn = new Set(readJudgements(dir, io.stderr).map((j) => j.id));
  const pool = readFindings(gh, args.repo, args.prs).filter((f) => isMovable(f.severity, f.confidence));
  const seed = args.seed ?? Number(day(now).replaceAll("-", ""));
  const picked = draw(pool, args.count, seed, drawn);
  if (picked.length === 0) {
    io.stdout(
      `No finding left to draw: ${pool.length} in the movable cells of the last ${args.prs} pull requests, ${drawn.size} already drawn earlier.\n`,
    );
    return 0;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let file = join(dir, `judging-${day(now)}.jsonl`);
  for (let n = 2; existsSync(file); n++) file = join(dir, `judging-${day(now)}-${n}.jsonl`);
  const rows = picked.map((f: OutcomeFinding): Judgement => ({
    id: f.id,
    repo: f.repo,
    pr: f.pr,
    url: f.url,
    path: f.path,
    line: f.line,
    title: titleOf(f.body),
    body: hideWord(f.body),
    cell: { severity: f.severity, confidence: f.confidence! },
    wouldAct: null,
  }));
  writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, { mode: 0o600 });
  io.stdout(
    [
      `Wrote ${rows.length} finding(s) to ${file}`,
      `Draw: uniform random, stratified over the ${MOVABLE.length} movable cells (one finding per cell in turn, so a cell with few findings gives all of them), unanswered findings included, seed ${seed}.`,
      "The priority word is hidden. Judge each one without looking at how the pull request answered it:",
      'set "wouldAct" to true or false on every line (would a careful reviewer act on this finding), then run:',
      `  wachiman calibrate ${args.repo} --propose`,
      "",
    ].join("\n"),
  );
  return 0;
}

const WORDS: readonly Word[] = ["fyi", "could", "should"];
const weaker = (a: Word, b: Word) => (WORDS.indexOf(a) <= WORDS.indexOf(b) ? a : b);

interface ProposedCell {
  word: Priority;
  n: number;
  yes: number;
  prs: number;
  measured: boolean;
  provenance: "judged" | "seed";
}

const MIN_N = 20;
const MIN_PRS = 5;

function runPropose(args: CalibrateArgs, home: string, gh: GhFn, io: CalibrateIo): number {
  const dir = calibrationDir(home, args.repo);
  const judged = readJudgements(dir, io.stderr).filter((j) => j.wouldAct !== null);
  if (judged.length === 0) {
    io.stdout(
      `No judgements for ${args.repo} yet, so no change is proposed. Run \`wachiman calibrate ${args.repo} --judge\` and answer the file it writes.\n`,
    );
    return 0;
  }
  const cells = aggregateOutcomes(readFindings(gh, args.repo, args.prs));
  const rateOf = (s: Severity, c: Confidence) => cells.find((x) => x.severity === s && x.confidence === c)?.all;

  const table: Record<string, Record<string, ProposedCell>> = {};
  for (const s of Object.keys(TABLE_V1.cells) as Severity[]) {
    table[s] = {};
    for (const c of ["high", "medium", "low"] as Confidence[]) {
      table[s][c] = { word: TABLE_V1.cells[s][c].priority, n: 0, yes: 0, prs: 0, measured: false, provenance: "seed" };
    }
  }
  const lines: string[] = [];
  for (const { severity, confidence } of MOVABLE) {
    const own = judged.filter((j) => j.cell.severity === severity && j.cell.confidence === confidence);
    const yes = own.filter((j) => j.wouldAct === true).length;
    const prs = new Set(own.map((j) => j.pr)).size;
    const current = TABLE_V1.cells[severity][confidence].priority as Word;
    const moved = movedWord(current, yes, own.length, prs);
    // A low-confidence Blocker or Fix is a question: never above Could, whatever the judgements say.
    const capped = (severity === "blocker" || severity === "fix") && confidence === "low" ? weaker(moved.word, "could") : moved.word;
    table[severity][confidence] = {
      word: capped,
      n: own.length,
      yes,
      prs,
      measured: moved.measured,
      provenance: moved.measured ? "judged" : "seed",
    };
    const name = `${severity} · ${confidence}`;
    const k = rateOf(severity, confidence);
    const beside =
      k && answeredOf(k) > 0
        ? ` | fixed ${Math.round((k.fixed / answeredOf(k)) * 100)}%, declined ${Math.round((k.declined / answeredOf(k)) * 100)}% of ${answeredOf(k)} answered (reported, not fitted)`
        : " | no fixed or declined replies";
    if (!moved.measured) {
      const short = [
        own.length < MIN_N ? `n ${own.length} of ${MIN_N}` : `n ${own.length}`,
        ...(prs < MIN_PRS ? [`${prs} of ${MIN_PRS} PRs`] : []),
      ];
      lines.push(`${name}: not measured (${short.join(", ")})${beside}`);
      continue;
    }
    const { low, high } = wilsonInterval(yes, own.length);
    const detail = `n ${own.length}, ${prs} PRs, interval ${low.toFixed(2)}–${high.toFixed(2)}`;
    if (capped !== current) lines.push(`${name}: ${current} → ${capped} (${detail})${beside}`);
    else if (moved.word !== capped)
      lines.push(
        `${name}: unchanged at ${current}; the judgements say ${moved.word}, capped at could by the low-confidence floor (${detail})${beside}`,
      );
    else lines.push(`${name}: unchanged at ${current} (${detail})${beside}`);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "proposed-table.json");
  writeFileSync(file, `${JSON.stringify({ version: "v2", basedOn: TABLE_V1.version, repo: args.repo, cells: table }, null, 2)}\n`, {
    mode: 0o600,
  });
  io.stdout(
    [
      `Proposed table v2 for ${args.repo}, fitted to ${judged.length} judgement(s) (blocker at high and medium stays Must, info stays FYI):`,
      ...lines.map((l) => `  ${l}`),
      "",
      `Written to ${file}. Nothing the engine reads has changed: src/priority.ts is edited by hand, from this file, in a pull request.`,
      RATES_NOTE,
      "",
    ].join("\n"),
  );
  return 0;
}

export function runCalibrate(args: CalibrateArgs, env: Record<string, string | undefined>, io: CalibrateIo, gh: GhFn = defaultGh): number {
  const home = wachimanHome(env);
  try {
    if (args.judge) return runJudge(args, home, gh, io);
    if (args.propose) return runPropose(args, home, gh, io);
    const findings = readFindings(gh, args.repo, args.prs);
    const cells = aggregateOutcomes(findings);
    if (args.json) {
      io.stdout(
        `${JSON.stringify({ format: "wachiman.calibration/1", repo: args.repo, prs: args.prs, findings: findings.length, cells }, null, 2)}\n`,
      );
    } else io.stdout(formatReport(args.repo, args.prs, findings, cells));
    return 0;
  } catch (error) {
    if (error instanceof GhError) {
      io.stderr(`wachiman: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
