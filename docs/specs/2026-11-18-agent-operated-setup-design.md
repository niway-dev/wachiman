# Design: let a coding agent install and maintain Wachiman through the CLI

- **Status:** in progress (2026-11-18). Tracker: [NIW2-868](https://linear.app/niway/issue/NIW2-868).
- **Kind:** feature. Written without a design conversation (GSD); every `Yes, your call` row below is an assumption the owner can reverse on the PR.

## Summary (one minute)

A person asks their coding agent to set up Wachiman. The agent reads one public guide, asks the person the open choices in chat, and runs `wachiman` commands with explicit flags, never a terminal prompt nobody can see. This PR adds that guide (`docs/agents.md`), a machine-readable result for `init` (`--json`, schema `wachiman.init/1`), and a dry run for local mode, so the agent can show the whole plan before anything is written and report local and GitHub readiness separately. The guide also covers configuring, diagnosing, upgrading and uninstalling, and it says the agent must ask before every commit, push or pull request. Running `init` without `--json` behaves exactly as before.

## Decisions

| # | Decision | Options considered | Chosen, and why | Assumed? | ADR |
| --- | --- | --- | --- | --- | --- |
| 1 | What this PR covers | All four layers of the plan in one PR; the CLI guide and CLI changes here, the website in its own PR | CLI guide and CLI changes here. The website can only point at a guide that exists in a release, and its prompt and `llms.txt` are already being rewritten by an open website change | Yes, your call | none |
| 2 | How an agent gets a structured `init` result | A new `plan`/`apply` command; `init --json` | `init --json`, matching `setup --json` (prints `wachiman.project/1`), `doctor`, `project show` and `profile list`, which already print versioned `wachiman.<name>/1` documents | Yes, your call | none |
| 3 | Does `--json` ask questions | Prompt on a terminal anyway; never prompt | Never prompt. A JSON caller is a program; a missing answer is a usage error printed as JSON with exit 2 | Yes, your call | none |
| 4 | `--dry-run` with `--mode local` | Keep exit 2 (shipped docs); allow it (the earlier command contract said dry run exits 0) | Allow it: it previews `.wachiman.yml` and the PR template and writes nothing. Without it an agent cannot preview a local install | Yes, your call | none |
| 5 | `--mode both` without a terminal | Run `setup` too; keep the hand-off | Keep the hand-off: binding needs an explicit `--profile`, which `init` does not take. The JSON names the exact `setup` command as a pending action | No, `docs/cli.md` and the command contract | none |
| 6 | Where the agent instructions live | Website only; `docs/cli.md`; a new `docs/agents.md` | `docs/agents.md`: one task-oriented page an agent reads first, linking to `docs/cli.md` for every flag instead of copying it | Yes, your call | none |
| 7 | Asking before Git publication | Allowed after "install it"; always ask | Always ask before commit, push or pull request; `--yes` answers Wachiman's prompts, not this | No, owner request | none |
| 8 | Release strategy for this PR | `safe`, `flag` | `safe`: a new flag and a newly accepted combination; every existing invocation keeps its output and exit code | No, additive change | none |

## Acceptance criteria

- [ ] **AC1** `docs/agents.md` exists and covers discovery, install, configure, diagnose, upgrade and uninstall, each with the exact commands for this release.
- [ ] **AC2** `docs/agents.md` maps every `init` and `setup` question to its flag or command, default, and effect, and names the choices with no flag.
- [ ] **AC3** `docs/agents.md` tells the agent to ask in chat, never to use credentials in chat, and to ask before every commit, push or pull request.
- [ ] **AC4** `wachiman init --json` prints exactly one parseable `wachiman.init/1` document on stdout, for success and for usage errors.
- [ ] **AC5** The JSON lists each file with its action (`created`, `replaced`, `unchanged`, `would-create`, `would-replace`, `refused`) and any backup path.
- [ ] **AC6** The JSON reports local and GitHub readiness separately, with pending actions such as the exact `setup` command and adding `ANTHROPIC_API_KEY`.
- [ ] **AC7** `init --json` never prompts: with stdin closed and `--mode` missing it exits 2 with a JSON error naming the missing flag.
- [ ] **AC8** `init --mode local --dry-run` exits 0, reports what it would write, and writes no file in the repository or the Wachiman home.
- [ ] **AC9** Running the same `init --json` twice leaves the repository unchanged and reports every file `unchanged` the second time.
- [ ] **AC10** `init --help` and `docs/cli.md` document `--json` and local `--dry-run`; an unknown flag stays a usage error.

## Out of scope

- The website's `/llms.txt`, a `/cli.txt` route and the copy prompt: separate change, after a release carries this guide.
- An end-to-end fixture that drives a whole agent conversation.
- A general `wachiman uninstall` command; the guide documents the existing manual steps.
- Logging in, creating secrets, committing, pushing or opening pull requests from `init`.

---

## Failures this must protect against

- A missing answer opens a prompt the chat user cannot see, and the agent hangs.
- `both` writes the workflow, leaves the binding unset, and the agent reports "all set".
- A dry run writes `.wachiman.yml`, the PR template or anything in the Wachiman home.
- JSON mode mixes status lines or the rendered workflow into stdout, so the document does not parse.
- A repeat run creates a second workflow or replaces a custom one without saying so.
- An agent treats `--yes` as permission to commit or publish.
- The guide advertises a flag that this release does not have.

## The `wachiman.init/1` document

```json
{
  "format": "wachiman.init/1",
  "ok": true,
  "mode": "both",
  "dryRun": false,
  "repoDir": "/path/to/repo",
  "files": [
    { "path": ".github/workflows/wachiman-review.yml", "action": "created" },
    { "path": ".wachiman.yml", "action": "unchanged" },
    { "path": ".github/pull_request_template.md", "action": "created" }
  ],
  "local": { "status": "pending", "pending": ["wachiman setup --profile <name> --yes --repo-dir /path/to/repo"] },
  "github": { "status": "pending", "pending": ["Add the repository secret ANTHROPIC_API_KEY", "Commit and open a pull request with the files above"] },
  "error": null
}
```

Illustrative, not observed output. `local.status` and `github.status` are `not-used` for a mode that does not include them. On a usage error, `ok` is `false`, `error` holds `{ "code": "usage", "message": "..." }`, `files` lists what was already written (empty when nothing was), and the exit code is 2. A rendered workflow in a dry run is in the file entry's `content` field, so stdout stays one document.

## Sources

- `docs/cli.md` (the `init` section) and `docs/specs/2026-11-09-cli-command-contract.md` section 5.5, which disagree on local `--dry-run`; decision 4 settles it.
- `src/init/args.ts`, `src/init/options.ts`, `src/init/run.ts` at `ef3e0f8`.
- Existing JSON schemas: `wachiman.doctor/1`, `wachiman.project/1` (also printed by `setup --json`), `wachiman.profiles/1`.
