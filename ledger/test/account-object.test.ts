import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { LedgerAccount, ReserveInput } from "../src/account-object";

declare global {
  namespace Cloudflare {
    interface Env {
      ACCOUNTS: DurableObjectNamespace<LedgerAccount>;
    }
  }
}

/** A fresh account object per test, so no test sees another's entries. */
function account() {
  return env.ACCOUNTS.get(env.ACCOUNTS.newUniqueId());
}

const NOON = Date.parse("2026-11-06T12:00:00Z");

let runs = 0;
function input(over: Partial<ReserveInput> = {}): ReserveInput {
  runs += 1;
  return {
    repository_id: "1",
    repository: "acme/app",
    run_id: `run-${runs}`,
    run_attempt: "1",
    trigger: "pull_request",
    forced: false,
    wanted_usd: 4,
    account_limit_usd: 6,
    now: NOON,
    ...over,
  };
}

describe("LedgerAccount", () => {
  it("grants min(wanted, account left)", async () => {
    const stub = account();
    const first = await stub.reserve(input());
    const second = await stub.reserve(input());
    expect(first).toMatchObject({ ok: true, granted_usd: 4, account_left_usd: 2, day: "2026-11-06" });
    expect(second).toMatchObject({ ok: true, granted_usd: 2, account_left_usd: 0, repository_left_usd: null });
  });

  it("$0.30 left grants $0.30; $0 left refuses with limit and resets_at = next 00:00 UTC", async () => {
    const stub = account();
    await stub.reserve(input({ wanted_usd: 5.7 }));
    const thirty = await stub.reserve(input({ wanted_usd: 1 }));
    expect(thirty).toMatchObject({ ok: true, granted_usd: 0.3, account_left_usd: 0 });
    const refused = await stub.reserve(input({ wanted_usd: 1 }));
    expect(refused).toEqual({
      ok: false,
      reason: "limit",
      account_spent_usd: 6,
      account_limit_usd: 6,
      day: "2026-11-06",
      resets_at: "2026-11-07T00:00:00.000Z",
    });
  });

  it("a repository limit refuses with repository_limit while the account still has room", async () => {
    const stub = account();
    const first = await stub.reserve(input({ wanted_usd: 3, repository_limit_usd: 2 }));
    expect(first).toMatchObject({ ok: true, granted_usd: 2, repository_left_usd: 0, account_left_usd: 4 });
    const refused = await stub.reserve(input({ wanted_usd: 1, repository_limit_usd: 2 }));
    expect(refused).toMatchObject({ ok: false, reason: "repository_limit", account_spent_usd: 2 });
    const other = await stub.reserve(input({ repository_id: "2", repository: "acme/api", wanted_usd: 1 }));
    expect(other).toMatchObject({ ok: true, granted_usd: 1 });
  });

  it("a repository with no room under its own caller_limit_usd is refused, not granted zero", async () => {
    const stub = account();
    await stub.reserve(input({ wanted_usd: 2, caller_limit_usd: 2 }));
    const refused = await stub.reserve(input({ caller_limit_usd: 2 }));
    expect(refused).toMatchObject({ ok: false, reason: "repository_limit", account_limit_usd: 6 });
    expect(await stub.reserve(input({ caller_limit_usd: 2, forced: true }))).toMatchObject({ ok: true, granted_usd: 4 });
  });

  it("caller_limit_usd only lowers the grant", async () => {
    const stub = account();
    expect(await stub.reserve(input({ caller_limit_usd: 2 }))).toMatchObject({ ok: true, granted_usd: 2 });
    const roomy = account();
    expect(await roomy.reserve(input({ caller_limit_usd: 10 }))).toMatchObject({ ok: true, granted_usd: 4 });
  });

  it("forced is granted past the limit and still recorded", async () => {
    const stub = account();
    await stub.reserve(input({ wanted_usd: 6 }));
    const forced = await stub.reserve(input({ forced: true, wanted_usd: 3 }));
    expect(forced).toMatchObject({ ok: true, granted_usd: 3, account_left_usd: -3 });
    const today = await stub.today(6, NOON);
    expect(today.spent_usd).toBe(9);
  });

  it("settle replaces reserved with spent; a second settle is a no-op; an unknown id is 404", async () => {
    const stub = account();
    const r = await stub.reserve(input({ wanted_usd: 4 }));
    if (!r.ok) throw new Error("expected a grant");
    const settled = await stub.settle({ reservation_id: r.reservation_id, spent_usd: 1.25, now: NOON + 60_000 });
    expect(settled).toMatchObject({ ok: true, entry: { reserved_usd: 4, settled_usd: 1.25, day: "2026-11-06" } });
    expect((await stub.today(6, NOON)).spent_usd).toBe(1.25);

    const again = await stub.settle({ reservation_id: r.reservation_id, spent_usd: 3, now: NOON + 120_000 });
    expect(again).toEqual(settled);
    expect((await stub.today(6, NOON)).spent_usd).toBe(1.25);

    expect(await stub.settle({ reservation_id: "nope", spent_usd: 1 })).toEqual({ ok: false, status: 404 });
  });

  it("an unsettled reservation stays counted; attempt 2 of the same run replaces attempt 1", async () => {
    const stub = account();
    const attempt1 = await stub.reserve(input({ run_id: "r42", run_attempt: "1", wanted_usd: 4 }));
    expect(attempt1).toMatchObject({ ok: true, granted_usd: 4 });
    // Attempt 1 was killed and never settled: its reservation still counts.
    expect((await stub.today(6, NOON)).spent_usd).toBe(4);

    // Attempt 2 re-reserves with attempt 1 excluded, so it gets the full 5 rather than 2.
    const attempt2 = await stub.reserve(input({ run_id: "r42", run_attempt: "2", wanted_usd: 5 }));
    expect(attempt2).toMatchObject({ ok: true, granted_usd: 5, account_left_usd: 1 });
    expect((await stub.today(6, NOON)).spent_usd).toBe(5);
    if (!attempt1.ok || !attempt2.ok) throw new Error("expected grants");
    expect(attempt2.reservation_id).not.toBe(attempt1.reservation_id);

    // The dead attempt's id no longer settles anything.
    expect(await stub.settle({ reservation_id: attempt1.reservation_id, spent_usd: 1 })).toEqual({ ok: false, status: 404 });
    const settled = await stub.settle({ reservation_id: attempt2.reservation_id, spent_usd: 2 });
    expect(settled).toMatchObject({ ok: true, entry: { run_attempt: "2", reserved_usd: 5, settled_usd: 2 } });
    expect((await stub.today(6, NOON)).spent_usd).toBe(2);
  });

  it("a reservation at 23:59:59 settles on the same day; a reserve at 00:00:00 sees zero", async () => {
    const stub = account();
    const late = Date.parse("2026-11-06T23:59:59Z");
    const midnight = Date.parse("2026-11-07T00:00:00Z");
    const r = await stub.reserve(input({ wanted_usd: 6, now: late }));
    if (!r.ok) throw new Error("expected a grant");
    expect(r.day).toBe("2026-11-06");

    const settled = await stub.settle({ reservation_id: r.reservation_id, spent_usd: 5, now: midnight + 30_000 });
    expect(settled).toMatchObject({ ok: true, entry: { day: "2026-11-06", settled_usd: 5 } });

    const fresh = await stub.reserve(input({ wanted_usd: 6, now: midnight }));
    expect(fresh).toMatchObject({ ok: true, granted_usd: 6, account_left_usd: 0, day: "2026-11-07" });
    expect((await stub.today(6, late)).spent_usd).toBe(5);
  });

  it("two concurrent reserves on $2 left grant at most $2 in total", async () => {
    const stub = account();
    const results = await Promise.all([
      stub.reserve(input({ wanted_usd: 4, account_limit_usd: 2 })),
      stub.reserve(input({ wanted_usd: 4, account_limit_usd: 2 })),
    ]);
    const granted = results.reduce((sum, r) => sum + (r.ok ? r.granted_usd : 0), 0);
    expect(granted).toBeLessThanOrEqual(2);
    expect(granted).toBe(2);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("today sums by repository", async () => {
    const stub = account();
    await stub.reserve(input({ wanted_usd: 1.5 }));
    const b = await stub.reserve(input({ wanted_usd: 2 }));
    await stub.reserve(input({ repository_id: "2", repository: "acme/api", wanted_usd: 1 }));
    if (!b.ok) throw new Error("expected a grant");
    await stub.settle({ reservation_id: b.reservation_id, spent_usd: 0.5 });
    // An entry from yesterday is not part of today.
    await stub.reserve(input({ wanted_usd: 3, now: NOON - 86_400_000 }));

    const today = await stub.today(6, NOON);
    expect(today.day).toBe("2026-11-06");
    expect(today.limit_usd).toBe(6);
    expect(today.spent_usd).toBe(3);
    expect(today.by_repository).toEqual([
      { repository: "acme/app", usd: 2 },
      { repository: "acme/api", usd: 1 },
    ]);
  });
});
