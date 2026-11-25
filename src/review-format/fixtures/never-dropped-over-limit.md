👮 **Wachiman** · 🔴 **1 blocker before merge** · 30 to fix in this PR · 6 to investigate · 8 pre-existing issues to fix, not from this PR · whole PR at `d6f4431`

| At a glance | |
| --- | --- |
| **Findings** | 🔴 1 blocker · 🟠 30 to fix · 🟡 0 to consider · ⚪ 0 for your information (31) · 8 pre-existing · 6 needs investigation · 1 Must · 30 Should |
| **Risk** | High: top fact `data` at `store.ts:40`, see Risk facts |
| **Coverage** | 4 of 4 files reviewed, whole pull request |
| **Read first** | `store.ts` |

### To fix (31)

| | Where | Finding |
| --- | --- | --- |
| 🔴 Blocker · Must · 🔐 security | [`store.ts:3`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L3) | The token is written to the log |
| 🟠 Fix · Should · 🐛 bug | [`store.ts:10`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L10) | Fix number 1: the handler of case 1 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`session.ts:11`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L11) | Fix number 2: the handler of case 2 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`routes.ts:12`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/routes.ts#L12) | Fix number 3: the handler of case 3 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`auth.ts:13`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/auth.ts#L13) | Fix number 4: the handler of case 4 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`cache.ts:14`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/cache.ts#L14) | Fix number 5: the handler of case 5 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`queue.ts:15`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/queue.ts#L15) | Fix number 6: the handler of case 6 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`store.ts:16`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L16) | Fix number 7: the handler of case 7 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`session.ts:17`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L17) | Fix number 8: the handler of case 8 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`routes.ts:18`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/routes.ts#L18) | Fix number 9: the handler of case 9 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`auth.ts:19`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/auth.ts#L19) | Fix number 10: the handler of case 10 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`cache.ts:20`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/cache.ts#L20) | Fix number 11: the handler of case 11 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`queue.ts:21`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/queue.ts#L21) | Fix number 12: the handler of case 12 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`store.ts:22`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L22) | Fix number 13: the handler of case 13 drops its error |
| 🟠 Fix · Should · 🐛 bug | [`session.ts:23`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L23) | Fix number 14: the handler of case 14 drops its error |

- … and 16 more not shown because of GitHub's size limit, they are on their lines.

### Needs investigation (6)

| | Where | Finding |
| --- | --- | --- |
| Needs investigation · 🟠 Fix · Should · 🔐 security | [`queue.ts:5`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/queue.ts#L5) | Inconclusive fix 1 |

- … and 5 more not shown because of GitHub's size limit.

### Risk facts

- `data` · [`store.ts:40`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L40) — Fact 1: data is written here without a check.
- … and 11 more not shown because of GitHub's size limit

### Pre-existing (8)

- … and 8 more not shown because of GitHub's size limit.

<details><summary>Details of findings with no thread (1)</summary>

**Inconclusive fix 1 (confidence high)** ([`queue.ts:5`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/queue.ts#L5))

Inconclusive fix 1: the first paragraph says what goes wrong.

</details>

<sub>Answer a finding in its thread: `Verdict: correct` or `Verdict: wrong`, and why.</sub>

<!-- wachi:receipt eyJhY2NvdW50IjoiYWNjdC0xIiwicmVwb3NpdG9yeSI6ImFjbWUvc2hvcCIsInJ1bl9pZCI6InJ1bi0xIiwidXNkIjowLjEyLCJkYXkiOiIyMDI2LTExLTE0In0.c2lnbmF0dXJl -->

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · 5 in / 1.2k out · $0.12</sub>

<!-- wachi:auto -->

<!-- wachi:review -->

<!-- wachiman sha=d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->