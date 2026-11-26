# Optional usage telemetry, asked once in `wachiman init`

- **Status:** proposed (2026-11-25). Designed, not built. Building waits for the trigger in
  [When to build it](#when-to-build-it).
- **ADRs:** [Usage metrics are sent only after opt-in, and never carry an account
  identifier](../adr/0065-usage-metrics-are-sent-only-after-opt-in-and-never-carry-an-account-identifier.md)
  (amends decision 5 of
  [the local-review architecture decision](../adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)).

## Summary (one minute)

Wachiman learns nothing today about how it is used outside the owner's machines: how big the
diffs are, how many chunks a review needs, what it costs in tokens, where it fails. This spec lets
an installation share those counts. Interactive `wachiman init` asks once, with No as the default.
After a yes, each review sends one small summary built from an allowlist of numbers and bounded
categories, linked by a random installation UUID. Code, prompts, model output, repository names,
paths and every account identifier (GitHub, Claude, OpenAI or any other) never leave the machine,
not even hashed.

It is not built yet. With one user, telemetry would only measure the owner, whose own runs are
already in the local history and `wachiman status`. Building it also replaces a public promise
("Wachiman sends no telemetry") that appears in the README, the guides and the website. So the
design is written now and the work starts when someone else uses Wachiman.

| Decision | Why | ADR |
| --- | --- | --- |
| Opt-in, asked once in interactive `init`, default No | Consent where setup already happens, like Angular CLI's analytics question; declining costs nothing | [0065](../adr/0065-usage-metrics-are-sent-only-after-opt-in-and-never-carry-an-account-identifier.md) |
| No account identifier, raw, hashed or derived | A hash of a GitHub login is still that login to anyone who hashes the same login | 0065 |
| A random UUID per installation, created on yes | Links reports from one installation over time without knowing who it is | 0065 |
| A summary from an allowlist of fields, never the SQLite index or history files | What is sent is what the schema lists, and nothing else can slip in | 0065 |
| Laptop only in the first version; Actions out | Consent belongs to the environment that runs; a workflow needs its own explicit switch, designed later | none |
| The receiver is a new hosted endpoint, apart from the spend ledger | The ledger knows accounts; keeping the two apart makes "no account identifier" checkable | none |
| Telemetry never fails a review and adds at most 2 seconds | One attempt with a 2-second timeout and a size cap, after the result is written | none |
| The intended rules are published now; "sends no telemetry" changes only in the release that starts sending | The later change then fulfils a published promise instead of reversing one; never claim what is not running | 0065 |

**Open questions.** Retention of raw events (proposed: 90 days, then aggregates only). How
`monorepo` is told apart from `single`. Whether the CLI shows the last payload
(`wachiman telemetry show`) or only writes it to a file.

**Out of scope.** Telemetry from Actions runs. Uploading past runs on opt-in. Publishing usage
statistics. Collecting review text or raw error messages. Treating finding counts as evidence of
correctness. A deletion command; to ask for deletion, `wachiman telemetry status` prints the
installation ID, which the owner sends with the request before any reset.

## When to build it

Build it when either is true:

- an installation outside the owner's machines is known (a user report, an issue, a download that
  is not the owner's), or
- the owner has a question about real usage that the local history cannot answer.

Until then the code says what it says today: Wachiman sends no telemetry.

## Consent

`wachiman init`, run in a terminal, asks once:

```text
Would you like to share usage metrics to help improve Wachiman?

Metrics include diff sizes, chunk counts, token usage, review duration,
error categories, finding counts, and repository languages and layout.
A random installation ID links your usage reports, so they are
pseudonymous, not anonymous. The receiver sees your network address
and does not keep it.

We do not send code, prompts, responses, repository names, file paths,
or identifiers from any of your accounts.

What is sent, and how to turn it off: <link to on-your-machine.md#telemetry>

Share usage metrics? [y/N]
```

- **Yes:** store the choice and a new random UUID (v4) in the user's Wachiman settings, not in the
  repository. Send a summary after each later review. Past runs are never sent.
- **No or Enter:** store No and never ask again. Reviews work exactly as before.
- **No terminal** (`--json`, `--yes`, CI, an agent): store nothing and send nothing; the question
  is asked at the next interactive `init`. `init --json` reports `"telemetry": "pending"` so an
  agent relays the question to the owner, who answers it or runs `wachiman telemetry on`; the agent
  never answers it. `init --dry-run` writes no choice and no UUID.
- **Later:** `wachiman telemetry on|off|status`. `on` is a consent like `init`'s: it needs a
  terminal, shows the same text and asks `[y/N]`, and refuses when `CI` or `GITHUB_ACTIONS` is set;
  `off` and `status` work anywhere. Off stops sending from the next review on. It
  does not delete what was received. A new `on` after an `off` keeps the same UUID;
  `wachiman telemetry reset` makes a new one.
- **`DO_NOT_TRACK`:** when it is set ([donottrack.sh](https://donottrack.sh/)), telemetry is off
  whatever the stored choice, exactly like `WACHIMAN_TELEMETRY=0`, and interactive `init` does not
  ask the question. The gate is `usageDataAllowed()` in `src/tracking.ts`; telemetry also
  checks that `CI` and `GITHUB_ACTIONS` are unset, which keeps the first version laptop only.
- **Environment override:** `WACHIMAN_TELEMETRY=0` turns it off for one process, whatever the
  stored choice. Nothing turns it on without the stored yes.

## What a summary holds

One JSON document per review, schema `wachiman.telemetry/1`, under 4 KB. Only these fields; the
client builds it field by field and never copies an object from the run.

| Field | Values |
| --- | --- |
| `installation` | the random UUID |
| `version` | Wachiman version |
| `mode` | `local`, `ask` |
| `model` | a known model family (`opus`, `sonnet`, `haiku`, `other`) |
| `diff` | changed files, added and removed lines, rounded to two significant figures |
| `chunks` | planned, completed |
| `tokens` | input, output, cache read, cache write; `null` when the provider gave none, never 0 |
| `duration_s` | whole seconds |
| `outcome` | `complete`, `partial`, `failed`, plus retries |
| `error` | one of a fixed list of categories (`auth`, `quota`, `timeout`, `provider`, `git`, `other`), never a message |
| `findings` | count per severity; output volume, not confirmed bugs |
| `languages` | up to five language names from a fixed list, computed locally from file extensions |
| `layout` | `single`, `monorepo`, `distributed`, `unknown` |
| `day` | the UTC date of the review, no time |

`layout` is `distributed` when the run read sibling repositories from the workspace manifest, which
the run already knows. Telling `monorepo` from `single` needs a rule (open question); until then it
is `unknown` rather than a guess. Sibling names are never sent.

## The receiver

A hosted endpoint, `POST /v1/usage`, that accepts the schema above and nothing else, operated by
Niway and separate from the spend ledger: no shared accounts, keys or storage. It keeps no IP
address in its storage or logs. Its HTTP contract is written in this repository before the
endpoint exists, like the spend ledger's ([ledger-api.md](../ledger-api.md)), so anyone can check
what the client sends against it. The service itself is not in this repository.

## Failure and resources

Sending happens after the review result is written, in the same process, with a 2-second timeout,
one attempt and no retry queue on disk, so nothing is ever pending between commands. A hanging
endpoint adds at most 2 seconds to the review's wall time. A failure is ignored and never changes the exit code or
the output. A summary over the size cap is not sent.

## What must change in the same release

- [on-your-machine.md](../on-your-machine.md#telemetry): the fields, the endpoint, how to turn it
  off. The rules already published in its Telemetry section are met by this design; the fields are
  listed there before the release.
- `README.md`, [local-review.md](../local-review.md), [faq.md](../faq.md): "sends no telemetry"
  becomes "sends no telemetry unless you opted in (in `wachiman init` or with
  `wachiman telemetry on`)".
- ADR 0019 decision 5, ADR 0039 and ADR 0042, by [ADR 0065](../adr/0065-usage-metrics-are-sent-only-after-opt-in-and-never-carry-an-account-identifier.md).
- The network-call inventory test behind on-your-machine.md gains the new call site.
- An entry in `wachimanDataCollection` in `package.json` (printed by `wachiman upgrade`) and a
  `CHANGELOG.md` call-out, as CONTRIBUTING.md requires for any change that sends usage data.
- [cli.md](../cli.md): the `init` question, the `wachiman telemetry` command, the `init --json`
  field, and its "Wachiman sends no usage data today" line.
- The website, privacy policy and terms change with the receiver, outside this repository.

## Verification the implementation must show

- A test that builds a summary from a run whose config, remotes, paths and environment hold
  marker strings (a GitHub login, an email, a repository name, a token) and asserts none appears.
- A test that no telemetry call happens without the stored yes, in `init` without a terminal, and
  with `WACHIMAN_TELEMETRY=0`.
- A test that a failing or hanging endpoint leaves the review's output and exit code unchanged and
  adds no more than the timeout to its wall time.
- A test that with a stored yes and `CI` or `GITHUB_ACTIONS` set no call is made (laptop only), and
  that `wachiman telemetry on` refuses without a terminal.
- A test that with a stored yes and `DO_NOT_TRACK` set no call is made, and that interactive `init`
  does not ask while it is set.
- The schema in `docs/` and the client's builder are checked against each other by a test.
