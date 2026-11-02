# Draft: lower-cost review models, delivery routes, and bounded context

Status: research draft for discussion; no migration, subscription, paid experiment, or runtime change approved by this document. Requested by the owner on 2026-11-02 after reporting approximately $150 spent on tests over four days. That bill has not been reconciled with provider usage.

## Summary

Keep Wachiman's questions, evidence, structured contracts, deterministic execution policy, and explicit coverage. Compare cheaper models under that same process before changing its architecture. There is no evidence that Claude is the only viable reviewer; there is also no Wachiman measurement establishing DeepSeek or Qwen as equivalent replacements. Preserve Opus 5.5 high and Sonnet 5.5 high as measured references. Optimize cost per useful, correctly detected defect, with severity and false positives visible.

Three independent choices must remain distinguishable: model (judgment), harness (tools and isolation), and delivery route (direct API, gateway, or subscription). A cheaper route does not make the same model reason better. A cheaper model can require more turns or silently miss defects.

## Existing evidence and design conflicts

The historical v1.4.0 E1 comparison used the same five PRs, three rounds per model, high effort. Opus found 7.3 of 14 known Medium+ defects per round for $6.96; Sonnet found 5.3 for $4.58. Distinct defects across rounds: 11 versus 9. Invalid findings: zero observed for both. Cost per detected defect: approximately $0.95 versus $0.86. These are five-PR round costs, not single-PR prices. Small, repeatedly studied corpus; no general equivalence claim follows.

Sonnet saw the sibling `markCopySeen` call but incorrectly judged the new drag path equivalent in all three rounds. A strong judge receiving only the cheap reader's findings cannot recover this omission. It must inspect original cited code and closed contracts, and independently cover engine-selected obligations. Model confidence must not be the sole escalation trigger.

Historical evidence is pinned to [the E1 report at commit 47933f0](https://github.com/niway-dev/wachiman/blob/47933f0/docs/benchmark/2026-11-02-e1-sonnet/README.md), before benchmark data moved out of this repository.

Current main also includes [ADR 0016](../adr/0016-data-path-questions-chosen-by-the-engine.md): deterministic data-path questions. Its in-sample A/B improved detection and reduced average batch cost, but does not establish held-out quality. New model comparisons must freeze the SAME current engine for both arms; historical v1.4.0 results are not a matched control for current-main candidates.

Related work: [issue #79](https://github.com/niway-dev/wachiman/issues/79), [reader/judge draft #80](https://github.com/niway-dev/wachiman/pull/80), [model tiers draft #90](https://github.com/niway-dev/wachiman/pull/90), and [initial idea #76](https://github.com/niway-dev/wachiman/pull/76).

**Conflict to resolve:** #90 proposes Anthropic-only tiers and superseding ADR 0004. This study reopens that proposed restriction; it does not silently accept or supersede it. Keep cost tiers conceptually separate from vendor exclusivity. No new ADR is accepted here. ADR 0004 already supports a second provider; a new API agent loop would reopen its rejected alternative and ADR 0002's small trusted-runtime constraint.

The shared hub's [model usage guidance](https://github.com/csdev19/general-knowledge/blob/main/conventions/ai-model-usage.md) supports bounded evidence and measured role assignment, but does not establish DeepSeek/Qwen review quality.

## Price snapshot and reproducible scenario

Consulted 2026-11-02. USD per million tokens; route-specific quotes, not interchangeable guarantees. Recheck at experiment execution. No taxes, runner costs, payment fees, or cache writes are included below.

| Model and route | Uncached input | Cached read | Output |
| --- | ---: | ---: | ---: |
| Opus 5.5, Anthropic direct | 4.00 | 0.20 | 20.00 |
| Sonnet 5.5, Anthropic direct | 2.00 | 0.10 | 10.00 |
| DeepSeek V4.1 Flash, direct, peak | 0.30 | 0.006 | 1.20 |
| DeepSeek V4 Pro, direct, peak | 1.32 | 0.044 | 3.96 |
| Qwen3.8 Flash, OpenCode PAYG | 0.15 | 0.016 | 0.47 |
| Qwen3.8 Max, OpenCode PAYG | 2.00 | 0.25 | 6.00 |

Sources: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/), [OpenCode model pricing](https://opencode.ai/v2/docs/console/models/).

Illustrative workload: 100,000 uncached input tokens + 20,000 billed output tokens across a completed review. These are invented equal-usage scenarios, NOT recorded Wachiman traces. Output must include billed reasoning where applicable. Different tokenizers, effort controls, retries and tool loops invalidate equal-token assumptions in real runs.

`cost = uncached_input / 1e6 * input_price + cached_input / 1e6 * cache_price + output / 1e6 * output_price + cache_write_cost + other_fees`

| Model | Scenario cost | Reduction vs Opus | Reduction vs Sonnet |
| --- | ---: | ---: | ---: |
| Opus 5.5 | $0.8000 | — | — |
| Sonnet 5.5 | $0.4000 | 50.0% | — |
| DeepSeek Flash, peak | $0.0540 | 93.3% | 86.5% |
| DeepSeek Pro, peak | $0.2112 | 73.6% | 47.2% |
| Qwen Flash, OpenCode | $0.0244 | 97.0% | 93.9% |
| Qwen Max, OpenCode | $0.3200 | 60.0% | 20.0% |

These percentages describe prices at fixed usage, not quality-preserving savings. Do not multiply the owner's $150 bill by them. DeepSeek's listed off-peak rates halve these direct-API scenarios, but latency-sensitive reviews should not depend on waiting for a cheaper period.

Current sources disagree across routes: OpenCode lists Sonnet cache reads at $0.20, while Anthropic direct lists $0.10; DeepSeek Pro PAYG rates also differ from direct. Record the actual endpoint, effective model version, usage buckets, and invoice, not just a friendly model name. #90's claim that Opus/Sonnet cache reads cost the same needs route/date qualification.

## Tabulated capacity, processing, and intelligence evidence

Snapshot retrieved 2026-11-02. “Latest” means the newest live evidence verified in this research, not a guarantee that every evaluation has been rerun on the latest endpoint. ND means not verified, never zero. API limits are not recommended review budgets.

### Context and output capacity

| Model / version | Advertised context | Maximum output | Reasoning control / identity caveat | Source |
| --- | ---: | ---: | --- | --- |
| Opus 5.5 | 1M tokens | 128K standard; 300K batch beta | Adaptive, always on; Wachiman reference uses high | [Anthropic specification](https://platform.claude.com/docs/en/models/opus-5-5/overview) |
| Sonnet 5.5 | 1M | 128K standard; 300K batch beta | Adaptive; Wachiman reference uses high | [Anthropic specification](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) |
| DeepSeek V4.1 Flash 1017 | 1M | 384K listed API maximum | Pin effective version behind `deepseek-flash` | [API specification](https://api-docs.deepseek.com/quick_start/pricing/) |
| DeepSeek V4 Pro 0813 | 1M | 384K listed API maximum | Effective endpoint identity unresolved; see below | [API specification](https://api-docs.deepseek.com/quick_start/pricing/) |
| Qwen3.8 Flash, hosted | 1,000,000 | 131,072 | Thinking cap 262,144; high/max map to xhigh on documented route | [Hosted specification](https://docs.qwencloud.com/developer-guides/getting-started/latest-model) |
| Qwen3.8 Max, hosted | 1M | 131K, as published | Thinking input maximum 983K; AA lists 984K for 0902 | [Hosted specification](https://www.qwencloud.com/news/qwen-3-8-max) |

Context includes material needed by the request; maximum input, reasoning and output allowances cannot simply be added as independently usable capacity. Check endpoint-specific accounting. Qwen hosted Flash is not automatically the same deployment as the open-weight Flash-Next checkpoint; do not transfer local-checkpoint limits or results by name similarity.

**DeepSeek source conflict:** its [September 10 announcement](https://deepseek.com/en/news/deepseek-v4-1-flash/) says Pro requests would route to Flash starting September 14, while the current API table still identifies Pro-0813 separately. Keep Pro's earlier price scenario conditional; verify effective model and billing before calling it an independent experimental arm. Public pages alone do not resolve this contradiction.

### Independent intelligence and processing measurements

Artificial Analysis (AA) is the measurement producer here, not the model vendor. The current pages identify **Intelligence Index v5.0**, a nine-evaluation composite. Scores are index points, not percent accuracy, IQ, or percent of Opus's review capability. This is the most recent common independent index verified here. Do not mix cached search results from v4.3.2 with v5.0.

| Exact evaluated configuration | AA index v5.0 ↑ | Output tokens/s ↑ | Published latency, seconds ↓ | AA cost/task, USD ↓ | Source |
| --- | ---: | ---: | --- | ---: | --- |
| Opus 5.5 high, default fallback | 52 | 79.6 | 47.50, FAQ TTFT label | 3.46 | [AA Opus high](https://artificialanalysis.ai/models/claude-opus-5-5-high) |
| Sonnet 5.5 high, default fallback | 41 | 105.7 | 13.47, FAQ TTFT label | 1.64 | [AA Sonnet high](https://artificialanalysis.ai/models/claude-sonnet-5-5-high) |
| DeepSeek V4.1 Flash 1017 max | 32 | 170 | 1.28 first chunk; 11.73 reasoning | 0.60 | [AA provider table](https://artificialanalysis.ai/providers/deepseek) |
| DeepSeek V4 Pro 0813 max | 23 | 94 | 1.79 first chunk; 21.38 reasoning | 1.77 | [AA provider table](https://artificialanalysis.ai/providers/deepseek) |
| Qwen3.8 Max 0902 | 34 | 39.4 | 2.90, FAQ TTFT label | 10.02 | [AA Qwen Max](https://artificialanalysis.ai/models/qwen3-8-max) |
| Qwen3.8 Flash, hosted | ND | ND | ND | ND | No independently verified matching row located |

Use the DeepSeek provider **table** snapshot above consistently: its summary and FAQ showed different rolling speed numbers during retrieval. These are changing service measurements, not immutable model specifications. AA's latency sections distinguish first chunk, first answer and thinking time, while some FAQs use the shorter TTFT label. The heterogeneous latency column is deliberately NOT ranked as one metric. First chunk can be reasoning, not an actionable answer.

AA cost/task includes its benchmark's token consumption and cache behavior; it is neither Wachiman cost/PR nor the fixed-token scenario above. Qwen Max's $10.02/task illustrates why cheaper output tokens do not guarantee cheaper completed work. We have not reproduced that figure. Benchmark effort/harness differs between rows; a shared index is useful evidence, not a controlled Wachiman A/B.

Derived output-only comparison: Sonnet high generates about 1.33x as many tokens/s as Opus high on these measurements. This does not imply a review finishes 33% sooner: total output, reasoning, tools, queueing and retries also matter. Prefill throughput, p50/p95 complete-review latency and peak runner memory are ND for all six candidates in a matched Wachiman experiment.

### Recent model-specific studies and review relevance

| Candidate | Latest source verified here | Published result / evidence | What it establishes and what it does not |
| --- | --- | --- | --- |
| Opus 5.5 high | Live AA v5.0 page above; historical Wachiman E1 | 7.3 known Medium+ bugs/round, 11 distinct/3 rounds, zero invalid observed | Stronger local reference than Sonnet on that corpus; not a universal reviewer ranking |
| Sonnet 5.5 high | Live AA v5.0 page above; historical Wachiman E1 | 5.3 bugs/round, 9 distinct/3 rounds, zero invalid observed | Measured lower cost with omissions; “73% retained” is local, not a general quality ratio |
| DeepSeek V4.1 Flash | [Technical report](https://arxiv.org/abs/2609.19969), submitted Sep 17; [current model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash) | DeepSWE v1.1: 69.8 with Claude Code vs 74.2 with mini-SWE; Terminal-Bench 2.1: 88.0 vs 90.3 for those harnesses | Vendor-reported harness sensitivity; neither is a code-review recall test or necessarily the exact hosted 1017 revision |
| DeepSeek V4 Pro 0813 | Live AA v5.0 provider table above | Index 23 on max; endpoint identity remains disputed by official pages | External baseline exists; running the alias may not reproduce this model |
| Qwen3.8 Flash | [Current hosted model documentation](https://docs.qwencloud.com/developer-guides/getting-started/latest-model), release date not established here | Vendor reports SWE-bench Pro 62.5 and DeepSWE 1.1 58.7 | Candidate-selection evidence; independent hosted-model measurement and Wachiman recall still missing |
| Qwen3.8 Max | [Aug 3 release evaluation](https://www.qwencloud.com/news/qwen-3-8-max); newer 0902 AA row above | Vendor reports SWE-bench Pro 67.7, Terminal-Bench 2.1 86.6; newer AA index 34 | Different revisions, harnesses and suites; do not subtract vendor scores to infer review superiority |

SWE-style scores measure solving repository tasks, not spotting defects without changing the code. The local experiment remains the decision gate. A blank independent score is more honest than borrowing a score from Qwen 27B, Flash-Next or an older index version.

### Memory: what is actually stored and where

| Memory dimension | Claude Opus / Sonnet API | DeepSeek API | Qwen hosted API | Wachiman consequence |
| --- | --- | --- | --- | --- |
| Model weights in our runner | None required | None required | None required | No local GPU VRAM requirement for API inference; runner still needs normal process RAM |
| Provider RAM/VRAM per request | ND | ND for hosted endpoint | ND for hosted endpoint | Cannot rank API providers by an invented GB figure |
| Peak runner RAM | Not measured | Not measured | Not measured | Measure maximum RSS of engine + CLI process tree on the same batch/concurrency |
| Working context | Up to advertised 1M | Up to advertised 1M | Up to advertised 1M | Target 16K–32K evidence packets experimentally; retrieval and explicit incomplete coverage remain required |
| Prompt-cache hit price, USD/MTok | Opus 0.20; Sonnet 0.10, direct | Flash 0.006; Pro 0.044, peak direct, conditional identity | Flash 0.016; Max 0.25, OpenCode route | Cache is a billing/compute optimization, not persistent knowledge; see dated price sources above |
| Persistent project memory | Engine-owned repository facts | Same | Same | Store provenance; retrieve relevant facts; invalidate against current code |
| Exact local self-hosting footprint | Weights not provided by these API specifications | Requires a specific checkpoint/runtime | Requires a specific checkpoint/runtime | Separate deployment study, not part of choosing the API |

One actual research memory metric is available: DeepSeek's [V4.1 Flash report](https://arxiv.org/abs/2609.19969) gives **890 bytes/token for its global KV-cache component in HBM**. At 32,000 tokens that component is 28.48 MB decimal; at 1,000,000 it is 890 MB. This excludes model weights, other caches, workspaces and concurrency. It is emphatically not “the entire model fits in 890 MB.” It describes the paper's architecture, not a measured hosted endpoint allocation or our runner memory.

### Metrics the next paid experiment must emit

| Metric | Unit / aggregation | Why it changes the decision |
| --- | --- | --- |
| Peak context | Tokens/request, max and p95 | Tests whether 1M capacity is useful at all |
| Prompt processing | Prefill tokens/s; fixed 16K/32K inputs | Separates reading speed from answer generation |
| First chunk / first answer | Seconds, recorded separately | Makes reasoning latency visible |
| Output and reasoning | Billed tokens, separated where available | Finds cheaper models that spend more tokens |
| Cache | Read/write tokens, hit ratio, effective USD | Tests actual reuse rather than advertised discount |
| Complete review | Seconds/PR p50/p95; turns and tool calls | Measures user-visible processing performance |
| Runner memory | Peak RSS MB, whole process tree | Sizes Actions runners; unrelated to hosted model VRAM |
| Quality | Confirmed recall by severity, false positives, incomplete coverage | Prevents fast/cheap but shallow reviews from winning |
| Cost | USD/completed PR and confirmed Medium+ defect | Includes retries, failures, judge calls and subscription allocation |

## Gateways, free access, and pooled subscriptions

**OpenRouter:** one integration and balance can simplify experiments and provider selection. Standard adds 5.5% when buying credits; inference itself follows listed provider rates. For example, $10 of credits costs $10.55 before taxes. It is not an automatic discount on Opus. Free access has limits (the pricing page lists 50 requests/day); one tool-driven review consumes multiple requests. Pin model and provider during evaluation; do not use an automatic free-model router as a reproducible model identity. Verify tools, schema support, reasoning accounting, caching and data policy for the selected endpoint. Source: [OpenRouter pricing](https://openrouter.ai/pricing).

**OpenCode free:** the listed offer is DeepSeek V4.1 Flash Free, not a verified product named “DeepSeek Lite.” It is temporary, and free-tier chat endpoints require OpenCode. Useful for exploratory coding, not a proven drop-in free Wachiman backend. Source: [OpenCode models](https://opencode.ai/v2/docs/console/models/).

**OpenCode Go:** $10/month; Go Plus $40/month. The Go table lists model-specific monthly allowances (DeepSeek Flash $100, Pro $15, Qwen Flash $30), with 5-hour and weekly constraints. These are consumption allowances, not cash and not an unrestricted pool to spend on any model. Other coding agents are supported with client identity and stable session headers. Service accounts are not covered by Go Teams. Eligibility for Wachiman's unattended CI and the exact account arrangement remain unverified; confirm before adopting. Source: [Go terms and limits](https://opencode.ai/v2/docs/console/go/).

Subscription economics: `effective cash cost per completed review = monthly fee / completed reviews + overages + paid fallback`. A hypothetical $10 plan used for 100 completed reviews costs $0.10 each; used for ten, $1 each. This says nothing about how many reviews the allowance actually permits. Compare the same captured trace against the allowance meter, including bursts, rather than converting marketing request counts into PR counts.

Pooled services can be practical when authorized usage, stable model identity and allowance accounting fit. No unspecified third-party pool is endorsed here. Distinguish a gateway selling authorized inference from shared consumer accounts. For any candidate, establish the automation allowance, model/version, concurrency, exhaustion behavior, data retention and total cash fee. Compare with the already cheap direct API before adding another operational dependency.

## Context, memory, and processing

A 1M context window is capacity, not a minimum purchase. A request containing 20K tokens does not pay for 1M merely because the model supports it. Conversely, 20 requests each reading 50K tokens accumulate 1M input tokens even though no request approaches the window limit. Cached tokens may be cheaper, but they still count as usage.

Keep four quantities separate:

- Peak context per request: how much the model sees at once.
- Cumulative tokens per review: all tool turns, retries and judge calls.
- Prompt cache: repeated prefixes billed differently, subject to provider rules.
- Persistent memory: versioned repository facts retrieved into future prompts; storage is not automatic model knowledge.

Illustrative Opus input-only calculation: ten reads of a stable 50K prefix cost $2 without cache. At the quoted 5-minute cache-write rate ($5/MTok), one write plus nine cache hits costs $0.34 ($0.25 + $0.09), provided the prefix is eligible, reused within its lifetime, and all hits occur. Output and changing suffixes are extra. This is not an observed Wachiman saving.

Proposed experiments, not shipping defaults:

1. Measure per-call uncached input, cache writes/reads, billed reasoning/output, tool count, latency, retries and completeness before tuning. Reconcile canceled/failed calls with provider billing; footers alone undercount some spending.
2. Try evidence packets targeting 16K–32K input tokens per batch. Treat this as a test range, not an established optimum or permission to silently truncate. Retrieve cited callers, sibling flows, failure paths and relevant obligations on demand. Mark excluded evidence and incomplete coverage.
3. Build deterministic local references once per commit. Reuse them across batches. An index provides candidates, not proof of correctness; invalidate by commit/content hash.
4. Reuse stable prompt prefixes where supported. Keep changing diffs after stable policy/tool definitions. Measure actual cache hits; fresh independent CLI calls need not share useful cache.
5. Store compact facts with paths, symbols, commit provenance and validation status. Retrieve only relevant facts and revalidate against the current base/head. Never promote a repeated model conclusion to truth merely because it appeared twice.
6. Compare effort high vs medium as a separate arm AFTER model-only evaluation. “High” is not equivalent across providers. Track whether savings come from less reasoning, fewer tool turns, or incomplete work.
7. A judge must receive bounded original evidence and engine obligations, including closed contracts. Allow bounded evidence requests. Summaries alone can preserve the reader's mistake.

No matched Wachiman latency/speedup measurement is available yet; published service measurements are tabulated above. Record median and p95 end-to-end review time, tool time, time to first token, output rate, queue time and retries. Parallel calls can reduce elapsed time while increasing rate-limit failures and leaving token cost unchanged. API context is not the runner's RAM; self-hosting adds weights/KV-cache memory and GPU economics, which this study does not price.

## Staged experiment and proposed decision gates

Options: full model replacement (cleanest initial experiment); cheap reader plus strong judge (potential savings, added calls and inherited blind spots); selective strong reviews (requires measured escalation signals, not reader confidence alone).

Recommended sequence:

1. Freeze engine SHA, dataset SHAs, prompts, budgets, tools and output schema. Reuse historical artifacts for diagnostics. For a matched comparison either use the historical engine for all arms or rerun an Opus/Sonnet control on current main; never mix them silently.
2. One contract/isolation smoke case for DeepSeek Flash and Qwen Flash. Check structured output, read-only confinement, credential isolation, stop behavior and truthful cost accounting. No external publication by the model.
3. One pass on the existing five PRs for survivors. Inspect omissions and false positives against code. Keep human/code-grounded adjudication; Claude judgments alone are not an unbiased reference.
4. Repeat promising candidates and evaluate held-out PRs. Record severity-specific recall, false positives, run variance, incomplete coverage and costs. Report the same defects individually; total finding count can hide losing serious bugs and adding low-value comments.
5. Only then test reader/judge composition. Compare the combined bill with the single-model controls and test whether the judge recovers falsely closed contracts.

Proposed research envelope: $10 total, including controls, failed calls and retries; not spent or guaranteed sufficient. Estimate from the smoke case before expanding. Use an external prepaid/spend limit where possible plus admission checks; existing per-call caps are soft. Stop and report insufficient sample rather than increasing budget automatically. Do not run every model/effort/route combination.

Proposed promotion target for discussion: at least 90% of baseline confirmed Medium+ detection, no additional known high-severity omission in the evaluation set, no increase in invalid findings, and at least 50% lower complete-review cost. Report sample uncertainty; passing a small set is not a safety guarantee. A deliberately cheaper, lower-recall tier is a separate product decision.

## Open decisions

- Reopen #90's Anthropic-only proposal in favor of vendor-independent tiers?
- First candidates: DeepSeek Flash direct and Qwen Flash through a documented PAYG endpoint; reserve Pro/Max for a later failure-driven comparison.
- Is preserving approximately all high-impact findings mandatory, or is a visibly lower-coverage economy tier acceptable?
- Confirm CI eligibility before choosing a subscription; start with metered API access for clean measurements.
- Reconcile the $150 bill and capture real usage before projecting monthly spend.

## Acceptance criteria for this research draft

- [x] Preserve the question/code/output philosophy and explain its semantic limit.
- [x] Separate measured results from equal-token scenarios and hypotheses.
- [x] Compare direct, gateway, free and subscription economics with dated primary sources.
- [x] Explain context capacity, cumulative usage, caching and persistent memory separately.
- [x] Identify overlap/conflict with existing drafts and define a bounded experiment.
- [ ] Run a paid model comparison and demonstrate retained findings (future work).
- [ ] Verify unattended CI eligibility and invoice-level costs (future work).
