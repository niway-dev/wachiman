# Flow questions, evidence and admitted investigation

- **Status:** proposed 2026-10-31. Written on Claude Fable 5.1 after an adversarial review by
  GPT-6.1 Sol and two research notes. **Implemented: decisions 1, 2, 3 and 9** (flow questions and
  failure-path question in the prompt, `contracts[]` with a citation check, the PR body as a claim
  to verify, `confidence` on findings). Nothing else is built: decisions 4 to 8 and 10 to 14, and
  the ablation and replay under Measurement, have not been done.
- **Creates:** ADR 0009 (investigation requested by the model, admitted by the engine).
  Reuses ADR 0001 (budgets in the workflow, no hosted service), ADR 0003 (labels), ADR 0006
  (repository policy from base).
- **Refs:** #43; [field benchmark](../benchmark/2026-10-31/README.md);
  [Sol's critique](../research/2026-10-31-sol-critique-risk-map-and-depth.md);
  [harness options](../research/2026-10-31-harness-options.md);
  [multi-language mapping](../research/2026-10-31-multi-language-mapping-deep.md)

## In one minute

**Summary.** Wachi reads every file and misses the question a good human reviewer asks: *what
does this change do to the running app, compared with what existed?* Five real PRs show it: the
competitor caught the top user-facing bug on four of five by following an action to its effect;
Wachi, at 43 % of the cost, caught 17 other valid things and none of those four. This design adds
that question to every batch, gives the model the evidence to answer it (a deterministic map of
what the new code connects to), and lets the model *ask* for more investigation while the engine
*admits* it under a finite budget. Breadth stays; depth is added where the model shows it is
needed, and paid for from a separate reserve.

**Decisions.**

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | Every batch answers the **flow questions** for each new user action or new call into existing code: what changes, which existing path does the same, what that path does before and after, how the result reaches the visible state; for state loaded once, what happens when background work finishes and on leave-and-return | These are the questions whose answers were in unchanged files on #464, #465, #466, #467. Asking is cheap; gating them on a risk score would have skipped the 14-file PR | none |
| 2 | Batch output gains `contracts[]`: one entry per question, `closed` with `evidence[]` (file:line) or `open` with `open_question` and `candidates[]`. The engine checks shape and that every cited line exists; it never marks a contract true | Makes the question answerable and auditable without pretending code can judge the answer | 0009 |
| 3 | The PR body is a list of **claims to verify**, named as such in the prompt, never a summary the batches inherit | "The runner is reused unchanged" was true on #467 and hid the bug. No model-written PR summary is distributed to batches | none |
| 4 | The engine builds a **risk map** before batching: for each symbol the diff adds, changes or newly calls, its definition, references (array with `kind`), count, import edges, and *new connections* to existing code including qualified member calls (`window.electronAPI.startFileDrag`) and literal channel strings. Every entry carries `provenance` (`module_scan`, `text_match`, `history`) and `status` (`complete`, `truncated`, `unsupported`) | Candidates with provenance, not a verdict. Textual matches are labelled textual | none |
| 5 | The map is a file in the run dir (like `pr.json`); each batch prompt inlines its slice, capped, with a pointer to the whole file | The model reads auxiliary files today via `--add-dir`; no new tool, no new permission | reuses 0001 |
| 6 | The model may return `needs_investigation` (question, premises, candidate files). The engine **admits** at most N per review from a **separate reserve**, never from the coverage budget, with no recursion; unadmitted ones stay as open contracts with the reason | Judgement in the model, execution in the engine. Automatic, no manual command needed; `/wachi review deeply` stays as an override | 0009 |
| 7 | Admission starts in **observation mode**: requests are logged in the review footer and measured; no extra call is made until the ablation says it pays | A budget cap alone does not stop the model from steering the work; the policy must be finite and visible | 0009 |
| 8 | Open contracts are dispatched in this order: investigate now (code is in the repo and admitted); hand once to a later batch that holds the missing file; ask the author only when product intent or external facts are missing | Publishing every open item as `question` would push the reviewer's homework onto the author | none |
| 9 | Findings gain a `confidence` field (`high`, `medium`, `low`), separate from `severity`, following CodeQL's split of `@precision` and `@problem.severity`. The evidence rule already forces low-confidence items into `question`; the field makes precision measurable by level | Severity says how bad if true; confidence says how sure. Precision per confidence level is the number that calibrates the prompt | reuses 0003 |
| 10 | Harness knobs: add `--max-turns` (exists in Claude Code 2.1.316; verify on the pinned version) and map `error_max_turns`; keep `--max-budget-usd` as the soft cap and the engine's hard stop; add a wall-clock kill | Two belts: harness and engine, turns and dollars | none |
| 11 | No OpenCode adapter now. Subscription use is wired later through the unmodified Claude Code binary (`CLAUDE_CODE_OAUTH_TOKEN` in the allowlist, `preflight()` accepting either credential) as a workflow input | OpenCode has no structured output or dollar cap, forbids Claude subscription use, weighs 214 MB, and would lose `--restricted` and `--json-schema` | reuses 0001 |
| 12 | No MCP, no new interactive tools. Engine-written context files are the channel | A review run in Pullfrog uses four MCP tools and the server is unauthenticated on loopback; 75–90 % of its cost is re-reading context over 25–45 turns, not MCP. Nothing to gain for an engine that posts the review itself | reuses 0001 |
| 13 | Risk indicators from history (relative churn, change frequency and recency, co-change) are computed and shown, **not summed into a score** and **not used to gate** anything | Owner: each indicator weighs differently per codebase; calibrate after measuring. Co-change missed the real link on #465 (shared API use, not co-editing) | none |
| 14 | Multi-language: `git grep -nw` with extension filters is the floor everywhere; **vendored tree-sitter WASM** (web-tree-sitter 0.25.10 plus grammar files, ~5 MB for TS/TSX/Go/Python/Java/Rust, 12.3 MB with Kotlin and Swift) is the AST layer, TS/TSX first. ast-grep only as a dev-time check | Pullfrog's own impact tool is regex + one `git grep` (parity for the floor). Measured: grep alone misses aliased consumers (`libraryChanged` → `onLibraryChanged`, 0 of 2) and property-named handlers; tree-sitter resolves them and returns member calls with positions. This adds vendored third-party code: ADR 0002 gets a new reopen condition, below | reopens 0002 |

**Open questions.**

1. N for admitted investigations and the size of the reserve. Default: N = 3 per review,
   reserve = 25 % of the PR budget, both workflow inputs.
2. Whether a small classifier (TypeSafe's Jev, a hosted "System One" model returning calibrated
   yes/no) should pre-screen `needs_investigation`. Acceptable only with the consumer's own key,
   like any provider. Default: not in v1; log the data the classifier would need.
3. Where the bridge list lives (`electronAPI`, `ipcRenderer`, event names) for qualified calls.
   Default: the focus file, read from base (ADR 0006).

**Out of scope.** Automatic resolution of investigated threads. A persistent index. A verification
pass (deferred; Anthropic's Code Review shows one at $15–25 per review). Thresholds tuned on the
five benchmark PRs.

## Detail

### The flow questions in the prompt

Illustrative wording, placed before `RULES`:

> For every new user action, new screen state, or new call into code this part does not change,
> add one `contracts` entry: what it changes; which existing path does the same thing and what
> that path does before and after; how the result reaches what the user sees. If the state is
> loaded once, say what happens when the background work it depends on finishes and when the user
> leaves and comes back. Cite file:line for each answer. If you cannot answer from the files you
> can read, set `status: "open"` with the question and the files you would read. The pull request
> body is the author's claim; verify it, do not inherit it.

### `contracts` in the schema

```json
{
  "action": "drag a ready copy from MasterCopiesPanel",
  "location": "features/prepare/components/master-copies-panel.tsx:174",
  "equivalent_path": "the ready toast's drag, export-status-cards.tsx:231-235",
  "before_after": "toast calls markCopySeen before startFileDrag; the new path does not",
  "visible_effect": "copy keeps the unseen outline and the '1 copy ready' chip after upload",
  "evidence": ["master-copies-panel.tsx:174", "export-status-cards.tsx:234", "ready-copies.ts:76"],
  "status": "closed"
}
```

The engine: resolves every `evidence` path and line against the head (a missing line turns the
entry `open` with reason `evidence_not_found`); links closed entries that produced a finding;
lists open ones under a "Contracts the review could not close" section; counts
`needs_investigation` requests in the footer.

### The risk map

Built by the engine in the run dir as `risk-map.json` plus a Markdown rendering per batch.

- **Symbols:** from the diff's added/changed lines via tree-sitter (definitions with positions,
  member calls, imports); fallback `git grep -nw` of identifiers with extension filters where no
  grammar is vendored. Noise measured on kaipu with grep only: after filtering to `*.ts`/`*.tsx`,
  almost nothing wrong remains, but aliases and property-named handlers are missed; that is what
  the AST layer fixes.
- **New connections:** calls from changed lines into symbols the PR does not define, including
  `obj.member(...)` where `obj` is in the bridge list, and string literals that match an IPC
  channel constant. For each: other call sites with the lines before the call.
- **Indicators** (shown, never scored): fan-in split into production/types/tests; relative churn;
  change frequency and recency in a bounded window; co-change partners left out of the PR; key
  path (RISK_RULES and repository rules). In shallow clones history is `unsupported`, not zero.
- **Caps:** per-batch slice ≤ 16 KB with a `truncated` flag; whole file readable by the model.

### Admission policy (ADR 0009)

- Inputs: `investigation_reserve_usd`, `max_investigations` (workflow inputs, ADR 0001).
- A `needs_investigation` request is admitted when: the reserve has room, the count is below N,
  the candidate files exist in the head, and the question is not a duplicate of an admitted one.
- An admitted investigation is one extra provider call with the question, its premises, the
  candidate files and the relevant map slice, Read/Glob/Grep only, its own budget share. Its
  output is a `contracts` entry and optional findings on the original batch's files.
- Observation mode: everything above runs except the extra call; the footer reports "N
  investigation requests, 0 admitted (observation)".

### Harness changes (decision 10, 11)

`--max-turns <n>` per batch (input `batch_max_turns`, default to be set after the ablation);
`terminalReason` maps `error_max_turns`; a wall-clock kill at `batch_timeout_s`. Later:
`CLAUDE_CODE_OAUTH_TOKEN` accepted as an alternative credential.

### Multi-language (decision 14) and ADR 0002

Artefacts to vendor, with a `vendor/MANIFEST` (name, version, source URL, sha256) and a test that
recomputes hashes: web-tree-sitter 0.25.10 runtime (`tree-sitter.js` 151 KB, `tree-sitter.wasm`
205 KB, MIT) and grammar `.wasm` files from each grammar's own release (TS 0.23.2, TSX 0.23.2,
Go 0.25.0, Python 0.25.0, Java 0.23.5, Rust 0.24.0; Kotlin 1.1.0 and Swift 0.7.3 later). Do not
use the `tree-sitter-wasms` bundle, which fails to load on current runtimes. Official `tags.scm`
files are not enough for Swift (no call captures) and Kotlin (none); those queries are ours.

ADR 0002's reopen condition is amended by the owner's decision of 2026-10-31: a dependency may
enter when a measured experiment shows it improves reviews and the artefact is pinned by hash.
The multi-language note's measurements are the first such experiment; the ablation below is the
second.

## Measurement

**Ablation first** (Sol's cheapest falsifier): the affected batches of #465 and #467 at their
original heads, same model and limits, several runs each:

| | prompt today | + flow questions | + risk map | + both |
| --- | --- | --- | --- | --- |

Record: precedent retrieved, causal chain completed, correct finding, false alarms, cost. This
separates "the map does not retrieve the evidence" from "it does and the model still does not
ask". The map is built by generic rules with no bug names. If flow questions alone match flow
questions plus map, the mapper is not built further.

**Then the full replay** of the five PRs in `kaipu-bench-wachi` ([benchmark spec](2026-10-31-review-benchmark-design.md)):
keep the 17 valid findings, gain the 5 Pullfrog-only bugs, stay well under $7.68. Memory written
from these reviews does not count as prior knowledge on these PRs.

## Sources and unverified claims

- All #46x facts: [field benchmark](../benchmark/2026-10-31/README.md) and per-PR files.
- `Bun.Transpiler.scan()` returns imports and export names only (verified locally, Bun 1.4.2).
- `--max-turns` exists in Claude Code 2.1.316, hidden from `--help`; not yet verified on the pinned
  2.1.304. `--max-budget-usd` is soft.
- OpenCode facts and the subscription prohibition: [harness options](../research/2026-10-31-harness-options.md), from current docs; OpenCode V2 not checked.
- Pullfrog MCP cost share (10–25 %) is inferred from tool-call counts, not measured.
- tree-sitter and ast-grep measurements were run on macOS arm64; Linux and the non-TS grammars
  were tested on small hand-written samples only.
- Jev: TypeSafe AI docs (introduction page) and third-party posts; the quickstart returned 404.
