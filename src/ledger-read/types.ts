/**
 * What the laptop reads from the ledger (`GET /v1/entries`, ledger API contract v1). Parsed leniently
 * on the fields the report uses; a response that is not the documented shape is an error, never zero.
 */
export const ENTRY_STATES = ["reserved", "settled", "unsettled", "unreserved"] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

export interface LedgerCall {
  operation: string;
  label: string;
  model: string;
  turns: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** Null when the call died without a result and its real cost is unknown. */
  cost_usd: number | null;
  costKnown: boolean;
  terminal_reason: string | null;
  auth: string;
}

export interface LedgerEntry {
  id: string;
  day: string;
  week: string;
  repository: string;
  repository_id: number | string;
  pr: number | null;
  run_id: number | string | null;
  run_attempt: number | null;
  trigger: string;
  forced: boolean;
  state: EntryState;
  reservedUsd: number;
  settledUsd: number | null;
  created_at: string;
  settled_at: string | null;
  calls: LedgerCall[];
}

export interface LedgerLimits {
  dailyUsd: number | null;
  weeklyUsd: number | null;
}

export interface EntriesResponse {
  account: string;
  limits: LedgerLimits;
  entries: LedgerEntry[];
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** An account name becomes a directory name; anything else is refused. */
export const ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const nullableNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseCall(raw: unknown): LedgerCall {
  const c = isObject(raw) ? raw : {};
  const cost = nullableNum(c.cost_usd);
  return {
    operation: str(c.operation),
    label: str(c.label),
    model: str(c.model),
    turns: num(c.turns),
    duration_ms: num(c.duration_ms),
    input_tokens: num(c.input_tokens),
    output_tokens: num(c.output_tokens),
    cache_read_tokens: num(c.cache_read_tokens),
    cache_write_tokens: num(c.cache_write_tokens),
    cost_usd: cost,
    costKnown: c.costKnown !== false && cost !== null,
    terminal_reason: typeof c.terminal_reason === "string" ? c.terminal_reason : null,
    auth: str(c.auth, "api-key"),
  };
}

function parseEntry(raw: unknown): LedgerEntry {
  if (!isObject(raw)) throw new Error("an entry is not an object");
  const state = raw.state;
  if (!(ENTRY_STATES as readonly unknown[]).includes(state)) throw new Error(`an entry has the unknown state ${JSON.stringify(state)}`);
  if (typeof raw.id !== "string" || raw.id === "") throw new Error("an entry has no id");
  if (typeof raw.day !== "string" || !DAY_PATTERN.test(raw.day)) throw new Error("an entry has no valid day");
  if (typeof raw.week !== "string" || !DAY_PATTERN.test(raw.week)) throw new Error("an entry has no valid week");
  return {
    id: raw.id,
    day: raw.day,
    week: raw.week,
    repository: str(raw.repository),
    repository_id: typeof raw.repository_id === "number" || typeof raw.repository_id === "string" ? raw.repository_id : "",
    pr: typeof raw.pr === "number" && Number.isInteger(raw.pr) ? raw.pr : null,
    run_id: typeof raw.run_id === "number" || typeof raw.run_id === "string" ? raw.run_id : null,
    run_attempt: nullableNum(raw.run_attempt),
    trigger: str(raw.trigger),
    forced: raw.forced === true,
    state: state as EntryState,
    reservedUsd: num(raw.reservedUsd),
    settledUsd: nullableNum(raw.settledUsd),
    created_at: str(raw.created_at),
    settled_at: typeof raw.settled_at === "string" ? raw.settled_at : null,
    calls: Array.isArray(raw.calls) ? raw.calls.map(parseCall) : [],
  };
}

export function parseEntriesResponse(body: unknown): EntriesResponse {
  if (!isObject(body)) throw new Error("the ledger answered with something that is not a JSON object");
  if (typeof body.account !== "string" || !ACCOUNT_PATTERN.test(body.account)) throw new Error("the ledger answer has no usable account name");
  if (!Array.isArray(body.entries)) throw new Error("the ledger answer has no entries list");
  const limits = isObject(body.limits) ? body.limits : {};
  return {
    account: body.account,
    limits: { dailyUsd: nullableNum(limits.dailyUsd), weeklyUsd: nullableNum(limits.weeklyUsd) },
    entries: body.entries.map(parseEntry),
  };
}
