# The usage telemetry API

This is the contract between the Wachiman CLI and the receiver of its opt-in usage summaries. It is
written so that you can check what the client sends, and so that anyone can point
`WACHIMAN_TELEMETRY_URL` at a receiver of their own while testing. The receiver itself is not in this
repository. The decision is [ADR 0065](adr/0065-usage-metrics-are-sent-only-after-opt-in-and-never-carry-an-account-identifier.md);
the design is the [optional usage telemetry spec](specs/2026-11-24-optional-usage-telemetry-design.md);
what the CLI does and when is in [on-your-machine.md](on-your-machine.md#telemetry).

Nothing is sent unless you answered yes in `wachiman init` or with `wachiman telemetry on`, and never
when `DO_NOT_TRACK`, `CI` or `GITHUB_ACTIONS` is set or `WACHIMAN_TELEMETRY` is `0`, `false`, `off` or `no` (any case).

## The route

`POST https://usage.wachiman-api.dev/v1/usage`, once when a `wachiman local` review or a `wachiman ask`
answer finishes, including an `ask` that failed and wrote no answer, and not when you interrupt the run.
`WACHIMAN_TELEMETRY_URL` replaces the address, but only with an `https:` URL, or `http:` on `localhost`,
`127.0.0.1` or `[::1]`. Any other value (`http://test-box:8080`, say) is not used, and nothing is sent;
`wachiman telemetry status` prints a warning when it sees one. The body is one JSON document (`content-type: application/json`) of schema
`wachiman.telemetry/1`, at most 4096 bytes. A larger summary is not sent. No header carries an
identifier, and the client sends no cookie and follows no redirect.

## The body

Every field is always present. The client builds it field by field from numbers and from values
checked against a fixed list; it never copies an object from the run.

| Field | Values |
| --- | --- |
| `format` | `"wachiman.telemetry/1"` |
| `installation` | a random UUID v4, made when you said yes, kept until `wachiman telemetry reset`. Not derived from anything |
| `version` | the Wachiman version (`1.2.3`, or `1.2.3-rc.1`); `"unknown"` when it is not a version number |
| `mode` | `"local"` or `"ask"` |
| `model` | `"opus"`, `"sonnet"`, `"haiku"` or `"other"` |
| `diff` | `{files, added, removed}`, counted over the files the review kept after the default excludes (lockfiles, generated files) and your own `exclude`, so it is not the size of the whole diff: non-negative integers, rounded to two significant figures (124 is 120) |
| `chunks` | `{planned, completed}`: review batches planned and finished (an `ask` is one) |
| `tokens` | `{input, output, cache_read, cache_write}`: an integer, or `null` when the provider gave none or gave 0: both arrive as `null` |
| `duration_s` | whole seconds |
| `outcome` | `{state, retries}`: `state` is `"complete"`, `"partial"` or `"failed"`; `retries` counts batches that needed a retry |
| `error` | `null`, or `"auth"`, `"quota"`, `"timeout"`, `"provider"`, `"git"` or `"other"`. Never a message. A stop on the spending cap is `"quota"`; a turn limit, a call whose output was not an answer, and anything unclassified are `"other"`. `"git"` is reserved: the two call sites send only after a provider ran |
| `findings` | `{blocker, fix, consider, info}`: the count of findings per severity, the engine's own lowercase severity keys. It is output volume, not confirmed bugs |
| `languages` | up to five lowercase names from a fixed extension table, for the files the review kept after those excludes, most files first |
| `layout` | `"distributed"` when a `wachiman local` run read siblings from the workspace manifest, otherwise `"unknown"`; `wachiman ask` always sends `"unknown"`. `"single"` and `"monorepo"` are reserved until a rule tells them apart |
| `day` | the UTC date of the review, `YYYY-MM-DD`, no time |

The languages the table can produce: css, c, cpp, csharp, dart, elixir, go, haskell, html, java,
javascript, json, kotlin, lua, markdown, php, protobuf, python, ruby, rust, scala, shell, sql,
svelte, swift, terraform, toml, typescript, vue, yaml.

It never carries code, prompts, model output, repository names, remotes, paths, file names, branch
names, error text, an email, a hostname, a machine ID, or an identifier of any account (GitHub,
Claude, OpenAI or any other), raw or hashed.

## The answers

| Status | Meaning | What the client does |
| --- | --- | --- |
| `204` | Accepted | Nothing |
| `400` | The body is not a valid `wachiman.telemetry/1` document | Nothing |
| `413` | The body is over 4096 bytes | Nothing |
| anything else, a timeout, or no answer | Not accepted | Nothing |

The client makes one attempt with a 2-second timeout and keeps no queue: nothing is retried, and the
review's output and exit code never depend on the answer. It prints nothing about it.

## What the receiver does

The receiver, run by Niway, accepts this schema and nothing else. It keeps no IP address in its
storage or logs, and it deletes raw events after 90 days, keeping aggregates only. It is separate
from the spend ledger: no shared accounts, keys or storage. This describes the receiver's intended
behavior and is **not verified** from this repository; the service is not here.

To ask for deletion, run `wachiman telemetry status` and send the installation ID with the request,
before any `wachiman telemetry reset`.
