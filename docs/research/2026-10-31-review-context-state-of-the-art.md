# How AI reviewers find cross-file bugs: state of the art, October 2026

- **Date:** 2026-10-31
- **Method:** web search on vendor docs, comparison posts and 2026 papers. Paper findings come
  from abstracts and search snippets; the full papers were not read.
- **Why:** the [2026-10-31 field benchmark](https://github.com/niway-dev/wachiman-benchmarks/blob/main/2026-10-31/README.md) showed Wachi
  missing bugs whose precedent or contract lives in unchanged files.

## In one minute

The field splits into three ways of getting context beyond the diff, plus one way of keeping
precision:

1. **A prebuilt code graph** (Greptile). The repository is indexed into a graph of functions,
   classes and files with who-calls-whom, updated incrementally; on a PR, callers, dependencies
   and similar patterns are pulled in before parallel agents review.
2. **Agentic retrieval** (Pullfrog, Claude Code Review). The model explores with tools during the
   review. Deep where it looks, silent where it does not.
3. **Diff plus local context** (CodeRabbit historically). Low noise, shallower on cross-file
   impact. Sources conflict on whether it now builds a dependency graph.
4. **A verification step** (Anthropic's Code Review for Claude Code, March 2026). Several agents
   review in parallel; a separate step checks each finding against the surrounding code, tests and
   types, filters false positives and ranks by severity. Anthropic reports an average of
   $15–$25 per review.

**What the research adds.** AACR-Bench (200 PRs, repository-level context) finds that the
granularity of context and the retrieval method change results significantly, and the effect
depends on the model and on whether an agent is used. SWE-PRBench (350 PRs) reports that
**unstructured file content harms contextual detection**: dumping more files into the prompt can
make a reviewer worse. ContextBench (issue resolution, not review) finds elaborate agent scaffolds
add only marginal retrieval gains.

## What this means for Wachi

- **Targeted, structured context over more context.** The peer call sites idea (benchmark
  improvement 2) is a small, query-shaped slice of a code graph: other call sites of what the new
  code calls, with the lines that matter. SWE-PRBench is a warning against attaching whole
  files instead.
- **No persistent index.** A Greptile-style graph needs a server or a stored index, which ADR 0001
  rules out. `git grep` at review time on the checked-out head gives the slice Wachi needs with no
  state.
- **Keep the breadth, add a question.** Agentic reviewers find what they go looking for and miss
  the rest (see the benchmark: Pullfrog missed every test-quality and most main-process findings).
  Wachi's batches guarantee every file is read; the contract check (improvement 1) adds the
  question an agentic reviewer asks.
- **Verification is the precision lever, not the recall lever.** Both reviewers had zero invalid
  findings on the five PRs. A verification pass is worth its cost only once added context starts
  producing false positives.

## Sources

- Greptile and CodeRabbit context approaches:
  [morphllm: CodeRabbit vs Greptile](https://www.morphllm.com/comparisons/coderabbit-vs-greptile),
  [morphllm: GitHub AI code review](https://www.morphllm.com/github-ai-code-review),
  [dev.to: Greptile alternatives](https://dev.to/pyor/greptile-alternatives-in-2026-an-honest-comparison-k4),
  [meshworld](https://meshworld.in/blog/ai/tooling/ai-code-review-coderabbit-vs-greptile-2026/)
- Claude Code Review:
  [VKTR](https://www.vktr.com/ai-news/anthropic-launches-multi-agent-code-review-for-claude-code/),
  [Context Studios](https://www.contextstudios.ai/fr/blog/claude-code-review-multi-agent-pr),
  [aicodereview.cc](https://aicodereview.cc/blog/claude-code-review). The sub-1% incorrect-finding
  figure in one of them is a secondary claim and is not used here.
- [AACR-Bench, arXiv 2601.19494](https://arxiv.org/abs/2601.19494v1) ·
  [SWE-PRBench, arXiv 2603.26130](https://arxiv.org/pdf/2603.26130) ·
  [Agent Retrieval Bench](https://huggingface.co/papers/2607.24882.md) ·
  [ContextBench](https://benchmarklist.com/benchmarks/contextbench/)
