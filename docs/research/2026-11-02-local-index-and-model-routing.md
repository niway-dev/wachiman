# Local repository index and model routing: state of the art

- **Date:** 2026-11-02. Prepared for the [reader, judge and local index design](../specs/2026-11-02-reader-judge-and-local-index-design.md) (issue #79).
- **Method:** web search. Most sources are secondary (write-ups, vendor posts, ports), not
  primary documentation; each claim is marked with its source and how firm it is.
- **Prior notes:** [review context, state of the art](2026-10-31-review-context-state-of-the-art.md),
  [multi-language mapping, deep](2026-10-31-multi-language-mapping-deep.md),
  [harness options](2026-10-31-harness-options.md).

## 1. A repository map built locally: Aider

Aider's repository map is the closest existing design to the owner's philosophy: index what is
possible locally, then hand the model a small, ranked slice.

- **Tags:** tree-sitter parses each file for definitions and references.
- **Graph and ranking:** files are nodes and symbol references are edges. A personalized
  PageRank, seeded with the files in play, ranks what matters to them.
- **Budget:** the map is cut to a token budget, by default `--map-tokens` 1,024. A reading of
  `repomap.py` gives the default as `max(1024, min(max_input_tokens/8, 4096))` (secondary, not
  checked against the source).
- **No server:** the map is rebuilt when files change or commits land.

Sources: [fast.io, Aider context window](https://fast.io/resources/aider-context-window.md),
[fast.io, Aider token limits](https://fast.io/resources/aider-token-limit.md),
[repo-mapper (a Rust port)](https://docs.rs/crate/repo-mapper/latest/source/README.md).

**For Wachiman:** the 2026-10-31 measurement on kaipu found that `git grep` misses aliased
consumers (`libraryChanged` → `onLibraryChanged`, 0 of 2). tree-sitter returns references with
kind and position ([multi-language mapping](2026-10-31-multi-language-mapping-deep.md)). Neither
resolves types; references stay by name.

## 2. A prebuilt code graph: Greptile and CodeRabbit

- **Greptile** indexes the repository into a graph of functions, classes and files, kept up to date
  incrementally. On a pull request it pulls in callers, dependencies and similar patterns.
- **CodeRabbit** advertises a "Code Graph Analysis". Its internals are not visible.

Both are hosted, which ADR 0001 rules out for Wachiman. The idea that carries over is the graph,
not the server. Sources are in the [2026-10-31 note](2026-10-31-review-context-state-of-the-art.md).

## 3. Model routing: cheap explorers, an expensive judge

- **The pattern:** a frontier model for planning and judgement, cheaper models for exploration and
  token-heavy work. One write-up reports a recurring workflow cut from about $100 to $15–20 per
  run (single author, called directional by the author).
  [Arize](https://arize.com/blog/how-i-cut-coding-agent-costs-with-model-harness-routing/)
- **Review is the hard case:** a frontier model on every review is slow and expensive, and a cheap
  one misses bugs, so roles are assigned per model. A routing classifier is said not to pay for
  itself below roughly 500 agent calls a day.
  [Augment](https://augmentcode.com/guides/ai-model-routing-guide)
- **Treat a subagent's output as evidence to verify, not as a verdict;** resolve disagreements at
  the frontier layer. [claudepluginhub, efficient-frontier skill](https://www.claudepluginhub.com/skills/welldundun-builder-skills/efficient-frontier)
- **Agentic reviewers** reach higher precision at a substantial exploration and validation cost,
  and successful reviews go with stronger planning (arXiv, July 2026, from a search snippet; not
  read in full). [arXiv 2607.16740](https://arxiv.org/abs/2607.16740)

The savings figures are vendor demos or single-author experiments. They are indicative, not
transferable to Wachiman's numbers.

## 4. Where Wachiman's own cost goes

Measured on a Pullfrog review of kaipu-record #465 ([harness options](2026-10-31-harness-options.md)):

| Part | Share of cost |
| --- | --- |
| Cache reads (context re-read across turns) | ~50 % |
| Cache writes | ~36 % |
| Output | ~14 % |

A cheaper model only for the output saves little. **The reading has to move to the cheaper model**
for routing to pay.

## 5. Storing an index without a server: the GitHub Actions cache

- 10 GB per repository at no extra cost. Paid plans can go beyond.
- Entries not accessed for 7 days are evicted; past the size limit, the least recently used go first.
- It lives in the consumer's GitHub, keyed by whatever the workflow chooses (for example the base
  SHA).

Sources: [GitHub changelog, cache above 10 GB](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/),
[GitHub changelog, eviction policy](https://github.blog/changelog/2025-09-29-new-date-for-enforcement-of-cache-eviction-policy/).
No 2026 change was found; check the current docs before relying on the figures.

## 6. From Wachiman's own logs

Pullfrog's prompt allows specialist subagents. In the 14 Pullfrog runs whose tool calls are
saved in [niway-dev/wachiman-benchmarks](https://github.com/niway-dev/wachiman-benchmarks), it started none: the only "Task" in those logs is
`» Task complete.`. Its advantage on those pull requests came from one agent following one
action across files, not from specialisation.
