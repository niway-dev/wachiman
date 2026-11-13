# ADR 0047: A stdio MCP server that runs the CLI as a child, with spend caps the agent cannot change

- **Status:** proposed 2026-11-13. Not implemented. Draft: it becomes accepted when the owner answers
  open questions 1 and 3 of the spec. Reuses
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  (local mode on the subscription), [ADR 0028](0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)
  (the Node launcher), [ADR 0029](0029-named-account-profiles-external-config-directories-and-home-kept-project-bindings.md)
  (profiles) and [ADR 0030](0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  (result `/2`). **Does not amend**
  [ADR 0002](0002-typescript-on-bun-zero-dependencies.md) when decision 2 holds; choosing the official
  SDK instead would need an amendment.
- **Date:** 2026-11-13
- **Spec:** [A Wachiman MCP server](../specs/2026-11-13-mcp-server-design.md)
- **Issue:** none yet.
- **Numbering:** `main` holds up to 0038. Open pull requests hold 0039
  ([#213](https://github.com/niway-dev/wachiman/pull/213)) and 0045 and 0046
  ([#210](https://github.com/niway-dev/wachiman/pull/210)). 0040 to 0044 are not on any open pull
  request I could list, but unpublished work may hold them. This draft takes 0047 and is renumbered on
  merge if it collides.

## Context

Wachiman's local review reaches an agent today through skills that tell it to run `wachiman local`.
That needs a shell and a host that reads skills. The Model Context Protocol (MCP) lets an editor or an
orchestrator call a program as a tool, with typed inputs and a structured result, and many hosts offer
a one-click install for it. The owner wants any agentic development environment to use Wachiman easily.

Four facts constrain the design:

- A review takes tens of seconds to many minutes, and the Claude Code provider blocks on each model
  call (`spawnSync` in `src/providers/claude-code.ts`). Hosts' tool timeouts range from 60 seconds
  (Codex default) to about 28 hours (Claude Code default).
- Each review spends the developer's Claude subscription, and the model, not the developer, decides when
  to call a tool.
- ADR 0019 promises local mode posts nothing, has no telemetry and keeps the developer's subscription
  out of any service.
- ADR 0002 keeps the engine free of runtime dependencies.

## Decision

1. **`wachiman mcp` serves MCP over stdio only.** Stdout carries protocol messages and nothing else;
   logs go to stderr; the server exits when stdin closes and ends its child. No Streamable HTTP, no
   hosted server, no tunnel.
2. **The protocol layer is hand-written**, limited to what a tools-only stdio server needs, and answers
   both the 2025-11-25 (`initialize`) and 2026-07-28 (`server/discover`, per-request `_meta`) protocol
   eras. The official SDK is allowed only as a test-only client.
3. **Every paid call is a child process** running `wachiman local` or `wachiman ask` through the same
   isolation flags as the launcher, from a neutral working directory, with `ANTHROPIC_API_KEY` removed
   from its environment.
4. **Phase 1 tools:** `review`, `review_job`, `ask`, `history` (list only), `status`, `doctor`. `loop`
   and verdicts are not tools until the rules that keep a loop honest travel with them.
5. **A review call blocks up to a soft deadline** (default 45 seconds), then returns a job id that
   `review_job` waits on or cancels. Progress notifications are sent when the host provides a token.
6. **Spend controls live in server arguments, never tool inputs:** one paid operation at a time per
   machine, a per-session call cap and estimated-dollar cap, an optional daily cap, no repeat of an
   identical complete review in a session, and cancellation that ends the child.
7. **The repository comes from `repoDir`, `--repo-dir` or the host's project directory,** and must be
   the same repository as the server's start directory when that is one. **The profile is never a tool
   input.**
8. **`review` and `ask` are not annotated read-only,** so a host that skips confirmation for read-only
   tools still confirms a paid call.

## Alternatives rejected

- **The official SDK as a runtime dependency.** Interoperability and upkeep come free, but three
  packages and about 16 MB land in a package that has one runtime dependency, `bun`, and the 2026-10-31
  amendment to ADR 0002 admits a dependency only when it improves reviews. Kept as the fallback.
- **Streamable HTTP, or a hosted server.** It would serve remote-only hosts such as Traycer, and
  comparable SaaS tools do it, but it adds a listener and routes the owner's subscription through a
  server, which ADR 0019 and the Claude Code terms it checked do not allow.
- **An in-process review.** Simpler, but the provider blocks the event loop, so the server could not
  answer a cancel, a progress request or stdin closing.
- **A start tool and a poll tool only.** Works in every host, but every poll is a model turn and the
  model decides how often to poll.
- **Relying on MCP Tasks.** It is the standard answer, but both sides must opt in and no target host's
  support is confirmed.
- **Caps as tool inputs.** The agent would raise its own limit.
- **A `loop` tool in phase 1.** The rules in the `wachiman-loop` skill would not reach a host without
  skills.

## Consequences

- A host with no shell or no skills can run a local review, get structured findings with history ids,
  and install the server with one command or link.
- The repository owns a protocol layer and its two eras. Spec churn (2025-11-25 to 2026-07-28 took
  about eight months) becomes this repository's work.
- A long review in a host with a short tool timeout costs the model several short `review_job` calls.
- A model can still start paid reviews up to the caps. The host's approval prompt and the tool
  descriptions are the human gate; the caps bound the damage.
- The review child cannot call the server again: the provider passes `--strict-mcp-config` and
  `--restricted`.
- Another long-running process exists on the developer's machine, with a lock file under the Wachiman
  home.

## Non-goals

- No remote or hosted transport, no authentication layer, no telemetry.
- No GitHub-posting tools (`review <pr>`, `comment`, `threads`) and no tool that changes accounts,
  profiles or project bindings.
- No tool that edits code.
- No MCP prompts, resources, Tasks or elicitation in phase 1.

## Reopen if

- The server needs anything beyond tools, or the era handling exceeds about 600 lines: use the SDK and
  amend ADR 0002.
- Two target hosts document MCP Tasks support: `review` returns a task handle to them.
- Two target hosts surface MCP prompts and the owner wants the workflow text there.
- A host that matters only accepts remote servers and the owner accepts a hosted service: reopen
  decision 1 and ADR 0019 together.
- The smoke test shows a host sends no progress token and enforces a short maximum timeout: revisit the
  soft deadline.
- The subscription terms change in a way that allows or forbids a local server calling `claude`.
