# Greptile's review levels and agent tooling, skills under `claude -p`, and a local review on a subscription

- **Date:** 2026-11-03
- **Status:** research. Nothing here is decided or built. The local review is being designed
  separately (a spec will follow); the two output ideas are candidates for #90.
- **Related:** #90 (draft: spend tier, engine-extracted obligations, a judge that degrades and never
  deletes); #99 (draft: cheaper re-reviews); [ADR 0001](../adr/0001-distribution-and-trust.md)
  (distribution and trust); [ADR 0016](../adr/0016-data-path-questions-chosen-by-the-engine.md)
  (questions chosen by the engine); [docs/cli.md](../cli.md).

## In one minute

- **Greptile sells review depth, not models.** Three levels per review: Base costs 1 credit, Plus
  3, Apex 10, at US$1 a credit on the Pro plan. Its pricing page does not say what changes between
  levels. This is the same shape as #90's `tier`. The credit does not transfer: Wachiman has one
  operator who already caps spend in dollars.
- **Greptile's skills and plugin do not review.** The review runs on Greptile's servers. The skills
  run on the developer's side: they ask Greptile for a review, read the comments, and fix them.
- **Skills do work under `claude -p`, with Wachiman's hardening flags**, but only when loaded with
  `--plugin-dir` and when `Skill` is in `--tools`. A skill planted in the working directory is
  ignored under `--restricted`. Probed 2026-11-03 on Claude Code 2.1.317, for under one cent.
- **Skills add little to the reviewer itself.** A skill is text the model decides to load. ADR 0016
  has the engine decide which questions a batch gets, because that is measurable; a skill hands the
  choice back to the model.
- **Two output ideas from Greptile's reviews are worth taking:** a copy-paste prompt for the
  developer's own agent, and a "how this was verified" line per finding.
- **A local review on the developer's own Claude subscription is allowed** by Claude Code's terms
  when it runs the unmodified `claude` binary signed in by the developer. The catch is the data
  terms: a personal Pro or Max account is under the Consumer Terms, so company code may be used
  for training if that setting is on. That has to be part of the request for permission.

## Greptile

### Review levels

From the [pricing page](https://www.greptile.com/pricing), checked 2026-11-03:

| Level | Cost per review |
| --- | --- |
| Base | 1 credit |
| Plus | 3 credits |
| Apex | 10 credits |

- Starter: free for one developer, 50 credits a month. Pro: US$1 per credit, no seat fees,
  credits prepaid and shared across the organisation. Enterprise: custom.
- The page does not describe what Plus or Apex do differently (model, number of agents, time).
- Greptile keeps public demo repositories "for Greptile Plus/Apex evaluation"
  ([demo-itk](https://github.com/greptileai/demo-itk), [demo-onyx](https://github.com/greptileai/demo-onyx),
  [demo-cline](https://github.com/greptileai/demo-cline) and others). demo-itk has the same pull
  request reviewed five times (#3–#7), but no review says which level wrote it, so the levels
  cannot be compared from them. Unchecked: whether the differences between those five reviews come
  from the level, from summary settings (#3 was closed "to re-open a fresh PR with the updated
  summary settings") or from run-to-run variance.

**What transfers to Wachiman:** the buyer chooses depth, never a model. This is #90's `tier`.
**What does not:** the credit. Greptile meters a pool shared across an organisation; Wachiman's
spend is already capped in dollars by `budget_usd` (ADR 0001 decision 6), so a credit would be a
second unit for the same cap.

### Agent tooling on GitHub

[github.com/greptileai](https://github.com/greptileai), checked 2026-11-03:

- [skills](https://github.com/greptileai/skills) (432 stars): three
  [Agent Skills](https://agentskills.io). `check-pr` looks for unresolved comments, failing
  checks and an incomplete description on a PR, fixes them and resolves the threads. `cli-review`
  runs a Greptile CLI review on the local checkout and summarises it. `greploop` asks Greptile for
  a review, fixes every actionable comment, pushes and asks again, at most five times, until the
  review gives 5/5 confidence and zero comments.
- [claude-plugin](https://github.com/greptileai/claude-plugin): a Claude Code plugin with the
  Greptile MCP server (read and resolve review results, search the team's knowledge base and coding
  patterns) and the Greptile CLI (review the working branch before a PR exists). Both sign in over
  OAuth against the Greptile account.
- [cli](https://github.com/greptileai/cli): `greptile login`, `greptile review`. Only the binary
  is published; the source "will be opened later in beta".

**Reading.** The skills and the plugin run on the developer's side and drive a review that happens
on Greptile's servers. The review is not written by a skill.

**Not worth copying:** `greploop` (the owner's `cs-babysit` and `cs-review-loop` skills run the same
loop), the 1–5 confidence score (Wachiman's `fix`, `consider` and `question` labels already say what
to do, and an uncalibrated number adds nothing), and an MCP server (`gh` already reads and resolves
threads).

### Two output ideas from the demo reviews

Read from [demo-itk #4](https://github.com/greptileai/demo-itk/pull/4) and
[#7](https://github.com/greptileai/demo-itk/pull/7):

1. **A prompt for the developer's agent.** The summary ends with a "Fix with agent prompt" block:
   every issue with `file:line`, the explanation, a suggested change, and the instruction "For each
   issue above, determine whether it is valid and should be fixed. If so, fix it directly." The
   owner fixes with Claude Code, so this removes copying findings one by one. It is text in the
   comment, with no extra model call.
2. **"How this was verified" per finding, with a concrete case.** For example: "changing an
   independently allocated `[7, 9, 11]` image to `[7, 9, 13]` leaves 693 pixels allocated but
   advertises 819", followed by which calls the claim was checked against. Wachiman's contracts
   already carry `evidence` that the engine checks against the head (`src/contracts.ts`, and the
   `UNVERIFIED` marker in `src/engine.ts`); its findings (`Finding`, `src/engine.ts`) carry only a
   title and a body. The candidate design, for #90: add `checked` (the lines read to confirm the
   finding) and `example` (input, wrong result, expected result) to a finding; validate `checked`
   with the code that already validates contract evidence; render one line under the finding; and
   degrade a `fix` or `blocker` whose `checked` does not resolve to `consider` with an unconfirmed
   note, never drop it (ADR 0018 of #90).

The demo reviews also open with a 1–5 confidence score and include a Mermaid diagram of the
change. Neither is proposed.

## Skills under `claude -p`

### The probe

A throwaway plugin with one skill (`codeword`, whose body says to answer `PAPAYA-42`) and a
throwaway project skill in a working directory's `.claude/skills/` (`localword`, `MANGO-77`). Each
run used Wachiman's adapter flags (`src/providers/claude-code.ts`): `-p --restricted
--strict-mcp-config --settings <file> --output-format json`, Haiku at effort `low`, the prompt on
stdin. Claude Code 2.1.317, 2026-11-03.

| Run | Setup | Result | Cost |
| --- | --- | --- | --- |
| A | `--plugin-dir <plugin>`, `--tools Read,Glob,Grep` (today's tools) | No skill visible: "The only tools I have are Glob, Grep, and Read" | $0.0007 |
| B | `--plugin-dir <plugin>`, `--tools Read,Glob,Grep,Skill` | Invoked `probe:codeword`, answered `PAPAYA-42` | $0.0015 |
| C | Skill in the working directory's `.claude/skills/`, `--tools …,Skill`, no `--plugin-dir` | Ignored: `localword` not listed | $0.0011 |

Two side findings:

- **C is a security property.** Under `--restricted`, a skill committed to the reviewed branch is
  not loaded, which matches what the adapter already relies on for `CLAUDE.md` and settings.
- **B brings Claude Code's bundled skills along.** With `Skill` enabled, the session also listed
  `code-review`, `loop`, `schedule`, `security-review`, `init` and others. Using skills in the
  reviewer would need to filter those, and `--disable-slash-commands` disables every skill,
  including the one wanted. Not tested: whether a permission rule on `Skill(<name>)` can narrow it.
- `--tools` takes several values, so a prompt given as the last argument is swallowed by it. The
  adapter already sends the prompt on stdin.

### Do skills help the reviewer?

**Not as a way to give the reviewer instructions.** A skill is prompt text that the model chooses to
load when its description seems to match. ADR 0016 does the opposite on purpose: the engine picks
the questions from the added lines with plain code, so every review gets a known set and the A/B
can measure it. A skill would make that choice the model's again. Progressive loading saves tokens
on long guides, but the engine already sends only the questions that fire, and prompt caching makes
the fixed part cheap.

**Where a skill would help is on the developer's side**, as with Greptile: a skill that tells the
developer's Claude Code how to read Wachiman's findings and fix them. The owner's
`cs-address-review-feedback` skill already does this for any reviewer's threads. The "prompt for
your agent" block above serves the same goal without anything to install.

## A local review on the developer's own subscription

The owner wants to run Wachiman on a laptop against an employer's code, signed in with a Claude
subscription, with nothing posted to GitHub and no telemetry. Getting permission for a local tool is
easier than getting a CI job and an API key approved. The design is a separate document; these are
the external facts it depends on.

**Others already do this.** The [CodeRabbit CLI](https://docs.coderabbit.ai/cli) reviews local
changes (`--type uncommitted`, with an agent-oriented output mode) and ships a
[Claude Code plugin](https://docs.coderabbit.ai/cli/claude-code-integration) (`/coderabbit:review
uncommitted`) whose docs warn a review can take 7 to 30+ minutes; it is in beta, and its docs
disagree on whether untracked files are included. The Greptile CLI (`greptile review`) reviews the
working branch before a PR exists. Both run the review on the vendor's servers, under the vendor's
account. A Wachiman local review would run on the developer's machine and account.

### Is a subscription allowed?

From Claude Code's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance),
checked 2026-11-03:

- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra,
  Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code
  and other native Anthropic applications."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own
  applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of
  their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or
  session tokens."
- It does not "prevent an end user from signing in to the unmodified Claude Code binary with their
  own Claude subscription".
- "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of
  Claude Code and the Agent SDK."

**Reading** (an interpretation, not legal advice): a local mode that runs the developer's own,
unmodified `claude` binary, signed in through Anthropic's own flow, and never reads, stores or
forwards the token, fits these terms. What would not fit: Wachiman reading the OAuth token, calling
the API with it directly, or running reviews for other people on one person's subscription. A
review that fires many batches is heavier than "ordinary, individual usage", so a local mode should
review on request, not on every save. In February 2026 Anthropic enforced the same restriction
against third-party tools that routed subscription credentials
([report](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use)).

### What happens to the employer's code

From Claude Code's [data usage page](https://code.claude.com/docs/en/data-usage), checked
2026-11-03:

- **Training.** Free, Pro, Max and Ultra are consumer accounts: Anthropic trains on their data
  "when this setting is on (including when you use Claude Code from these accounts)". Team,
  Enterprise and API accounts are commercial: Anthropic does not train on them unless the customer
  opts in.
- **Retention.** Consumer accounts: 5 years if the training setting is on, 30 days if it is off.
  Commercial accounts: 30 days, or zero data retention for qualified Enterprise organisations.
- **Local copies.** Claude Code keeps session transcripts in plain text under `~/.claude/projects/`
  for 30 days (`cleanupPeriodDays`).

**Consequence for the permission request.** On a personal Pro or Max account, the employer's code
goes to Anthropic under the Consumer Terms. The training setting must be off
([privacy controls](https://claude.ai/settings/data-privacy-controls)), and the employer should know
the 30-day retention. If the employer has a Claude Team or Enterprise plan, signing in with that
account puts the same review under commercial terms, which is the easier request to approve.

### Telemetry

From the same [data usage page](https://code.claude.com/docs/en/data-usage):

| Traffic | Contains | Off with |
| --- | --- | --- |
| Model calls | prompts and model output, including the code | cannot be turned off; it is the review |
| Metrics | latency, reliability, usage; "never include your code, prompts, or file paths" | `DISABLE_TELEMETRY=1` |
| Error reports (Pro, Max, Ultra sign-ins, v2.1.198+) | Claude Code's own errors and stack traces, with secrets and paths redacted | `DISABLE_ERROR_REPORTING=1` |
| `/feedback`, `/bug`, `/share` | the conversation, including code | `DISABLE_FEEDBACK_COMMAND=1`; never triggered by `-p` without a person |
| Session quality survey | a rating only | `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1` |
| WebFetch domain check | the hostname | not reachable: the adapter does not grant `WebFetch` |

`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off metrics, error reports, `/feedback` and
surveys at once. It also turns off feature-flag evaluation, which Wachiman does not depend on as far
as known (not tested). A local mode can set it in the environment of every `claude` call, so "zero
telemetry" means: nothing leaves the machine except the model calls, and Wachiman itself sends
nothing. Whether Wachiman makes any other network call in a local run is part of the design review.

## Sources

- Greptile pricing: <https://www.greptile.com/pricing>
- Greptile on GitHub: <https://github.com/greptileai>; <https://github.com/greptileai/skills>;
  <https://github.com/greptileai/claude-plugin>; <https://github.com/greptileai/cli>
- Greptile demo reviews: <https://github.com/greptileai/demo-itk/pull/4>,
  <https://github.com/greptileai/demo-itk/pull/7>
- Agent Skills: <https://agentskills.io>
- CodeRabbit CLI, local review of uncommitted changes and Claude Code plugin:
  <https://docs.coderabbit.ai/cli>, <https://docs.coderabbit.ai/cli/claude-code-integration>
- Claude Code legal and compliance: <https://code.claude.com/docs/en/legal-and-compliance>
- Claude Code data usage: <https://code.claude.com/docs/en/data-usage>
- Third-party subscription enforcement, February 2026:
  <https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use>
