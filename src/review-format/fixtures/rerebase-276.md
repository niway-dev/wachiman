👮 **Wachiman** · 🟠 **1 to fix in this PR** · 2 to consider · changes since `4660fb4` at `5644837`

| At a glance | |
| --- | --- |
| **Findings** | 🔴 0 blockers · 🟠 1 to fix · 🟡 2 to consider · ⚪ 0 for your information (3) · 2 Should · 1 Could |
| **Risk** | Low (this push only): no risk facts reported, no risky paths |
| **Coverage** | 3 of 3 files reviewed, changes since `4660fb4` (4 commits: `ea6c1bb`, `c0ac2fd`, `074c294`, `5644837`) |
| **Earlier threads** | none open |
| **Read first** | `pr-state-wait.ts`, `pr-state-wait.test.ts`, `pr-state.md` |

### To fix (1)

| | Where | Finding |
| --- | --- | --- |
| 🟠 Fix · Should · 🐛 bug | [`pr-state-wait.ts:284`](https://github.com/niway-dev/wachiman/blob/5644837662a947a898d9e8974724695ce8996c03/src/pr-state-wait.ts#L284) | realWaitDeps.openListener passes the remaining time as the \`gh\` probe, so the real listener never opens |

### To consider (2)

| | Where | Finding |
| --- | --- | --- |
| 🟡 Consider · Could · 🧪 tests | [`pr-state-wait.test.ts:361`](https://github.com/niway-dev/wachiman/blob/5644837662a947a898d9e8974724695ce8996c03/src/pr-state-wait.test.ts#L361) | Hang tests have no coverage of the production wiring and rely on wall-clock bounds |
| 🟡 Consider · Should · 📝 docs | [`pr-state-wait.ts:259`](https://github.com/niway-dev/wachiman/blob/5644837662a947a898d9e8974724695ce8996c03/src/pr-state-wait.ts#L259) | Doc comment line is much longer than its neighbours |

<details><summary>What the change connects to (3 closed, 0 open)</summary>

Questions the reviewer answered about what this change does to the running product. The engine checked that the cited lines exist, not that the answers are true.

**Closed, with the lines they rest on**

- Probe `gh event listen --help` with a timeout capped by the time left before the deadline (`src/pr-state-wait.ts:191`) — A hanging `gh` no longer pushes the wait past `--timeout`. The probe still blocks the event loop synchronously for up to min(5 s, time left). The wait ends with a timeout document. If it fails: The probe is bounded by min(5 s, remaining). `Bun.spawn` and `listenerOver` are non-blocking. However `realWaitDeps.openListener` passes the number as the `gh` argument (line 284), so in production t… Evidence: `src/pr-state-wait.ts:121`, `src/pr-state-wait.ts:168-176`, `src/pr-state-wait.ts:189-196`, `src/pr-state-wait.ts:284`.
- Mark the listener dead when its event stream ends or breaks while the process lives (`src/pr-state-wait.ts:230`) — One stderr line. stdout is unchanged and stays a single JSON object. If it fails: Both the stream end and a stream error reach the same code after the try/catch. A stream that ended while `pending` was set still reports "event" first, which is correct. Evidence: `src/pr-state-wait.ts:219-246`, `src/pr-state-wait.ts:128-132`.
- Handle SIGHUP in the wait's signal handlers (`src/pr-state-wait.ts:265`) — The `gh event listen` child no longer outlives a closed terminal or a launcher-forwarded SIGHUP. If it fails: Handlers are installed only while waiting and removed in `finally`. A signal that arrives during a blocking `gh` call is handled when that call ends, which is bounded by the deadline. Evidence: `src/pr-state-wait.ts:85`, `src/pr-state-wait.ts:263-278`, `src/pr-state-wait.ts:151-154`.

</details>

<details><summary>What the reviewer checked</summary>

The probe is now bounded by the deadline, a dead stream falls back to polling, and SIGHUP is handled. One real bug: `realWaitDeps.openListener` is still `openGhEventListener` itself. The loop now passes the remaining time as the second argument, which that function reads as the `gh` probe. In production the listener therefore never opens and every wait silently polls. The tests inject their own openers and miss it.

</details>

<details><summary>Coverage by batch</summary>

| Batch | Files | Lines | Highest risk | Status | Turns | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| Batch 1 of 1 | 3 | 159 | 4 | reviewed | 6 | $0.14 |

</details>

<details><summary>Details of findings with no thread (1)</summary>

**realWaitDeps.openListener passes the remaining time as the `gh` probe, so the real listener never opens (confidence high)** ([`pr-state-wait.ts:284`](https://github.com/niway-dev/wachiman/blob/5644837662a947a898d9e8974724695ce8996c03/src/pr-state-wait.ts#L284))

The loop now calls `deps.openListener(repo, remainingMs)` (line 121), but `openGhEventListener` has the signature `(repo, gh: GhProbe = realGhProbe, remainingMs = PROBE_LIMIT_MS)` (line 168), and `realWaitDeps.openListener` is set to it directly (line 284). In production the number of milliseconds therefore lands in the `gh` parameter. `gh.supported(remainingMs)` throws a TypeError, the `catch` at line 173 returns null, and every real `--wait` falls back to polling and prints "gh event listen is not available". `src/cli.ts:361` is the only runtime caller and it uses `realWaitDeps`. Under `strictFunctionTypes` this assignment should also fail the type check, because `number` is not assignable to `GhProbe`. The tests never catch it: every wait test injects a lambda such as `(repo, ms) => openGhEventListener(repo, makeGhProbe(hang), ms)`, and none uses `realWaitDeps.openListener`. Fix: set `openListener: (repo, remainingMs) => openGhEventListener(repo, realGhProbe, remainingMs)`. Add a test that calls `realWaitDeps.openListener` with a time limit.

</details>

<sub>Answer a finding in its thread: `Verdict: correct` or `Verdict: wrong`, and why.</sub>

<!-- wachi:receipt eyJhY2NvdW50Ijoibml3YXkiLCJyZXBvc2l0b3J5Ijoibml3YXktZGV2L3dhY2hpbWFuIiwicnVuX2lkIjoiNDQ4ODQ5MTM5OTIiLCJ1c2QiOjAuMTQyMjcyLCJkYXkiOiIyMDI2LTExLTIxIn0.-HIIdsfT3xC0dteQTWV5K8ngwFKZpmSN0Fk5eh4ZD_MugK9NaD7OM1PxAlGSivZhBHjjyCVviQR47a3BWt_1DQ -->

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · re-review · 4 commits · 8 in / 3.5k out / 80k cache read / 25k cache write · Claude subscription: API-equivalent estimate, not a bill · $0.14</sub>

<!-- wachi:review -->

<!-- wachiman sha=5644837662a947a898d9e8974724695ce8996c03 -->