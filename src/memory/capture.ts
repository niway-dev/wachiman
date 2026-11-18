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
import { loadMemorySettings } from "./settings";
import {
  evidenceFromFinding,
  EVIDENCE_SOURCES,
  newCandidate,
  proposability,
  readCandidate,
  readCandidates,
  renderEntry,
  today,
  withEvidence,
  writeCandidate,
  type Candidate,
  type Evidence,
  type EvidenceSource,
} from "./candidates";
import { proposeCandidate, type ProposeDeps } from "./propose";

export const CAPTURE_SUBCOMMANDS = ["candidates", "add", "show", "propose"] as const;

export interface CaptureIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
}

export interface CaptureContext {
  env?: Record<string, string | undefined>;
  now?: () => Date;
  deps?: ProposeDeps;
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

export function runCapture(sub: (typeof CAPTURE_SUBCOMMANDS)[number], rest: string[], repoDir: string, io: CaptureIo, ctx: CaptureContext = {}): number {
  const env = ctx.env ?? process.env;
  const home = wachimanHome(env);
  const key = repositoryKey(repoDir).key;
  const date = today((ctx.now ?? (() => new Date()))());
  const { minEvidence } = loadMemorySettings(repoDir, (n) => io.stderr(`note: ${n}`));

  if (sub === "candidates") {
    const p = parseOptions(rest, sub, ["--format"], []);
    if (p.positional.length > 0) throw new UsageError(`wachiman memory candidates takes no argument, got "${p.positional[0]}".`);
    const format = p.values.get("--format") ?? "terminal";
    if (format !== "terminal" && format !== "json") throw new UsageError(`--format must be terminal or json, got "${format}".`);
    const list = readCandidates(home, key);
    if (format === "json") {
      const candidates = list.map((c) => {
        const q = need(c, minEvidence);
        return { id: c.id, title: c.title, kind: c.kind, scope: c.scope, evidence: q.counted, distinct: q.distinct, needed: q.needed, proposable: q.proposable, ...(q.why ? { why: q.why } : {}), ...(c.proposed ? { proposed: c.proposed.at } : {}) };
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
      const state = c.proposed ? `proposed ${c.proposed.at.slice(0, 10)}` : q.proposable ? "proposable" : `not proposable: ${q.why}`;
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
    const id = oneId(parseOptions(rest, sub, [], []), sub);
    const c = readCandidate(home, key, id);
    if (!c) throw new UsageError(`No memory candidate ${id} for this repository; list them with \`wachiman memory candidates\`.`);
    const q = need(c, minEvidence);
    if (!q.proposable) {
      io.stderr(`memory propose: candidate ${id} is not proposable: ${q.why}. Nothing was written.`);
      return 1;
    }
    const result = proposeCandidate(c, repoDir, io, ctx.deps);
    if (result.recorded) writeCandidate(home, key, { ...c, proposed: { at: (ctx.now ?? (() => new Date()))().toISOString() } });
    return result.recorded ? (result.pullRequestFailed ? 1 : 0) : 1;
  }

  // add
  const p = parseOptions(rest, sub, ["--file", "--kind", "--scope", "--rule", "--why", "--holds-while", "--title", "--source", "--finding", "--pr", "--branch"], ["--agent"]);
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
  const existing = readCandidate(home, key, fresh.id);
  const saved = existing ? withEvidence(existing, [first]) : fresh;
  writeCandidate(home, key, saved);
  const q = need(saved, minEvidence);
  io.stdout(`candidate ${saved.id} saved: ${saved.title}\n${q.proposable ? "proposable: show it to the owner with `wachiman memory show " + saved.id + "`, then `wachiman memory propose " + saved.id + "`." : `not proposable yet: ${q.why}.`}\n`);
  return 0;
}
