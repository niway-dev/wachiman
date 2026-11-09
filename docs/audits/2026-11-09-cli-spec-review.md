# CLI and verified-review specification review — 2026-11-09

## Intent and scope

The owner asked Fable and the parent to write all commands/types/specifications needed to
implement npm+Bun installation, a Windows executable, interactive project init/YAML, account
setup/doctor and a shared review motor with hypothesis falsification. This task delivers
specification documents only. It does not implement, publish, create a PR or change credentials.

## Ground truth

Base: b3f60be. New documents are local and uncommitted in the prepared worktree. The parent read
src/formats.ts, src/engine.ts, src/profiles.ts, src/providers/claude-code.ts,
src/history/store.ts, src/history/command.ts, the /1 schemas and format contract, and
feat/findings-verifier:src/verify.ts, engine.ts and config.ts via git show. The verifier branch
is existing work, not a verifier implemented or tested in this documentation task.

## Consequential corrections to the first draft

- Kept committed JSON output /1 by default; new semantics use /2 explicitly. No tree-id-to-commit
  disguise on downgrade. Existing consumers need no surprise default switch.
- Aligned ADR 0030 and types on exact severity/verdict/status vocabularies; origin unknown is
  explicit. Base/head evidence is available; an unchanged line alone is not pre-existing proof.
- Preserved usable verdicts on partial stops; reference existence does not prove semantic truth.
- Made registration+binding a single final config transaction; cancellation reports completed
  workflow/directory/login effects rather than promising they never happened.
- Removed source-wrapper API-key stripping as well as env-to-flag translation in the plan, so
  auth/account policy agrees across entry points; the compatibility change is explicit.
- Made unknown account directory and populated managed profile fail doctor like they fail local;
  auth checking remains bounded, hardened and honest about subprocess network uncertainty.
- Added missing command argument unions and full history grammar; recovery commands can repair
  dangling references without enabling a provider fallback. Profile removal also clears defaults.
- Required safe workflow target containment and a bundled published workflow ref independent of
  the CLI release number. Dry-run cannot continue into setup/login.
- Replaced stale-lock stealing with explicit recovery; protected concurrent writes and temporary
  paths. Working-tree capture uses temporary index/objects, no configured filters, explicit
  staged/all semantics and no ancestry operations on tree objects.
- Avoided hand-duplicating launcher code; package tests install the exact tarball and include its
  helper. Windows source-runtime checks precede npm support claims, not just the exe slice.
- Retained source tooling, kept native Windows in scope, and preserved user skill edits.

## Validation and limits

Document checks validate local Markdown links outside code spans/fences, literal JSON examples,
fence balance and critical cross-document vocabulary/default invariants. Runtime acceptance
criteria are not checked off. A full source test suite would exercise none of these proposed
features and was not run. No build, package install, auth command, Windows run, publishing or
model call occurred. Unverified platform/compiler/publisher prerequisites remain explicit probes.

## What to review first

1. The command contract: account precedence, setup save boundary, init path/write behaviour.
2. The types: verifier evidence/origin and version migration, config locking/recovery.
3. The plan: existing verifier integration, exact artifact release tests and native Windows gates.

No commit or remote side effect is part of this handoff. The three new ADRs remain proposed
implementation mechanisms; they record the owner's accepted product direction and the concrete
engineering defaults chosen to implement it.
