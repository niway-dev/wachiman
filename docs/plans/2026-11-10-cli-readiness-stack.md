# Draft: CLI readiness and project onboarding stack

Status: draft for implementation, 2026-11-10. No implementation PRs have been opened
by this plan. Baseline inspected: `1a820af`.

## Outcome

A person installs Wachiman, runs `wachiman init` inside an existing Git repository,
chooses local reviews, GitHub reviews or both, and leaves knowing what is ready,
what still needs action and the exact next command. Existing scripts keep using the
same flags, JSON formats and exit codes.

This draft covers six implementation PRs, one for each readiness gap found in the
CLI review. It does not reopen review-engine, verifier, pricing or account-precedence
decisions. “Any project” means an existing supported Git worktree, including a
subdirectory, linked worktree, repository without an origin and a path with spaces;
it does not promise support for non-Git directories or every operating system.

## Ground truth and verification limits

- `src/init/` and `src/setup/` already implement interactive and flag-driven flows.
  Both use `src/wizard/prompt.ts`, a numbered readline interface.
- `src/setup/prompt.ts` builds its selector from registered and discovered managed
  profiles. It offers registration and creation, but no built-in `default` row.
  Explicit `setup --profile default` is a separate, existing path.
- `src/init/run.ts` hands local setup to `setup`, including another setup invitation;
  `src/setup/prompt.ts` then asks whether to set up the repository again.
- `src/init/run.ts:setupLine` and `src/accounts/commands.ts:closeSetup` interpolate
  repository paths into suggested commands without shell quoting.
- The previous review ran
  `bun test src/wizard src/init src/setup src/cli-wizards.test.ts src/cli-accounts.test.ts src/cli-skills.test.ts`
  on Bun 1.4.2: exit 1, **195 passed, 1 failed**. The failed test was
  `a terminal > Backspace redraws the line with the question still in front of it`.
  It uses synthetic streams; this is evidence of a failing test, not yet proof of
  the same defect in a real terminal. CI pins Bun 1.3.4.
- npm packaging and release verification already exist. The README describes the
  published package. Registry state was not independently checked in this review.
- ADR 0028 explicitly records the abandoned Windows executable and missing Windows
  CI coverage. A standalone executable is not a pending deliverable of this stack.
- `docs/cli.md` still describes `src/cli.ts` as the npm bin, although `package.json`
  points at `bin/wachiman.js`. The older CLI implementation plan is historical and
  contains an obsolete “nothing built” statement.

No live login, paid model call, real-terminal walkthrough or native Windows run has
been performed for this draft. Acceptance criteria below remain unchecked.

## Stack and delivery rules

Open the layers in this order. Each branch starts from the preceding layer and each
PR targets that layer until it merges; retarget and update the remaining layers
after each merge. The branch names and titles below are proposed, not created.

| Layer | Proposed branch | Proposed PR title | Purpose |
| --- | --- | --- | --- |
| 1 | `fix/cli-prompt-editing` | `fix: make wizard answer editing reliable` | Establish reliable terminal input |
| 2 | `feat/cli-current-account` | `feat: offer the current Claude session during setup` | Make first-time local setup accessible |
| 3 | `feat/cli-onboarding-flow` | `feat: guide project onboarding through one continuous flow` | Integrate init and setup |
| 4 | `feat/cli-wizard-styles` | `feat: add consistent wizard steps and terminal styles` | Make progress and outcomes readable |
| 5 | `fix/cli-setup-next-actions` | `fix: finish setup with actionable readiness and commands` | Make the handoff accurate and executable |
| 6 | `docs/cli-readiness` | `docs: align CLI installation and onboarding guidance` | Align documentation and final evidence |

Every PR carries a Proof table with its acceptance criteria, actual commands,
exit codes and relevant evidence. Mark unfinished checks as not verified. Keep
runtime changes in their owning layer; update directly affected help and examples
there rather than postponing misleading instructions to layer 6. Do not merge a
layer with unexplained failing checks. Use isolated fixture homes, fake providers
and temporary repositories for automated validation; no test needs a real login,
credential read or paid review.

## PR 1 — reliable prompt editing

Investigate the Backspace failure before choosing a fix. Reproduce on pinned Bun
1.3.4 and local Bun 1.4.2, then compare the synthetic-stream test with a real PTY.
Correct the implementation if editing is broken; correct the test if it assumes
a runtime-specific ANSI redraw sequence. Preserve a meaningful check that both
the displayed question and resulting answer are correct.

Likely surface: `src/wizard/prompt.ts`, `src/wizard/prompt.test.ts`.

- [ ] Typing `abc`, Backspace, Enter returns `ab` and leaves a readable question.
- [ ] Editing works on the pinned runtime; the local runtime result is recorded.
- [ ] Enter defaults, invalid-answer retries, Escape, Ctrl-C and EOF still behave
  correctly, including cancellation exit 130 through the command.
- [ ] Suspending for a child process and resuming restores terminal ownership.
- [ ] The targeted suite passes; a PTY walkthrough records the visible result.

Avoid a broad terminal rewrite or a new prompt dependency in this fix.

## PR 2 — use the current Claude session

Add a built-in choice, “Use my current Claude session”, mapped to `default`.
Do not require users to know their Claude configuration directory to choose it.
Keep existing profiles, external registration and managed creation available.

Proposed selector order: current session, existing profiles, create an isolated
profile, register an existing directory. Default selection uses the current
project binding first, then the configured global default, then the built-in
current session. Include built-in `default` when resolving those selections.
Explain that current-session settings are shared with the person's normal Claude.

Likely surface: `src/setup/prompt.ts`, setup tests and help. Do not change the
public `profile list` JSON contract just to populate a wizard row.

- [ ] A fresh fixture home can select `default` without registering a profile.
- [ ] Enter selects the printed default for a fresh home, existing binding and
  configured default, including a binding to `default`.
- [ ] Selection does not change account precedence or silently substitute another
  account when confirmation fails.
- [ ] Existing managed/external profile flows and atomic save still work.
- [ ] Signed-out or missing Claude produces an accurate recovery instruction.

## PR 3 — continuous onboarding

Make `init` the guided entry point while retaining standalone `setup`. Reuse its
resolvers and execution functions rather than creating a second configuration
implementation. Validate the Git worktree before collecting answers.

The conceptual stages are project, review mode, configuration, confirmation and
checks/next actions. The configuration stage has only the questions required for
the selected mode. Local mode selects an account; GitHub mode collects operator
and workflow settings; both includes both sets. Do not ask for a second general
setup invitation after local setup has already been selected.

Keep workflow writing and account binding as separate transactions. Preview each
write before its own confirmation; accurately report completed effects if a later
stage is cancelled. Never describe the entire wizard as atomic. A GitHub API-key
secret remains a manual GitHub action; local reviews use the signed-in account.

Likely surface: `src/init/{prompt,run}.ts`, `src/setup/{prompt,run}.ts`, CLI wiring.

- [ ] Local, GitHub and both modes ask only relevant questions, with no duplicate
  invitation to configure local reviews.
- [ ] Starting from a subdirectory writes a workflow at the worktree root.
- [ ] Linked worktrees and repositories without an origin retain existing binding
  identity semantics; no binding is inferred from a project config file.
- [ ] Re-running preserves the current binding as the proposed selection and
  never overwrites a workflow without the existing explicit force behavior.
- [ ] Cancelling before writes changes nothing; cancellation after a workflow,
  directory creation, login or binding reports exactly what remains.
- [ ] Flag-driven/non-TTY runs, `--yes`, missing-value errors, JSON output and
  dry-run retain their documented semantics. Dry-run never starts login or setup.
- [ ] Invalid/non-Git targets fail before configuration questions or side effects.

## PR 4 — steps and terminal styles

Add a small shared presentation layer over the existing readline prompter:
opening context, stage labels, selected/default choices, muted supporting text,
success, warning, error and cancellation. Show the current stage and total for
the chosen route; supplied flags must not produce misleading progress counts.
Retain numbered selection and line-based input for this stack.

Keep prompts on stderr and machine results on stdout. Use restrained ANSI styling
only on a suitable output terminal; honor `NO_COLOR` and use plain output for
pipes and dumb terminals. Meaning must remain clear without color or Unicode.
Do not introduce cursor-driven menus, a new runtime dependency or an ASCII logo.
The existing design explicitly chooses readline and no full-screen repaint.

Likely surface: `src/wizard/`, init/setup presentation and relevant help.

- [ ] Every route shows consistent stage names and an accurate end state.
- [ ] Default choices, descriptions and errors remain legible in a narrow terminal.
- [ ] `NO_COLOR`, redirected output and `TERM=dumb` produce readable plain text.
- [ ] JSON and dry-run workflow output contain no decoration or prompts.
- [ ] Cancellation, suspend/resume and the editing checks from PR 1 still pass.
- [ ] Before/after terminal evidence shows fresh local setup, both mode and a
  validation failure. Evidence uses fixture paths and no account secrets.

Apply the owner's taste guidance before implementing this layer. Any change to
the established prompt mechanism or dependency policy needs its own explicit
decision rather than being slipped into styling.

## PR 5 — accurate readiness and next actions

End with a compact result: configuration saved, local readiness, workflow state,
manual GitHub actions and the exact next command. Derive readiness from existing
doctor checks, not merely from a successful binding write. A saved binding and a
failed required check must be shown as distinct facts.

Render copyable commands safely for paths with spaces and shell metacharacters.
Prefer a command that needs no path when already inside the target worktree;
otherwise quote for the supported shell, with explicit shell-specific alternatives
when necessary. Apply the same policy to `setupLine`, `closeSetup` and recovery
instructions touched by these flows. Never execute a generated suggestion.

- [ ] Failed required doctor checks do not produce a ready/success claim, and the
  existing documented exit status is preserved.
- [ ] Local setup ends with an executable review command; paths with spaces,
  quotes and shell metacharacters cannot change its argument boundaries.
- [ ] Account failures name the appropriate repair command for the selected account.
- [ ] GitHub mode clearly lists secret creation and workflow submission as pending,
  without claiming the remote configuration has been verified.
- [ ] Both mode reports local and GitHub readiness independently.
- [ ] The final summary agrees with persisted state after decline or cancellation.

## PR 6 — documentation and release evidence

Align `docs/cli.md`, `docs/install.md`, `docs/local-review.md` and relevant README
examples with the shipped launcher and final onboarding. Mark the old implementation
plan as historical or retire it once its remaining contents have been reconciled;
do not erase outstanding items simply because this stack is complete. Link the
final Proof evidence from this draft and mark each layer's actual PR/state.

- [ ] Installation docs describe the Node launcher and bundled Bun accurately.
- [ ] A person following the local guide reaches the first review command without
  needing to infer a profile directory or an undocumented setup step.
- [ ] GitHub and both-mode guides describe the manual secret/PR actions accurately.
- [ ] Docs, help and examples agree on flags, defaults, cancellation and exit codes.
- [ ] The full suite and exact-package verification run on the final stack head;
  results include versions, exit codes and counts, with no publishing step.
- [ ] A final walkthrough covers fresh and existing projects, subdirectories,
  worktrees, no origin, spaces in paths, cancellation and non-TTY use.
- [ ] Platform claims cite available evidence. Native Windows remains explicitly
  unverified unless a native run supplies evidence; no executable is promised.

## Decisions and boundaries to review

1. Keep one PR per readiness point, ordered so styling builds on a stable flow.
2. Keep readline, numbered input and the existing dependency policy. Rich menus
   are a separate decision if the simpler presentation proves insufficient.
3. Offer the current session as the fresh-home default, while preserving binding
   and global-default preference for existing users.
4. Keep write confirmations and cancellation reporting truthful across separate
   side effects; a continuous experience does not imply one transaction.
5. Keep native Windows validation separate from the abandoned executable. If
   native Windows support becomes a release gate, capture that as a scoped follow-up
   with its own runtime evidence rather than silently expanding this stack.

## Draft proof

| Criterion | Evidence | State |
| --- | --- | --- |
| All six readiness points have an owning PR | Six layer sections above | Drafted |
| Each layer has acceptance criteria and boundaries | Checklists and scope above | Drafted |
| Existing failure is distinguished from a confirmed terminal defect | Ground truth and PR 1 investigation | Recorded; root cause unverified |
| Runtime implementation and release readiness | Per-layer checks above | Not implemented or verified by this draft |

Review the current-session default and transaction boundaries first. The branch
names and PR titles are safe to adjust when opening the actual stack. This draft
does not need a runtime test run: it changes documentation only and records the
previous test result without claiming a new passing run.
