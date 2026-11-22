👮 **Wachiman** · ⚠️ **Partial: 10 of 18 files not reviewed** · 2 blockers before merge · 2 to fix in this PR · 1 pre-existing issue to fix, not from this PR · 10 to consider · whole PR at `d6f4431`

> ⚠️ **Partial review.** Reviewed 8 of 18 files. Not reviewed: 10 (10 not reached: the pull request's budget was spent).
> The file names are not listed because of GitHub's size limit. Ask `/wachiman review <paths>` for the rest.

ℹ️ **GitHub would not anchor these findings on their lines**, so none of them is an inline comment. Each finding is listed once below, with a number.

| At a glance | |
| --- | --- |
| **Findings** | 🔴 2 blockers · 🟠 2 to fix · 🟡 10 to consider · ⚪ 3 for your information (17) · 1 pre-existing · 2 Must · 2 Should · 10 Could · 3 FYI |
| **Risk** | At least high: 10 files were not reviewed; top fact `auth` at `auth.ts:200`, see Risk facts |
| **Coverage** | 8 of 18 files reviewed, whole pull request; 10 not reviewed, file names not listed because of GitHub's size limit. Ask `/wachiman review <paths>` for the rest |
| **Read first** | `auth.ts` |

### To fix (4)

| # | | Where | Finding |
| --- | --- | --- | --- |
| 1 | 🔴 Blocker · Must · 🔐 security | [`store.ts:3`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L3) | The token is written to the log |
| 2 | 🔴 Blocker · Must · 🔐 security | [`auth.ts:200`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/auth.ts#L200) | The admin route has no authorisation check |
| 3 | 🟠 Fix · Should · 🐛 bug | [`store.ts:21`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L21) | The cache is never invalidated |
| 4 | 🟠 Fix · Should · 🐛 bug | [`session.ts:9`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L9) | The timeout is read in seconds but used as milliseconds |

<details><summary>To consider (10)</summary>

| # | | Where | Finding |
| --- | --- | --- | --- |
| 5 | 🟡 Consider · Could · 🧹 cleanup | [`store.ts:30`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L30) | Small issue number 1 |
| 6 | 🟡 Consider · Could · 🧪 tests | [`session.ts:31`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L31) | Small issue number 2 |
| 7 | 🟡 Consider · Could · 🧹 cleanup | [`routes.ts:32`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/routes.ts#L32) | Small issue number 3 |
| 8 | 🟡 Consider · Could · 🧪 tests | [`auth.ts:33`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/auth.ts#L33) | Small issue number 4 |
| 9 | 🟡 Consider · Could · 🧹 cleanup | [`cache.ts:34`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/cache.ts#L34) | Small issue number 5 |
| 10 | 🟡 Consider · Could · 🧪 tests | [`queue.ts:35`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/queue.ts#L35) | Small issue number 6 |
| 11 | 🟡 Consider · Could · 🧹 cleanup | [`store.ts:36`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L36) | Small issue number 7 |
| 12 | 🟡 Consider · Could · 🧪 tests | [`session.ts:37`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L37) | Small issue number 8 |
| 13 | 🟡 Consider · Could · 🧹 cleanup | [`routes.ts:38`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/routes.ts#L38) | Small issue number 9 |
| 14 | 🟡 Consider · Could · 📝 docs | [`queue.ts`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/queue.ts) | The queue's header comment is out of date |

</details>

### Risk facts

- `auth` · [`auth.ts:200`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/auth.ts#L200) — The admin route is reachable without a session.

### Pre-existing (1)

| # | | Where | Finding |
| --- | --- | --- | --- |
| 15 | Pre-existing · 🟠 Fix · Should · 🐛 bug | [`session.ts:70`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L70) | The session manager never closes the store |

<details><summary>Details of each finding (5)</summary>

**1. The token is written to the log (confidence high)** ([`store.ts:3`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L3))

The token is written to the log: the first paragraph says what goes wrong.

The second paragraph says how to reproduce it and what to change. Sentence 1 of the model's account of what it read. Sentence 2 of the model's account of what it read. Sentence 3 of the model's account of what it read. Sentence 4 of the model's account of what it read. Sentence 5 of the model's account of what it read. Sentence 6 of the model's account of what it read.

**2. The admin route has no authorisation check (confidence high)** ([`auth.ts:200`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/api/auth.ts#L200))

The admin route has no authorisation check: the first paragraph says what goes wrong.

The second paragraph says how to reproduce it and what to change. Sentence 1 of the model's account of what it read. Sentence 2 of the model's account of what it read. Sentence 3 of the model's account of what it read. Sentence 4 of the model's account of what it read. Sentence 5 of the model's account of what it read. Sentence 6 of the model's account of what it read.

**3. The cache is never invalidated (confidence high)** ([`store.ts:21`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/store.ts#L21))

The cache is never invalidated: the first paragraph says what goes wrong.

The second paragraph says how to reproduce it and what to change. Sentence 1 of the model's account of what it read. Sentence 2 of the model's account of what it read. Sentence 3 of the model's account of what it read. Sentence 4 of the model's account of what it read. Sentence 5 of the model's account of what it read. Sentence 6 of the model's account of what it read.

**4. The timeout is read in seconds but used as milliseconds (confidence high)** ([`session.ts:9`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L9))

The timeout is read in seconds but used as milliseconds: the first paragraph says what goes wrong.

The second paragraph says how to reproduce it and what to change. Sentence 1 of the model's account of what it read. Sentence 2 of the model's account of what it read. Sentence 3 of the model's account of what it read. Sentence 4 of the model's account of what it read. Sentence 5 of the model's account of what it read. Sentence 6 of the model's account of what it read.

**15. The session manager never closes the store (confidence high)** ([`session.ts:70`](https://github.com/acme/shop/blob/d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/session.ts#L70))

The session manager never closes the store: the first paragraph says what goes wrong.

The second paragraph says how to reproduce it and what to change. Sentence 1 of the model's account of what it read. Sentence 2 of the model's account of what it read. Sentence 3 of the model's account of what it read. Sentence 4 of the model's account of what it read. Sentence 5 of the model's account of what it read. Sentence 6 of the model's account of what it read.

</details>

<!-- wachi:receipt eyJhY2NvdW50IjoiYWNjdC0xIiwicmVwb3NpdG9yeSI6ImFjbWUvc2hvcCIsInJ1bl9pZCI6InJ1bi0xIiwidXNkIjowLjEyLCJkYXkiOiIyMDI2LTExLTE0In0.c2lnbmF0dXJl -->

<sub>Claude Sonnet 5.5 via Claude Code 2.1.304 · effort high · review · 5 in / 1.2k out · $0.12</sub>

<!-- wachi:auto -->

<!-- wachi:review -->

<!-- wachi:partial sha=d6f4431aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa state=eyJyIjpbXSwidCI6W119 -->