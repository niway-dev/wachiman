# ADR 0029: Named account profiles, external configuration directories, and project bindings kept in the home directory

- **Status:** proposed 2026-11-09. Not implemented. **Amends**
  [ADR 0019](0019-a-review-core-behind-source-and-sink-ports-and-a-local-subscription-mode.md)
  open question 4's mechanism (the `default | isolated[:name]` flag grows into named profiles;
  decisions 4 and 5 of 0019 are unchanged). **Reuses** [ADR 0020](0020-an-opt-in-on-laptop-review-history-with-deterministic-finding-tracking.md)'s
  repository identity for the bindings.
- **Date:** 2026-11-09
- **Spec:** [The Wachiman CLI and verified reviews](../specs/2026-11-09-cli-and-verified-reviews-design.md),
  decisions 5–12 and section 4; [types §1](../specs/2026-11-09-review-and-config-types.md);
  [command contract §4, §5.4, §5.7](../specs/2026-11-09-cli-command-contract.md).
- **Numbering:** 0029 because 0028 is this design's packaging record and lower numbers are held
  by open branches.

## Context

`src/profiles.ts` knows two profiles: `default` (the shell's `claude`, with whatever
`CLAUDE_CONFIG_DIR` the environment has) and `isolated[:<name>]` (a bare sign-in under
`~/.wachiman/claude-<name>`, created by `--setup-profile`). The owner works with several Claude
accounts on one machine, two of them in custom configuration directories that are populated
(skills, settings) and must be used in place, and one of them possibly through an explicit
binary path. Which account a repository uses must be decided once per project and never
guessed. Today the bash wrapper turns `WACHIMAN_PROFILE` into a `--profile` flag, so an
exported variable would beat any per-project choice.

Anthropic's [official policy](https://code.claude.com/docs/en/legal-and-compliance), read
2026-11-09, distinguishes end-user sign-in through its official unmodified CLI from third-party
credential collection/intermediation. The design follows that boundary; it does not claim
blanket approval for this product or arbitrary volume. CLAUDE_CONFIG_DIR keeps accounts in
separate directories; do not move existing directories because sign-in storage may depend on
that path. Wachiman stores references, never credentials.

## Decision

1. **Profiles are named and global**, in `~/.wachiman/config.json` (`version: 1`), of two kinds:
   `managed` (Wachiman-created bare sign-in, today's isolated profile; the populated check stays)
   and `external` (a developer-owned `CLAUDE_CONFIG_DIR`, optionally with an absolute `binary`
   path). `default` stays a built-in, not a record. Existing `~/.wachiman/claude-<name>`
   directories are recognised as managed profiles without being moved or rewritten.
2. **A project binding lives in the home directory**, keyed by `repositoryKey` (the normalised
   `origin` URL hashed, else the git common directory), so every clone and worktree of one
   repository shares it. **Nothing in the reviewed repository is read for account or binary
   selection.**
3. **Precedence:** `--profile` > binding > `WACHIMAN_PROFILE` > `defaultProfile` > built-in
   `default`. The chosen profile, its kind, directory, binary and rung, and any lower rung it
   overrode, are printed on stderr before any call. **The bash wrapper stops translating
   `WACHIMAN_PROFILE` into a flag and stops stripping ANTHROPIC_API_KEY** so every entry point runs the same resolver.
4. **Strict failure, no fallback.** A rung whose value does not resolve fails there; a corrupt
   config, a dangling binding, a missing directory, a binary that does not answer `--version`,
   or an `auth status` that is not a confirmed `claude.ai` sign-in in the profile's directory is
   exit 2 for local before any model call, with the fix named. Setup may deliberately persist
   a signed-out binding and finish with exit 1 plus a repair command; explicit profile login
   must remain usable to repair a signed-out account. An external or managed profile whose binary
   cannot report its configuration directory is `unverified`, which is a failure for a review and
   a failed required auth check for `doctor`.
5. **Credentials are never read, copied or moved.** `profile login` starts the official,
   unmodified `claude` (by path, no shell, from an empty temp directory, with
   `CLAUDE_CONFIG_DIR` set) and never reads the outcome; the only check is `claude auth status`
   with a bounded timeout and output cap; no file inside an external directory is ever opened;
   inside a managed one only `settings.json` (today's inspection). The official Claude process
   necessarily reads/writes its own sign-in state; these invariants apply to Wachiman code.
6. **The only stored executable path is a profile's `binary`,** accepted only from `profile add`
   or `setup`, only as an absolute existing executable (`.exe` on Windows), never a
   `.cmd`/`.bat`/`.ps1` shim; there is no environment variable that names a binary.
7. **Writes are locked and atomic (no automatic stale-lock stealing):** read-modify-write under `config.json.lock`, temp file and
   rename, mode `0600` where enforced; two concurrent `setup` runs keep both entries.
8. **`wachiman setup` is the guided binding command; `profile` manages profiles; `project show`
   and `project unbind` inspect and remove; `profile remove` never deletes a directory by default
   and never an external one.**

## Alternatives rejected

- **Per-path bindings** (keyed by the checkout directory). Each worktree would need one and a
  moved checkout would lose it; the repository identity ADR 0020 already computes is what
  people mean by "this project".
- **A binding file in the repository** (`.wachiman.json`). Shares a choice that is personal and
  machine-specific, leaks workstation paths, and would let an untrusted branch choose what
  executes.
- **`WACHIMAN_PROFILE` above the binding** (today's effective order through the wrapper). An
  exported variable is forgotten; a binding is a deliberate act in the repository the person is
  looking at. The ambient value losing to the deliberate one is the safe direction.
- **Fallback to `default` when a profile fails.** The one outcome this design must prevent is
  code reaching the wrong account; a fallback is exactly that.
- **Copying or moving an existing directory into `~/.wachiman`.** Signs the account out on macOS
  and touches credentials, which the terms forbid.
- **Reading `~/.claude.json` or `.credentials.json` to confirm the account.** Forbidden by the
  same terms; `claude auth status` exists for this.
- **Inspecting external directories for customisations and refusing populated ones.** Every real
  work directory is populated; the hardening flags already apply; the report simply does not call
  an external profile isolated.
- **A `WACHIMAN_CLAUDE_BIN` variable.** An environment variable that names an executable is a
  path injection surface with no owner.

## Consequences

- One new file in the home directory, one lock, and five new commands; the skill text changes to
  read `profile list --json` and `project show --json`.
- `WACHIMAN_PROFILE` keeps working but one rung lower than before when a binding exists; the
  changelog announces it.
- `ReviewResult.provider.profile` in `/1` is unchanged (managed → `isolated`, external and
  built-in default → `default`); the named account appears in `/2` and in the preambles
  (ADR 0030).
- A review on an external profile now runs two extra subprocesses (`--version`, `auth status`)
  before the first call; both are bounded.
- Older `claude` binaries that cannot report `configDirectory` make external profiles unusable
  for reviews until upgraded; `doctor` says which version is needed once the probe fixes it.

## Non-goals

- Reading, caching or displaying any account identity beyond what `auth status` prints
  (`authMethod`, `configDirectory`); no e-mail, no raw JSON in any output.
- Supporting a `claude` shell function, alias or wrapper script as the binary.
- Per-repository review settings (focus, severity): that is ADR 0006's territory and stays in the
  repository, read from the base commit.

## Reopen when

- Anthropic's page changes the permitted shape for an end user's subscription sign-in through
  the unmodified binary: the local mode's `subscription` auth is the switch to turn off
  (ADR 0019's reopen condition).
- `claude auth status` stops reporting `configDirectory` or changes its JSON: the confirmation
  contract moves to whatever the binary offers, and strictness is reconsidered rather than
  silently loosened.
- A second person shares one machine's `~/.wachiman`: the home-keyed binding model assumes one
  user per home.
