# A Wachiman MCP server, so any agentic development environment can run local reviews

- **Status:** proposed 2026-11-13. Not implemented. Written on Claude Sonnet 5.5 as design research;
  the owner has not yet chosen between the options in "Open questions".
- **Date:** 2026-11-13
- **Issue:** none yet.
- **Creates:** [ADR 0047](../adr/0047-a-stdio-mcp-server-that-runs-the-cli-as-a-child-with-spend-caps-the-agent-cannot-change.md)
  (draft). **Numbering:** `main` holds up to 0038; open pull requests hold 0039
  ([#213](https://github.com/niway-dev/wachiman/pull/213)) and 0045 and 0046
  ([#210](https://github.com/niway-dev/wachiman/pull/210)); 0040 to 0044 are not on any open pull request
  I could list, but unpublished work may hold them, so this draft takes 0047 and is renumbered on merge
  if it collides.
- **Reuses:** [ADR 0019](../adr/0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  (local mode on the developer's subscription, nothing posted, no telemetry),
  [ADR 0028](../adr/0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)
  (the Node launcher), [ADR 0030](../adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)
  (result `/2`), [ADR 0034](../adr/0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md)
  (one loop round per call), [ADR 0035](../adr/0035-a-rebuildable-sqlite-index-beside-the-run-files.md)
  (not touched). **Does not amend** [ADR 0002](../adr/0002-typescript-on-bun-zero-dependencies.md)
  when the protocol layer is hand-written (decision 2); it would need an amendment if the official SDK
  is used instead.

## Summary (one minute)

`wachiman mcp` is a new command that speaks the Model Context Protocol (MCP) over stdio, so a host such
as Claude Code, Codex, Cursor or VS Code can call Wachiman's local review as a tool instead of running
a shell command from a skill. It adds no new engine. Every paid call runs `wachiman local` or
`wachiman ask` as a child process and returns the CLI's existing JSON result. The five tools in phase 1
are `review`, `ask`, `history`, `status` and `doctor`.

Two facts shape the design. First, a review takes tens of seconds to many minutes, and Codex's default
tool timeout is 60 seconds, so a plain blocking call would fail there by default. The server therefore
waits up to a soft deadline (45 seconds by default), and if the review is still running it returns a
job id that a second tool, `review_job`, waits on or cancels. Second, each review spends the owner's
Claude subscription. The caps (calls per session, estimated dollars per session, one paid operation at
a time) are server arguments written by the installer, never tool inputs, so the agent cannot raise its
own limit.

The strongest argument against building it is that skills plus the CLI already work in every host that
has a shell, and CodeRabbit shipped a CLI with a structured `--agent` mode and a Claude Code plugin,
not an MCP server. The plan therefore stops after phase 2 and measures before it builds installers for
every host.

| # | Decision | Why | ADR |
| --- | --- | --- | --- |
| 1 | `wachiman mcp` serves MCP over **stdio only**. Stdout carries protocol messages and nothing else; logs go to stderr. No Streamable HTTP, no tunnel | The MCP stdio rule is that stdout holds only valid messages. A network listener would reopen ADR 0019's "no service, no telemetry" promise and route the owner's subscription through a server, which Claude Code's terms forbid for third parties | 0047 (new) |
| 2 | The protocol layer is **hand-written** (about 400 lines, tools only, both protocol eras). The official SDK is a test-only client | The SDK adds three packages and 16 MB on disk to a package whose engine has no dependency of its own ([ADR 0002](../adr/0002-typescript-on-bun-zero-dependencies.md)). The SDK would be the right call if the surface grew past tools | 0047 (new) |
| 3 | Each paid call is a **child process** (`wachiman local` / `ask`), never an in-process call | The provider calls `claude` with `spawnSync`, which blocks the event loop, so an in-process review could not answer a cancel or a ping | 0047 (new) |
| 4 | Tools: `review`, `review_job`, `ask`, `history`, `status`, `doctor`. `loop` and verdicts wait for phase 4 | One round per call fits MCP, but the rules that keep a loop honest live in the skill text, which a bare tool drops | 0047 (new) |
| 5 | Long reviews: **a blocking call with a soft deadline**, then a job id. Progress notifications always sent | Hosts differ: Claude Code's tool timeout defaults to about 28 hours, Gemini CLI's to 10 minutes, Codex's to 60 seconds, and Cursor's and VS Code's are not documented | 0047 (new) |
| 6 | Spend: one paid operation per machine, a per-session call cap and estimated-dollar cap, no repeat of an identical review, a cap the agent cannot change | A tool call is cheap for the model and expensive for the subscription | 0047 (new) |
| 7 | Repository: `repoDir` input, else `--repo-dir`, else the host's project directory, else an error. It must be the same repository as the server's start directory when that is a repository | An agent must not be able to send an unrelated repository to the model | 0047 (new) |
| 8 | Profile: never a tool input. The server uses the CLI's own resolution (binding, environment, default) and an optional `--profile` argument | Same rule as the `wachiman-review` skill: a flag would override the binding the developer chose | none (reuses ADR 0029) |
| 9 | Results: `structuredContent` holds the full result; `content` holds a compact text rendering | Hosts forward `content` to the model, and Claude Code caps a tool output at 25,000 tokens by default | none |
| 10 | Annotations: `review` and `ask` are not read-only, on purpose; `history`, `status` and `doctor` are read-only | A host may skip confirmation for a read-only tool; a paid call should not be skipped | 0047 (new) |
| 11 | Install: `wachiman mcp install [--host <name>]` uses the host's own CLI when it has one, prints a snippet when the file cannot be rewritten safely, and prints a deeplink for Cursor and VS Code | A rewrite of a JSONC or TOML file that loses comments is worse than a copy-paste | none |
| 12 | Skills stay the workflow instructions. Phase 1 exposes no MCP prompts | Prompt support is uneven or undocumented across the hosts, and the tool descriptions carry the few rules that matter | none |

## Open questions

1. **Hand-written protocol layer or the official SDK?** Default: hand-written. The SDK works on Bun
   (section 4) and would absorb spec churn, but it needs an owner amendment to ADR 0002 because the
   2026-10-31 amendment only admits a dependency that improves reviews. If the owner prefers the SDK,
   decision 2 flips and nothing else changes.
2. **Which hosts speak which protocol era?** The latest revision (2026-07-28) removed the `initialize`
   handshake. I could not find which hosts have moved. The server answers both eras (section 4), and the
   phase 1 smoke test records the answer per host.
3. **Default caps.** Default: 6 paid calls and $9 estimated per session, which is three runs at the
   default $3 per-run budget. The owner may want a lower number or a daily cap across sessions
   (`--daily-usd`, default off).
4. **One paid operation per machine or per server process?** Default: per machine, with a lock file
   under the Wachiman home, because several hosts can each start their own server. The cost is a stale
   lock after a crash, which the server clears by checking the owning process.
5. **May `repoDir` name a different repository?** Default: only the repository the server started in.
   A user-level install whose host starts the server outside any repository gets a looser rule (any git
   work tree, named in the result).
6. **`ask` as read-only.** Default: not read-only, so hosts keep confirming it. The hint would be
   truthful (the CLI writes nothing for `ask`), at the price of a host possibly running paid calls
   without asking.
7. **Does the owner want the plugin route for Claude Code?** A Claude Code plugin can bundle
   `mcpServers` and skills together ([plugin reference](https://code.claude.com/docs/en/plugins-reference)),
   which gives a one-command install of both. It is not in the plan; it is cheap once `wachiman mcp`
   exists.
8. **Is anyone other than Claude Code and Codex going to use it?** Most of the owner's tier list runs
   those two agents underneath (section 2). If those hosts are the real use, the skills already cover
   them, and phases 3 and 4 may not be worth building.

## Out of scope

- Streamable HTTP, a hosted server, and any tunnel. Traycer accepts only remote MCP servers
  ([Traycer docs](https://docs.traycer.ai/integrations/mcp)), so it is not served.
- Posting to GitHub, the GitHub modes (`review <pr>`, `comment`, `threads`), `setup`, `init`, `profile`
  and `project` as tools. They change accounts or write to a repository's remote.
- A tool that edits code. The README says Wachiman does not change code.
- `loop` and `history --verdict` as tools (phase 4).
- MCP Tasks, elicitation and MCP prompts (section 7 names the condition that reopens each).
- A cost-estimate command in the CLI (`local --estimate`). Useful, and listed as optional in phase 0.

---

# Detail

## 1. What the owner asked for, and what was checked

The owner wants any agentic development environment (ADE) to use Wachiman easily, with a one-command or
one-click install where the host supports it. This spec was written from the repository at
`origin/main` (v1.14.0) and from sources read on 2026-11-13. Every external claim has a link. "Unknown"
means the page I read did not say; it is not a negative finding.

What the repository already has, and this design reuses:

- **A CLI with JSON outputs.** `wachiman local --format json` writes `wachiman.review-result/1` or
  `/2` (`--result-version 2`); `ask --format json` writes `wachiman.ask-result/1`; `history --json`
  writes `wachiman.history-state/1`; `status --json` writes `wachiman.status/1`; `doctor --json` writes
  `wachiman.doctor/1`; `project show --json` writes `wachiman.project/1`
  ([formats](../formats/README.md), `src/cli.ts`, `src/doctor/checks.ts`, `src/status/command.ts`).
- **Three skills** (`skills/wachiman-review`, `wachiman-loop`, `wachiman-audit`) that tell an agent which
  command to run, how to pick the range and the profile, and how to present the result.
- **A Node launcher** (`bin/wachiman.js`) that runs the package's Bun with `--no-env-file` and the
  package's own `bunfig.toml`, so the reviewed repository's `.env` and `bunfig.toml` are never read
  (`bin/launcher-args.js`, [ADR 0028](../adr/0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)).
  It inherits stdio, ignores SIGINT while the child runs and forwards SIGTERM and SIGHUP.

Three repository facts decide the design:

- **The review call blocks.** The Claude Code provider uses `spawnSync` for the model call
  (`src/providers/claude-code.ts`), and each call has a 900-second wall-clock limit
  (`DEFAULT_CALL_TIMEOUT_S` in `src/providers/types.ts`). A review is a sequence of such calls, one per
  batch. The 2026-11-04 trial in the [local review guide](../local-review.md) took 34 seconds for one
  call on a six-file pull request. A larger change has several batches.
- **`local` refuses `ANTHROPIC_API_KEY`.** It stops when the variable is set so the subscription pays,
  not the API (`wachiman --help`, ADR 0019). Hosts often have the variable in their environment, and the
  `wachiman-review` skill already runs `env -u ANTHROPIC_API_KEY wachiman local`. The server must do the
  same for its child.
- **The review child cannot load MCP servers.** The provider starts `claude` with `--strict-mcp-config`
  and `--restricted` (`src/providers/claude-code.ts`, lines 212 to 213), and a managed profile that holds
  an `.mcp.json` is refused ([local review guide](../local-review.md)). A review started through the
  Wachiman MCP server cannot call the Wachiman MCP server again.

## 2. Host support

**Method.** Three Claude Haiku workers read official documentation and repositories in parallel (one
per group of products); I read the MCP specification, the SDK registry entries and the comparison
products myself. Where a worker could not identify a product it said so, and the table keeps that.

### The mainstream hosts

| Host | MCP | Transports | Config | Install helper | Prompts / resources | Tool timeout |
| --- | --- | --- | --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/mcp) | yes | stdio, HTTP, `ws`; SSE deprecated | `.mcp.json` (project), `~/.claude.json` (user), key `mcpServers` | `claude mcp add ... -- <cmd> <args>`, `claude mcp add-json`; plugins can bundle `mcpServers` ([plugin reference](https://code.claude.com/docs/en/plugins-reference)) | tools, prompts, resources listed; elicitation and roots supported | `MCP_TOOL_TIMEOUT` defaults to about 28 hours; stdio idle window 30 minutes, kept alive by progress notifications; output capped at 25,000 tokens |
| [Codex CLI, app and IDE extension](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) | yes | stdio, Streamable HTTP | `~/.codex/config.toml`, `.codex/config.toml` for trusted projects, table `[mcp_servers.<name>]` | `codex mcp add <name> -- <cmd> <args>` | server `instructions` read at initialization; the rest unknown | `tool_timeout_sec` **defaults to 60**, `startup_timeout_sec` to 10 ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference)) |
| [Cursor](https://cursor.com/docs/context/mcp) | yes | stdio, SSE, Streamable HTTP | `.cursor/mcp.json`, `~/.cursor/mcp.json`, key `mcpServers` | deeplink `cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 JSON>` ([install links](https://cursor.com/docs/plugins/mcp/install-links)); no CLI found | prompts, resources, roots, elicitation listed; the rest unknown | unknown |
| [VS Code (Copilot agent)](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration) | yes | stdio, `http`, legacy `sse` | `.vscode/mcp.json`, key `servers`; newer Copilot setups also read `.mcp.json` with `mcpServers` | `code --add-mcp '<json>'`; web redirect `https://insiders.vscode.dev/redirect/mcp/install?name=<name>&config=<urlencoded JSON>` as used by the [GitHub MCP server README](https://github.com/github/github-mcp-server) (not in the VS Code pages I read) | tools, prompts, resources, roots, sampling, elicitation linked; the rest unknown | unknown; `cwd` defaults to the workspace folder |
| [Windsurf](https://docs.devin.ai/windsurf/plugins/cascade/mcp) | yes | stdio, Streamable HTTP, SSE | `mcp_config.json`; the page names both `~/.config/devin/` and `~/.codeium/windsurf/`, so check the installed version | UI only | tools, resources, prompts | unknown |
| [Zed](https://zed.dev/docs/ai/mcp) | yes | not named ("local and remote") | settings file, key `context_servers` | settings UI; no CLI | tools and prompts only; elicitation listed as future work | unknown |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md) | yes | stdio, SSE, Streamable HTTP (`httpUrl`) | `~/.gemini/settings.json`, `.gemini/settings.json`, key `mcpServers` | `gemini mcp add [options] <name> <commandOrUrl> [args...]` | prompts as slash commands, resources as `@server://...` | `timeout` defaults to 600,000 ms |
| [opencode](https://opencode.ai/docs/mcp-servers) | yes | local (stdio), remote (Streamable HTTP) | `opencode.json(c)` in the project, `~/.config/opencode/`; the page puts servers under `mcp.servers`, older configs under `mcp.<name>` | `opencode mcp add <name> -- <cmd> <args>`, `--global` | prompts as `<server>:<prompt>`, resources through built-in tools, elicitation supported; "a shared connection has no roots" | `execution` timeout 12 hours |

None of the pages I read for these hosts say whether they support progress notifications beyond Claude
Code, tool annotations (Claude Code uses `readOnlyHint` and `idempotentHint` for retry and parallelism,
not display) or `outputSchema`. I treat all of them as unknown and design so a host that ignores
them still works: the result is also in `content`.

### The owner's tier list

Most of these products are orchestrators: they start Claude Code, Codex, Cursor or OpenCode in a git
worktree. Where that is true, the useful install target is the underlying agent's own configuration
(Claude Code or Codex), not the orchestrator's. Whether an orchestrator passes the agent's own MCP
configuration through is unknown for nearly all of them.

| ADE | MCP | Transport | Install method for Wachiman | Source |
| --- | --- | --- | --- | --- |
| T3 Code | serves an MCP endpoint to outside agents (HTTP, OAuth); whether its own threads load third-party servers: unknown | HTTP; stdio unknown | install into the Claude Code or Codex it runs, then smoke-test | [outside agents](https://raw.githubusercontent.com/pingdotgg/t3code/HEAD/docs/user/outside-agents.md), [Claude provider](https://raw.githubusercontent.com/pingdotgg/t3code/HEAD/docs/user/providers-claude.md) |
| Capy | yes, as a client | Streamable HTTP (default) and stdio | Settings, MCP and plugins; the page says it imports Claude Code `mcpServers` JSON or Codex TOML. Whether its agents run on the owner's machine, where the clone and the `claude` sign-in are: unknown | [Capy MCP](https://docs.capy.ai/integrations/mcp) |
| Zeron | unknown (nothing found) | unknown | install into the agents it runs (Claude Code, Codex, OpenCode, Cursor) | [zeron.sh](https://zeron.sh) |
| bb | unknown (nothing found) | unknown | install into Claude Code or Codex | [ymichael/bb](https://github.com/ymichael/bb) |
| Paseo | runs its own MCP server for orchestration; third-party servers: unknown | not documented | install into the agents it runs | [Paseo MCP](https://raw.githubusercontent.com/getpaseo/paseo/main/public-docs/mcp.md) |
| MonoCode | unknown (nothing found) | unknown | install into the agents it runs | [hardbeat920/monocode](https://github.com/hardbeat920/monocode) |
| super.engineering | unknown (no MCP page found) | unknown | install into the agents it runs | [super.engineering](https://super.engineering) |
| Synara | serves an MCP endpoint to external clients; client side unknown | stdio bridge | install into the agent it runs | [external MCP](https://github.com/Emanuele-web04/synara/blob/main/docs/external-mcp.md) |
| Orca | yes: endpoints registered in Settings, Integrations, MCP appear in agent CLIs that support MCP | unknown | UI only; or install into the agent | [Orca docs](https://orca.dev/docs/cli/skills) |
| Diri | serves its own MCP server; client side unknown | stdio, plus local HTTP | install into the agent it runs | [Diri MCP](https://diri.sh/docs/mcp) |
| Traycer | yes, remote servers only: "Local MCP servers are not supported at this time" | remote HTTPS | **cannot be served** by a stdio server | [Traycer MCP](https://docs.traycer.ai/integrations/mcp) |
| Emdash | yes, in Library, MCP; it writes each agent's own file (for example `~/.claude.json`, `~/.codex/config.toml`) | stdio, HTTP | Library, MCP, custom command | [Emdash MCP](https://emdash.com/docs/library/mcp) |
| Paradev | serves an MCP server for workspaces; client side unknown | HTTP | install into Claude Code or Codex | [Paradev MCP](https://docs.paradev.com/mcp) |
| Conductor | unknown for general use; the only MCP setup found connects Slack to cloud workspaces (I read the first 100,000 of about 385,000 characters of its docs file) | unknown | install into Claude Code or Codex | [Conductor docs](https://www.conductor.build/llms-full.txt) |

**What this means.** Installing into Claude Code and Codex covers the orchestrators that run them, if
the orchestrator keeps the agent's own configuration. That is the first thing the smoke test checks.
Only Capy, Orca and Emdash document a way to register a server in the orchestrator itself, and all
three are UI-only.

## 3. The MCP specification, as it matters here

The latest revision is [2026-07-28](https://modelcontextprotocol.io/specification/latest). Its
[changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) removes the
`initialize` handshake (every request carries `protocolVersion` and client capabilities in `_meta`),
adds a required `server/discover`, removes `ping`, replaces server-initiated requests such as
`elicitation/create` with a multi round-trip pattern (`resultType: "input_required"`), moves Tasks into
an extension, and deprecates Roots, Sampling and Logging. The previous revision is 2025-11-25.

| Topic | What the specification says | Use in this design |
| --- | --- | --- |
| stdio | The server reads and writes newline-delimited JSON-RPC; "MUST NOT write anything to its stdout that is not a valid MCP message"; stderr is free for logs; the client closes stdin, then terminates the process ([stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)) | Decision 1. The server exits when stdin closes and kills its child |
| Tool annotations | `readOnlyHint` (default false), `destructiveHint` (default true, meaningful only when not read-only), `idempotentHint` (default false), `openWorldHint` (default true). All are hints; "Clients should never make tool use decisions based on `ToolAnnotations` received from untrusted servers" ([schema](https://modelcontextprotocol.io/specification/2026-07-28/schema)) | Decision 10. Annotations describe; the caps enforce |
| Structured output | A tool may declare `outputSchema` and return `structuredContent`; the server MUST conform; "a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block" ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)) | Decision 9 deviates from the SHOULD, with a reason (section 6) |
| Errors | Tool execution errors use `isError: true` in the result; protocol errors use JSON-RPC errors ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)) | A refused paid call is a tool execution error, so the model can read why |
| Cancellation | On stdio the client sends `notifications/cancelled`; the server SHOULD stop and MUST NOT send a further message for that request ([cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation)) | Section 5 |
| Progress | `notifications/progress` carries `progressToken`, `progress`, optional `total` and `message` ([schema](https://modelcontextprotocol.io/specification/2026-07-28/schema)); a client MAY reset its timeout on one but SHOULD keep a maximum ([cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation)) | Section 5 |
| Tasks | An extension: the server returns a task handle, the client polls `tasks/get`; both sides must opt in ([Tasks](https://modelcontextprotocol.io/extensions/tasks/overview)). The extension matrix rendered without cell contents when I fetched it, so I could not read which hosts support Tasks ([matrix](https://modelcontextprotocol.io/extensions/client-matrix)) | Not used in phase 1; section 7 |
| Elicitation | In 2026-07-28 a tool answers with `input_required` and the client retries ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)); Cursor, VS Code, Claude Code and opencode list elicitation support (section 2) | Not used in phase 1; section 7 |
| Roots | Deprecated in 2026-07-28 ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)); Claude Code answers `roots/list` with its launch directory ([Claude Code MCP](https://code.claude.com/docs/en/mcp)) | Section 5 uses explicit paths instead |

## 4. Protocol layer: write it or import the SDK

**What I measured on 2026-11-13.** The official TypeScript SDK is now v2, published as
`@modelcontextprotocol/server` (latest 2.4.0, published 2026-10-23); the v1 package
`@modelcontextprotocol/sdk` (1.32.2) "continues to receive bug fixes and security updates for at least
six months after the v2 release (2026-07-27)" ([repository](https://github.com/modelcontextprotocol/typescript-sdk),
[npm registry](https://registry.npmjs.org/@modelcontextprotocol/server)). Its README says it runs on
Node.js, Bun and Deno.

I installed `@modelcontextprotocol/server@2.4.0` with `bun add` in a scratch directory outside the
repository and ran a one-tool stdio server:

- It runs on Bun 1.3.4 (the version this repository pins) and on Bun 1.4.2. A client using the
  2025-11-25 `initialize` handshake got a correct `tools/list` and `tools/call` with
  `structuredContent`, annotations and `outputSchema`.
- A request using the 2026-07-28 shape (`server/discover` with `_meta`) returned `-32601 Method not
  found`, although the package README says it implements 2026-07-28. This is one probe, on stdio only,
  and I did not read the SDK's source, so it is a reason to test, not a finding about the SDK.
- The install is three packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/core`, `zod`),
  about 16 MB on disk (`zod` alone is 8.1 MB). The registry lists 7.0 MB unpacked for the server package
  and 1.37 MB for the core package. The v1 package has 17 dependencies (Express, Hono, jose, ajv and
  others). The SDK needs `zod` 4.

**ADR check.**

- [ADR 0002](../adr/0002-typescript-on-bun-zero-dependencies.md) says the engine has "no runtime
  dependencies" and that code beside the key should be "the smallest possible set". The 2026-10-31
  amendment admits a dependency when "a measured experiment shows it improves reviews"; the 2026-11-09
  amendment admits exactly one, `bun`. An MCP SDK improves how hosts call Wachiman, not the reviews, so
  it would need a new owner amendment. None of ADR 0002's three "Reopen if" conditions is met (a
  provider needs a runtime Bun cannot drive, a second maintainer wants another stack, Bun's cadence
  breaks the pin). The SDK route is therefore a policy change the owner would have to make, not one the
  ADR already allows.
- A hand-written layer does not touch ADR 0002. Its cost is real: the code owns the protocol
  eras. The 2026-07-28 revision came about eight months after 2025-11-25.

**Recommendation: hand-write it, limited to what a tools-only stdio server needs, and test it with the
SDK's client.** The surface is `initialize` (2025-11-25), `server/discover` (2026-07-28), `tools/list`,
`tools/call`, `notifications/cancelled`, `notifications/progress` and `ping`. The server detects the era
from the first message: an `initialize` request selects 2025-11-25 behaviour; a request with
`_meta["io.modelcontextprotocol/protocolVersion"]` selects 2026-07-28 behaviour (`resultType`,
`ttlMs`, `cacheScope`). The contract test drives both with a small client written in the test file and
adds the official SDK client as a test-only check in phase 1 if the owner allows a dev dependency.
**Reopen the choice** when the server needs anything beyond tools (resources, prompts, Tasks) or when
the era handling grows past about 600 lines: then the SDK is cheaper.

## 5. The command and its tools

### `wachiman mcp`

```text
wachiman mcp [--repo-dir <dir>] [--profile <name>] [--max-calls <n>] [--max-usd <n>]
             [--daily-usd <n>] [--wait <seconds>] [--job-timeout <seconds>]
wachiman mcp install [--host <name>|--all] [--scope user|project] [--dry-run] [--print] [...same limits]
```

- It runs through the existing launcher, so Bun starts with `--no-env-file` and the package's
  `bunfig.toml`. The launcher inherits stdio, so stdin closing reaches the server directly. If the
  host kills the Node launcher, Bun still sees the stdin close and exits.
- Nothing is written to stdout except protocol messages. A test fails on any stray byte. Notices go to
  stderr. Bun's own warnings also go to stderr.
- On stdin close the server cancels any job (section 5.4) and exits. On SIGTERM it does the same.
- Each paid call spawns `process.execPath` with the same isolation flags as the launcher
  (`--no-env-file`, `--config=<pkg>/bunfig.toml`, `<pkg>/src/cli.ts`), with its working directory set to
  a neutral directory (the Wachiman home), not the reviewed clone, as the `wachiman-review` skill
  requires. The child's environment is the server's minus `ANTHROPIC_API_KEY`. The result carries
  `auth: "subscription"` so the reader knows which payer ran.

### Tools

Tool names are short; hosts add their own prefix. All paths are absolute. Every input object rejects
unknown properties. The scope inputs mirror the CLI flags and are mutually exclusive, as in `local`.

**`review`** (paid)

| Input | Type | Meaning |
| --- | --- | --- |
| `scope` | one of `{base}`, `{from}`, `{commit}`, `{workingTree: "staged"|"all"}`, or omitted | The same ranges as `local`: omitted means the merge-base with the default branch |
| `paths` | string[] | Review only changed files under these paths |
| `repoDir` | string | The clone (see 5.3) |
| `history` | boolean, default true | The skill's default (`--history`); false opts out of the on-laptop history |
| `verify` | boolean, optional | `--verify` or `--no-verify`; omitted follows the environment |

Not exposed: `--max-depth` (the skill says to pass it only when the developer gives that number
themselves), `--profile`, `--input`, `--output`, and any force or bypass flag.

Output (`structuredContent`, `wachiman.mcp-review/1`):

```json
{
  "format": "wachiman.mcp-review/1",
  "status": "complete",
  "jobId": "j_7f3a",
  "auth": "subscription",
  "repo": { "root": "/abs/clone", "head": "5d6e7f8", "scope": "merge-base(origin/main, HEAD)" },
  "spend": { "runUsdEstimate": 0.41, "sessionUsdEstimate": 0.41, "sessionCalls": 1,
             "capUsd": 9, "capCalls": 6, "note": "API-equivalent estimate, not a bill" },
  "result": { "format": "wachiman.review-result/2" }
}
```

`status` is `complete`, `partial` (a usage limit or a timeout ended the run; the result lists what was
not reviewed), `cached`, `running` or `refused`. `result` is the full
[`wachiman.review-result/2`](../formats/review-result.v2.schema.json), produced with
`--result-version 2` so each finding carries its history id. The declared `outputSchema` is the
envelope only; `result` is declared as `{"type": "object", "required": ["format"]}`. The published
result schema is more than 1,000 lines, and hosts that put `outputSchema` into the model's context would
pay for it on every session. The contract test validates the full result against
`docs/formats/review-result.v2.schema.json`.

`content[0].text` is a compact rendering for the model: the coverage line and what was not reviewed,
findings by severity with `path:line`, title and history id, the estimate and the stop reason. It
reuses the terminal sink, not a new renderer. Annotations: `readOnlyHint: false`,
`destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`.

**`review_job`** (free; waits on, or cancels, a review that outlived the soft deadline)

Input `{ jobId, action: "wait" | "cancel" }`, default `wait`; `wait` blocks up to the soft deadline and
returns the same envelope. A finished job is kept for the session. Annotations: `readOnlyHint: false`
(cancel changes state), `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

**`ask`** (paid)

Input: `question` (string, optional; empty asks for the walkthrough), `scope` as in `review` (no
`paths`), `repoDir`. Output: the CLI's `wachiman.ask-result/1` (`sections[]`, `notAnswered`,
`hasReview`, `removedRefs`) in an envelope with the same `spend` block; `content` renders the sections
with their `path:line` references. `ask` never runs a review and writes nothing, so a host that uses
the hint could treat it as read-only. This spec sets `readOnlyHint: false` for the reason in decision
10 and asks the owner (open question 6). `openWorldHint: true`.

**`history`** (read-only)

Input: `repoDir`, `sinceDays`, `allRepos`. Output: `wachiman.history-state/1`. It lists only; `--forget`
and `--verdict` are not reachable. `readOnlyHint: true`, `openWorldHint: false`. The CLI moves a damaged
run file aside when it meets one (the `dashboard` help says `history` does the same), which is the one
write the hint does not cover; the description says so.

**`status`** (read-only)

Input: `sinceDays`, `allRepos`, `by` (day, repo, model, profile), `repo`, `model`, `profile`. Output:
`wachiman.status/1` (the kept runs and their estimated cost). `readOnlyHint: true`,
`openWorldHint: false`.

**`doctor`** (read-only)

Input: `repoDir`, `allProfiles` (boolean). Output: `wachiman.doctor/1`, with paths redacted
(`--redact-paths`) by default so a host that logs tool results does not record the home directory.
The profile line the CLI prints (for example `profile: work (managed; chosen by project binding)`) is
in the result, which is how an agent explains which account a review used. `readOnlyHint: true`,
`openWorldHint: false`. It runs `claude --version` and `bun --version` probes, so it is local only.

### 5.1 Is `loop` a tool?

Not in phase 1. [ADR 0034](../adr/0034-a-review-loop-driven-by-the-cli-that-never-edits-code.md) makes a
loop round one call, which is a natural MCP tool call, and `loop` exits `0`, `10` or `11`, which map to
a `converged`, `open` or `stopped` outcome. The reason to wait is that the loop's honesty rules (judge a
finding `wrong` only with a reason, never to make the loop end, the stop is not an approval) are in the
`wachiman-loop` skill, and a host that exposes the tool without the skill would let an agent end the
loop by judging findings `wrong`. Phase 4 adds `loop` and `history_verdict` together, with the rules in
the tool descriptions and an MCP prompt, and only after phase 2 shows the review tool is used.

### 5.2 Long reviews: blocking call with a soft deadline, or a start and poll pair

The options, and what the hosts support:

1. **Blocking call, progress notifications, no deadline.** The simplest, and cancellable with one
   protocol message. It works where the host's tool timeout is long: Claude Code (about 28 hours, idle
   window 30 minutes reset by progress), opencode (12 hours) and Gemini CLI (10 minutes). It fails by
   default in Codex (60 seconds) and is unknown for Cursor, VS Code, Windsurf and Zed.
2. **A start tool and a poll tool.** Works everywhere, but each poll is a model turn: the model decides
   when to poll, may poll in a tight loop, and pays tokens for it. A review also becomes two things the
   agent must remember to finish.
3. **MCP Tasks.** The standard answer to this exact problem, but both sides must opt in, and I could not
   confirm any target host supports it.
4. **Blocking call with a soft deadline, then a job id (chosen).** `review` waits up to `--wait` seconds
   (default 45, under Codex's 60) for the child. If it finishes, the call returns the result as in
   option 1. If not, it returns `status: "running"` with a `jobId`, the child keeps running, and
   `review_job` waits another 45 seconds per call. A 34-second review (the measured case) returns in one
   call everywhere. A ten-minute review returns after 45 seconds and costs the model about thirteen
   short calls in a host with the default, or one call in a host where the installer raised `--wait`.

The installer sets `--wait` per host where the host documents its limit: Claude Code `600`
(`MCP_TOOL_TIMEOUT` is about 28 hours and progress keeps the idle window alive), and for Codex it also
writes `tool_timeout_sec = 900` so the model's first call can wait longer than 60 seconds. For
Cursor, VS Code, Windsurf and Zed the default 45 stays until a smoke test shows more is safe.

**Progress.** If the call carries a `progressToken`, the server sends `notifications/progress` from the
child's stderr: the line `batches: N` gives `total`, each `batch i/N` line advances `progress`
(`src/local.ts` prints the first; `src/engine.ts` labels each call `batch i/N`), and a heartbeat every
15 seconds repeats the last message with the elapsed time. Parsing log text is fragile. Phase 0 asks for
a stable machine-readable form (see the plan), and until then a contract test pins the two line shapes.

### 5.3 Spend safety

The point is that the model decides when to call and the subscription pays. The controls:

- **One paid operation at a time, per machine.** A lock file under the Wachiman home holds the owning
  process id. A second `review` or `ask`, from this server or another host's, returns
  `status: "refused"` with `reason: "busy"` and the running job's repository and age. A stale lock
  (owner gone) is cleared. The owner has one machine; the lock protects it from two hosts reviewing at
  once.
- **Per-session caps, set by the owner.** `--max-calls` (default 6 paid calls) and `--max-usd` (default
  $9 estimated, which is three runs at the default $3 per-run budget; the figure is the CLI's
  API-equivalent estimate, "not a bill"). Before a call starts, the server refuses if
  `calls >= maxCalls` or `spent + reserve > maxUsd`, where `reserve` is the run's configured budget. After the
  call, `spent` adds the reported `costUsdEstimate` (a field of the result), or the whole reserve when no
  result came back (cancelled or killed).
- **An optional daily cap.** `--daily-usd` (default off) adds the last 24 hours of `wachiman status --json
  --since 1d --all-repos` to `spent`. It reads the local history, so it covers runs made with history
  on, including the server's own. The server does not read the ledger (open pull requests
  [#211](https://github.com/niway-dev/wachiman/pull/211) and
  [#213](https://github.com/niway-dev/wachiman/pull/213) are not merged).
- **The caps are not tool inputs.** They are server arguments, written into the host's config by the
  installer. An agent can read them in the `spend` block and cannot raise them. A refusal reads: the cap,
  what was spent, and "ask the developer; they can restart the server with a higher limit". It is a tool
  execution error (`isError: true`), so the model sees it.
- **No repeat of an identical review.** The key is the repository root, the head commit (or tree id for a
  working-tree scope), the scope, the paths and the verify setting. A second identical call in the same
  session returns the stored result with `status: "cached"` and spends nothing. A `partial` result is not
  stored, so a run cut short by a usage limit can be tried again. There is no `force` input: a
  changed head is a different key, and an owner who wants an identical rerun uses the CLI. Across
  sessions the kept history already stores the result, and `ask` reads it.
- **Cancellation.** On `notifications/cancelled` for a blocked call, the server sends SIGINT to the
  child (the CLI stops, removes its snapshot and exits 130; `local` guide), waits 10 seconds, then
  SIGTERM, then 5 seconds, then SIGKILL, and sends no further message for that request. A killed child
  can leave its snapshot directory in the system temporary folder; the server logs the path on stderr.
  The reserve for a cancelled run stays counted. For a job that outlived the soft deadline, the original
  call has already returned, so only `review_job` with `action: "cancel"`, stdin closing, SIGTERM or the
  job timeout (`--job-timeout`, default 1,800 seconds) stops it.
- **The tool description tells the model to ask first.** Every paid tool's description says: "This
  spends the developer's Claude subscription. Ask the developer before calling it; never call it to
  re-check work you just changed unless they asked." A host's own approval prompt for tool calls is the
  human gate; the MCP specification says there SHOULD be one
  ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

### 5.4 Repository and profile resolution

**Repository.** In order:

1. `repoDir` in the tool call. The description tells the model to pass the workspace path it is working
   in.
2. `--repo-dir` in the server arguments (what a project-scoped install writes).
3. The host's project directory: the server's working directory, or `CLAUDE_PROJECT_DIR` when set
   (Claude Code puts it in the server's environment, [Claude Code MCP](https://code.claude.com/docs/en/mcp)).
   VS Code's `cwd` defaults to the workspace folder
   ([VS Code MCP configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)),
   and opencode's to the workspace ([opencode MCP](https://opencode.ai/docs/mcp-servers)). Codex's,
   Cursor's, Gemini CLI's and Zed's defaults are not documented in the pages I read.
4. Otherwise a tool error: "no repository: pass `repoDir`".

The path is resolved to the git top level. **Which repositories are allowed.** When the server's start
directory is inside a git work tree, `repoDir` must belong to the same repository (same
`git rev-parse --git-common-dir`, so worktrees count). When it is not, any git work tree is accepted and
named in the result (open question 5). An agent cannot send an unrelated repository to the model through
this tool. MCP Roots are not used: the 2026-07-28 revision deprecates them, and hosts differ.

**Profile.** Never a tool input. The child runs `wachiman local` without `--profile`, so the CLI's own
order applies: the project binding made by `wachiman setup`, then `WACHIMAN_PROFILE`, then the default
profile, then the built-in `default` ([local review guide](../local-review.md)). `wachiman mcp --profile
<name>` passes `--profile` to every child and wins over the binding, as the flag does in the CLI; the
installer writes it only when the owner asks. `doctor` explains the resolved profile. A review started
on the built-in `default` profile runs on the developer's own `claude`, and the tool description says so
only through `doctor`, as the skill does.

### 5.5 Version and compatibility notes

- Result `/2` is used so history ids exist ([ADR 0030](../adr/0030-review-result-2-carries-verification-and-origin-with-an-explicit-downgrade-to-1.md)).
- A working-tree scope defaults to `/2` in the CLI and has no `/1` form
  ([formats](../formats/README.md)).
- The server reports its version and the CLI's (they are the same package) in `serverInfo` and in each
  result's `engine`.

## 6. Result shape: why `content` is not the full JSON

The specification says a tool that returns structured content SHOULD also put the serialized JSON in a
text block, for clients that ignore `structuredContent`. This design returns the full result in
`structuredContent` and a compact rendering in `content`. The reasons are cost and a documented limit:
a review result with a dozen findings, each with an anchor, evidence and a verification block, is large;
text content is what hosts normally show the model; Claude Code truncates a tool output above 25,000
tokens by default ([Claude Code MCP](https://code.claude.com/docs/en/mcp)). A host that reads only
`content` gets everything an agent needs to present the findings (path, line, severity, title, id,
coverage, estimate); a host that reads `structuredContent` gets the contract. If the owner prefers the
specification's default, the cost is a larger context on every review and a risk of truncation in
Claude Code. This is the one place the design chooses against a SHOULD.

## 7. Prompts, Tasks, elicitation, and the skills

**Skills stay the workflow.** The skills say how to pick a range from "my branch", "only commit X" or
"from X on", how to present findings, and what never to do. MCP carries the transport. The tool
descriptions hold the rules that must travel with a tool in a host without skills: ask before a paid
call, never review the code yourself, pass `repoDir`, do not pass a profile, present path and line from
the result only. Updating `skills/wachiman-review` to say "use the MCP tools when they are available,
otherwise the CLI" is a phase 3 edit.

**Prompts: not in phase 1.** Claude Code, Gemini CLI and opencode surface MCP prompts; Zed and Windsurf
list prompts; Codex's documentation does not mention them (section 2). Two copies of the workflow text
(one in the skill, one in a prompt) would drift. Reopen when at least two target hosts surface prompts
and the owner wants them: generate the prompt from `skills/wachiman-review/SKILL.md` at build time so
there is one source.

**Tasks: not in phase 1.** The soft deadline and `review_job` do by hand what the Tasks extension
specifies. Reopen when two target hosts document Tasks support: `review` then returns a task handle to
them and keeps the current behaviour for everyone else.

**Elicitation: not in phase 1.** A confirmation before a costly review ("this will use about $X; go
on?") is the natural use, and Claude Code, Cursor, VS Code and opencode list elicitation support. In
the 2026-07-28 revision it becomes a multi round-trip result, which a hand-written server must
implement for both eras. Reopen if the owner wants a server-side confirm above the session cap.

## 8. Install UX

### `wachiman mcp install`

```text
wachiman mcp install [--host claude-code|codex|cursor|vscode|gemini|opencode|windsurf|zed|capy|all]
                     [--scope user|project] [--dry-run] [--print]
```

Rules, in order of preference:

1. **Use the host's own CLI when it has one.** Claude Code, Codex, VS Code, Gemini CLI and opencode have
   one (section 2). The command shells out to it, so the host's own parser writes its own file.
2. **Never rewrite a file it cannot round-trip.** Zed's settings, Windsurf's JSON and Codex's TOML may
   hold comments or hand edits. If no CLI exists, the installer prints the snippet and the path.
   `--print` prints every host's snippet without touching anything; `--dry-run` shows the command it
   would run.
3. **Print a deeplink where a host has one.** Cursor and VS Code (below).
4. **Write the absolute path of the launcher.** GUI hosts on macOS do not necessarily inherit a shell
   `PATH`, and Codex starts a server within 10 seconds by default
   ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference)). The installer
   writes the path of the installed `wachiman` (the resolved `bin/wachiman.js`), with a note that it must
   be re-run after a move. It does not default to `npx -y wachiman mcp`: the first run downloads the
   package and Bun (60 to 115 MB unpacked, [ADR 0028](../adr/0028-the-npm-package-installs-bun-itself-behind-a-node-launcher-and-no-windows-executable.md)),
   which can exceed a host's startup timeout.
5. **Print the next step.** After install: "run `wachiman doctor`" and "restart the host".

Phase 1 has no installer: the snippets below are documented by hand in `docs/mcp.md`.

### Exact snippets

In each, `wachiman` stands for the absolute launcher path the installer writes. They follow each host's
documented shape (section 2); the Cursor and VS Code deeplinks are a documented format applied to our
config, not a link I clicked in a host.

**Claude Code** (user scope; `600` is the soft deadline, section 5.2):

```sh
claude mcp add --scope user wachiman -- wachiman mcp --wait 600
```

or, shared in a repository, `.mcp.json`:

```json
{ "mcpServers": { "wachiman": { "command": "wachiman", "args": ["mcp", "--wait", "600"] } } }
```

**Codex** (CLI, app and extension share `~/.codex/config.toml`):

```sh
codex mcp add wachiman -- wachiman mcp
```

```toml
[mcp_servers.wachiman]
command = "wachiman"
args = ["mcp"]
tool_timeout_sec = 900
```

**Cursor** `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "wachiman": { "command": "wachiman", "args": ["mcp"] } } }
```

Deeplink (the `config` value is the base64 of `{"command":"wachiman","args":["mcp"]}`):

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=wachiman&config=eyJjb21tYW5kIjoid2FjaGltYW4iLCJhcmdzIjpbIm1jcCJdfQ==
```

**VS Code** `.vscode/mcp.json`:

```json
{ "servers": { "wachiman": { "type": "stdio", "command": "wachiman", "args": ["mcp"] } } }
```

```sh
code --add-mcp '{"name":"wachiman","type":"stdio","command":"wachiman","args":["mcp"]}'
```

Web redirect, in the form the GitHub MCP server README uses for its badges:

```text
https://insiders.vscode.dev/redirect/mcp/install?name=wachiman&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22wachiman%22%2C%22args%22%3A%5B%22mcp%22%5D%7D
```

**Gemini CLI** `~/.gemini/settings.json` (the timeout is milliseconds):

```json
{ "mcpServers": { "wachiman": { "command": "wachiman", "args": ["mcp"], "timeout": 900000 } } }
```

**opencode:** `opencode mcp add wachiman -- wachiman mcp` (the CLI hides the layout difference the two
documentation pages show). The file form, per the current page:

```json
{ "mcp": { "servers": { "wachiman": { "type": "local", "command": ["wachiman", "mcp"] } } } }
```

**Windsurf** `mcp_config.json` (check which of the two paths the installed version reads):

```json
{ "mcpServers": { "wachiman": { "command": "wachiman", "args": ["mcp"] } } }
```

**Zed** settings file:

```json
{ "context_servers": { "wachiman": { "command": "wachiman", "args": ["mcp"], "env": {} } } }
```

**Capy:** paste the Claude Code `mcpServers` JSON above into Settings, MCP and plugins, which the Capy
page says imports that format. Whether the agent runs where the clone and the `claude` sign-in are is
unknown.

**Orchestrators** (T3 Code, Zeron, Paseo, MonoCode, super.engineering, Conductor, bb, Synara, Diri,
Paradev, Emdash, Orca): install into Claude Code or Codex as above, then run the smoke test inside the
orchestrator. **Traycer:** not supported (remote servers only).

### README badges

The README gets two links under "Use it from your agent": the Cursor deeplink and the VS Code redirect
above, each with the bare command `wachiman`, and a line saying `npm install -g wachiman` comes first
(the badge cannot know an absolute path). Two risks: a custom-scheme link does not render as a clickable
link everywhere on GitHub (GitHub's own MCP server README uses an `https://` redirect for VS Code, and its
page has no Cursor badge), and the Cursor badge image URL is not on Cursor's official install-links page
(a search snippet cited `cursor.com/deeplink/mcp-install-dark.svg`, which I did not verify). Phase 3
verifies both in a browser before they are committed.

### What comparable products do

| Product | How it ships to agents | Source |
| --- | --- | --- |
| GitHub MCP server | a hosted remote server (`https://api.githubcopilot.com/mcp/`), or a local Docker image or binary over stdio; VS Code install badges through an `https://insiders.vscode.dev/redirect/mcp/install` link; `--read-only` and `--toolsets` flags limit what tools exist | [repository](https://github.com/github/github-mcp-server) |
| Sentry | a hosted remote server with OAuth (`claude mcp add --transport http sentry https://mcp.sentry.dev/mcp/...`), a Cursor install button, and a local `sentry mcp` stdio server that reuses the CLI login | [Sentry MCP](https://mcp.sentry.dev/) |
| Linear | a hosted Streamable HTTP server (`https://mcp.linear.app/mcp`) with OAuth, a read-only URL, a one-click Cursor link, and `npx -y mcp-remote` for stdio-only hosts | [Linear MCP](https://linear.app/docs/mcp) |
| Greptile | a hosted HTTP server (`claude mcp add --transport http greptile https://api.greptile.com/mcp`) plus a Claude Code plugin that bundles it; the tools read and manage review comments, patterns and the knowledge base; the page does not say it starts a review | [overview](https://www.greptile.com/docs/mcp/overview.md), [Claude Code](https://www.greptile.com/docs/integrations/claude-code) |
| CodeRabbit | a Claude Code plugin around the CodeRabbit CLI, which has `coderabbit --agent` (newline-delimited JSON for agents); the page mentions no MCP server | [Claude Code integration](https://docs.coderabbit.ai/cli/claude-code-integration) |

The pattern: SaaS products ship a hosted remote server because they already are a service. A local-only
tool has no service to point at, so the closest comparison is Sentry's `sentry mcp` (a stdio server
inside the CLI) and CodeRabbit's choice of a CLI with an agent mode plus a plugin. The GitHub server's
`--read-only` flag is the model for the read-only tools here.

## 9. Testing

1. **Contract test (`bun test`, no model call).** A test client written in the test file spawns
   `wachiman mcp` against a temporary git repository with the repository's existing fake `claude`
   binary (`WACHIMAN_CLAUDE_BIN`, the mechanism the local fake-provider tests use). It checks, for each
   era: the handshake or `server/discover`; `tools/list` (names, `inputSchema`, `outputSchema`,
   annotations, deterministic order); `tools/call` for each tool; that stdout holds only valid
   JSON-RPC lines; that the child's environment has no `ANTHROPIC_API_KEY`; that the full `result`
   validates against `docs/formats/review-result.v2.schema.json`; the progress line shapes; and that
   stdin closing ends the server and its child.
2. **Spend tests.** The call cap, the dollar cap with a reserve, the daily cap, `busy` across two
   servers, dedupe with a `partial` result excluded, cancellation (SIGINT then escalation), the soft
   deadline returning `running`, and `review_job` wait and cancel.
3. **Official SDK client, test-only.** The v2 SDK's client connects to the server and lists and calls
   the tools. This is the check that the hand-written layer is interoperable, and it needs a dev
   dependency (open question 1).
4. **Inspector.** `npx @modelcontextprotocol/inspector` against `bun src/cli.ts mcp`, run by hand before
   each release, with the transcript saved.
5. **Smoke test in real hosts.** Claude Code, Codex and Cursor first; VS Code and one orchestrator
   (T3 Code, since the owner uses it) second. Each run: install, `doctor`, a `review` of a small
   branch (about 34 seconds), a review long enough to pass the soft deadline, a cancel, and a refusal at
   the cap. The record per host: which protocol era it spoke, whether progress showed, whether
   annotations changed the confirmation prompt, and the working directory the server received. These
   answer the unknowns in section 2.

## 10. Phased plan

Sizes are rough days of one developer, including tests and docs.

| Phase | Content | Size | Gate |
| --- | --- | --- | --- |
| 0 (optional) | CLI: a stable progress form (for example `--progress json` on stderr) and `local --estimate` printing the pre-call estimate with no model call | S, 1 to 2 days | none |
| 1 | `wachiman mcp` skeleton: protocol layer for both eras, `doctor`, `status`, `history`; contract test; docs for the hand-written snippets; smoke test of read-only tools in Claude Code and Codex | M, 3 to 4 days | the era question (open question 2) is answered |
| 2 | `review`, `review_job`, `ask`; the spend controls; cancellation; progress; the full contract and spend tests; smoke test in Claude Code, Codex and Cursor | L, 5 to 7 days | the owner confirms the default caps (open question 3) |
| 3 | `wachiman mcp install` for Claude Code, Codex, Cursor and VS Code; README links; the skill edit; then Gemini CLI, opencode, Windsurf, Zed as small additions | M, 3 to 4 days, then S each | **measure first**: only build it if phase 2 is used by a host other than Claude Code or Codex, or the owner wants the one-command install anyway |
| 4 | `loop` and `history_verdict`, MCP prompts from the skill text, Tasks or elicitation if two hosts support them | M to L | the reopen conditions in section 7 |

## 11. The strongest argument against

Skills plus the CLI already work in any host that has a shell, which includes Claude Code, Codex, Gemini
CLI, opencode and the orchestrators built on them. The owner's tier list is mostly orchestrators that
run Claude Code or Codex, and those already read skills. CodeRabbit made the same choice: a CLI with an
agent output mode and a plugin, not an MCP server. Against that, MCP adds a long-running process, a
protocol that changed incompatibly within eight months, host timeouts that fight a minutes-long call,
and a way for a model to spend the subscription from one tool call. The real gain is narrow: hosts with
no shell or no skills (an editor's agent panel, for instance), structured results with finding ids that
need no parsing, a one-click install, and server-side caps that a skill cannot enforce.

If the owner mostly uses Claude Code and Codex, the cheaper path is to improve the skills and add a
Claude Code plugin; phase 3 is then not worth it. That is why the plan has a measurement gate before it.

## 12. What I could not verify

- Which protocol era each host speaks, and whether Cursor, VS Code, Windsurf, Zed and Codex send a
  `progressToken`, honour annotations or reset a timeout on progress. Only Claude Code's documentation
  addresses progress.
- Codex's, Cursor's, Gemini CLI's and Zed's working directory for a stdio server.
- Tool timeouts for Cursor, VS Code, Windsurf and Zed.
- Whether any orchestrator passes the underlying agent's MCP configuration through, and Capy's
  execution location. Conductor's documentation was read only in part.
- The Cursor badge image URL, and that the VS Code redirect form works for a custom server. Both are
  documented formats applied to our config.
- The MCP extension matrix (it rendered without cell contents), so Tasks support per host is unknown.
- Whether the SDK's `-32601` on `server/discover` is a bug or a stdio limitation; the probe was one
  request and I did not read the SDK source.
- The size of a review result in tokens. The 25,000-token Claude Code cap is documented; how close a real
  result gets was not measured.
- Nothing here was run against a real host. The only code run was the scratch SDK probe described in
  section 4, in a directory outside the repository.

## Sources

- MCP specification 2026-07-28: [overview](https://modelcontextprotocol.io/specification/latest),
  [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
  [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
  [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio),
  [cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation),
  [schema](https://modelcontextprotocol.io/specification/2026-07-28/schema),
  [Tasks](https://modelcontextprotocol.io/extensions/tasks/overview),
  [extension matrix](https://modelcontextprotocol.io/extensions/client-matrix).
- SDK: [repository](https://github.com/modelcontextprotocol/typescript-sdk),
  [`@modelcontextprotocol/server`](https://registry.npmjs.org/@modelcontextprotocol/server),
  [`@modelcontextprotocol/sdk`](https://registry.npmjs.org/@modelcontextprotocol/sdk).
- Hosts: [Claude Code MCP](https://code.claude.com/docs/en/mcp),
  [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference),
  [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
  [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference),
  [Cursor MCP](https://cursor.com/docs/context/mcp),
  [Cursor install links](https://cursor.com/docs/plugins/mcp/install-links),
  [VS Code MCP configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration),
  [Windsurf](https://docs.devin.ai/windsurf/plugins/cascade/mcp), [Zed](https://zed.dev/docs/ai/mcp),
  [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md),
  [opencode](https://opencode.ai/docs/mcp-servers).
- Tier-list ADEs: the links in the table in section 2.
- Comparable products: the links in the table in section 8.
