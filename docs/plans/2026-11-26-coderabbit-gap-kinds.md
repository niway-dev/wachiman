# Plan: close the review gaps CodeRabbit exposed on agent-orchestrator

Status: working plan, nothing implemented. Tracker: [#326](https://github.com/niway-dev/wachiman/issues/326).
Data: [wachiman-benchmarks `agent-orchestrator/`](https://github.com/niway-dev/wachiman-benchmarks/tree/main/agent-orchestrator).
Each point ships as its own pull request that updates this file. The last one deletes it.

## Where we start

On 10 merged pull requests of OrchestratorInc/agent-orchestrator, CodeRabbit raised 34 defects that the
authors fixed later in the same PR. Local Wachiman v1.17.0 (`claude-sonnet-5-5`, product defaults) reviewed
the same base..head and stated 8 of them, partially stated 1, and missed 25. It ran once per PR, for
$5.06 in total (API-price estimate), with 32 findings.

That number is recall against CodeRabbit's accepted findings, and only that. The set is built from what
CodeRabbit found, so CodeRabbit scores 34 of 34 by construction. Point 0 measures the other direction
before any rule is tuned.

## How every point is measured

- **Runner.** `agent-orchestrator/scripts/run-set.sh` in wachiman-benchmarks, with `WACHIMAN_DIR` set to
  the branch under test. Each run writes a new output directory, and `history.md` gets one row.
- **Split.** The tuning PRs are 9086, 8720, 8714, 9055 and 9036; the held-out PRs are 9076, 8832, 9095,
  8764 and 9148. Rules are written by looking at tuning cases only. Held-out cases are reported, and are
  never used to change a rule. Kinds 3, 4 and 5 have no held-out case yet, so point 0 mines a second batch
  before those are tuned.
- **Variance.** Three runs per PR, before and after. A case counts as caught when at least 2 of the
  3 runs state it.
- **Guards.**
  - The 8 cases caught today (ao-8720-C1, ao-8832-C1, ao-9036-C1, ao-9036-C3, ao-9148-C1, ao-9148-C2,
    ao-8764-C4, ao-8764-C5) stay caught.
  - Findings per PR stay within +25% of 3.2, and cost per run within +25% of $0.51.
- **A rule names a kind of check, never agent-orchestrator code.** It enters the rule inventory
  ([#315](https://github.com/niway-dev/wachiman/issues/315)) with the cases that justify it.

## Point 0: the other direction, and a second batch

The work happens in wachiman-benchmarks. Nothing changes in the engine.

1. **Judge Wachiman's 23 unmatched findings** on the 10 PRs: real or not, by reading the code at head,
   and would the owner fix them. Some look real. For example, on
   [#9095](https://github.com/OrchestratorInc/agent-orchestrator/pull/9095), a 404 from an older host
   still sends an `ao.requests.failed` event, which the PR's own comment says should stay quiet.
2. **Judge CodeRabbit's 25 inline comments** on the same PRs that are not in the answer key. They were
   never fixed, or were raised on a later commit.
3. **Mine a second batch.** Include "Outside diff range" comments from review bodies, which the first
   batch skipped; that is the kind of the #9068 gap. Fill the held-out side of kinds 3, 4 and 5.

Output: precision for both tools on the same 10 PRs, and a second answer key.

## Points 1 to 6, with their cases

Severity and difficulty (1 to 5) are our judgement from the verification pass. "Outside the diff" is
what a reviewer had to know or open beyond the changed hunks. Links point at the head that was reviewed.

**Where each point would change the engine.** These are hypotheses to test, not decisions:

- **1.** `src/evidence.ts`. Besides sibling call sites, the evidence would list:
  - the other readers of a type, list or registry the change extends ([#314](https://github.com/niway-dev/wachiman/issues/314));
  - the body of each symbol the added lines call, when that body is outside the diff.

  Four of its six cases need the second half.
- **2 to 6.** The review rules and flow questions in `src/engine.ts`. There is one candidate rule per kind;
  2 and 3 may merge into one rule about what happens between two statements the code treats as one step.
- **4** depends on knowledge the model may lack. Measure whether asking the question is enough before
  writing anything specific.

### 1. A fact outside the changed hunks

| Case | Split | Where, at head | What goes wrong | Sev / diff. | Outside the diff |
| --- | --- | --- | --- | --- | --- |
| [ao-8714-C3](https://github.com/OrchestratorInc/agent-orchestrator/pull/8714#discussion_r4632273208) | tune | [`ArtifactActionsMenu.tsx:253`](https://github.com/OrchestratorInc/agent-orchestrator/blob/19f3070c20cc660b3ca614aee84bab5e9fd33794/frontend/src/renderer/components/ArtifactActionsMenu.tsx#L253) | For a remote session, readIssueContent builds the URL with artifactContentUrl, which rewrites through the local daemon base URL. The content read goes to the wrong host and fails or returns local data. | medium / 4 | artifactContentUrl (lib/artifact-content-url.ts, not in diff) always uses getApiBaseUrl() (local daemon); hostId prop exists in the same component |
| [ao-8764-C3](https://github.com/OrchestratorInc/agent-orchestrator/pull/8764#discussion_r4642390048) | held-out | [`UpdateRouteKeeper.tsx:43`](https://github.com/OrchestratorInc/agent-orchestrator/blob/6faac3c37b020d21738c6af6ae018724866d3a8d/packages/mobile/lib/UpdateRouteKeeper.tsx#L43) | The restore waits on config !== null, but config stays null after load when no machine is paired, in cloud scope or after a rejected endpoint. restored never becomes true and the saved page is never reopened. | medium / 4 | store.tsx (not in diff): config stays null when unpaired, cloud-only or endpoint rejected; configResolved exists |
| [ao-9055-C1](https://github.com/OrchestratorInc/agent-orchestrator/pull/9055#discussion_r4694218206) | tune | [`ChatComposer.tsx:2445`](https://github.com/OrchestratorInc/agent-orchestrator/blob/fb22a438eafe7cc3e1dba99681e052223caacee3/frontend/src/renderer/components/chat/ChatComposer.tsx#L2445) | acceptsFiles lets files for the next message through during a send, but processFiles still counts the submitted files against MAX_ATTACHMENTS, so the new file is rejected with the limit error. | low / 4 | useFileAttachments.processFiles (not in diff) counts attachmentsRef.current including files of the in-flight send |
| [ao-9095-C1](https://github.com/OrchestratorInc/agent-orchestrator/pull/9095#discussion_r4699236454) | held-out | [`skill_scan.go:63`](https://github.com/OrchestratorInc/agent-orchestrator/blob/dbf9107df4b9b7ee26ea0603599273f6383f2a7f/backend/internal/service/chat/skill_scan.go#L63) | withSkillMetadata searches the .agents skill root first and overwrites label and description even when discovery chose the .claude copy of the same skill. The shown metadata then belongs to a different skill than the one that will run. | low / 4 | skill_metadata.go (not in diff): withSkillMetadata/skillRoots search .agents, .claude, .codex in that order, while the new Claude scan only reads .claude |
| [ao-8764-C1](https://github.com/OrchestratorInc/agent-orchestrator/pull/8764#discussion_r4642390022) | held-out | [`updateResume.ts:30`](https://github.com/OrchestratorInc/agent-orchestrator/blob/6faac3c37b020d21738c6af6ae018724866d3a8d/packages/mobile/lib/updateResume.ts#L30) | TRANSIENT does not include /conversation-actions, which the root layout declares as a formSheet. Opening it overwrites the saved page, and an update restart reopens the sheet instead of the session. | low / 4 | packages/mobile/app/_layout.tsx (only 4 lines in diff) declares /conversation-actions as formSheet; a reviewer must list root-level sheets |
| [ao-9076-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/9076#discussion_r4697928357) | held-out | [`provider.go:1103`](https://github.com/OrchestratorInc/agent-orchestrator/blob/9fadf374fc63d8b5808759cdfdb6bd249ed8bc24/backend/internal/adapters/device/local/provider.go#L1103) | NoteBooted overwrites the stored boot ID with any observation, so a delayed look carrying older boot A can replace the newer boot B and trigger a second hub replacement that interrupts all device streams. | low / 4 | LiveLease/listedDevice in devices/service.go (3s cached list, only 5 lines of that file in the diff) feeds NoteBooted outside any lock |

### 2. Interleavings on shared state

| Case | Split | Where, at head | What goes wrong | Sev / diff. | Outside the diff |
| --- | --- | --- | --- | --- | --- |
| [ao-9086-C4](https://github.com/OrchestratorInc/agent-orchestrator/pull/9086#discussion_r4698550196) | tune | [`service.go:676`](https://github.com/OrchestratorInc/agent-orchestrator/blob/a4542d6c630184148510fd43d2a3a83eb7d32b87/backend/internal/devices/service.go#L676) | Open lists devices before taking s.mu, then forgetStoppedLocked clears ownership using that stale listing. A device another session booted and warm-released in between looks stopped, loses owned/parked records, and stays running forever. | low / 4 | Interleaving of Open (list before s.mu), boot and warm release; that parked does not block idleLocked |
| [ao-8720-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/8720#discussion_r4633656704) | tune | [`workspace.go:2057`](https://github.com/OrchestratorInc/agent-orchestrator/blob/06f399b87ed0bd9bfb0d68708c3dc8b882516316/backend/internal/adapters/workspace/gitworktree/workspace.go#L2057) | Two concurrent resolvers can both read current=false before either records an attempt, so both launch a remote HEAD lookup. The freshness check and the attempt reservation are not done atomically under liveDefaultMu. | low / 3 | Nothing; liveDefaultCurrent and recordLiveDefault are in the same file/hunk |
| [ao-9076-C1](https://github.com/OrchestratorInc/agent-orchestrator/pull/9076#discussion_r4697928340) | held-out | [`provider.go:1038`](https://github.com/OrchestratorInc/agent-orchestrator/blob/9fadf374fc63d8b5808759cdfdb6bd249ed8bc24/backend/internal/adapters/device/local/provider.go#L1038) | recordBoots, called after the helper starts, accepts whatever boot the device has at that moment as the helper's boot. An outside reboot in that gap is recorded as the helper's own boot and excused by ownBoots, so touch recovery never triggers. | low / 4 | How ownBoots excuses a boot in NoteBooted and that awaitLiveStream widens the gap between grid/api/start and recordBoots (mostly in the diff) |
| [ao-9076-C3](https://github.com/OrchestratorInc/agent-orchestrator/pull/9076#discussion_r4697928371) | held-out | [`provider.go:1106`](https://github.com/OrchestratorInc/agent-orchestrator/blob/9fadf374fc63d8b5808759cdfdb6bd249ed8bc24/backend/internal/adapters/device/local/provider.go#L1106) | When a boot change arrives while replacingHub is true, the new ID is stored but no replacement is scheduled. A simulator rebooted after the new hub's helpers exist then looks unchanged, and touch stays routed to the helper of the previous boot. | low / 3 | Nothing; replacingHub and restartHub are in the diff |
| [ao-9055-C3](https://github.com/OrchestratorInc/agent-orchestrator/pull/9055#discussion_r4694218240) | tune | [`useConversation.ts:1262`](https://github.com/OrchestratorInc/agent-orchestrator/blob/fb22a438eafe7cc3e1dba99681e052223caacee3/frontend/src/renderer/hooks/useConversation.ts#L1262) | The finally block deletes the restoresInFlight entry by key without checking it owns it. A second restore replaces the first entry, and when the first settles it removes the barrier of the second, so staging proceeds without waiting. | low / 3 | Needs the idea that a second restore for the same key can start while the first is pending |
| [ao-9055-C4](https://github.com/OrchestratorInc/agent-orchestrator/pull/9055#discussion_r4694218269) | tune | [`useConversation.ts:2438`](https://github.com/OrchestratorInc/agent-orchestrator/blob/fb22a438eafe7cc3e1dba99681e052223caacee3/frontend/src/renderer/hooks/useConversation.ts#L2438) | useStageAttachments uploads before reading restoresInFlight, and the entry is deleted when the restore settles. If an upload outlasts a failed restore, the lookup returns undefined and the attachments POST runs for a session whose restore failed, hiding the failure. | low / 3 | Nothing; the two awaits are adjacent |

### 3. Crash and partial-failure windows

| Case | Split | Where, at head | What goes wrong | Sev / diff. | Outside the diff |
| --- | --- | --- | --- | --- | --- |
| [ao-9086-C1](https://github.com/OrchestratorInc/agent-orchestrator/pull/9086#discussion_r4698550148) | tune | [`service.go:251`](https://github.com/OrchestratorInc/agent-orchestrator/blob/a4542d6c630184148510fd43d2a3a83eb7d32b87/backend/internal/devices/service.go#L251) | The lease removal is saved in endLeaseLocked before finishRelease records the parked session, so a daemon stop between the two leaves the device running with its owned record but no parked record. The reaper only retires parked devices, so it leaks a booted simulator. | low / 3 | Nothing beyond the diff: that saveLocked persists owned+parked and that retireParked reads only parked |
| [ao-9086-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/9086#discussion_r4698550172) | tune | [`service.go:354`](https://github.com/OrchestratorInc/agent-orchestrator/blob/a4542d6c630184148510fd43d2a3a83eb7d32b87/backend/internal/devices/service.go#L354) | retireParked deletes the parked and owned records and saves them before calling Provider.Shutdown. A process exit during Shutdown loses all record that AO owns the running device, so no later pass can retire it. | low / 3 | Nothing; the Shutdown call and the restore-on-error branch are in the same function |
| [ao-9086-C3](https://github.com/OrchestratorInc/agent-orchestrator/pull/9086#discussion_r4698550180) | tune | [`service.go:365`](https://github.com/OrchestratorInc/agent-orchestrator/blob/a4542d6c630184148510fd43d2a3a83eb7d32b87/backend/internal/devices/service.go#L365) | Provider.List can succeed while one platform's listing failed, so a running parked device may be absent from the result. retireParked treats absence as stopped, deletes its records and skips Shutdown, leaving the device booted and unrecoverable. | medium / 4 | Provider.List can succeed while one platform failed: local/provider.go listReport/ListPlatform (ListPlatform already in base, not in the diff) and releaseIfGone's use of it |

### 4. Rules of an external API or tool

| Case | Split | Where, at head | What goes wrong | Sev / diff. | Outside the diff |
| --- | --- | --- | --- | --- | --- |
| [ao-8714-C1](https://github.com/OrchestratorInc/agent-orchestrator/pull/8714#discussion_r4632273154) | tune | [`github-issue-artifact.ts:31`](https://github.com/OrchestratorInc/agent-orchestrator/blob/19f3070c20cc660b3ca614aee84bab5e9fd33794/frontend/src/main/github-issue-artifact.ts#L31) | A transferred issue can answer HTTP 301 and the numeric branch returns the destination's number and title without checking repository_url. The dialog pairs it with the selected repo and publishing can post to an unrelated issue or fail. | medium / 4 | GitHub REST returns 301 for a transferred issue and gh api follows it (not verified live); the search branch just below already filters by repository_url |
| [ao-8714-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/8714#discussion_r4632273205) | tune | [`github-issue-artifact.ts:47`](https://github.com/OrchestratorInc/agent-orchestrator/blob/19f3070c20cc660b3ca614aee84bab5e9fd33794/frontend/src/main/github-issue-artifact.ts#L47) | publishIssueArtifact sends input.name unchanged, but GitHub rejects parentheses in artifact names. The gh CLI strips them; this direct API call does not, so plan (1).md fails at POST. | low / 5 | gh issue artifact create docs: names can't contain some characters such as parentheses; CLI strips them (confirmed in cli.github.com manual, gh_issue_artifact_create) |
| [ao-8720-C3](https://github.com/OrchestratorInc/agent-orchestrator/pull/8720#discussion_r4633656718) | tune | [`resolver.go:219`](https://github.com/OrchestratorInc/agent-orchestrator/blob/06f399b87ed0bd9bfb0d68708c3dc8b882516316/backend/internal/gitdefault/resolver.go#L219) | RefreshRemoteHead skips the fetch when refs/remotes/origin/<branch> exists, even if the remote just renamed its default branch to a name with an old leftover ref. HEAD is cached as that branch without fetching, and new worktrees start from a stale commit. | low / 4 | That a renamed remote default can leave an old refs/remotes/origin/<branch>; reading the docstring of RefreshRemoteHead and cachedRemoteHead semantics |
| [ao-9036-C4](https://github.com/OrchestratorInc/agent-orchestrator/pull/9036#discussion_r4691743783) | tune | [`performance-telemetry.ts:312`](https://github.com/OrchestratorInc/agent-orchestrator/blob/c502ed61f57ebb0d8e64e0a5469b200211562e6e/frontend/src/renderer/lib/performance-telemetry.ts#L312) | Any script starting at or after tasksEnd is counted as callback time, but ResizeObserver callbacks can run after styleAndLayoutStart. That time is subtracted from the callback phase (which ends at styleStart) while rendering still counts the full end-styleStart span, so the breakdown is wrong for those scripts. | low / 5 | Long Animation Frames timeline: ResizeObserver callbacks run after styleAndLayoutStart; the arithmetic itself reproduces (150 ms for a 100 ms frame) |

### 5. A UI control that disagrees with its handler

| Case | Split | Where, at head | What goes wrong | Sev / diff. | Outside the diff |
| --- | --- | --- | --- | --- | --- |
| [ao-9055-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/9055#discussion_r4694218222) | tune | [`ChatComposer.tsx:2692`](https://github.com/OrchestratorInc/agent-orchestrator/blob/fb22a438eafe7cc3e1dba99681e052223caacee3/frontend/src/renderer/components/chat/ChatComposer.tsx#L2692) | The Remove button for next-message attachments is enabled during an optimistic send, but its handler still returns early on submitInFlight.current, so clicking it does nothing. | low / 3 | Nothing; onClick early return is 12 lines above the changed disabled prop |
| [ao-8714-C4](https://github.com/OrchestratorInc/agent-orchestrator/pull/8714#discussion_r4632273215) | tune | [`ArtifactActionsMenu.tsx:482`](https://github.com/OrchestratorInc/agent-orchestrator/blob/19f3070c20cc660b3ca614aee84bab5e9fd33794/frontend/src/renderer/components/ArtifactActionsMenu.tsx#L482) | GitHubIssueArtifactDialog has no trigger and no focus restoration, and the menu's restore is skipped for this action, so closing the dialog leaves focus on body and keyboard users lose their place. | low / 4 | Radix Dialog restores focus only to a trigger (none here); the menu's onCloseAutoFocus consumes sharing.current; ArchiveModalHost returnFocus pattern |
| [ao-8714-C5](https://github.com/OrchestratorInc/agent-orchestrator/pull/8714#discussion_r4632273229) | tune | [`bridge.ts:37`](https://github.com/OrchestratorInc/agent-orchestrator/blob/19f3070c20cc660b3ca614aee84bab5e9fd33794/frontend/src/renderer/lib/bridge.ts#L37) | Without window.ao, findArtifactIssues returns an empty list, so the dialog just disables publishing and never surfaces the desktop-required error that publishIssueArtifact throws. | low / 3 | That the dialog renders lookup errors (issues.error) in the removed/old code; the sibling stub right below already throws |

### 6. Invariants between parts and a whole

| Case | Split | Where, at head | What goes wrong | Sev / diff. | Outside the diff |
| --- | --- | --- | --- | --- | --- |
| [ao-9036-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/9036#discussion_r4691743764) | tune | [`startup_timing.go:67`](https://github.com/OrchestratorInc/agent-orchestrator/blob/c502ed61f57ebb0d8e64e0a5469b200211562e6e/backend/internal/daemon/startup_timing.go#L67) | Each step is converted to integer milliseconds independently, so two 1.5 ms steps are recorded as 1+1 while the total is 3. The per-step values no longer sum to the reported total. | none / 2 | Go Duration.Milliseconds truncates |
| [ao-8832-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/8832#discussion_r4655684748) | held-out | [`workspace_file_paths.go:146`](https://github.com/OrchestratorInc/agent-orchestrator/blob/e519f61c4b76be92bebee873190cd4e00b8ba536/backend/internal/service/session/workspace_file_paths.go#L146) | Each source's changed files are put first, but the global limit is applied by appending source by source. If the first source fills the cap with unchanged paths, a changed file from a later source is dropped from search and @. | low / 3 | Semantics of appendWorkspaceFilesWithCap (cap fills in source order) and that cap is 20k files, so only huge multi-repo projects trigger it |
| [ao-9095-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/9095#discussion_r4699236464) | held-out | [`skill_scan.go:179`](https://github.com/OrchestratorInc/agent-orchestrator/blob/dbf9107df4b9b7ee26ea0603599273f6383f2a7f/backend/internal/service/chat/skill_scan.go#L179) | Plugins are deduplicated on the key-derived name before the manifest name is read. With a@m named b and b@m named c, the second plugin is skipped on seen[b] and all c skills vanish. | low / 3 | Nothing, but needs a constructed scenario (plugin key a@m with manifest name b, and b@m) |
| [ao-8764-C2](https://github.com/OrchestratorInc/agent-orchestrator/pull/8764#discussion_r4642390039) | held-out | [`updateResume.ts:70`](https://github.com/OrchestratorInc/agent-orchestrator/blob/6faac3c37b020d21738c6af6ae018724866d3a8d/packages/mobile/lib/updateResume.ts#L70) | restoreAction compares only pathnames, so /session/abc?hostId=h_2 vs saved ?hostId=h_1 returns none and the app keeps the wrong machine context. | low / 3 | Nothing beyond the diff; needs the ?hostId= query to be part of route identity |
