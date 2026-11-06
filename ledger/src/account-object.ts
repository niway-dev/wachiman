import { DurableObject } from "cloudflare:workers";

/**
 * One account's daily spend ledger (ADR 0021, ADR 0022): a SQLite-backed Durable Object that
 * reserves before a run and settles after it. The day is UTC and decided by this clock.
 *
 * Money is stored as INTEGER micro-dollars (1 USD = 1_000_000) and converted only at the RPC
 * boundary. Sums and comparisons are then exact integer arithmetic, so $6 - $5.70 leaves exactly
 * $0.30 and a balance of $0 is exactly 0, with no epsilon to tune. Micro-dollars are finer than
 * any token price we bill, and the totals stay far below 2^53.
 */

export interface ReserveInput {
  repository_id: string;
  repository: string;
  run_id: string;
  run_attempt: string;
  trigger: string;
  forced: boolean;
  wanted_usd: number;
  caller_limit_usd?: number;
  account_limit_usd: number;
  repository_limit_usd?: number;
  now?: number;
}

export type ReserveOutput =
  | {
      ok: true;
      reservation_id: string;
      granted_usd: number;
      account_left_usd: number;
      repository_left_usd: number | null;
      day: string;
    }
  | {
      ok: false;
      reason: "limit" | "repository_limit";
      account_spent_usd: number;
      account_limit_usd: number;
      day: string;
      resets_at: string;
    };

export interface SettleInput {
  reservation_id: string;
  /** The caller's repository: an entry reserved by another repository is not found. */
  repository_id: string;
  spent_usd: number;
  now?: number;
}

export type SettleOutput = { ok: true; entry: Entry } | { ok: false; status: 404 };

export interface Entry {
  id: string;
  day: string;
  repository_id: string;
  repository: string;
  run_id: string;
  run_attempt: string;
  trigger: string;
  forced: boolean;
  reserved_usd: number;
  settled_usd: number | null;
  created_at: string;
  settled_at: string | null;
}

export interface TodayOutput {
  day: string;
  limit_usd: number;
  spent_usd: number;
  by_repository: { repository: string; usd: number }[];
}

type Row = {
  id: string;
  day: string;
  repository_id: string;
  repository: string;
  run_id: string;
  run_attempt: string;
  trigger: string;
  forced: number;
  reserved_micro: number;
  settled_micro: number | null;
  created_at: string;
  settled_at: string | null;
};

const MICRO = 1_000_000;
const DAY_MS = 86_400_000;
/** Raw rows are kept 90 days (spec, "Data"). */
const RETENTION_DAYS = 90;

const toMicro = (usd: number): number => Math.round(usd * MICRO);
const toUsd = (micro: number): number => micro / MICRO;
const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);
/** The next 00:00:00Z strictly after `now`. */
const nextMidnight = (now: number): string => new Date((Math.floor(now / DAY_MS) + 1) * DAY_MS).toISOString();

function toEntry(row: Row): Entry {
  return {
    id: row.id,
    day: row.day,
    repository_id: row.repository_id,
    repository: row.repository,
    run_id: row.run_id,
    run_attempt: row.run_attempt,
    trigger: row.trigger,
    forced: row.forced === 1,
    reserved_usd: toUsd(row.reserved_micro),
    settled_usd: row.settled_micro === null ? null : toUsd(row.settled_micro),
    created_at: row.created_at,
    settled_at: row.settled_at,
  };
}

export class LedgerAccount extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // Synchronous SQL in the constructor completes before any request is delivered.
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      run_id TEXT NOT NULL,
      run_attempt TEXT NOT NULL,
      trigger TEXT NOT NULL,
      forced INTEGER NOT NULL,
      reserved_micro INTEGER NOT NULL,
      settled_micro INTEGER,
      created_at TEXT NOT NULL,
      settled_at TEXT
    )`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS entries_day ON entries (day, repository_id)");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS entries_run ON entries (run_id)");
  }

  /** Spend in micro-dollars for a day, optionally for one repository, optionally excluding one entry. */
  private spent(day: string, repositoryId: string | null, excludeId: string | null): number {
    const row = this.ctx.storage.sql
      .exec<{ micro: number }>(
        `SELECT COALESCE(SUM(COALESCE(settled_micro, reserved_micro)), 0) AS micro FROM entries
         WHERE day = ? AND (? IS NULL OR repository_id = ?) AND (? IS NULL OR id != ?)`,
        day,
        repositoryId,
        repositoryId,
        excludeId,
        excludeId,
      )
      .one();
    return row.micro;
  }

  /**
   * Reserves up to `wanted_usd` for a run (ADR 0021). Refuses when the account, or the
   * repository's own limit, has nothing left today, unless `forced`.
   *
   * Atomic by construction: the method is synchronous (sql.exec does not await), so the read,
   * the computation and the write run with no await in between and no other call to this object
   * can interleave. Concurrent reserves are serialized one after the other.
   *
   * A reserve whose `run_id` already has an unsettled entry today from a lower `run_attempt`
   * replaces that entry in place (a settled entry is real spend and is kept): the dead attempt is excluded from the day's spend, the row takes the new
   * attempt and amount, its settlement is cleared, and it gets a NEW reservation id, so a late
   * settle from the old attempt answers 404 instead of overwriting the retry's spend. An entry
   * from an earlier day is left on its day (that spend happened then) and the retry gets a new row.
   */
  reserve(i: ReserveInput): ReserveOutput {
    const now = i.now ?? Date.now();
    const day = dayOf(now);
    const sql = this.ctx.storage.sql;

    sql.exec("DELETE FROM entries WHERE day < ?", dayOf(now - RETENTION_DAYS * DAY_MS));

    const earlier = sql
      .exec<{ id: string; run_attempt: string; settled_micro: number | null }>(
        "SELECT id, run_attempt, settled_micro FROM entries WHERE run_id = ? AND day = ? ORDER BY created_at DESC LIMIT 1",
        i.run_id,
        day,
      )
      .toArray()[0];
    // A settled entry is real spend and is never replaced: the retry gets a new row beside it.
    const replaced =
      earlier !== undefined && earlier.settled_micro === null && Number(earlier.run_attempt) < Number(i.run_attempt)
        ? earlier.id
        : null;

    const spent = this.spent(day, null, replaced);
    const repoSpent = this.spent(day, i.repository_id, replaced);
    const accountLeft = toMicro(i.account_limit_usd) - spent;
    const repoLeft = i.repository_limit_usd !== undefined ? toMicro(i.repository_limit_usd) - repoSpent : null;
    const callerLeft = i.caller_limit_usd !== undefined ? toMicro(i.caller_limit_usd) - repoSpent : null;

    const repositoryFull = (repoLeft !== null && repoLeft <= 0) || (callerLeft !== null && callerLeft <= 0);
    if (!i.forced && (accountLeft <= 0 || repositoryFull)) {
      return {
        ok: false,
        reason: accountLeft <= 0 ? "limit" : "repository_limit",
        account_spent_usd: toUsd(spent),
        account_limit_usd: i.account_limit_usd,
        day,
        resets_at: nextMidnight(now),
      };
    }

    const wanted = toMicro(i.wanted_usd);
    // Past the checks above every left is positive for a non-forced call, so the grant is positive.
    const granted = i.forced
      ? wanted
      : Math.min(wanted, accountLeft, repoLeft ?? Infinity, callerLeft ?? Infinity);

    const id = crypto.randomUUID();
    const createdAt = new Date(now).toISOString();
    if (replaced !== null) {
      sql.exec(
        `UPDATE entries SET id = ?, run_attempt = ?, trigger = ?, forced = ?, reserved_micro = ?,
         settled_micro = NULL, settled_at = NULL, created_at = ? WHERE id = ?`,
        id,
        i.run_attempt,
        i.trigger,
        i.forced ? 1 : 0,
        granted,
        createdAt,
        replaced,
      );
    } else {
      sql.exec(
        `INSERT INTO entries (id, day, repository_id, repository, run_id, run_attempt, trigger, forced,
         reserved_micro, settled_micro, created_at, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
        id,
        day,
        i.repository_id,
        i.repository,
        i.run_id,
        i.run_attempt,
        i.trigger,
        i.forced ? 1 : 0,
        granted,
        createdAt,
      );
    }

    return {
      ok: true,
      reservation_id: id,
      granted_usd: toUsd(granted),
      account_left_usd: toUsd(accountLeft - granted),
      repository_left_usd: repoLeft === null ? null : toUsd(repoLeft - granted),
      day,
    };
  }

  /**
   * Replaces a reservation's amount with the real spend (ADR 0021). Idempotent: a second settle
   * returns the stored entry unchanged. The entry keeps the day it was reserved on.
   */
  settle(i: SettleInput): SettleOutput {
    const sql = this.ctx.storage.sql;
    const row = sql.exec<Row>("SELECT * FROM entries WHERE id = ?", i.reservation_id).toArray()[0];
    if (row === undefined || row.repository_id !== i.repository_id) return { ok: false, status: 404 };
    if (row.settled_micro !== null) return { ok: true, entry: toEntry(row) };

    const settled = { ...row, settled_micro: toMicro(i.spent_usd), settled_at: new Date(i.now ?? Date.now()).toISOString() };
    sql.exec(
      "UPDATE entries SET settled_micro = ?, settled_at = ? WHERE id = ?",
      settled.settled_micro,
      settled.settled_at,
      row.id,
    );
    return { ok: true, entry: toEntry(settled) };
  }

  /** Today's totals for the account, by repository (ADR 0022). Tags are folded in by the Worker. */
  today(limitUsd: number, now?: number): TodayOutput {
    const day = dayOf(now ?? Date.now());
    const rows = this.ctx.storage.sql
      .exec<{ repository: string; micro: number }>(
        `SELECT MAX(repository) AS repository, SUM(COALESCE(settled_micro, reserved_micro)) AS micro
         FROM entries WHERE day = ? GROUP BY repository_id ORDER BY micro DESC, repository ASC`,
        day,
      )
      .toArray();
    return {
      day,
      limit_usd: limitUsd,
      spent_usd: toUsd(this.spent(day, null, null)),
      by_repository: rows.map((r) => ({ repository: r.repository, usd: toUsd(r.micro) })),
    };
  }
}
