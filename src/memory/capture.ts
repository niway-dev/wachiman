/**
 * `wachiman memory candidates | add | show | propose` (layer 3, laptop capture). No model is called
 * here: the developer's coding agent drafts the entry from the code and the owner's intent and hands
 * it over with `add`. `propose` is the only subcommand that writes to a remote (`propose.ts`).
 */
import { readFileSync } from "node:fs";
import { wachimanHome } from "../accounts/config";
import { UsageError } from "../config";
import { spawnGit } from "../evidence";
import { historyRoot, repositoryKey } from "../history/store";
import { loadMemorySettings, repositoryRoot } from "./settings";
import {
  candidateProblem,
  evidenceFromFinding,
  EVIDENCE_SOURCES,
  newCandidate,
  proposability,
  readCandidate,
  readCandidates,
  renderEntry,
  today,
  withCandidateLock,
  withEvidence,
  writeCandidate,
  type Candidate,
  type Evidence,
  type EvidenceSource,
} from "./candidates";
import type { GhFn } from "../engine";
import { proposeCandidate, teamHasMemory, type ProposeDeps } from "./propose";
import { candidatesFromPersonal, FIRST_PROPOSE_QUESTION, parseMemoryChoice, personalMemoryDir, proposePersonal, readMemoryChoice, writeMemoryChoice } from "./personal";

export const CAPTURE_SUBCOMMANDS = ["candidates", "add", "show", "propose"] as const;

/** The options each capture subcommand accepts: the parser below reads this, and the loop skill's commands are tested against it. */
export const CAPTURE_OPTIONS: Record<(typeof CAPTURE_SUBCOMMANDS)[number], { values: readonly string[]; flags: readonly string[] }> = {
  candidates: { values: ["--format"], flags: [] },
  show: { values: [], flags: [] },
  propose: { values: [], flags: ["--personal", "--team", "--from-personal"] },
  add: { values: ["--file", "--kind", "--scope", "--rule", "--why", "--holds-while", "--title", "--source", "--finding", "--pr", "--branch"], flags: ["--agent"] },
};

export interface CaptureIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

export interface CaptureContext {
  env?: Record<string, string | undefined>;
  /** The GitHub calls of `memory remember`; tests pass a fake. Default: the `gh` binary. */
  gh?: GhFn;
  now?: () => Date;
  deps?: ProposeDeps;
  /** Asks the developer a question and returns the answer; absent when nobody can answer (no terminal). */
  ask?: (question: string) => string | undefined;
}

interface Parsed {
  values: Map<string, string>;
  flags: Set<string>;
  positional: string[];
}

/** `--x v`, `--x=v` and bare flags; anything else starting with `--` is a usage error. */
function parseOptions(argv: string[], sub: string, valueOptions: readonly string[], flagOptions: readonly string[]): Parsed {
  const out: Parsed = { values: new Map(), flags: new Set(), positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out.positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (flagOptions.includes(name)) {
      if (eq !== -1) throw new UsageError(`${name} takes no value.`);
      out.flags.add(name);
    } else if (valueOptions.includes(name)) {
      if (out.values.has(name)) throw new UsageError(`${name} was given twice.`);
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined) throw new UsageError(`${name} needs a value.`);
      if (eq === -1 && v.startsWith("--")) throw new UsageError(`${name} needs a value, and "${v}" looks like another option. A value that starts with "--" is written ${name}=${v}.`);
      out.values.set(name, v);
    } else {
      throw new UsageError(`Unknown option "${name}" for wachiman memory ${sub}.`);
    }
  }
  return out;
}

const oneId = (p: Parsed, sub: string) => {
  if (p.positional.length !== 1) throw new UsageError(`wachiman memory ${sub} takes one entry id.`);
  return p.positional[0];
};

function currentBranch(repoDir: string): string | undefined {
  const r = spawnGit(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: repoDir, timeoutMs: 30_000 });
  return r.status === 0 && r.stdout.trim() !== "" ? r.stdout.trim() : undefined;
}

function parsePr(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) throw new UsageError(`--pr must be a pull request number, got "${v}".`);
  return Number(v);
}

const need = (c: Candidate, minEvidence: number) => proposability(c, minEvidence);

/**
 * Marks a candidate after its entry was written: `proposed` once the team's pull request has it, `personal` when it only went to
 * this machine. Read again under the candidate's lock, so evidence added by `memory add` while the push was in flight is not
 * overwritten. A failure is said, never thrown: the entry is already written, and a second propose is idempotent.
 */
function markCandidate(home: string, key: string, id: string, fallback: Candidate | undefined, mark: "proposed" | "personal", at: string, io: CaptureIo) {
  try {
    withCandidateLock(home, key, id, () => {
      const latest = readCandidate(home, key, id) ?? fallback;
      if (latest) writeCandidate(home, key, { ...latest, [mark]: { at } });
    });
  } catch (error) {
    io.stderr(`memory propose: the entry was recorded, but candidate ${id} could not be marked as ${mark === "personal" ? "written to personal memory" : "proposed"} (${(error as Error).message}).`);
  }
}

/** `propose --from-personal [<id>...]`: the personal entries (or those ids) go to the team's memory pull request through the same write path as `propose <id>`. Personal memory is left as it is. */
function sendPersonal(ids: string[], repoDir: string, home: string, key: string, io: CaptureIo, ctx: CaptureContext): number {
  for (const id of ids) if (!/^[0-9a-f]{7}$/.test(id)) throw new UsageError(`"${id}" is not a memory entry id (seven hex characters).`);
  const dir = personalMemoryDir(home, repoDir);
  if (dir === undefined) {
    io.stderr("memory propose: this repository has no remote named origin with a host, an owner and a repository, so it has no personal memory; nothing was sent.");
    return 1;
  }
  const { candidates, unknown, skipped } = candidatesFromPersonal(dir, ids);
  if (unknown.length > 0) throw new UsageError(`No personal memory entry ${unknown.join(", ")} for this repository.`);
  for (const line of skipped) io.stderr(`memory propose: skipped personal entry ${line}`);
  if (candidates.length === 0) {
    io.stdout("no personal memory entries to send.\n");
    return skipped.length > 0 ? 1 : 0;
  }
  let failed = skipped.length > 0;
  for (const c of candidates) {
    io.stdout(`sending ${c.id} to the team's memory pull request:\n${renderEntry(c)}`);
    const result = proposeCandidate(c, repoDir, io, ctx.deps);
    if (!result.recorded || result.pullRequestFailed) failed = true;
    // As after a team propose: the local candidate of this entry, if there is one, is marked as proposed.
    if (result.recorded) markCandidate(home, key, c.id, undefined, "proposed", (ctx.now ?? (() => new Date()))().toISOString(), io);
  }
  return failed ? 1 : 0;
}

export function runCapture(sub: (typeof CAPTURE_SUBCOMMANDS)[number], rest: string[], repoDir: string, io: CaptureIo, ctx: CaptureContext = {}): number {
  const env = ctx.env ?? process.env;
  const home = wachimanHome(env);
  const key = repositoryKey(repoDir).key;
  const date = today((ctx.now ?? (() => new Date()))());
  // `show` prints stored text and needs no setting, so a broken `.wachiman.yml` must not stop it.
  const minEvidence = sub === "show" ? 0 : loadMemorySettings(repoDir, (n) => io.stderr(`note: ${n}`)).minEvidence;

  if (sub === "candidates") {
    const p = parseOptions(rest, sub, CAPTURE_OPTIONS.candidates.values, CAPTURE_OPTIONS.candidates.flags);
    if (p.positional.length > 0) throw new UsageError(`wachiman memory candidates takes no argument, got "${p.positional[0]}".`);
    const format = p.values.get("--format") ?? "terminal";
    if (format !== "terminal" && format !== "json") throw new UsageError(`--format must be terminal or json, got "${format}".`);
    const list = readCandidates(home, key, (name, why) => io.stderr(`note: ${name} is not listed: ${why}; remove it to start that candidate again.`));
    if (format === "json") {
      const candidates = list.map((c) => {
        const q = need(c, minEvidence);
        return { id: c.id, title: c.title, kind: c.kind, scope: c.scope, evidence: q.counted, distinct: q.distinct, needed: q.needed, proposable: q.proposable, ...(q.why ? { why: q.why } : {}), ...(c.proposed ? { proposed: c.proposed.at } : {}), ...(c.personal && !c.proposed ? { personal: c.personal.at } : {}) };
      });
      io.stdout(`${JSON.stringify({ format: "wachiman.memory-candidates/1", candidates }, null, 2)}\n`);
      return 0;
    }
    if (list.length === 0) {
      io.stdout("no memory candidates for this repository.\n");
      return 0;
    }
    for (const c of list) {
      const q = need(c, minEvidence);
      const state = c.proposed ? `proposed ${c.proposed.at.slice(0, 10)}` : c.personal ? `personal ${c.personal.at.slice(0, 10)}${q.proposable ? ", proposable to the team" : ""}` : q.proposable ? "proposable" : `not proposable: ${q.why}`;
      io.stdout(`${c.id}  ${c.kind}  ${c.scope}  ${c.title}\n    ${state}\n`);
    }
    return 0;
  }

  if (sub === "show") {
    const id = oneId(parseOptions(rest, sub, [], []), sub);
    const c = readCandidate(home, key, id);
    if (!c) throw new UsageError(`No memory candidate ${id} for this repository; list them with \`wachiman memory candidates\`.`);
    io.stdout(renderEntry(c));
    return 0;
  }

  if (sub === "propose") {
    const parsed = parseOptions(rest, sub, CAPTURE_OPTIONS.propose.values, CAPTURE_OPTIONS.propose.flags);
    if (parsed.flags.has("--from-personal")) {
      if (parsed.flags.has("--personal") || parsed.flags.has("--team")) throw new UsageError("--from-personal already sends to the team's memory pull request; it cannot be combined with --personal or --team.");
      return sendPersonal(parsed.positional, repoDir, home, key, io, ctx);
    }
    const id = oneId(parsed, sub);
    if (parsed.flags.has("--personal") && parsed.flags.has("--team")) throw new UsageError("--personal and --team exclude each other: choose where the entry goes.");
    let personal = parsed.flags.has("--personal");
    const c = readCandidate(home, key, id);
    if (!c) throw new UsageError(`No memory candidate ${id} for this repository; list them with \`wachiman memory candidates\`.`);
    const q = need(c, minEvidence);
    if (!q.proposable) {
      io.stderr(`memory propose: candidate ${id} is not proposable: ${q.why}. Nothing was written.`);
      return 1;
    }
    if (!personal && !parsed.flags.has("--team")) {
      // Spec decision 16: a repository whose team has not adopted memory is never pushed to unasked.
      let choice = readMemoryChoice(home, key);
      // The probe fetches from origin, so it runs only when the answer depends on it: a stored `team` answer goes to the team whatever the team has.
      const teamMemory = choice === "team" ? undefined : (ctx.deps?.teamMemory ?? teamHasMemory)(repositoryRoot(repoDir));
      if (choice === "personal" && teamMemory === true) {
        // The team adopted memory after the answer was given: the entry goes to the team again.
        io.stdout("this repository's team now has .wachiman/memory/, so this entry goes to the team's memory pull request; pass --personal to keep it on this machine.\n");
        choice = "team";
      }
      if (!choice && teamMemory === false) {
        choice = parseMemoryChoice(ctx.ask?.(FIRST_PROPOSE_QUESTION));
        if (!choice) {
          io.stderr(`memory propose: this repository's default branch has no .wachiman/memory/, so nothing was pushed or written. Run it again with --personal (keep the entry on this machine) or --team (propose it to the team's repository).`);
          return 1;
        }
        writeMemoryChoice(home, key, choice, (ctx.now ?? (() => new Date()))());
      }
      personal = choice === "personal";
    }
    const result = personal ? proposePersonal(c, repoDir, home, io) : proposeCandidate(c, repoDir, io, ctx.deps);
    if (result.recorded) {
      // A personal write is kept on this machine: the team never received it, so it stays proposable (`--from-personal`).
      markCandidate(home, key, id, c, personal ? "personal" : "proposed", (ctx.now ?? (() => new Date()))().toISOString(), io);
    }
    return result.recorded ? (result.pullRequestFailed ? 1 : 0) : 1;
  }

  // add
  const p = parseOptions(rest, sub, CAPTURE_OPTIONS.add.values, CAPTURE_OPTIONS.add.flags);
  if (p.positional.length > 0) throw new UsageError(`wachiman memory add takes no argument, got "${p.positional[0]}".`);
  let base: Record<string, string> = {};
  const file = p.values.get("--file");
  if (file !== undefined) {
    try {
      base = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new UsageError(`--file ${file} is not a readable JSON entry (${error instanceof Error ? error.message : error}).`);
    }
    if (!base || typeof base !== "object" || Array.isArray(base)) throw new UsageError(`--file ${file} must hold a JSON object with kind, scope, rule and why.`);
  }
  for (const name of ["kind", "scope", "rule", "why", "holdsWhile", "holds while", "title"]) {
    const v = (base as Record<string, unknown>)[name];
    if (v !== undefined && typeof v !== "string") throw new UsageError(`--file ${file}: "${name}" must be a string, got ${Array.isArray(v) ? "an array" : v === null ? "null" : typeof v}.`);
  }
  const field = (flag: string, name: string) => p.values.get(flag) ?? (typeof base[name] === "string" ? base[name] : undefined);
  const sourceText = p.values.get("--source") ?? "instruction";
  if (!(EVIDENCE_SOURCES as readonly string[]).includes(sourceText)) throw new UsageError(`--source must be one of: ${EVIDENCE_SOURCES.join(", ")}. A reaction or silence is never evidence.`);
  const source = sourceText as EvidenceSource;
  const kind = field("--kind", "kind");
  if (kind === "exception" && source === "fixed") throw new UsageError("A fix supports only a convention, never an exception.");
  const finding = p.values.get("--finding");
  const pr = parsePr(p.values.get("--pr"));
  const agent = p.flags.has("--agent");

  let first: Evidence;
  if (source === "instruction") {
    if (finding !== undefined) throw new UsageError("--finding is for --source judged or fixed.");
    const branch = p.values.get("--branch") ?? currentBranch(repoDir);
    if (pr === undefined && branch === undefined) throw new UsageError("HEAD is detached: say where the instruction came from with --pr <n> or --branch <name>.");
    first = { date, source, agent, ...(pr !== undefined ? { pr } : { branch }) };
  } else {
    if (finding === undefined) throw new UsageError(`--source ${source} needs --finding <id>: the evidence is read from the local history, not taken on trust.`);
    first = evidenceFromFinding(key, historyRoot(home), finding, source, { ...(pr !== undefined ? { pr } : {}), agent, date });
  }

  const fresh = newCandidate(
    {
      kind: kind ?? "",
      scope: field("--scope", "scope") ?? "",
      rule: field("--rule", "rule") ?? "",
      why: field("--why", "why") ?? "",
      holdsWhile: field("--holds-while", "holdsWhile") ?? field("--holds-while", "holds while"),
      title: field("--title", "title"),
    },
    first,
    date,
  );
  const saved = withCandidateLock(home, key, fresh.id, () => {
    const existing = readCandidate(home, key, fresh.id);
    const next = existing ? withEvidence(existing, [first]) : fresh;
    const problem = candidateProblem(next);
    if (problem) throw new UsageError(problem);
    writeCandidate(home, key, next);
    return next;
  });
  const q = need(saved, minEvidence);
  io.stdout(`candidate ${saved.id} saved: ${saved.title}\n${q.proposable ? "proposable: show it to the owner with `wachiman memory show " + saved.id + "`, then `wachiman memory propose " + saved.id + "`." : `not proposable yet: ${q.why}.`}\n`);
  return 0;
}
