# kaipu-record bug catalogue (code-review benchmark candidates)

Source: niway-dev/kaipu-record main at clone time (2026-10-30). Read-only mining. SZZ = git blame of the lines each fix removed/changed, on the fix's parent; commit->PR mapped from local merge history.

Total bugs: 145. Skipped PRs/items: 37.

Notes: (1) The AI reviewer (github-actions[bot], claude-review/agent-review markers) started on 2026-10-20 (~PR #301); every introducing PR merged earlier is `did-not-run`. (2) Two duplicates removed during merge (cursor-track tail cut #143, ghost process #422/#423 share fix commits). (3) Related chains: #143 (Fable 5.1 fix) introduced REC-B8 fixed in #416; #395 and #413 each fixed half of the cursor-tracker-after-end leak; #255 introduced the activation-policy cache bug fixed in #366; #367 hardening is followed by #439. (4) #303 (docs title) and #244 hold stacked code: replay #306 / #245 instead where the record says so. (5) found_by values marked Owner/user come from PR bodies; Linear tickets were not readable.

## Top 15 benchmark candidates

Filter: difficulty >= 4, introducing PR identified with medium/high confidence, introducing PR <= 40 files, bug at least partly visible from its diff. Alternates: stylex-hover-null-erases-fill (#233<-#215), ci-ondemand-review-owner-vs-member (#365<-#355, reviewer missed), fullscreen-pillarbox-from-ceiling-size (#390<-#12), uiohook-start-deadlock (#414<-#134; root cause is inside the native dependency, so unfair for diff review).

| id | fix PR | intro PR | conf | class | diff | intro size | found by | fixed by | prior reviewer |
|---|---|---|---|---|---|---|---|---|---|
| spare-overlay-state-lost-before-listener | #418 | #402 | high | race/ordering | 5 | 26f +1820/-504 | Owner terminal log; reproduced by Opus 5.5 with Playwright | Claude Opus 5.5 (trailer) | missed |
| activation-policy-cache-skips-restore | #366 | #255 | high | state machine | 5 | 5f +319/-13 | User report on desktop 0.14.1 | Claude Fable 5.1 (trailer) | did-not-run |
| auth-ipc-throw-loses-error-kind | #81 | #69 | high | cross-file contract | 5 | 2f +421/-0 | Claude Opus 5 whole-branch review (critical) | Claude Opus 5 (trailer) | did-not-run |
| auth-get-session-null-body | #81 | #68 | high | state machine | 5 | 2f +204/-0 | Claude Opus 5 whole-branch review (dispatched on opus) with source verification | Claude Opus 5 (trailer) | did-not-run |
| auth-origin-csrf-403 | #79 | #68 | medium | cross-file contract | 5 | 2f +204/-0 | Sonnet 5 during Task 12 manual verification against live wrangler dev | Claude Sonnet 5 (trailer) | did-not-run |
| auth-bearer-token-exposed-via-web-proxy | #81 | #66 | medium | security/abuse | 5 | 1f +2/-1 | Claude Opus 5 whole-branch review (Important) | Claude Opus 5 (trailer) | did-not-run |
| cursor-track-tail-cut-uses-late-wall-clock | #416 | #143 | medium | cross-file contract | 5 | 17f +1168/-10 | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer); some branch commits trailed Claude Fable 5.1 (tests/merge only) | did-not-run |
| cursor-track-tail-cut-floors-duration | #143 | #133 | high | data loss | 4 | 29f +1475/-27 | Claude Fable 5.1 (observed with the new cursor-track inspector) | Claude Fable 5.1 (trailer) | did-not-run |
| ci-required-check-skips-reads-green | #183 | #174 | high | CI | 5 | 7f +1020/-146 | Maintainer observation on PR #178 (0.8.1 RC) | Claude Opus 5 (trailer) | did-not-run |
| ticket-extend-between-read-and-release-race | #342 | #276 | high | race/ordering | 4 | 19f +641/-357 | Opus 5.5 reviewing the WIP in PR 342 (owner session) | Claude Opus 5.5 (trailer) | did-not-run |
| clearing-label-then-clicking-shape-deletes-wrong-shape | #370 | #52 | high | race/ordering | 4 | 8f +244/-47 | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | did-not-run |
| shot-editor-save-marks-dirty-clean-over-new-edit | #360 | #18 | medium | race/ordering | 4 | 7f +164/-14 | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | did-not-run |
| library-exported-badge-compares-clocks | #159 | #156 | high | state machine | 4 | 38f +1760/-20 | User/owner prod review of #156 on the first edited recording | Claude Opus 5 (trailer) | did-not-run |
| video-label-double-click-edit-broken-by-pointer-capture | #187 | #184 | medium | state machine | 5 | 7f +238/-24 | Owner | Claude Opus 5 (trailer) | did-not-run |
| drag-out-copies-whole-file-across-volumes | #412 | #286 (was #269: corrected 2026-11-02, the commit `749df1bc` is not in #269's diff) | high | platform-specific | 4 | see #286 | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer) | did-not-run |

## All bugs (difficulty desc)

| # | id | audit | fix PR | intro PR | conf | class | diff | intro size (files,+/-) | visible in intro diff | found by | fixed by | Fable found/fixed | prior reviewer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | rec-aspect-ratio-squeeze |  | #12 | #2 | high | cross-file contract | 5 | 276,+15860/-1161 | partial | Owner/user report (MacBook recording) + ffprobe confirmation by Opus 4.8 during fix | Claude Opus 4.8 (trailer) | F/F | did-not-run |
| 2 | recording-orphaned-on-page-unmount | FABLE-#1 | #17 | #2 | high | state machine | 5 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 3 | capture-hotkey-races-recording-countdown | FABLE-#9 | #17 | #13 | medium (omission) | race/ordering | 5 | 105,+6280/-164 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 4 | did-finish-load-race-on-hotkey | FABLE-uncertain-did-finish-load | #20 | #4, #13 | medium | race/ordering | 5 | 44,+6129/-82 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 5 | auth-origin-csrf-403 |  | #79 | #68 | medium (omission) | cross-file contract | 5 | 2,+204/-0 | partial | Sonnet 5 during Task 12 manual verification against live wrangler dev | Claude Sonnet 5 (trailer) | F/F | did-not-run |
| 6 | auth-get-session-null-body |  | #81 | #68 | high | state machine | 5 | 2,+204/-0 | partial | Claude Opus 5 whole-branch review (dispatched on opus) with source verification | Claude Opus 5 (trailer) | F/F | did-not-run |
| 7 | auth-ipc-throw-loses-error-kind |  | #81 | #69 | high | cross-file contract | 5 | 2,+421/-0 | partial | Claude Opus 5 whole-branch review (critical) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 8 | auth-bearer-token-exposed-via-web-proxy |  | #81 | #66 | medium | security/abuse | 5 | 1,+2/-1 | partial | Claude Opus 5 whole-branch review (Important) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 9 | release-build-missing-main-vite-server-url |  | #83 | #81 | medium | config/env | 5 | 17,+420/-71 | partial | Opus 5, found while tracing the E2E breakage | Claude Opus 5 (trailer) | F/F | did-not-run |
| 10 | web-hono-dev-env-not-reaching-worker |  | #123 | #115 | medium | config/env | 5 | 30,+12383/-62 | partial | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 11 | integration-suite-silently-skipped |  | #125 | #92 | high | CI | 5 | 61,+4572/-171 | partial | Owner/Opus 5 | Claude Opus 5 (trailer) | F/F | did-not-run |
| 12 | ci-required-check-skips-reads-green |  | #183 | #174 | high | CI | 5 | 7,+1020/-146 | partial | Maintainer observation on PR #178 (0.8.1 RC) | Claude Opus 5 (trailer) | u/F | did-not-run |
| 13 | video-label-double-click-edit-broken-by-pointer-capture |  | #187 | #184 | medium | state machine | 5 | 7,+238/-24 | partial | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 14 | ci-gate-reports-per-run-worst-conclusion |  | #190 | #183, #174 | medium | CI | 5 | 3,+106/-36 | partial | Maintainer observation (#178 blocked) | Claude Opus 5 (trailer) | u/F | did-not-run |
| 15 | ci-e2e-playwright-runs-under-bun |  | #219 | #176, #162 | low | CI | 5 | 4,+338/-36 | no | CI run showing 'No tests found' | Claude Opus 5 (trailer) | u/F | did-not-run |
| 16 | stylex-hover-null-erases-fill |  | #233 | #215, #221, #226 | high | UI/cosmetic | 5 | 17,+745/-140 | partial | Owner visual check | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 17 | ci-edited-event-skipped-gate-passes |  | #238 | #174 | medium | CI | 5 | 7,+1020/-146 | partial | Maintainer observation on #195 | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 18 | ci-worker-secrets-before-deploy |  | #246 | #207, #7 | low | race/ordering | 5 | 34,+1599/-609 | no | Failed deploy run 37523401905 | Claude Fable 5.1 + Opus 5.5 (trailers) | u/T | did-not-run |
| 19 | dock-show-on-every-policy-call |  | #255 | #4, #2 | medium | platform-specific | 5 | 44,+6129/-82 | no | Owner report + diagnosis log (agent-work-queue#9) | Claude Fable 5.1 (trailer) | u/T | did-not-run |
| 20 | upload-quota-released-while-ticket-live |  | #276 | #92 | medium (omission) | security/abuse | 5 | 61,+4572/-171 | partial | API security audit 2026-10-12 (finding F-1, ticket NIW2-323); auditor model unknown | Claude Opus 5.5 (trailer on WIP commit f34df72) | u/F | did-not-run |
| 21 | capture-panel-new-space-over-fullscreen |  | #291 | #2 | medium (omission) | platform-specific | 5 | 276,+15860/-1161 | no | Owner (NIW2-380) | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 22 | activation-policy-cache-skips-restore |  | #366 | #255 | high | state machine | 5 | 5,+319/-13 | partial | User report on desktop 0.14.1 | Claude Fable 5.1 (trailer) | u/T | did-not-run |
| 23 | sidecar-writemeta-lost-update-and-shared-tmp | LIB-B1 | #367 | #90, #245 | medium | race/ordering | 5 | 91,+10300/-475 | partial | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) (squash of 5 commits) | F/F | did-not-run |
| 24 | asset-identity-minted-per-vault-instance | LIB-B8 | #367 | #90 | high | race/ordering | 5 | 91,+10300/-475 | partial | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 25 | camera-bubble-not-draggable |  | #388 | #384 | high | state machine | 5 | 136,+9155/-634 | partial | Owner report | Claude Opus 5.5 (trailer) | F/F | missed |
| 26 | area-crop-uses-ceiling-track-size |  | #390 | #377 | medium | platform-specific | 5 | 85,+2436/-221 | partial | Owner (ffprobe of two takes on single-display MacBook), diagnosed by Opus 5.5 | Claude Opus 5.5 (trailer) | F/F | missed |
| 27 | fullscreen-pillarbox-from-ceiling-size |  | #390 | #12 | medium | platform-specific | 5 | 10,+434/-195 | partial | Owner (ffprobe of the Screen take), diagnosed by Opus 5.5 | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 28 | take-records-dead-capture |  | #395 | #133, #17 | medium (omission) | race/ordering | 5 | 29,+1475/-27 | no | Opus 5.5 audit | Claude Opus 5.5 + Sonnet 5.5 (trailers) | F/F | did-not-run |
| 29 | closed-window-keeps-pending-take |  | #396 | #384, #17 | low (omission) | state machine | 5 | 136,+9155/-634 | no | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | missed |
| 30 | cursor-track-start-after-take-ended-orphans-sampler | REC-A2 / REC-B4 | #413 | #133 | medium (omission) | resource leak | 5 | 29,+1475/-27 | partial | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 31 | uiohook-start-deadlock |  | #414 | #134 | medium | deadlock | 5 | 11,+275/-8 | partial | Owner (two hangs, thread sample) diagnosed by Fable 5.1; two independent reviews (Opus, Codex) of the C patch | Claude Fable 5.1 (trailer) | T/T | did-not-run |
| 32 | cursor-track-tail-cut-uses-late-wall-clock | REC-B8 | #416 | #143 | medium | cross-file contract | 5 | 17,+1168/-10 | partial | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer); some branch commits trailed Claude Fable 5.1 (tests/merge only) | F/F | did-not-run |
| 33 | spare-overlay-state-lost-before-listener |  | #418 | #402 | high | race/ordering | 5 | 26,+1820/-504 | partial | Owner terminal log; reproduced by Opus 5.5 with Playwright | Claude Opus 5.5 (trailer) | F/F | missed |
| 34 | raise-brings-hidden-bar-back |  | #419 | #384, #377 | medium | platform-specific | 5 | 136,+9155/-634 | partial | Owner log; Fable 5.1 probed Electron | Claude Fable 5.1 (trailer) | T/T | missed |
| 35 | shutdown-ghost-process-late-windows |  | #423 | #393, #402 | medium (omission) | race/ordering | 5 | 24,+1555/-198 | no | CI (E2E release-candidate runs, teardown hang) + owner ghost process; analysed by Fable 5.1 | Claude Fable 5.1 (trailer) | T/T | missed |
| 36 | overlay-keys-heard-after-paint |  | #425 | #303, #309 | medium | race/ordering | 5 | 66,+6178/-326 | partial | CI release-tag test failure (Release Desktop desktop-v0.15.0), analysed by Fable 5.1 | Claude Fable 5.1 (trailer) | T/T | did-not-run |
| 37 | screenshot-hotkey-destroys-recording | FABLE-#2 | #17 | #13 | medium (omission) | cross-file contract | 4 | 105,+6280/-164 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 38 | fastStart-in-memory-buffers-recording | FABLE-#3 | #17 | #2 | high | resource leak | 4 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 39 | record-page-guards-on-local-status | FABLE-#5 | #17 | #2, #4 | medium | state machine | 4 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 40 | no-recovery-when-recorder-renderer-dies | FABLE-#10 | #17 | #2 | low (omission) | state machine | 4 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 41 | start-while-finalizing-records-nothing | FABLE-#20 | #17 | #2, #4 | medium | race/ordering | 4 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 42 | main-window-hidden-after-engine-start | FABLE-#24 | #17 | #2 | high | race/ordering | 4 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 43 | window-resize-distorts-recording | FABLE-#25 | #17 | #12 | medium | state machine | 4 | 10,+434/-195 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 44 | stop-during-starting-gap-dropped | FABLE-#39 | #17 | #2 | medium | race/ordering | 4 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 45 | rebind-window-close-leaves-shortcuts-unregistered | FABLE-#21 | #20 | #4 | high | resource leak | 4 | 44,+6129/-82 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 46 | dock-click-does-not-reopen-window | FABLE-#27 | #20 | #2 | low | platform-specific | 4 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 47 | persisted-settings-no-renderer-broadcast | FABLE-#14 | #21 | #4 | medium (omission) | cross-file contract | 4 | 44,+6129/-82 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 48 | screenshot-editor-double-composite-on-reexport | FABLE-#4 | #24 | #13 | medium | state machine | 4 | 105,+6280/-164 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 49 | export-clips-annotations-to-shot-rect | FABLE-#12 | #24 | #15 | medium | UI/cosmetic | 4 | 30,+2416/-115 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 50 | export-arrow-not-scaled | FABLE-#13 | #24 | #13 | high | cross-file contract | 4 | 105,+6280/-164 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 51 | crop-padding-desync-preview-export | FABLE-#26 | #24 | #15 | high | UI/cosmetic | 4 | 30,+2416/-115 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 52 | editor-export-poster-seek-never-fires |  | #43 | #28 | high | race/ordering | 4 | 63,+8737/-12 | partial | Reported by user/owner (reproduces on every edit); root cause traced by Opus 4.8 | Claude Opus 4.8 (trailer) | F/F | did-not-run |
| 53 | auth-password-too-short-reported-as-email-taken |  | #81 | #68 | high | cross-file contract | 4 | 2,+204/-0 | partial | Claude Opus 5 whole-branch review (Important) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 54 | auth-lastknownemail-not-persisted |  | #81 | #69 | high | state machine | 4 | 2,+421/-0 | partial | Claude Opus 5 whole-branch review (Important) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 55 | ci-e2e-missing-main-vite-server-url |  | #83 | #81 | high | CI | 4 | 17,+420/-71 | partial | Opus 5 while validating #83 (pipeline failure) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 56 | screenshots-se-handle-dead-after-wrap |  | #83 | #51, #50 | medium | UI/cosmetic | 4 | 7,+121/-35 | yes | Owner/Opus 5 while using the editor | Claude Opus 5 (trailer) | F/F | did-not-run |
| 57 | console-dev-no-env-delivery |  | #125 | #115 | low (omission) | config/env | 4 | 30,+12383/-62 | partial | Owner/Opus 5 | Claude Opus 5 (trailer) | F/F | did-not-run |
| 58 | cursor-track-tail-cut-floors-duration |  | #143 | #133 | high | data loss | 4 | 29,+1475/-27 | partial | Claude Fable 5.1 (observed with the new cursor-track inspector) | Claude Fable 5.1 (trailer) | T/T | did-not-run |
| 59 | library-exported-badge-compares-clocks |  | #159 | #156 | high | state machine | 4 | 38,+1760/-20 | partial | User/owner prod review of #156 on the first edited recording | Claude Opus 5 (trailer) | F/F | did-not-run |
| 60 | video-preview-clipped-on-short-window |  | #177 | #141 | high | UI/cosmetic | 4 | 43,+981/-113 | partial | Owner (reported seeing the last terminal line missing) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 61 | video-label-hit-box-ignores-multiline |  | #187 | #184 | medium | UI/cosmetic | 4 | 7,+238/-24 | partial | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 62 | landing-shortcuts-typed-glyphs-wrong |  | #198 | #196 | high | cross-file contract | 4 | 94,+6211/-357 | partial | Owner/Opus 5 audit of the landing copy | Claude Opus 5 (trailer) | F/F | did-not-run |
| 63 | ci-preview-wrangler-npm-catalog |  | #208 | #207 | high (omission) | CI | 4 | 34,+1599/-609 | partial | First real workflow run (run 36938226183) | Claude Opus 5 (trailer) | u/F | did-not-run |
| 64 | ci-web-preview-no-version-url |  | #209 | #207 | low | config/env | 4 | 34,+1599/-609 | partial | Preview Web run #2 | Claude Fable 5 + Opus 5 (trailers) | u/T | did-not-run |
| 65 | web-ui-ships-duplicate-tailwind |  | #214 | ? | high | config/env | 4 | ?,+?/-? | no | Perf investigation (Fable 5 trailer) | Claude Fable 5 (trailer) | u/T | did-not-run |
| 66 | stylex-light-theme-class-never-applied |  | #232 | #212, #215 | low (omission) | cross-file contract | 4 | 17,+745/-140 | partial | Owner visual check | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 67 | plan-capacities-disagree-with-spec |  | #273 | #92, #84 | low | cross-file contract | 4 | 61,+4572/-171 | partial | Maintainer (NIW2-232) | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 68 | legacy-recordings-upload-no-controls |  | #276 | #53, #92 | medium (omission) | security/abuse | 4 | 60,+2168/-77 | partial | API security audit 2026-10-12 (F-2) | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 69 | ticket-extend-between-read-and-release-race |  | #342 | #276 | high | race/ordering | 4 | 19,+641/-357 | yes | Opus 5.5 reviewing the WIP in PR 342 (owner session) | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 70 | capture-overlay-keyboard-focus-last-painted |  | #352 | #303 | medium | race/ordering | 4 | 69,+6830/-318 | partial | User report (two displays) | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 71 | toast-edit-opens-editor-stale-list |  | #354 | #309 | low | race/ordering | 4 | 86,+7540/-1376 | partial | Production audit v0.14.0 | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 72 | shot-editor-save-marks-dirty-clean-over-new-edit | SHOT-B1 | #360 | #18 | medium | race/ordering | 4 | 7,+164/-14 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | F/F | did-not-run |
| 73 | shot-autoactions-skipped-if-image-loads-before-settings | SHOT-B8 | #360 | #194 | medium | race/ordering | 4 | 24,+526/-71 | partial | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | F/F | did-not-run |
| 74 | shot-toast-retry-runs-after-editor-unmount | SHOT-B9b | #360 | #19 | medium | state machine | 4 | 13,+282/-34 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | F/F | did-not-run |
| 75 | ci-ondemand-review-owner-vs-member |  | #365 | #355 | high | CI | 4 | 8,+1361/-1 | partial | Maintainer: run 39648100277 skipped on #364 | Claude Opus 5.5 (trailer) | u/F | missed |
| 76 | trim-no-bounds-overlap-and-past-source-end | VID-B2 | #368 | #28 | high (omission) | cross-file contract | 4 | 63,+8737/-12 | partial | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 77 | clearing-label-then-clicking-shape-deletes-wrong-shape | SHOT-B5 | #370 | #52 | high | race/ordering | 4 | 8,+244/-47 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 78 | screen-single-display-record-noop |  | #387 | #384, #377 | medium | cross-file contract | 4 | 136,+9155/-634 | partial | Owner testing (single-display MacBook), diagnosed by Opus 5.5 | Claude Opus 5.5 (trailer) | F/F | missed |
| 79 | countdown-clock-before-shade-visible |  | #391 | #384 | medium (omission) | race/ordering | 4 | 136,+9155/-634 | partial | Owner testing; tied to a record start/stop audit by Opus 5.5 | Claude Opus 5.5 (trailer) | F/F | missed |
| 80 | cancelled-countdown-no-app-activate |  | #392 | #384 | high | state machine | 4 | 136,+9155/-634 | partial | Owner release-blocker report, then Opus 5.5 audit (D1-D5) | Claude Opus 5.5 (trailer) | F/F | missed |
| 81 | cancel-during-starting-waits-on-hung-engine |  | #392 | #17 | medium (omission) | deadlock | 4 | 23,+1733/-552 | partial | Opus 5.5 audit of the record start/stop path | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 82 | compositor-play-uncapped-hang |  | #392 | #12 | medium (omission) | deadlock | 4 | 10,+434/-195 | partial | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 83 | bar-shows-before-ready-after-hide |  | #395 | #2 | low | race/ordering | 4 | 276,+15860/-1161 | partial | Opus 5.5 audit of the start/stop path | Claude Opus 5.5 + Sonnet 5.5 (trailers) | F/F | did-not-run |
| 84 | stale-lookup-acts-on-next-take |  | #395 | #384 | medium (omission) | race/ordering | 4 | 136,+9155/-634 | partial | Opus 5.5 audit | Claude Opus 5.5 + Sonnet 5.5 (trailers) | F/F | missed |
| 85 | cursor-tracker-starts-after-abort |  | #395 | #133 | high (omission) | resource leak | 4 | 29,+1475/-27 | partial | Opus 5.5 audit | Claude Opus 5.5 + Sonnet 5.5 (trailers) | F/F | did-not-run |
| 86 | renderer-crash-in-countdown-leaves-app-hidden |  | #396 | #384 | medium (omission) | state machine | 4 | 136,+9155/-634 | partial | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | missed |
| 87 | dead-renderer-take-handles-and-session-id-reuse |  | #396 | #2, #17 | low (omission) | resource leak | 4 | 276,+15860/-1161 | no | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 88 | drag-out-copies-whole-file-across-volumes | LIB-B12 (a) | #412 | #286 (was #269; corrected 2026-11-02) | high | platform-specific | 4 | 12,+1198/-26 | yes | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 89 | close-quit-guard-timeout-leaves-hub-recording-and-stale-listener | REC-B5 | #413 | #17, #18 | high | state machine | 4 | 23,+1733/-552 | yes | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 90 | dev-run-shares-userdata-with-installed |  | #428 | #305, #333 | low (omission) | config/env | 4 | 45,+1634/-219 | no | Owner (SingletonLock on his machine) | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 91 | sidecar-read-error-mints-new-assetid | NIW2-568 (follow-up of LIB-B1/#367) | #439 | #90 | high | data loss | 4 | 91,+10300/-475 | partial | unknown (not in the 2026-10-15 audit docs; related to LIB-B1 evidence and LIB-B6 pattern) | Claude Sonnet 5.5 (trailer) with Claude Opus 5.5 follow-up commit | F/F | did-not-run |
| 92 | camera-bubble-chrome-leaks-into-first-frames |  | #453 | #384 | high | race/ordering | 4 | 136,+9155/-634 | partial | Owner report NIW2-588 | Claude Opus 5.5 (trailer) | F/F | missed |
| 93 | stop-ignored-during-countdown | FABLE-#19 | #17 | #2 | medium | state machine | 3 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 94 | camera-bubble-in-screenshot | FABLE-#22 | #17 | #13 | medium (omission) | UI/cosmetic | 3 | 105,+6280/-164 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 95 | start-shortcut-reveals-window-mid-recording | FABLE-#23 | #17 | #4 | high (omission) | state machine | 3 | 44,+6129/-82 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 96 | chunk-write-failures-only-logged | FABLE-#7 | #19 | #2 | high | data loss | 3 | 276,+15860/-1161 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 97 | settings-written-non-atomically | FABLE-#28 | #19 | #2 | medium | data loss | 3 | 276,+15860/-1161 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 98 | vault-folder-change-empties-library | FABLE-#30 | #22 | #2 | medium (omission) | data loss | 3 | 276,+15860/-1161 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 99 | auth-web-typecheck-errors-hidden |  | #77 | #73 | medium | CI | 3 | 3,+237/-0 | partial | Sonnet 5 / orchestrator running bun run build | Claude Sonnet 5 (trailer) | F/F | did-not-run |
| 100 | auth-panel-stale-form-mode |  | #79 | #73 | high (omission) | state machine | 3 | 3,+237/-0 | yes | Sonnet 5 during Task 12 manual verification | Claude Sonnet 5 (trailer) | F/F | did-not-run |
| 101 | auth-signed-out-flash-on-load |  | #79 | #72 | high | race/ordering | 3 | 2,+210/-0 | yes | Sonnet 5 during Task 12 manual verification | Claude Sonnet 5 (trailer) | F/F | did-not-run |
| 102 | verification-email-state-lost-on-remount |  | #120 | #107, #111 | medium | state machine | 3 | 42,+1076/-15 | partial | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 103 | web-two-headers-on-roadmap-and-legal |  | #126 | #122, #102 | high | UI/cosmetic | 3 | 12,+464/-5 | partial | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 104 | export-poster-from-source-not-rendered-output |  | #132 | #43 | medium | data loss | 3 | 8,+362/-88 | yes | Opus 5 during video-editor v2 audit | Claude Opus 5 (trailer) | F/F | did-not-run |
| 105 | record-page-holds-microphone-open |  | #181 | #2 | high | resource leak | 3 | 276,+15860/-1161 | partial | Owner report ('se mueve mi audio...') | Claude Opus 5 (trailer) | F/F | did-not-run |
| 106 | video-label-drawn-twice-under-editor |  | #185 | #184 | medium (omission) | UI/cosmetic | 3 | 7,+238/-24 | yes | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 107 | video-label-reopen-shows-one-line |  | #187 | #184 | medium (omission) | UI/cosmetic | 3 | 7,+238/-24 | yes | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 108 | annotation-handles-visible-while-editing-text |  | #194 | #52, #51 | low (omission) | UI/cosmetic | 3 | 8,+244/-47 | yes | Owner (annotation fixes, #194) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 109 | annotation-long-word-overflows-box |  | #194 | #51 | high | UI/cosmetic | 3 | 7,+121/-35 | partial | Opus 5 during annotation work | Claude Opus 5 (trailer) | u/F | did-not-run |
| 110 | vault-sidecar-write-not-atomic |  | #244 | #90 | low | data loss | 3 | 91,+10300/-475 | partial | Opus 5.5 review of PR 244 | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 111 | retry-pending-deletes-starvation |  | #342 | #276 | high | state machine | 3 | 19,+641/-357 | yes | Opus 5.5 reviewing the WIP in PR 342 | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 112 | capture-never-opens-editor-when-autosave |  | #354 | #309 | medium | state machine | 3 | 86,+7540/-1376 | partial | Production audit of capture flow (v0.14.0) | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 113 | tag-registry-wiped-on-unreadable-tags-json | LIB-B6 | #358 | #245 | high | data loss | 3 | 52,+3920/-162 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | F/F | did-not-run |
| 114 | recording-finalize-strands-part-in-tmpdir | REC-B6 | #359 | #2 | high | data loss | 3 | 276,+15860/-1161 | partial | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | F/F | did-not-run |
| 115 | shot-discard-deletes-manual-copy-keeps-autosaved | SHOT-B4 | #360 | #155 | medium | state machine | 3 | 20,+692/-17 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | F/F | did-not-run |
| 116 | shot-editor-clicks-dropped-while-busy | SHOT-B9a | #360 | #13 | medium | state machine | 3 | 105,+6280/-164 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet (Co-Authored-By trailer, no version) | F/F | did-not-run |
| 117 | screenshot-orphan-png-when-sidecar-write-fails | SHOT-B3 (second half) | #367 | #309 | low (omission) | data loss | 3 | 89,+8025/-1389 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 118 | trim-start-handle-runs-away-from-pointer | VID-B1 | #368 | #28 | high | state machine | 3 | 63,+8737/-12 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 119 | trim-drag-no-pointercancel-handling | VID-B7 | #368 | #28 | high (omission) | state machine | 3 | 63,+8737/-12 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 120 | trim-drag-clamps-overlays-on-every-live-frame | VID-B8 | #368 | #28 | high | state machine | 3 | 63,+8737/-12 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 121 | screenshot-hotkey-during-recording-toast-in-hidden-window | SHOT-B7 | #374 | #303 | medium (omission) | cross-file contract | 3 | 7,+675/-15 | partial | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 122 | control-bar-shown-after-take-stopped |  | #392 | #384 | medium | race/ordering | 3 | 136,+9155/-634 | yes | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | missed |
| 123 | input-throw-strands-starting |  | #392 | #17 | medium | state machine | 3 | 23,+1733/-552 | yes | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 124 | ci-verify-runs-empty-scripts-test |  | #394 | #375 | high (omission) | CI | 3 | 7,+32/-1266 | partial | Failing verify on main | Claude Opus 5.5 (trailer) | u/F | caught |
| 125 | control-bar-stale-saving-state |  | #395 | #2 | low (omission) | state machine | 3 | 276,+15860/-1161 | no | Owner report | Claude Opus 5.5 + Sonnet 5.5 (trailers) | F/F | did-not-run |
| 126 | cancel-in-create-gap-starts-engine |  | #396 | #392 | high | resource leak | 3 | 12,+502/-65 | yes | Opus 5.5 audit of the hub/store/engine/writer | Claude Opus 5.5 (trailer) | F/F | missed |
| 127 | stop-keeps-encoding-through-poster-wait |  | #396 | #393 | high (omission) | race/ordering | 3 | 24,+1555/-198 | yes | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | missed |
| 128 | metadata-failure-leaves-orphan-mp4 |  | #396 | #2 | medium | data loss | 3 | 276,+15860/-1161 | partial | Opus 5.5 audit | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 129 | picked-mic-not-remembered |  | #408 | #2 | medium (omission) | state machine | 3 | 276,+15860/-1161 | no | Owner report | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 130 | tag-editor-paste-and-quick-removes-use-stale-list | LIB-B2 | #411 | #245 | high | race/ordering | 3 | 52,+3920/-162 | yes | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 131 | drag-out-second-drag-deletes-first-drag-file | LIB-B12 (b) | #412 | #269 | high | race/ordering | 3 | 12,+1198/-26 | yes | Opus auditor (audit 2026-10-15) | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 132 | camera-bubble-permanent-pink-border |  | #453 | #2 | low | UI/cosmetic | 3 | 276,+15860/-1161 | partial | Owner report NIW2-588 | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 133 | countdown-cannot-be-cancelled | FABLE-#17 | #17 | #2 | medium (omission) | state machine | 2 | 276,+15860/-1161 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 134 | editor-no-unsaved-changes-guard | FABLE-#8 | #18 | #13 | medium (omission) | data loss | 2 | 105,+6280/-164 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 135 | cmd-q-mid-recording-quits-silently | FABLE-#11 | #18 | #2 | low (omission) | data loss | 2 | 276,+15860/-1161 | partial | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 136 | editor-save-copy-swallow-failures | FABLE-#6 | #19 | #13 | high | data loss | 2 | 105,+6280/-164 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 137 | library-list-failure-shown-as-empty | FABLE-#18 | #19 | #2 | high | data loss | 2 | 276,+15860/-1161 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 138 | duplicate-shortcut-bindings-allowed | FABLE-#29 | #20 | #4 | medium (omission) | state machine | 2 | 44,+6129/-82 | yes | Claude Fable 5 audit (pre-testers audit, adversarially verified) | Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code') | T/F | did-not-run |
| 139 | web-tab-title-hardcoded-spanish |  | #126 | #103 | high | UI/cosmetic | 2 | 25,+194/-12 | yes | Owner | Claude Opus 5 (trailer) | F/F | did-not-run |
| 140 | annotation-long-word-overflows-box |  | #194 | #51 | medium (omission) | UI/cosmetic | 2 | 7,+121/-35 | yes | Owner (annotation fixes, #194) | Claude Opus 5 (trailer) | F/F | did-not-run |
| 141 | ci-preview-environment-says-production |  | #208 | #207 | high | CI | 2 | 34,+1599/-609 | yes | First real workflow run | Claude Opus 5 (trailer) | u/F | did-not-run |
| 142 | asset-cursor-unvalidated |  | #276 | #97 | high | cross-file contract | 2 | 14,+472/-158 | yes | API security audit 2026-10-12 (F-9) | Claude Opus 5.5 (trailer) | u/F | did-not-run |
| 143 | screenshot-overwrite-not-atomic | LIB-B10 / SHOT-B3 | #367 | #13 | high | data loss | 2 | 105,+6280/-164 | yes | Opus auditor (audit 2026-10-15) | Claude Sonnet 5.5 (trailer) | F/F | did-not-run |
| 144 | pause-resume-during-finalizing |  | #395, #396 | #17 | medium | state machine | 2 | 23,+1733/-552 | yes | Opus 5.5 audits (twice) | Claude Opus 5.5 (trailer) | F/F | did-not-run |
| 145 | edited-title-hardcoded-spanish |  | #44 | #28 | medium | UI/cosmetic | 1 | 63,+8737/-12 | yes | Owner (called 'bonus bug' in #44 body) | Claude Opus 4.8 (trailer) | F/F | did-not-run |

## Details

### 1. rec-aspect-ratio-squeeze

- **Defect:** Capture was constrained to a hardcoded 1920x1080 box, so Chromium's desktop capturer rescaled non-16:9 panels to 16:9 without keeping proportions (fix: capture native, re-frame with fitToCap).
- **User-visible failure:** Recordings on every MacBook (3024x1964, AR 1.54) came out stretched ~15% horizontally and soft; circles became ellipses.
- **Fix:** PR #12; commits c3ec7fd0
- **Class:** cross-file contract
- **Introduced by:** PR #2; commits 709819b2, 0f639922, 847f0278; confidence high; omission: False. Removed lines blamed to #2 (recorder-engine.ts constraints, recording-quality.ts presets, watermark-compositor.ts); all introduced by the initial recorder import.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. #2 is the 276-file initial import; poor replay. The hardcoded 1920x1080 constraints are visible, but the bug (Chromium rescales without AR) needs platform knowledge and a non-16:9 display.
- **Difficulty:** 5/5. Needs knowledge of how Chromium's desktop capturer rescales constraints and a non-16:9 screen; code looks like a normal resolution cap.
- **Found by:** Owner/user report (MacBook recording) + ffprobe confirmation by Opus 4.8 during fix. **Fixed by:** Claude Opus 4.8 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 2. recording-orphaned-on-page-unmount (FABLE-#1)

- **Defect:** Recording engine, session, tick interval and the recordingCommand listener lived in useScreenRecorder owned by RecordPage; unmounting the page mid-recording removed the listener and left a live engine with no stop path.
- **User-visible failure:** Navigating (Library, screenshot, rescue shortcut) mid-recording makes Stop and the stop shortcut dead; the recording is never finalized and is lost.
- **Fix:** PR #17; commits c860120a
- **Class:** state machine
- **Introduced by:** PR #2; commits 5efda2e4d, d0f431c55; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Strong blame: 218 removed lines of use-screen-recorder.ts all in PR #2 (commits 5efda2e4d, fa906e4cb, 94799c752). Architectural defect (lifetime bound to React mount) rather than a single line.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app). The hook design is visible only if the reviewer reasons about unmount + IPC listener lifetime.
- **Difficulty:** 5/5. Needs cross-file reasoning: hook cleanup, page routing, hub IPC and shortcut flow combine; each file looks locally fine.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 3. capture-hotkey-races-recording-countdown (FABLE-#9)

- **Defect:** triggerCaptureScreenshot and renderer capture() have no guard for the countdown/starting phase, so the native region selector races the recording start.
- **User-visible failure:** Pressing the screenshot hotkey during the 3-2-1 countdown starts recording underneath the selector and can reveal the main window mid-recording.
- **Fix:** PR #17; commits c860120a
- **Class:** race/ordering
- **Introduced by:** PR #13; commits 04382f9f8; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. triggerCaptureScreenshot and captureWindowHooks were added in PR #13; the countdown lives in PR #2 code. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: partial. Needs the countdown timing in hooks from PR #2 in context.
- **Difficulty:** 5/5. Timing race across main process, countdown interval and a native selector; activity is idle during the countdown.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 4. did-finish-load-race-on-hotkey (FABLE-uncertain-did-finish-load)

- **Defect:** Hotkey handlers checked contents.isLoading() then registered did-finish-load, which can fire before the check, losing the request for freshly created windows.
- **User-visible failure:** Start/screenshot hotkeys can be ignored when the window was just created.
- **Fix:** PR #20; commits 28912ae9
- **Class:** race/ordering
- **Introduced by:** PR #4, #13; commits c372abd69, 04382f9f8; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Fix removed the isLoading()/once('did-finish-load') patterns: start/rec patterns blamed to #4, screenshot hotkey to #13 (also #16 for panel).
- **Replayability:** intro PR size {'files': 44, 'add': 6129, 'del': 82}; mixed: True; visible from diff: partial. Timing-dependent in Electron.
- **Difficulty:** 5/5. Event-ordering race; classed 'uncertain' then verified real by Fable.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 5. auth-origin-csrf-403

- **Defect:** Desktop auth-client's credential POSTs sent no Origin header and the server's trustedOrigins had no desktop entry; better-auth's formCsrfMiddleware (Sec-Fetch-* gated) rejects sign-in/email and sign-up/email with MISSING_OR_NULL_ORIGIN when fetched from Electron main.
- **User-visible failure:** Sign-up and sign-in failed outright with 403 for every desktop user.
- **Fix:** PR #79; commits 7807c94f
- **Class:** cross-file contract
- **Introduced by:** PR #68; commits ce9613b1; confidence medium; omission: True. Pure addition (Origin header + trustedOrigins literal), so blame is weak; auth-client.ts callCredentialEndpoint was written in #68 (task 3). Server side auth.ts trustedOrigins pre-existed from initial commit.
- **Replayability:** intro PR size {'files': 2, 'add': 204, 'del': 0}; mixed: False; visible from diff: partial. #68 is a small stacked PR (204 lines, 2 files) on base feat/desktop-auth-02-shared-types; replay it at its own base. The omission is only visible with knowledge of better-auth's second CSRF check (spec's adversarial review also missed it).
- **Difficulty:** 5/5. Requires third-party library internals (formCsrfMiddleware, Sec-Fetch-* in Electron main-process fetch) and cross-file server/client reasoning; mocks hid it from tests.
- **Found by:** Sonnet 5 during Task 12 manual verification against live wrangler dev. **Fixed by:** Claude Sonnet 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 6. auth-get-session-null-body

- **Defect:** getSession only treated HTTP 401 as 'session gone', but better-auth /get-session answers 200 with JSON null for an expired/missing session, so data.user.email threw a TypeError.
- **User-visible failure:** The stale token was never cleared; auth state landed on 'unknown' forever for the common expired-session case (no recovery without manual intervention).
- **Fix:** PR #81; commits 1d735e55
- **Class:** state machine
- **Introduced by:** PR #68; commits ce9613b1; confidence high; omission: False. 5 removed lines in auth-client.ts blamed to ce9613b1 (#68).
- **Replayability:** intro PR size {'files': 2, 'add': 204, 'del': 0}; mixed: False; visible from diff: partial. #68 small; visible that only 401 is handled, but the 200+null contract is third-party behaviour (verified by Opus 5 in installed better-auth@1.4.18 source).
- **Difficulty:** 5/5. Needs knowledge of better-auth's undocumented-in-diff 200+null response; the code looks correct against a REST-style assumption.
- **Found by:** Claude Opus 5 whole-branch review (dispatched on opus) with source verification. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 7. auth-ipc-throw-loses-error-kind

- **Defect:** signIn/signUp IPC handlers threw bare {kind} object literals; Electron serializes thrown IPC errors down to .message only, so the renderer received err.kind undefined (fixed by returning a discriminated AuthAttemptResult).
- **User-visible failure:** Every sign-in/sign-up failure showed the generic 'Something went wrong'; 3 of 4 specific error strings were unreachable.
- **Fix:** PR #81; commits a365f9f3
- **Class:** cross-file contract
- **Introduced by:** PR #69; commits c7f0d906, 997e2753, 111acd2e; confidence high; omission: False. 22 removed lines across auth-store.ts (#69), use-auth-status.ts (#72), electron-api.ts (#70); primary origin is the throw in #69's handlers.
- **Replayability:** intro PR size {'files': 2, 'add': 421, 'del': 0}; mixed: False; visible from diff: partial. #69 is 421 lines/2 files (auth-store + test); the bug needs the renderer consumer (#72/#73) and Electron IPC serialization knowledge. Renderer tests used mockRejectedValue, bypassing serialization.
- **Difficulty:** 5/5. Needs Electron IPC error-serialization knowledge and cross-process reasoning; tests masked it by injecting errors directly.
- **Found by:** Claude Opus 5 whole-branch review (critical). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 8. auth-bearer-token-exposed-via-web-proxy

- **Defect:** bearer() added to the shared better-auth config makes every response carry set-auth-token (raw session token) and expose it via CORS; apps/web-hono's createProxyHandler copies response headers verbatim so page JS can read it. Also requireSignature defaulted off.
- **User-visible failure:** Web app sessions' raw token readable from page JS (same-origin XSS could steal a live session despite httpOnly cookie); security regression.
- **Fix:** PR #81; commits 78865f3f
- **Class:** security/abuse
- **Introduced by:** PR #66; commits 7574138b; confidence medium; omission: False. base-config.ts bearer() line blamed to #66; proxy-handler.ts pre-existed from the initial commit (weak).
- **Replayability:** intro PR size {'files': 1, 'add': 2, 'del': 1}; mixed: False; visible from diff: partial. #66 is a 2-line/1-file PR; the harm only appears from interaction with the existing proxy-handler in another package, so a reviewer must open that file.
- **Difficulty:** 5/5. Cross-package interaction: a 2-line plugin addition is safe-looking, the leak is in unmodified code that forwards headers.
- **Found by:** Claude Opus 5 whole-branch review (Important). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 9. release-build-missing-main-vite-server-url

- **Defect:** release-desktop.yml built the signed app without MAIN_VITE_SERVER_URL (inlined at build time); since c17f54b1 the main process throws at startup when it is missing.
- **User-visible failure:** The next signed release would have shipped a binary that throws on launch and opens no window, with build and notarization both green (caught before release).
- **Fix:** PR #83; commits 58a09066
- **Class:** config/env
- **Introduced by:** PR #81; commits c17f54b1; confidence medium; omission: False. Same introducing commit as the E2E failure; the release workflow was missing the variable since the auth wiring (#71) but only became fatal with c17f54b1.
- **Replayability:** intro PR size {'files': 17, 'add': 420, 'del': 71}; mixed: True; visible from diff: partial. #81 mixed. Reviewer must reason that a build-time-inlined env var is required by a new startup guard and that the release workflow does not provide it.
- **Difficulty:** 5/5. Build-time env inlining plus a workflow in a different file; success signals all green.
- **Found by:** Opus 5, found while tracing the E2E breakage. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 10. web-hono-dev-env-not-reaching-worker

- **Defect:** web-hono's dev script injected Infisical secrets into the parent Node process (with-env.sh), but @cloudflare/vite-plugin runs SSR in workerd, which reads its own bindings, so env.parse(process.env) saw nothing.
- **User-visible failure:** bun run dev failed immediately with ZodError: DATABASE_URL, VITE_SERVER_URL expected string, received undefined.
- **Fix:** PR #123; commits 20df0f21
- **Class:** config/env
- **Introduced by:** PR #115; commits fb69c15f; confidence medium; omission: False. Dev script line blamed to fb69c15f (refactor(secrets): filter by consumer tag), which c2pr maps to #115 (console app, 30 files +12.4k mixed).
- **Replayability:** intro PR size {'files': 30, 'add': 12383, 'del': 62}; mixed: True; visible from diff: partial. #115 is large and mixed; poor replay.
- **Difficulty:** 5/5. Runtime-boundary reasoning (parent process vs workerd) with green-looking secret injection logs.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 11. integration-suite-silently-skipped

- **Defect:** test:integration forwarded only TEST_DATABASE_URL under Turbo strict env while the root script fetched only DATABASE_URL; the test did `url ? describe : describe.skip`, so all 10 DB tests skipped and the command exited 0.
- **User-visible failure:** bun run test:integration reported success without touching a database.
- **Fix:** PR #125; commits 0a1f24cd
- **Class:** CI
- **Introduced by:** PR #92; commits 54aeff89, 443d9903; confidence high; omission: False. describeDb skip and turbo env both introduced in 54aeff89 (#92).
- **Replayability:** intro PR size {'files': 61, 'add': 4572, 'del': 171}; mixed: True; visible from diff: partial. #92 is 61 files +4572; the three disagreeing pieces live in turbo.json, root package.json and the test.
- **Difficulty:** 5/5. Needs three-file reasoning plus Turbo strict-mode semantics; silent success.
- **Found by:** Owner/Opus 5. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 12. ci-required-check-skips-reads-green

- **Defect:** The release-candidate gate had `if` conditions (draft, event type) so its job could be skipped; GitHub counts a skipped required check as passed, so an `edited` run's skipped gate turned the merge button green while the real run was pending.
- **User-visible failure:** 0.8.1 release candidate showed 'All checks have passed, 5 skipped' while verification still ran.
- **Fix:** PR #183; commits 06388e64
- **Class:** CI
- **Introduced by:** PR #174; commits a8988fea6; confidence high; omission: False. Removed lines in pr-checks.yml/check-workflow-eligibility.ts blamed to a8988fea6 (PR 174), plus a8292e42c (PR 176).
- **Replayability:** intro PR size {'files': 7, 'add': 1020, 'del': 146}; mixed: False; visible from diff: partial. Workflow + ADR + harness in one PR; the false belief 'skipped = unsatisfied' is written in ADR 0005 inside the same diff.
- **Difficulty:** 5/5. Needs GitHub branch-protection semantics (skipped counts as success); the code looks like a careful guard.
- **Found by:** Maintainer observation on PR #178 (0.8.1 RC). **Fixed by:** Claude Opus 5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 13. video-label-double-click-edit-broken-by-pointer-capture

- **Defect:** Move branch captured the pointer on e.target; for a multi-line label that is a <tspan> which re-renders/vanishes when selection changes, so the two clicks of a dblclick no longer share a target and the dblclick never fires.
- **User-visible failure:** After labels became movable, double-click to edit a video label stopped working.
- **Fix:** PR #187; commits 347c09ae
- **Class:** state machine
- **Introduced by:** PR #184; commits 2c33d5b8; confidence medium; omission: False. Old setPointerCapture(e.target) from #28 (2 strong lines), made reachable by #184 changing label content to per-line <tspan>s.
- **Replayability:** intro PR size {'files': 7, 'add': 238, 'del': 24}; mixed: False; visible from diff: partial. #184 diff shows the tspan change; the faulty capture line is in unmodified code, and jsdom cannot reproduce pointer capture.
- **Difficulty:** 5/5. Needs DOM event semantics (dblclick target pairing, pointer capture) across a changed render shape and an untouched handler.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 14. ci-gate-reports-per-run-worst-conclusion

- **Defect:** After #183 the gate always ran and failed closed; two runs on the same commit (synchronize + edited, fired together by release-please) produced a permanent failure check run next to a later success, and GitHub resolves a required check to the worst conclusion, so the PR could not merge.
- **User-visible failure:** Desktop 0.9.0 PR (#178) unmergeable for three revisions although verification passed.
- **Fix:** PR #190; commits 6346e447
- **Class:** CI
- **Introduced by:** PR #183, #174; commits 433ab5ef7, a8988fea6; confidence medium; omission: False. 433ab5ef7 (PR 183) 40 lines, a8988fea6 (PR 174) 14. Fix-of-a-fix: defect created by PR 183's fail-closed design on top of 174's multi-trigger workflow.
- **Replayability:** intro PR size {'files': 3, 'add': 106, 'del': 36}; mixed: False; visible from diff: partial. Replay PR 183 (small). The multi-run behaviour is not derivable from the diff; measured on the live repo in PR 190 body.
- **Difficulty:** 5/5. Depends on undocumented GitHub rollup behaviour measured empirically.
- **Found by:** Maintainer observation (#178 blocked). **Fixed by:** Claude Opus 5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 15. ci-e2e-playwright-runs-under-bun

- **Defect:** `bunx playwright test`/`playwright test` under bun loaded Playwright twice, so tests registered on an instance the runner never read: 'No tests found', a release gate testing nothing.
- **User-visible failure:** Desktop E2E gate (pr-checks, release-desktop) ran zero tests.
- **Fix:** PR #219; commits 62644ec6
- **Class:** CI
- **Introduced by:** PR #176, #162; commits a8292e42c, 9e211fd05; confidence low; omission: False. bunx playwright lines in pr-checks.yml (PR 176) and release-desktop.yml (PR 162); package.json script from PR 30 (8cab0cf3e). Exact trigger (bun/Playwright version change) unknown.
- **Replayability:** intro PR size {'files': 4, 'add': 338, 'del': 36}; mixed: False; visible from diff: no. Runtime behaviour of bun's node shim; not derivable from diff.
- **Difficulty:** 5/5. Platform/runtime knowledge: bun run shadows node on PATH.
- **Found by:** CI run showing 'No tests found'. **Fixed by:** Claude Opus 5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 16. stylex-hover-null-erases-fill

- **Defect:** Hover layers used backgroundColor { default: null, ':hover': x }; in StyleX a later style naming a property replaces it whole, so null erased the variant's fill. Enabled Buttons, Modal buttons and SourceCard action lost their background/border/text colour.
- **User-visible failure:** Every enabled primary/danger/ghost/outline button rendered white with only the glow.
- **Fix:** PR #233; commits 6d70a02e
- **Class:** UI/cosmetic
- **Introduced by:** PR #215, #221, #226; commits f46a419d8, 461d0c7b7, b22954b49; confidence high; omission: False. Same pattern in three PRs: button.tsx (215), modal.tsx (221), source-card.tsx (226).
- **Replayability:** intro PR size {'files': 17, 'add': 745, 'del': 140}; mixed: False; visible from diff: partial. Replay PR 215 first (Button).
- **Difficulty:** 5/5. Needs StyleX merge semantics; reads like harmless null default.
- **Found by:** Owner visual check. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 17. ci-edited-event-skipped-gate-passes

- **Defect:** `edited` was a pr-checks trigger; when release-please edits the PR body at force-push time, the edited run verified nothing and reported checks skipped, which GitHub counts as passing, so the merge button read green while the real run was pending.
- **User-visible failure:** Desktop 0.10.0 (#195) read 'All checks have passed' during verification.
- **Fix:** PR #238; commits dc095d4a
- **Class:** CI
- **Introduced by:** PR #174; commits a8988fea6; confidence medium; omission: False. `edited` trigger and gate wiring from a8988fea6 (PR 174); PR 190 later changed the gate. Fix is inside ci-titled PR 238 (speed + this hole), after the fixes in 183/190 did not fully close it.
- **Replayability:** intro PR size {'files': 7, 'add': 1020, 'del': 146}; mixed: False; visible from diff: partial. Same PR 174 as the ci-required-check record.
- **Difficulty:** 5/5. GitHub event/skip semantics.
- **Found by:** Maintainer observation on #195. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 18. ci-worker-secrets-before-deploy

- **Defect:** Release jobs passed secrets through wrangler-action `secrets:` (wrangler secret bulk BEFORE deploy); once preview-web uploaded a non-deployed version, Cloudflare refused the secret edit; it was also non-atomic (new secrets with old code).
- **User-visible failure:** web-v0.9.0 deploy failed: 'latest version of your Worker isn't currently deployed'.
- **Fix:** PR #246; commits 964fe816
- **Class:** race/ordering
- **Introduced by:** PR #207, #7; commits 5d73a4719, 1007ad2cc; confidence low; omission: False. SZZ top: PR 7 (1007ad2cc release-api.yml, 13 lines), Initial commit, PR 208/105. Trigger was preview-web upload (PR 207/208); the secrets-before-deploy pattern predates it.
- **Replayability:** intro PR size {'files': 34, 'add': 1599, 'del': 609}; mixed: True; visible from diff: no. Interaction between two workflows and Cloudflare version state; no single diff shows it.
- **Difficulty:** 5/5. Cross-workflow, external platform state.
- **Found by:** Failed deploy run 37523401905. **Fixed by:** Claude Fable 5.1 + Opus 5.5 (trailers). Fable found: unknown; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 19. dock-show-on-every-policy-call

- **Defect:** forceRegularPolicy/applyDockPolicy called app.dock.show() on every call; on macOS that re-transforms the process and orders windows out and back in, so camera-on re-assertions produced a blur-hide-show cycle.
- **User-visible failure:** Main window disappears when it loses focus (macOS) after enabling camera.
- **Fix:** PR #255; commits 78e20a25
- **Class:** platform-specific
- **Introduced by:** PR #4, #2; commits c372abd69, 780d81d1a; confidence medium; omission: False. forceRegularPolicy (c372abd69, PR 4) and applyDockPolicy (780d81d1a, PR 2).
- **Replayability:** intro PR size {'files': 44, 'add': 6129, 'del': 82}; mixed: True; visible from diff: no. Large early PRs; macOS runtime behaviour.
- **Difficulty:** 5/5. Native AppKit side effect of an innocuous call.
- **Found by:** Owner report + diagnosis log (agent-work-queue#9). **Fixed by:** Claude Fable 5.1 (trailer). Fable found: unknown; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 20. upload-quota-released-while-ticket-live

- **Defect:** cancelUpload/deleteCloudCopy released the account's quota and deleted the R2 object while the presigned PUT ticket could still write, so a client could store bytes no revision accounts for (audit F-1).
- **User-visible failure:** Abuse: a client can store objects beyond its quota after cancel/delete; no end-user symptom.
- **Fix:** PR #276; commits f34df723
- **Class:** security/abuse
- **Introduced by:** PR #92; commits af036542f, a3a3e273; confidence medium; omission: True. Fix is mostly additions (ticketWindowClosed guard in cancel/delete/retry); weak blame on cancel-upload.ts/delete-cloud-copy.ts/retry-pending-deletes.ts written in PR 92 (af036542f). The cloud-data model already stated 'a reservation must not expire while a valid ticket can still write' but cancel/delete ignored it.
- **Replayability:** intro PR size {'files': 61, 'add': 4572, 'del': 171}; mixed: True; visible from diff: partial. PR 92 is large (plan 01 Tasks 0-9: quotas, revisions, tickets). Bug spans cancel-upload, delete-cloud-copy and ticket signing; needs the invariant from the data-model doc.
- **Difficulty:** 5/5. Cross-file temporal invariant: a presigned URL cannot be revoked, so release/delete order vs ticket expiry matters; nothing in one file shows it.
- **Found by:** API security audit 2026-10-12 (finding F-1, ticket NIW2-323); auditor model unknown. **Fixed by:** Claude Opus 5.5 (trailer on WIP commit f34df72). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 21. capture-panel-new-space-over-fullscreen

- **Defect:** The capture panel was a plain always-on-top window; macOS cannot place it over a full-screen Space, so it created a new black Space, and because the panel is prewarmed the Space stuck until restart.
- **User-visible failure:** Clicking the menu-bar icon over a full-screen app switches to a black Space.
- **Fix:** PR #291; commits 3656863a
- **Class:** platform-specific
- **Introduced by:** PR #2; commits 7ac9f84a8; confidence medium; omission: True. Window creation in capture-panel-window.ts from initial import.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: False; visible from diff: no. Initial import; not replayable.
- **Difficulty:** 5/5. macOS Spaces behaviour, only observable on device.
- **Found by:** Owner (NIW2-380). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 22. activation-policy-cache-skips-restore

- **Defect:** After #255 the policy setter skipped calls matching its cache, but floating control-bar/camera windows called setVisibleOnAllWorkspaces(visibleOnFullScreen) without skipTransformProcessType so Electron ran dock.hide(); cache said 'regular', so forceRegularPolicy/applyDockPolicy became no-ops and the Dock/Cmd+Tab entry never came back.
- **User-visible failure:** Kaipu drops out of Dock and Cmd+Tab after first recording and every camera toggle (macOS, 0.14.1).
- **Fix:** PR #366; commits 72ab3e26
- **Class:** state machine
- **Introduced by:** PR #255; commits 78e20a253; confidence high; omission: False. Cache early-return (78e20a253, PR 255) is the regression; the missing skipTransformProcessType in control-bar/camera-bubble windows dates to PR 2 (81c60546a, 65473b531), masked until 255.
- **Replayability:** intro PR size {'files': 5, 'add': 319, 'del': 13}; mixed: False; visible from diff: partial. Small, replayable. Reviewer must reason that the cache can diverge from real AppKit state.
- **Difficulty:** 5/5. Cache diverging from external OS state; fix PR 255 itself looks correct in isolation.
- **Found by:** User report on desktop 0.14.1. **Fixed by:** Claude Fable 5.1 (trailer). Fable found: unknown; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR 255 merged 2026-10-13 (no reviewer). On the fix PR 366 the reviewer noted 'isVisible() probe may lag right after dock.show()', a related caveat.

### 23. sidecar-writemeta-lost-update-and-shared-tmp (LIB-B1)

- **Defect:** LibraryVault.writeMeta was an unlocked read-merge-write through one shared <id>.json.tmp, and currentVault() builds a new LibraryVault per IPC call, so concurrent writes lost updates, rejected with ENOENT on the second rename and could leave interleaved invalid JSON that read back as {}.
- **User-visible failure:** Pasting several tags (or rename+tag edit) loses a field or errors; in ~5% of the audit's runs the sidecar is corrupted so the item loses title, tags and assetId (and its cloud link).
- **Fix:** PR #367; commits 3377f73
- **Class:** race/ordering
- **Introduced by:** PR #90, #245; commits e1637cfdc, 8ca010e25; confidence medium; omission: False. STRONG blame of removed writeMeta lines: read-merge `const current = await this.sidecar(id)` = e1637cfdc (#90 sidecar v2); fixed `${target}.tmp` + rename = 8ca010e25 (stacked in #245, reached main via #244). Both needed for the failure; #90 primary.
- **Replayability:** intro PR size {'files': 91, 'add': 10300, 'del': 475}; mixed: True; visible from diff: partial. #90 is a 91-file PR; #245 has the atomic-tmp commit but a fixed tmp name looks like an improvement in its diff.
- **Difficulty:** 5/5. Needs cross-file knowledge that each IPC call builds a new LibraryVault, so per-instance guards do not help; the tmp-name collision is only visible under concurrency.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer) (squash of 5 commits). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 24. asset-identity-minted-per-vault-instance (LIB-B8)

- **Defect:** ensureIdentity guarded minting with a per-instance identityInFlight map, but every IPC call creates a new LibraryVault, so concurrent list calls minted different assetIds for a legacy/hand-imported item and one write lost.
- **User-visible failure:** Library shows assetId X while disk holds Y; clicking the card opens /library/X which then reports the item missing and bounces back.
- **Fix:** PR #367; commits 3377f73
- **Class:** race/ordering
- **Introduced by:** PR #90; commits e1637cfdc; confidence high; omission: False. identityInFlight lines (84, 194-223) blame to e1637cfdc (#90).
- **Replayability:** intro PR size {'files': 91, 'add': 10300, 'del': 475}; mixed: True; visible from diff: partial. The comment in the diff claims 'two parallel describe(id) calls never mint two ids'; the per-instance flaw needs the IPC factory (library/index.ts currentVault) from outside the diff.
- **Difficulty:** 5/5. Cross-file reasoning: guard scope vs object lifetime in another module.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 25. camera-bubble-not-draggable

- **Defect:** The camera bubble window was made movable:false and its -webkit-app-region drag removed on purpose in 'size the camera bubble from its fixed corner' (spec decision 6 read as 'not draggable'). That also removed dragging on full-screen recordings, where it used to work.
- **User-visible failure:** The camera bubble can no longer be moved before or during a take.
- **Fix:** PR #388; commits aec18960
- **Class:** state machine
- **Introduced by:** PR #384; commits 96447be3, 099fa524; confidence high; omission: False. PR body of #388 names 96447be3 and 099fa524 (both in #384, Fable 5.1 trailer). Behaviour regression by design rather than a coding slip.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. Diff shows movable:false and the deleted drag region, but only the product spec says drag must survive; the spec text itself said 'not draggable'.
- **Difficulty:** 5/5. Requires product intent beyond the diff; the spec in the same PR endorsed the behaviour. The second half of #388 (turn camera off from the bubble) is a feature, not recorded.
- **Found by:** Owner report. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 26. area-crop-uses-ceiling-track-size

- **Defect:** startEngine sized the area crop from screenTrack.getSettings(); for desktop capture Chromium reports the maxWidth/maxHeight ceiling (7680x4320) instead of the delivered frames (3024x1964). The crop scale trackSize/displaySize came out about 5x too big, so drawImage drew a corner.
- **User-visible failure:** Frame (area) recordings play back mostly black with a piece of the selection in the top-left corner.
- **Fix:** PR #390; commits 606828de
- **Class:** platform-specific
- **Introduced by:** PR #377; commits aab7b1fa; confidence medium; omission: False. SZZ strong blames #12 (the getSettings sizing line) but the area crop that makes it visible is aab7b1fa (377, 'crop a recording area in the compositor'), which trusts the same track size. Sibling bug full-display-pillarbox below shares the root line.
- **Replayability:** intro PR size {'files': 85, 'add': 2436, 'del': 221}; mixed: False; visible from diff: partial. Crop math is visible; the false assumption (getSettings = delivered frame size) is a Chromium behaviour not in the diff.
- **Difficulty:** 5/5. Needs Electron/Chromium desktop-capture knowledge and Retina scaling; reasoning about arithmetic alone looks correct.
- **Found by:** Owner (ffprobe of two takes on single-display MacBook), diagnosed by Opus 5.5. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. #377 AI review (issue comment) said the crop arithmetic 'reads correctly' and that areaEncodePlan uses 'the track's measured size'; it did not question getSettings(). The first automatic pass said 'Too large to review in one pass'.

### 27. fullscreen-pillarbox-from-ceiling-size

- **Defect:** Full-display recordings sized the output with fitToCap(7680,4320,1440)=2560x1440 from the ceiling reported by getSettings(), so real 1.54-aspect frames were letterboxed into a 16:9 canvas.
- **User-visible failure:** Full-screen recordings on a MacBook come out 2560x1440 with black side bars instead of the panel's aspect.
- **Fix:** PR #390; commits 606828de
- **Class:** platform-specific
- **Introduced by:** PR #12; commits c3ec7fd0; confidence medium; omission: False. SZZ strong #12 (4 lines): getSettings-based sizing added by 'preserve the screen's real aspect ratio'. Bug latent since July; owner noticed in Oct.
- **Replayability:** intro PR size {'files': 10, 'add': 434, 'del': 195}; mixed: False; visible from diff: partial. Diff shows getSettings() used as the 'measured' size; whether it is truthful for desktop capture is not in the diff.
- **Difficulty:** 5/5. Needs knowing Chromium reports the constraint ceiling for getDisplayMedia/desktop capture.
- **Found by:** Owner (ffprobe of the Screen take), diagnosed by Opus 5.5. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #12 merged 2026-07-02, before the AI reviewer (2026-10-20); no review comments in cache.

### 28. take-records-dead-capture

- **Defect:** If the screen capture ended after the engine resolved but before the cursor session resolved, onError called stopRecording which no-ops (no engine yet) and the start went on to record a dead capture.
- **User-visible failure:** A take that looks fine but contains no live capture.
- **Fix:** PR #395; commits b5481644
- **Class:** race/ordering
- **Introduced by:** PR #133, #17; commits 3d1707f2, c860120a; confidence medium; omission: True. The window exists because #133 (3d1707f2) awaits a cursor session after startEngine; the no-op onError path is #17 (SZZ strong #17, 2 lines).
- **Replayability:** intro PR size {'files': 29, 'add': 1475, 'del': 27}; mixed: False; visible from diff: no. Needs both the onError no-op in #17 and the new await in #133 in view.
- **Difficulty:** 5/5. Interaction of an old no-op handler with a later added await.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 + Sonnet 5.5 (trailers). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #133 merged 2026-09-22, before the AI reviewer.

### 29. closed-window-keeps-pending-take

- **Defect:** Closing the main window mid-countdown did not call hub.forceReset in index.ts, so the pending take (tray state, Esc shortcut, shade) was never released.
- **User-visible failure:** After closing the window during 3-2-1 the tray 'Record' stays disabled and Esc stays captured.
- **Fix:** PR #396; commits df513732
- **Class:** state machine
- **Introduced by:** PR #384, #17; commits 844368a9, c860120a; confidence low; omission: True. Wiring omission in index.ts closed handler. forceReset from #17; pending/countdown state that needs release from #384. SZZ strong #17 only on doc lines. Guess.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: no. Absent code in a far-away file.
- **Difficulty:** 5/5. Missing wiring; hub has the function, index.ts never calls it. PR body notes no unit test covers it.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 30. cursor-track-start-after-take-ended-orphans-sampler (REC-A2 / REC-B4)

- **Defect:** cursorTrackStart awaited the display lookup then started a 125 Hz sampler and global mouse hook without checking the session was still live; an abort/finalize/forceReset landing meanwhile left a tracker nobody stops. #395 already covered abort via abortedSessions; #413 extends it to finalize and forceReset (endedSessions).
- **User-visible failure:** Permanent main-thread polling and a global mouse hook for the rest of the app session after a fast failed start or force-reset.
- **Fix:** PR #413; commits 663cfbf9
- **Class:** resource leak
- **Introduced by:** PR #133; commits 2468bd10c; confidence medium; omission: True. Omission: no liveness check after the await when the handler was wired (2468bd10c, #133 cursor track IPC). #395 (d757058c5) partially fixed abort on 2026-10-27; #413 (this scope) closes the rest. Strong blame points to #395 for the abortedSessions lines only.
- **Replayability:** intro PR size {'files': 29, 'add': 1475, 'del': 27}; mixed: True; visible from diff: partial. #133 is 29 files; the handler is small but the abort race needs the renderer store (other file) to see.
- **Difficulty:** 5/5. Timing race between two IPC calls across renderer and main.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 31. uiohook-start-deadlock

- **Defect:** uiohook-napi 1.5.5 hook_enable() waited on a condvar without a predicate loop and used a second mutex as an is-running flag; on a spurious/early wakeup it joined the hook thread while holding both mutexes, and the hook thread blocked on one of them. uIOhook.start() ran on Electron's main thread.
- **User-visible failure:** Start recording freezes the whole app forever (even quit); only kill -9. Happened twice in normal use.
- **Fix:** PR #414; commits c2a6aab6, f1e35d52
- **Class:** deadlock
- **Introduced by:** PR #134; commits b9b912a0, 3dd4c6a6; confidence medium; omission: False. Hook first started by #134 (dep b9b912a0, ClickHook 3dd4c6a6, wired 26cfad1) on the main thread. The race is in third-party C, upstream PR SnosMe/uiohook-napi#66; SZZ strong blames only rebuild scripts. Latent since 2026-09-22.
- **Replayability:** intro PR size {'files': 11, 'add': 275, 'del': 8}; mixed: False; visible from diff: partial. Diff shows a native hook started synchronously from main; the deadlock itself is inside the dependency and is not reproducible (50k cycles never hit it).
- **Difficulty:** 5/5. Native-library race; only a thread sample proves it. A reviewer could at most flag running a global hook in the main process (follow-up NIW2-541: utilityProcess).
- **Found by:** Owner (two hangs, thread sample) diagnosed by Fable 5.1; two independent reviews (Opus, Codex) of the C patch. **Fixed by:** Claude Fable 5.1 (trailer). Fable found: True; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. #134 merged 2026-09-22, before the AI reviewer.

### 32. cursor-track-tail-cut-uses-late-wall-clock (REC-B8)

- **Defect:** Main cut cursor samples past meta.durationMs+250 where durationMs came from a wall clock started after startEngine (after the 150 ms thumbnail capture), while samples are in video time from t0; the offset consumed the 250 ms margin.
- **User-visible failure:** The cursor freezes 0.1-0.3 s before the end of every recording in the editor and last clicks are lost.
- **Fix:** PR #416; commits 5145f8b2
- **Class:** cross-file contract
- **Introduced by:** PR #143; commits fb044684b; confidence medium; omission: False. The `durationMs + 250` margin in recording-hub.ts and durationMs in recorder-store.ts blame to fb044684b (#143 tail-cut fix, itself co-authored by Claude Fable 5.1); the clock start (Date.now after startEngine) is c860120a7 (#17). Guess: #143 is the PR that built the check on the wrong clock.
- **Replayability:** intro PR size {'files': 17, 'add': 1168, 'del': 10}; mixed: True; visible from diff: partial. #143 is 17 files (inspector, CLI, fixture and fix); needs the recorder-store clock origin from #17.
- **Difficulty:** 5/5. Two clocks with different zero points across renderer and main; only a measurement reveals the offset.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Opus 5.5 (trailer); some branch commits trailed Claude Fable 5.1 (tests/merge only). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 33. spare-overlay-state-lost-before-listener

- **Defect:** Since 11020663 a spare capture overlay learns mode/intent only from main's first screenshot:overlay-state message and renders null before it. A spare still loading when its pick opened was revealed on ready-to-show and sent the state before React's useEffect attached onState; the message was lost.
- **User-visible failure:** Frame recording looks stuck with no error: a screen-sized focused transparent window paints nothing and swallows every click and key.
- **Fix:** PR #418; commits afd007df
- **Class:** race/ordering
- **Introduced by:** PR #402; commits 11020663; confidence high; omission: False. SZZ strong blames #309 on the useEffect lines but only through an indent/reformat; the bug is created by 11020663 (#402, Sonnet 5.5): neutral spare=1 query, state by message only.
- **Replayability:** intro PR size {'files': 26, 'add': 1820, 'del': 504}; mixed: True; visible from diff: partial. The one-shot push from main and the renderer's late effect attach are in different files; PR mixes preloads of overlay and shade.
- **Difficulty:** 5/5. One-shot IPC ordering vs React effect timing across main and renderer.
- **Found by:** Owner terminal log; reproduced by Opus 5.5 with Playwright. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. #402 AI review: 0 findings in 3 batches; said the shade window reuse logic is consistent.

### 34. raise-brings-hidden-bar-back

- **Defect:** BrowserWindow.moveTop() on macOS orders a hidden window back on screen. The countdown calls raiseFloating() -> bar.raise() on the bar (kept hidden between takes), and an Esc cancel never hid the bar.
- **User-visible failure:** Esc during 3-2-1 leaves the control bar on screen reading 'Starting...' over an idle app until the next take.
- **Fix:** PR #419; commits 4bf11e19
- **Class:** platform-specific
- **Introduced by:** PR #384, #377; commits 844368a9, 7b803190; confidence medium; omission: False. raise()/moveTop first added by 7b803190 (#377, SZZ strong 377 3 lines); raiseFloating called during the countdown, before the take, came with 844368a9 (#384). Probed on a bare Electron window.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. moveTop on a hidden window is OS behaviour; the call site is in the diff.
- **Difficulty:** 5/5. Needs macOS/Electron knowledge that moveTop un-hides.
- **Found by:** Owner log; Fable 5.1 probed Electron. **Fixed by:** Claude Fable 5.1 (trailer). Fable found: True; Fable fixed: True.
- **Prior AI reviewer on intro PR:** missed. #377 AI review explicitly called the bar/bubble raise via onShown 'reasonable for Windows'; #384 review had no related finding.

### 35. shutdown-ghost-process-late-windows

- **Defect:** Quit relied on app.quit(). Windows created after the quit began (3 s overlay/shade prewarm timer, overlay re-warm after every pick), a renderer that never answers beforeunload, or a wedged native hook left the process alive with no window and no tray.
- **User-visible failure:** Ghost process after quitting; E2E teardown hang on five release-candidate runs, all 3.5-4.5 s after launch.
- **Fix:** PR #423; commits ad43588c, f46b4fbf
- **Class:** race/ordering
- **Introduced by:** PR #393, #402; commits aa9cfed6, 11020663; confidence medium; omission: True. Prewarm timer OVERLAY_PREWARM_AFTER_LAUNCH_MS and hidden overlay windows came with aa9cfed6 (#393); shade prewarm and spare re-warm with 11020663 (#402). Missing explicit shutdown is omission; SZZ strong only 402/393 single lines.
- **Replayability:** intro PR size {'files': 24, 'add': 1555, 'del': 198}; mixed: False; visible from diff: no. Needs knowledge of Electron quit semantics across several windows.
- **Difficulty:** 5/5. Timing of timers vs quit; not visible in a local diff.
- **Found by:** CI (E2E release-candidate runs, teardown hang) + owner ghost process; analysed by Fable 5.1. **Fixed by:** Claude Fable 5.1 (trailer). Fable found: True; Fable fixed: True.
- **Prior AI reviewer on intro PR:** missed. #393 AI review: 2 minor 'Consider' items, no lifecycle finding; #402 review: 0 findings.

### 36. overlay-keys-heard-after-paint

- **Defect:** FrameBox, ScreenCard, WindowPicker and CaptureOverlay attached their window keydown listener in useEffect, which runs a task after the commit that paints. A key pressed in that gap (Enter right after the box appears) is never heard and not retried.
- **User-visible failure:** Rare dropped Enter/V when the overlay just appeared; flaky test failed Release Desktop at the tag.
- **Fix:** PR #425; commits 41f0e4b9
- **Class:** race/ordering
- **Introduced by:** PR #303, #309; commits 0c49043e, 8967126b; confidence medium; omission: False. PR #303 as mapped is a stacked merge of #306 (66 files, +6178); replay #306 not #303 (docs-only own diff). frame-box useEffect 0c49043e; screen-card/window-picker 8967126b (#309).
- **Replayability:** intro PR size {'files': 66, 'add': 6178, 'del': 326}; mixed: True; visible from diff: partial. The effect hook choice is visible, the consequence needs React scheduling knowledge.
- **Difficulty:** 5/5. React passive-effect timing; only a flaky test showed it.
- **Found by:** CI release-tag test failure (Release Desktop desktop-v0.15.0), analysed by Fable 5.1. **Fixed by:** Claude Fable 5.1 (trailer). Fable found: True; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. #306 merged 2026-10-17 and #309 2026-10-18, both before the AI reviewer; no review comments.

### 37. screenshot-hotkey-destroys-recording (FABLE-#2)

- **Defect:** Global screenshot hotkey ran capture() unconditionally; on success it navigated to the editor, unmounting RecordPage mid-recording and bringing the app to front inside the recording.
- **User-visible failure:** Pressing the screenshot shortcut during a recording orphans it and puts the app window on screen in the video.
- **Fix:** PR #17; commits c860120a
- **Class:** cross-file contract
- **Introduced by:** PR #13; commits 04382f9f8; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission (no activity gate). Capture hotkey, triggerCaptureScreenshot and navigation to the editor were all introduced in PR #13; the page-unmount half is finding 1 from PR #2. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: yes. PR #13 is 105 files but the hotkey/capture/navigation code is in the diff; the interaction with an active recording needs the hub and Record page context.
- **Difficulty:** 4/5. Feature added without considering the recording-active state; reviewer must think of the cross-feature interaction.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 38. fastStart-in-memory-buffers-recording (FABLE-#3)

- **Defect:** Mp4OutputFormat used fastStart 'in-memory', so mediabunny held the entire recording in renderer RAM and nothing reached the disk writer until stop.
- **User-visible failure:** Long recordings OOM-crash the renderer and are entirely lost; any crash/quit loses everything.
- **Fix:** PR #17; commits c860120a
- **Class:** resource leak
- **Introduced by:** PR #2; commits 709819b21; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Strong blame: the fastStart line in recorder-engine.ts comes from 709819b21 (mediabunny engine) in PR #2.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app). One-line option; visible but needs knowledge of mediabunny semantics.
- **Difficulty:** 4/5. Requires library knowledge (in-memory buffers all chunks) contradicting the streaming-writer design elsewhere.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 39. record-page-guards-on-local-status (FABLE-#5)

- **Defect:** Record page lock, start button and auto-start guard key off the local recorder status rather than the hub-broadcast RecordingActivity, so a remounted page allows a second concurrent recording.
- **User-visible failure:** After rescue shortcut + navigating back, Start is enabled mid-recording and starts a second engine over the first.
- **Fix:** PR #17; commits c860120a
- **Class:** state machine
- **Introduced by:** PR #2, #4; commits d0f431c55, d36ae3b19, c372abd69; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Local-status guards in use-recording-setup.ts come from PR #2 (d0f431c55/d36ae3b19); the startAt auto-start guard in record-page.tsx from PR #4 (c372abd69). Primary: #2. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app). #4 (44 files, +6.1k) mixes shortcuts, camera and control-bar work.
- **Difficulty:** 4/5. Requires knowing the documented global-activity invariant and the remount path.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 40. no-recovery-when-recorder-renderer-dies (FABLE-#10)

- **Defect:** Main process has no render-process-gone handler or close guard; the hub activity is cleared only by a renderer-sent recordingStop.
- **User-visible failure:** If the renderer crashes or the window is closed mid-recording, the bar stays with a frozen timer, Dock policy is not restored and the Capture Panel stays locked until restart.
- **Fix:** PR #17; commits c860120a
- **Class:** state machine
- **Introduced by:** PR #2; commits df2927f67, 7ac9f84a8; confidence low; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission (handler missing). Hub (df2927f67) and window lifecycle in main/index.ts (7ac9f84a8) are from PR #2; pick #2 as author of the surrounding logic. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 4/5. Failure-path reasoning: what if the only sender of stop dies.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 41. start-while-finalizing-records-nothing (FABLE-#20)

- **Defect:** isRecording is false during 'finalizing' and the auto-start guard and RecordButton do not cover it; recorder.start() then early-returns because sessionRef is still set.
- **User-visible failure:** Countdown plays and then nothing records, with no error.
- **Fix:** PR #17; commits c860120a
- **Class:** race/ordering
- **Introduced by:** PR #2, #4; commits 5efda2e4d, c372abd69; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. sessionRef early-return from 5efda2e4d (PR #2), auto-start effect from c372abd69 (PR #4). Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. Two large PRs; the interaction only appears with the finalize phase.
- **Difficulty:** 4/5. State-machine gap across hook and page.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 42. main-window-hidden-after-engine-start (FABLE-#24)

- **Defect:** start() awaits startEngine before sending recordingStart, so the hub hides the main window only after capture has begun.
- **User-visible failure:** First ~0.5s and the poster thumbnail of recordings show the Kaipu window.
- **Fix:** PR #17; commits c860120a
- **Class:** race/ordering
- **Introduced by:** PR #2; commits 5efda2e4d; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Order of startEngine then recordingStart blamed to 5efda2e4d (PR #2). Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 4/5. Subtle ordering across renderer and main with visual-only symptom.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 43. window-resize-distorts-recording (FABLE-#25)

- **Defect:** Compositor computes target size once at start and stretches every frame into it; window sources resized mid-recording are squeezed.
- **User-visible failure:** Second half of a recording of a resized window is distorted.
- **Fix:** PR #17; commits c860120a
- **Class:** state machine
- **Introduced by:** PR #12; commits c3ec7fd04; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. recording-compositor.ts fixed-target logic blamed to c3ec7fd04 (PR #12, 'preserve real aspect ratio'), which reworked it. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 10, 'add': 434, 'del': 195}; mixed: False; visible from diff: yes. PR #12 is small (10 files, +434/-195) and well replayable.
- **Difficulty:** 4/5. Needs knowledge that window sources change dimensions at runtime.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 44. stop-during-starting-gap-dropped (FABLE-#39)

- **Defect:** Stop pressed between 'starting' and engine ready is silently dropped (same early-return as finding 19).
- **User-visible failure:** Recording starts anyway after the user pressed Stop.
- **Fix:** PR #17; commits c860120a
- **Class:** race/ordering
- **Introduced by:** PR #2; commits 5efda2e4d, 7f800e570; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Same early-return as finding 19; fixed incidentally by the unified cancel path in #17. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 4/5. Narrow timing window.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 45. rebind-window-close-leaves-shortcuts-unregistered (FABLE-#21)

- **Defect:** Entering shortcut-listening mode calls suspendShortcuts (unregisterAll) and resume is only sent from React effect cleanup, which does not run when the window is destroyed.
- **User-visible failure:** Closing the window while rebinding leaves every global shortcut dead until restart, including the rescue shortcut.
- **Fix:** PR #20; commits 28912ae9
- **Class:** resource leak
- **Introduced by:** PR #4; commits c372abd69; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Strong blame: shortcut-input.tsx suspend/resume added in c372abd69 (PR #4).
- **Replayability:** intro PR size {'files': 44, 'add': 6129, 'del': 82}; mixed: True; visible from diff: yes. Visible in the shortcut-input diff of PR #4 (effect-cleanup-only resume), but PR is 44 files.
- **Difficulty:** 4/5. Requires knowing Electron window destruction skips effect cleanup.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 46. dock-click-does-not-reopen-window (FABLE-#27)

- **Defect:** app 'activate' recreates the window only when getAllWindows() is empty, but hidden control-bar/capture-panel windows persist.
- **User-visible failure:** After closing the main window, clicking the Dock icon does nothing.
- **Fix:** PR #20; commits 28912ae9
- **Class:** platform-specific
- **Introduced by:** PR #2; commits 65473b531, 7ac9f84a8; confidence low; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. The activate line comes from a34ab1d25 (docs migration/scaffold commit, not a PR). Bug requires the persistent hidden windows added in PR #2 (control bar 65473b531, capture panel 7ac9f84a8); #2 chosen as the introducing PR.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. Boilerplate from Electron scaffold; trigger depends on window code elsewhere.
- **Difficulty:** 4/5. macOS-specific plus cross-file window lifecycle.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 47. persisted-settings-no-renderer-broadcast (FABLE-#14)

- **Defect:** Persisted AppSettings notifies only main-process listeners; no renderer broadcast exists, so the control-bar window (never reloaded) keeps a stale Stop-shortcut hint.
- **User-visible failure:** After rebinding Stop, the bar shows the old shortcut which no longer works.
- **Fix:** PR #21; commits 35ea952b
- **Class:** cross-file contract
- **Introduced by:** PR #4; commits c372abd69; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. The focus-refetch workaround (use-shortcut-labels.ts) and the settings-store shortcut notify code are from PR #4 (c372abd69).
- **Replayability:** intro PR size {'files': 44, 'add': 6129, 'del': 82}; mixed: True; visible from diff: partial. PR #4 (44 files) mixes shortcuts, window reachability and camera fixes.
- **Difficulty:** 4/5. Needs knowledge of window lifecycle (showInactive, never remounted) and the documented subscribe pattern.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 48. screenshot-editor-double-composite-on-reexport (FABLE-#4)

- **Defect:** exportPng re-reads the vault file via getBytes on every export; after Save->Overwrite the file already contains the flattened frame+annotations, so Copy or second Overwrite composites the scene again.
- **User-visible failure:** Library item silently corrupted: doubled padding/background and duplicated, shifted annotations; preview still looks fine.
- **Fix:** PR #24; commits d34a40f0
- **Class:** state machine
- **Introduced by:** PR #13; commits 04382f9f8; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. use-image-source.ts getBytes / localReader and overwrite persist both introduced in PR #13 (fix changed lines blame to 04382f9f8).
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: partial. PR #13 is large (105 files) and mixes the whole screenshot feature; the bug arises from combining re-edit + overwrite + repeated export.
- **Difficulty:** 4/5. Needs sequencing reasoning across reader, persist and export over a session.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 49. export-clips-annotations-to-shot-rect (FABLE-#12)

- **Defect:** Export wraps annotations in a clip-path of the shot rectangle while the live SVG layer renders with overflow visible, so annotations in the padding vanish in export.
- **User-visible failure:** Arrow heads, pen strokes or text extending into padding are cut off in the saved/copied PNG.
- **Fix:** PR #24; commits d34a40f0
- **Class:** UI/cosmetic
- **Introduced by:** PR #15; commits 42d1982c2; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. The rcLocal clip-path wrapper blamed to 42d1982c2 (crop tool, PR #15); the preview overflow-visible CSS is from #13/#14.
- **Replayability:** intro PR size {'files': 30, 'add': 2416, 'del': 115}; mixed: True; visible from diff: partial. PR #15 is 30 files +2.4k (crop tool); the clip is a small part. Mismatch with preview CSS requires another file.
- **Difficulty:** 4/5. Preview/export fidelity mismatch spans CSS and compositor.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 50. export-arrow-not-scaled (FABLE-#13)

- **Defect:** roughArrow uses fixed pixel constants (curve offset, jitter, arrowhead length 15) while the export converts coordinates to native pixels and scales other shapes.
- **User-visible failure:** Exported arrows on Retina captures have tiny heads and flat curves, unlike the editor.
- **Fix:** PR #24; commits d34a40f0
- **Class:** cross-file contract
- **Introduced by:** PR #13; commits 04382f9f8; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Strong blame: rough.ts constants (e.g. ah = 15) from 04382f9f8 in PR #13.
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: partial. Needs the compositor scale logic and rough.ts together; PR #13 is 105 files.
- **Difficulty:** 4/5. Scale mismatch between two modules, only visible with display scaling != 1.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 51. crop-padding-desync-preview-export (FABLE-#26)

- **Defect:** In windowed (cropped) mode the frame uses a frozen measured size, so changing padding desynchronizes preview from export.
- **User-visible failure:** Preview shows uneven padding; exported crop differs from what the user saw.
- **Fix:** PR #24; commits d34a40f0
- **Class:** UI/cosmetic
- **Introduced by:** PR #15; commits 42d1982c2; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Strong blame: frameSize state in beautified-frame.tsx from 42d1982c2 (PR #15).
- **Replayability:** intro PR size {'files': 30, 'add': 2416, 'del': 115}; mixed: True; visible from diff: partial. PR #15 is 30 files (+2.4k); needs interaction of crop, padding and ResizeObserver.
- **Difficulty:** 4/5. Stateful layout interaction only reproducible with crop+padding.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 52. editor-export-poster-seek-never-fires

- **Defect:** captureExportThumbnail set video.currentTime = 0 on a <video> already at 0, so 'seeked' never fired; the shared 2s timeout won and the function returned null (replaced by mediabunny CanvasSink-based generateThumbnail).
- **User-visible failure:** Every edited+exported video appeared in the Library with no thumbnail (generic film-strip icon).
- **Fix:** PR #43; commits 00be53b7
- **Class:** race/ordering
- **Introduced by:** PR #28; commits 2f796102; confidence high; omission: False. export-thumbnail.ts (78 removed lines) and use-video-export.ts blamed entirely to #28.
- **Replayability:** intro PR size {'files': 63, 'add': 8737, 'del': 12}; mixed: True; visible from diff: partial. #28 is the 63-file, +8.7k video editor; poor replay. The seek-to-same-time pattern is visible in export-thumbnail.ts but requires knowing 'seeked' does not fire when time is unchanged.
- **Difficulty:** 4/5. Browser-semantics trap (no seeked event when currentTime is unchanged); plausible-looking code with a timeout fallback that hides the failure.
- **Found by:** Reported by user/owner (reproduces on every edit); root cause traced by Opus 4.8. **Fixed by:** Claude Opus 4.8 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 53. auth-password-too-short-reported-as-email-taken

- **Defect:** callCredentialEndpoint mapped every non-ok status to one hardcoded error kind per endpoint without reading the body; better-auth returns 400 PASSWORD_TOO_SHORT for <8 chars.
- **User-visible failure:** Signing up with a 6-char password told the user 'That email is already registered.'
- **Fix:** PR #81; commits d51f8147
- **Class:** cross-file contract
- **Introduced by:** PR #68; commits ce9613b1; confidence high; omission: False. 11 removed lines in auth-client.ts blamed to ce9613b1 (#68).
- **Replayability:** intro PR size {'files': 2, 'add': 204, 'del': 0}; mixed: False; visible from diff: partial. #68 small; needs knowing better-auth's default minPasswordLength=8 (baseConfig sets none).
- **Difficulty:** 4/5. Misleading error mapping visible, but the trigger (server-side default min length) is external knowledge.
- **Found by:** Claude Opus 5 whole-branch review (Important). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 54. auth-lastknownemail-not-persisted

- **Defect:** lastKnownEmail came from a process-local cachedIdentity populated only after a successful call in the current process, so on restart with token on disk and server unreachable it was null; also a throwing unlink in signOut could restore a signed-out session next launch and cachedIdentity was not cleared on confirmed-gone.
- **User-visible failure:** In the offline-after-restart case the 'unknown' account label was empty; a failed token delete could silently re-sign-in a user who signed out.
- **Fix:** PR #81; commits 274be6e9
- **Class:** state machine
- **Introduced by:** PR #69; commits c7f0d906; confidence high; omission: False. 15 removed lines in auth-store.ts blamed to c7f0d906 (#69).
- **Replayability:** intro PR size {'files': 2, 'add': 421, 'del': 0}; mixed: False; visible from diff: partial. #69 contains the whole store; the gap versus the spec's offline scenario is visible only if the spec is read alongside.
- **Difficulty:** 4/5. Needs reasoning across restart/offline scenarios against the spec's intent; behaviour is internally consistent in a single process.
- **Found by:** Claude Opus 5 whole-branch review (Important). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 55. ci-e2e-missing-main-vite-server-url

- **Defect:** Commit c17f54b1 made the Electron main process throw when MAIN_VITE_SERVER_URL is unset (inlined at build time); the E2E CI job never set it.
- **User-visible failure:** All 10 desktop E2E specs failed with firstWindow Timeout 30000ms; every PR was blocked.
- **Fix:** PR #83; commits ba61fc80
- **Class:** CI
- **Introduced by:** PR #81; commits c17f54b1; confidence high; omission: False. Behavior introduced by the explicit server-URL check replacing the non-null assertion in src/main/index.ts (c17f54b1, in #81); the workflow files were not touched by it.
- **Replayability:** intro PR size {'files': 17, 'add': 420, 'del': 71}; mixed: True; visible from diff: partial. #81 has 17 files/+420 and mixes several unrelated fixes; the throw is visible, but the CI workflow impact needs cross-file reading.
- **Difficulty:** 4/5. Cross-file: a code change fails a workflow that is not in the diff.
- **Found by:** Opus 5 while validating #83 (pipeline failure). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 56. screenshots-se-handle-dead-after-wrap

- **Defect:** SE corner handle treated the dragged box height as the target font size, which only holds for one line (textBoxPx returns lines x fs x LH); once the east handle set a wrap width and the label wrapped to N lines the derived size was N times too large and always pinned to the largest level, emitting a no-op patch.
- **User-visible failure:** After dragging the east edge, the text annotation's SE corner handle stopped resizing the text.
- **Fix:** PR #83; commits b4fdc33c
- **Class:** UI/cosmetic
- **Introduced by:** PR #51, #50; commits 4a387b6d, c9018d48, 7bf59ccd; confidence medium; omission: False. 4 removed lines in handles.ts blamed to #14 (original corner formula) but the failure needs wrapped/multi-line text: #50 (multi-line) and #51 (wrap width via E handle). #51 is the PR that makes it reachable via the UI.
- **Replayability:** intro PR size {'files': 7, 'add': 121, 'del': 35}; mixed: False; visible from diff: yes. #51 is 121+/35- over 7 files, a good replay target; the SE-handle formula sits in a file it touches.
- **Difficulty:** 4/5. Requires reasoning that box height now scales with line count while the handle formula assumes one line.
- **Found by:** Owner/Opus 5 while using the editor. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 57. console-dev-no-env-delivery

- **Defect:** Console runs on workerd via @cloudflare/vite-plugin like web-hono but its dev script was a bare vite dev with no env:pull, so its config fell back to empty values (empty admin list denies everyone).
- **User-visible failure:** Console was unusable locally with no route to configure it.
- **Fix:** PR #125; commits 0a1f24cd
- **Class:** config/env
- **Introduced by:** PR #115; commits fb69c15f; confidence low; omission: True. Missing env delivery (omission); console app added in #115.
- **Replayability:** intro PR size {'files': 30, 'add': 12383, 'del': 62}; mixed: True; visible from diff: partial. #115 large mixed PR (30 files +12k).
- **Difficulty:** 4/5. Silent fail-closed fallback; needs workerd runtime reasoning.
- **Found by:** Owner/Opus 5. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 58. cursor-track-tail-cut-floors-duration

- **Defect:** recording-hub cut the cursor track at durationSeconds * 1000, but durationSeconds is Math.floor(elapsedMs/1000), discarding up to ~1 s of real samples/clicks at the end of every recording (fix: unfloored durationMs + 250 ms).
- **User-visible failure:** Cursor/click track ended up to ~1 s before the video ends (observed 24,994 ms on a 25.9 s video), so the cursor froze before the end in the editor.
- **Fix:** PR #143; commits fb044684
- **Class:** data loss
- **Introduced by:** PR #133; commits 2468bd10, 26cfad1a; confidence high; omission: False. maxMs argument lines blamed to 2468bd10 (#133) and 26cfad1a (#134, 1 line reformat/changed).
- **Replayability:** intro PR size {'files': 29, 'add': 1475, 'del': 27}; mixed: False; visible from diff: partial. #133 is 29 files +1475; #133's body even states the cut as 'durationSeconds x 1000'. Visible if the reviewer knows durationSeconds is floored in recorder-store.
- **Difficulty:** 4/5. Cross-file: units/rounding semantics of durationSeconds defined elsewhere; off-by-up-to-1s only visible on real recordings.
- **Found by:** Claude Fable 5.1 (observed with the new cursor-track inspector). **Fixed by:** Claude Fable 5.1 (trailer). Fable found: True; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 59. library-exported-badge-compares-clocks

- **Defect:** Library decided 'exported' via newest.createdAt >= video.editSavedAt, but an export's createdAt is its birthtime (encode start) and exporting always saves the session afterwards, so editSavedAt always lands later; fixed with an exportedSavedAt stamp carried through saves.
- **User-visible failure:** 'Edited · not exported' badge appeared on every export, even directly above a populated Exports list.
- **Fix:** PR #159; commits 0750c51b
- **Class:** state machine
- **Introduced by:** PR #156; commits 9abc19d2, 30829639; confidence high; omission: False. 32 removed lines blamed to #156 (lineage.ts, edit-project-probe.ts, compose-library.ts).
- **Replayability:** intro PR size {'files': 38, 'add': 1760, 'del': 20}; mixed: False; visible from diff: partial. #156 is 38 files/+1760; lineage.ts rule is visible. The ordering fact (export saves session after the encode, birthtime = start) lives in video-editor-page.
- **Difficulty:** 4/5. Timing/ordering semantics across files (fs birthtime vs session write); tests used fixtures that agreed with the rule.
- **Found by:** User/owner prod review of #156 on the first edited recording. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 60. video-preview-clipped-on-short-window

- **Defect:** Preview .content width came from viewport units (min(64vw, 46vh*ratio)) while height was capped by the row (max-height: min(46vh,100%)), so on short windows the box stopped matching the frame ratio and overflow:hidden clipped the bottom.
- **User-visible failure:** On windows shorter than ~850px the bottom of the recorded screen (e.g. last terminal line) was cut off in the editor.
- **Fix:** PR #177; commits 45e882e4
- **Class:** UI/cosmetic
- **Introduced by:** PR #141; commits d491b7d4; confidence high; omission: False. 7 removed CSS lines in preview-stage.module.css blamed to d491b7d4 (#141); width formula originally from #28.
- **Replayability:** intro PR size {'files': 43, 'add': 981, 'del': 113}; mixed: True; visible from diff: partial. #141 is 43 files +981; mixed polish PR. CSS bug requires layout reasoning; jsdom cannot reproduce.
- **Difficulty:** 4/5. Pure layout interaction between viewport and container constraints; invisible to unit tests.
- **Found by:** Owner (reported seeing the last terminal line missing). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 61. video-label-hit-box-ignores-multiline

- **Defect:** Hit test still used text.length*fs*0.55 by fs*1.3 (newlines counted as characters) instead of textBoxPx.
- **User-visible failure:** A tall multi-line label could not be clicked below its first line; the click fell through and started video playback.
- **Fix:** PR #187; commits 4a337db4
- **Class:** UI/cosmetic
- **Introduced by:** PR #184; commits 2c33d5b8; confidence medium; omission: False. Old heuristic from #28; #184 made labels multi-line without updating the hit test.
- **Replayability:** intro PR size {'files': 7, 'add': 238, 'del': 24}; mixed: False; visible from diff: partial. #184 7 files; hit-test code is not in the diff, so the reviewer must grep for other copies of the geometry.
- **Difficulty:** 4/5. Three copies of one geometry; the stale copy is outside the diff.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 62. landing-shortcuts-typed-glyphs-wrong

- **Defect:** Landing page printed typed keyboard glyphs (⌘⇧P start, ⌘⌃4 screenshot, ⌘L library) that read from nothing; real defaults are ⌘⌃C, ⌘⌃X and no library shortcut exists.
- **User-visible failure:** Every shortcut shown on the marketing page was wrong.
- **Fix:** PR #198; commits dac57728
- **Class:** cross-file contract
- **Introduced by:** PR #196; commits cac1fe80, 0c550495; confidence high; omission: False. app-window.tsx/hero.tsx blamed to cac1fe80 and 0c550495 within #196; bindings come from desktop ipc.ts (#13/#4).
- **Replayability:** intro PR size {'files': 94, 'add': 6211, 'del': 357}; mixed: True; visible from diff: partial. #196 is the 94-file marketing rebuild (+6211); poor replay. Wrongness requires comparing with ipc.ts default accelerators in another app.
- **Difficulty:** 4/5. Needs cross-app fact-checking of copy against the desktop defaults.
- **Found by:** Owner/Opus 5 audit of the landing copy. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 63. ci-preview-wrangler-npm-catalog

- **Defect:** preview-web.yml ran wrangler-action without installing wrangler; the action falls back to npm, which cannot parse bun's `catalog:` protocol (EUNSUPPORTEDPROTOCOL), so the preview never reached Cloudflare.
- **User-visible failure:** Preview Web workflow failed on its first run.
- **Fix:** PR #208; commits 6f553ab0
- **Class:** CI
- **Introduced by:** PR #207; commits 5d73a4719; confidence high; omission: True. Missing step; release-web.yml already carried the `bun add -g wrangler` step. Blame on preview-web.yml lines from 5d73a4719.
- **Replayability:** intro PR size {'files': 34, 'add': 1599, 'del': 609}; mixed: True; visible from diff: partial. PR 207 is titled docs(frontend) (web-vitals baseline) and bundles the new workflow commit; the review would have to compare with release-web.yml.
- **Difficulty:** 4/5. Needs knowledge of wrangler-action's npm fallback and the catalog protocol; the sibling workflow is the only hint.
- **Found by:** First real workflow run (run 36938226183). **Fixed by:** Claude Opus 5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 64. ci-web-preview-no-version-url

- **Defect:** kaipu-web wrangler config has routes and no workers_dev; wrangler resolves workers_dev=false, so Version URLs (hosted on workers.dev) cannot exist and the preview workflow grepped output for a URL that was ruled out by config.
- **User-visible failure:** Preview Web run green but reported 'URL: not found'.
- **Fix:** PR #209; commits 976105a7
- **Class:** config/env
- **Introduced by:** PR #207; commits 5d73a4719; confidence low; omission: False. Workflow grep for URL from 5d73a4719 (PR 207); config side (wrangler.jsonc) predates (PR 7 / Initial commit).
- **Replayability:** intro PR size {'files': 34, 'add': 1599, 'del': 609}; mixed: True; visible from diff: partial. Needs wrangler.jsonc in repo context.
- **Difficulty:** 4/5. Cross-file: workflow expectation vs wrangler default resolution.
- **Found by:** Preview Web run #2. **Fixed by:** Claude Fable 5 + Opus 5 (trailers). Fable found: unknown; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 65. web-ui-ships-duplicate-tailwind

- **Defect:** @kaipu/web-ui packaged its own full Tailwind build (side-effect CSS import + libInjectCss + tailwindcss plugin) on top of the app's, duplicating utilities (~52 KB) and letting the package's later base copy override the app's responsive variants.
- **User-visible failure:** Landing downloads utilities twice; responsive variants can lose.
- **Fix:** PR #214; commits a54e07ac
- **Class:** config/env
- **Introduced by:** PR ?; commits 3a06e76f8; confidence high; omission: False. Initial commit (template); not a PR.
- **Replayability:** intro PR size None; mixed: False; visible from diff: no. Not replayable (Initial commit).
- **Difficulty:** 4/5. Build-pipeline interaction.
- **Found by:** Perf investigation (Fable 5 trailer). **Fixed by:** Claude Fable 5 (trailer). Fable found: unknown; Fable fixed: True.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 66. stylex-light-theme-class-never-applied

- **Defect:** StyleX tokens are generated dark-by-default with light values under a createTheme class; applyTheme only flipped [data-theme=light], never applied the lightTheme class, so every @kaipu/ui component rendered dark on a light desktop.
- **User-visible failure:** Light theme: shared buttons, cards, nav rail, recording controls stay dark.
- **Fix:** PR #232; commits 93729415
- **Class:** cross-file contract
- **Introduced by:** PR #212, #215; commits 5c5ffd374; confidence low; omission: True. Strong blame only the old apply-theme.ts (PR 42, 5c5ffd374) which predates StyleX. Real cause is the StyleX token stage (PR 212) plus first shared component (PR 215) without the matching theme hook.
- **Replayability:** intro PR size {'files': 17, 'add': 745, 'del': 140}; mixed: False; visible from diff: partial. Replay PR 215 (Button atom) or PR 212 (tokens).
- **Difficulty:** 4/5. Needs StyleX compile output knowledge (hashed variable class).
- **Found by:** Owner visual check. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PRs 212/215 merged before 2026-10-20.

### 67. plan-capacities-disagree-with-spec

- **Defect:** deriveEntitlements granted Free 1 GB and Pro 25 GB while the accepted spec says Free 250 MB and Pro 15 GB; plan info was duplicated across server, desktop, web and copy.
- **User-visible failure:** Quota and plan copy disagree with the product decision.
- **Fix:** PR #273; commits 5eddfd0d
- **Class:** cross-file contract
- **Introduced by:** PR #92, #84; commits 7ac18652c, 56bd84a9f, adad8c76c; confidence low; omission: False. Constants in cloud-limits.ts/subscription.ts (PR 92); entitlements.ts (PR 84). May be a product decision change rather than a defect: guess.
- **Replayability:** intro PR size {'files': 61, 'add': 4572, 'del': 171}; mixed: True; visible from diff: partial. Needs the spec.
- **Difficulty:** 4/5. Spec-vs-code number mismatch.
- **Found by:** Maintainer (NIW2-232). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 68. legacy-recordings-upload-no-controls

- **Defect:** Legacy POST /api/v1/recordings upload + confirm routes stayed live with none of the v2 controls (quota, entitlement, verified email, kill switch, content-type allowlist, size-bound ticket) and no client calling them (audit F-2).
- **User-visible failure:** Abuse: unauthenticated-by-quota upload path to R2.
- **Fix:** PR #276; commits f34df723
- **Class:** security/abuse
- **Introduced by:** PR #53, #92; commits ff47ef515, 274848df6, cc0055b98; confidence medium; omission: True. Strong blame (195 removed lines) is PR 53, which created the legacy flow; the 'bug' is that PR 92 added the guarded v2 flow without retiring or guarding v1. PR 53 is the code that exists; PR 92 is the omission.
- **Replayability:** intro PR size {'files': 60, 'add': 2168, 'del': 77}; mixed: True; visible from diff: partial. Replay PR 92 (the PR that should have closed v1) or PR 53 (the PR that opened it; whole feature). In PR 53 alone the flow is a feature, not a defect.
- **Difficulty:** 4/5. Needs whole-surface thinking: new controls added on one route while an older sibling route remains unguarded.
- **Found by:** API security audit 2026-10-12 (F-2). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 69. ticket-extend-between-read-and-release-race

- **Defect:** cancelUpload and sweepExpiredReservations read the revision, checked the ticket window in app code, then ran release() as a second statement; a resumed intent could extendTicket and sign a fresh PUT URL in between, so release deleted the object and the new ticket pointed at an unreserved key (reopens F-1).
- **User-visible failure:** Abuse/data accounting: object written after quota release via a client-controlled race.
- **Fix:** PR #342; commits 8ded5c29
- **Class:** race/ordering
- **Introduced by:** PR #276; commits f34df723; confidence high; omission: False. Removed/changed lines are the WIP cancel-upload.ts/sweep-expired-reservations.ts written in f34df72 (PR 276, an unreviewed WIP commit); release() guard in repository from PR 92.
- **Replayability:** intro PR size {'files': 19, 'add': 641, 'del': 357}; mixed: True; visible from diff: yes. PR 276 carries the WIP + spec; the TOCTOU (read, check, then unconditional UPDATE) is visible in cancel-upload.ts of that diff. Mixed with legacy-route removal and cursor schema.
- **Difficulty:** 4/5. Classic check-then-act across two statements; requires knowing extendTicket exists and the client controls both requests.
- **Found by:** Opus 5.5 reviewing the WIP in PR 342 (owner session). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR 276 merged 2026-10-19, before the AI reviewer (2026-10-20). PR 342 cache has no bot comments either.

### 70. capture-overlay-keyboard-focus-last-painted

- **Defect:** Each capture opens one overlay per display and show() makes each window key, so the overlay that painted last held the keyboard even when the frame was on another display; Enter and Cmd+C were ignored.
- **User-visible failure:** Enter/Cmd+C sometimes ignored with multiple displays; auto save/copy looked broken.
- **Fix:** PR #352; commits 81863542
- **Class:** race/ordering
- **Introduced by:** PR #303; commits 7b74d86a2, c590bec88; confidence medium; omission: False. capture-overlay-windows.ts show calls from 7b74d86a2 (PR 303); c590bec88 attempted a partial fix.
- **Replayability:** intro PR size {'files': 69, 'add': 6830, 'del': 318}; mixed: True; visible from diff: partial. PR 303 is titled docs(design) but is a stacked 69-file code PR (GitHub shows 7 files +675).
- **Difficulty:** 4/5. Depends on Electron show() key-window semantics and multi-display paint order.
- **Found by:** User report (two displays). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 71. toast-edit-opens-editor-stale-list

- **Defect:** The toast's Annotate opened the editor without the image because the route resolved the asset id against a library list read before the new shot existed.
- **User-visible failure:** Editor opens empty after toast action.
- **Fix:** PR #354; commits d3ed49b9
- **Class:** race/ordering
- **Introduced by:** PR #309; commits 983a0a009; confidence low; omission: False. Guess: toast + route resolution added in PR 309 (983a0a009); blame not isolated.
- **Replayability:** intro PR size {'files': 86, 'add': 7540, 'del': 1376}; mixed: True; visible from diff: partial. PR 309 huge.
- **Difficulty:** 4/5. Ordering between save, list read and navigation across main/renderer.
- **Found by:** Production audit v0.14.0. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 72. shot-editor-save-marks-dirty-clean-over-new-edit (SHOT-B1)

- **Defect:** persist() ran setDirty(false) (and adopted the saved title) when the async save resolved, with no check that the scene/title changed while the save was in flight, so a concurrent edit was marked clean and lost on navigation.
- **User-visible failure:** User draws an arrow or types a title right after capture while auto-save runs; the edit is silently dropped when leaving the editor with no unsaved-changes prompt.
- **Fix:** PR #360; commits e5b25e63
- **Class:** race/ordering
- **Introduced by:** PR #18; commits c3d0b3699; confidence medium; omission: False. git blame of the parent: `setDirty(false)` after save is c3d0b3699 (#18 'guard destructive exits ... in the editor'); title adopt line is 248ab022d (#256). The unversioned save-then-clean pattern appears with the guard.
- **Replayability:** intro PR size {'files': 7, 'add': 164, 'del': 14}; mixed: False; visible from diff: yes. #18 is small (7 files) and the dirty guard plus persist change are in the diff; needs reasoning about concurrent edits during await.
- **Difficulty:** 4/5. Classic stale-state-after-await race in a React component; requires modelling that edits continue during compositing + IPC.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet (Co-Authored-By trailer, no version). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 73. shot-autoactions-skipped-if-image-loads-before-settings (SHOT-B8)

- **Defect:** The effect that fires auto-save/auto-copy depended only on [imageReady] and returned early when settings-derived actions were still null without marking itself fired, so if the image decoded before getSettings resolved it never re-ran.
- **User-visible failure:** Auto-save/auto-copy silently do not happen for that capture (rare, needs a busy main thread).
- **Fix:** PR #360; commits e5b25e63
- **Class:** race/ordering
- **Introduced by:** PR #194; commits 5cfabaf7a; confidence medium; omission: False. autoActionsRef / `!actions` early-return lines blame to 5cfabaf7a (#194 auto-copy); dependency array [imageReady] to d2dc78c9e (#155). Guess: #194 added the null-actions path; #155 is the alternative.
- **Replayability:** intro PR size {'files': 24, 'add': 526, 'del': 71}; mixed: True; visible from diff: partial. #194 mixes auto-copy with three annotation changes; the effect is small.
- **Difficulty:** 4/5. Timing-dependent (IPC vs image decode); effect deps look correct unless you notice the async source of `actions`.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet (Co-Authored-By trailer, no version). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 74. shot-toast-retry-runs-after-editor-unmount (SHOT-B9b)

- **Defect:** The retry closures passed to reportError captured persist/onCopy from the failing render; pressed after the editor unmounted (e.g. after Discard) they ran with imgRef null (displayedW 0, scale 1), re-saving a discarded capture with display-pixel padding.
- **User-visible failure:** Retry toast after leaving the editor re-creates a discarded screenshot with wrong padding/radius.
- **Fix:** PR #360; commits e5b25e63
- **Class:** state machine
- **Introduced by:** PR #19; commits 2cc79912c; confidence medium; omission: False. retry: () => void persist(opts) lines blame to 2cc79912c (#19 'surface silent failures ... with retry').
- **Replayability:** intro PR size {'files': 13, 'add': 282, 'del': 34}; mixed: True; visible from diff: yes. #19 is a 13-file batch of audit fixes; the retry closure is in the diff.
- **Difficulty:** 4/5. Needs reasoning about toast lifetime vs component lifetime and the compositor fallback scale.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet (Co-Authored-By trailer, no version). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 75. ci-ondemand-review-owner-vs-member

- **Defect:** on-demand review job required author_association == 'OWNER', but on an organization repo GitHub reports the owner as MEMBER, so every @claude comment was skipped.
- **User-visible failure:** @claude comments never started a review.
- **Fix:** PR #365; commits 1070d2b7
- **Class:** CI
- **Introduced by:** PR #355; commits 4668b1c14; confidence high; omission: False. Condition line blamed to 4668b1c14.
- **Replayability:** intro PR size {'files': 8, 'add': 1361, 'del': 1}; mixed: False; visible from diff: partial. PR 355 adds the whole review workflow (+1361). Needs GitHub semantics of author_association in orgs.
- **Difficulty:** 4/5. Platform knowledge (OWNER vs MEMBER in org repos).
- **Found by:** Maintainer: run 39648100277 skipped on #364. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. PR 355 reviewed by its own advisory review (4 notes: docs/adr path, unpinned installer, PR-head script with key, cancel-in-progress); none about author_association.

### 76. trim-no-bounds-overlap-and-past-source-end (VID-B2)

- **Defect:** trimClip clamped only to [0, other edge], knowing neither source duration nor neighbouring clips, so trims could overlap a neighbour (preview loops forever) or extend past the source end (export freezes last frame and desyncs audio).
- **User-visible failure:** Preview loops on overlapped clips; export has a frozen stretch and audio 30 s ahead of video.
- **Fix:** PR #368; commits 850d72c
- **Class:** cross-file contract
- **Introduced by:** PR #28; commits 2f7961021; confidence high; omission: True. trimClip (timeline.ts 109-124) blames to 2f7961021 (#28); bug is a missing bound.
- **Replayability:** intro PR size {'files': 63, 'add': 8737, 'del': 12}; mixed: False; visible from diff: partial. Visible in trimClip, but the failure is in use-preview-playback and export-worker (other files).
- **Difficulty:** 4/5. Needs cross-file reasoning about sourceToTimeline, playback seek and the muxer's audio cursor.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 77. clearing-label-then-clicking-shape-deletes-wrong-shape (SHOT-B5)

- **Defect:** commitText selected the edited label and called removeSelected(), which read selectedId from a stale useCallback closure; when blur fired after a mousedown that selected shape B, B was deleted.
- **User-visible failure:** Clear a re-edited label then click another shape: the other shape vanishes (undo recovers).
- **Fix:** PR #370; commits 267ba28
- **Class:** race/ordering
- **Introduced by:** PR #52; commits 8c823850d; confidence high; omission: False. commitText re-edit branch (lines 316-322, select+removeSelected) blames to 8c823850d (#52 re-edit text labels); removeSelected itself is #13.
- **Replayability:** intro PR size {'files': 8, 'add': 244, 'del': 47}; mixed: False; visible from diff: yes. #52 is 8 files; the interplay requires knowing removeSelected's closure from use-editor-scene.
- **Difficulty:** 4/5. Event ordering (pointerdown select, blur) plus stale closure across two files; audit marked it 'plausible', not run in browser.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 78. screen-single-display-record-noop

- **Defect:** On a lone display, wholeDisplay() answered the record intent with action 'select' (only sets the recording target). After #384 made 'Start recording' always open the selector in the record intent, the one-display shortcut still meant 'set target', so the take never started.
- **User-visible failure:** Record page -> Screen -> Start recording on a single-display Mac: app hides, comes back, no countdown, nothing records. Frame mode worked.
- **Fix:** PR #387; commits 849cb2ff
- **Class:** cross-file contract
- **Introduced by:** PR #384, #377; commits 18711b0b, a04e3882; confidence medium; omission: False. Buggy line (select for record intent) was written in 377 (a04e3882, correct then: Record page only picked a target). It became a bug when 384 (18711b0b, Fable 5.1) changed 'Start recording' to open the selector in record intent. Primary intro = 384, line origin = 377. PR fix body says it dates from spec decision 8.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. #384 is huge and mixed (record modes, camera bubble, metadata, tray). Defect needs the interaction between 18711b0b and the 377 wholeDisplay helper, which the 384 diff only shows as context (not changed).
- **Difficulty:** 4/5. Cross-PR contract: the changed meaning of the record intent is in 384, the stale 'select' answer sits in untouched code from 377.
- **Found by:** Owner testing (single-display MacBook), diagnosed by Opus 5.5. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 79. countdown-clock-before-shade-visible

- **Defect:** The recorder's 1 s setInterval started on the first 'counting' report, but the region countdown is drawn by the shade window, which only shows after loading a renderer. Nothing synchronized clock and display.
- **User-visible failure:** Region countdown reads '3.2..1': the 3 flashes and is replaced by the 2.
- **Fix:** PR #391; commits 55588d94
- **Class:** race/ordering
- **Introduced by:** PR #384; commits 844368a9; confidence medium; omission: True. Fix is mostly additions (new channel). Introduced when 844368a9 ('count down on the chosen region') moved the countdown from the visible Record page to the shade window.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. Need to connect the recorder clock (renderer store) with shade creation (main hub) across two files in the same PR; load latency is runtime behaviour.
- **Difficulty:** 4/5. Cross-process timing: clock in renderer, window load latency in main.
- **Found by:** Owner testing; tied to a record start/stop audit by Opus 5.5. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 80. cancelled-countdown-no-app-activate

- **Defect:** Abandon path of a region countdown only called showMainWindow (show+focus); it never re-asserted the Dock policy nor app.focus({steal:true}) as the stop path does. The shade is click-through, so clicking activates the app below.
- **User-visible failure:** Cancel the 3-2-1 (Esc, tray, shortcut) on a single-display Mac: main window returns with grey traffic lights, no keyboard focus, Dock entry missing ('stuck').
- **Fix:** PR #392; commits 39ebbb52
- **Class:** state machine
- **Introduced by:** PR #384; commits 844368a9, 9a968b72; confidence high; omission: False. SZZ strong 384 (3 lines) in recording-hub.ts; 9a968b72 ('never strand the app around a region countdown') is the commit that wrote the incomplete reveal (both Fable 5.1).
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. Absence of app.focus visible by comparison with applyStopWindowState elsewhere in the same file.
- **Difficulty:** 4/5. Needs to compare with the stop path and know macOS activation semantics with click-through windows.
- **Found by:** Owner release-blocker report, then Opus 5.5 audit (D1-D5). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 81. cancel-during-starting-waits-on-hung-engine

- **Defect:** A cancel while the store was 'starting' only set a flag read after startEngine settled. If any await hung (getUserMedia, play(), output.start, recordingCreate) the cancel was never honoured and nothing timed out.
- **User-visible failure:** Main window hidden, bar frozen at 0:00, Stop dead, every new start refused until the app is killed.
- **Fix:** PR #392; commits fe7a6932
- **Class:** deadlock
- **Introduced by:** PR #17; commits c860120a; confidence medium; omission: True. SZZ strong #17 (21 lines of recorder-store.ts, the engine lift-out that wrote the flag-based cancel); also #133 (cursor session await) and #377. PR text calls it pre-existing.
- **Replayability:** intro PR size {'files': 23, 'add': 1733, 'del': 552}; mixed: True; visible from diff: partial. Hang needs a never-settling await, which a reviewer must imagine; #17 is a large audit batch.
- **Difficulty:** 4/5. Absence of a timeout/cancel path; reasoning about awaits that never settle.
- **Found by:** Opus 5.5 audit of the record start/stop path. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #17 merged 2026-07-02, before the AI reviewer.

### 82. compositor-play-uncapped-hang

- **Defect:** The compositor's (and thumbnail's) video.play() on a capture track had no timeout; play() only settles once a frame arrives, so a frameless track hangs startEngine. #390's 1.5 s cap on measureFrameSize only moved the hang to the compositor.
- **User-visible failure:** Record start hangs forever on a capture that never delivers a frame (same stuck state as D2).
- **Fix:** PR #392; commits 3713e8cd
- **Class:** deadlock
- **Introduced by:** PR #12; commits c3ec7fd0; confidence medium; omission: True. 'await video.play()' in recording-compositor.ts first appeared in #12 (c3ec7fd0); SZZ strong #12 (7 lines). The sizing play() with cap came from #390.
- **Replayability:** intro PR size {'files': 10, 'add': 434, 'del': 195}; mixed: False; visible from diff: partial. Uncapped play() visible in the diff; knowing it never settles without frames is platform knowledge.
- **Difficulty:** 4/5. Needs knowledge that HTMLMediaElement.play() on a live track waits for the first frame.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #12 merged 2026-07-02, before the AI reviewer.

### 83. bar-shows-before-ready-after-hide

- **Defect:** ControlBarWindow.show() created a window whose ready-to-show handler showed it unconditionally. A fast failed start or early Stop called hide() (a no-op before the window exists), then ready-to-show showed it.
- **User-visible failure:** Bar floats over the idle app with a Stop that does nothing (first take of a session).
- **Fix:** PR #395; commits 2d00eb79
- **Class:** race/ordering
- **Introduced by:** PR #2; commits 65473b53; confidence low; omission: False. Unconditional showInactive in ready-to-show comes from the control-bar window factory in the initial import (#2). It only became reachable often after #384/#393 made early cancel/failed starts common. Guess.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. Poor replayability: #2 is the initial import (276 files).
- **Difficulty:** 4/5. Electron window lifecycle timing (ready-to-show vs hide).
- **Found by:** Opus 5.5 audit of the start/stop path. **Fixed by:** Claude Opus 5.5 + Sonnet 5.5 (trailers). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #2 predates the AI reviewer.

### 84. stale-lookup-acts-on-next-take

- **Defect:** The displayIdForSource lookup of a cancelled take A could resolve after take B started and call bar.show / replace B's area shade; no per-take generation.
- **User-visible failure:** Bar moves and the region shade of the new take is replaced (more likely with countdown Off).
- **Fix:** PR #395; commits d757058c
- **Class:** race/ordering
- **Introduced by:** PR #384; commits 844368a9, 9a968b72; confidence medium; omission: True. Missing guard; the shade.show inside the .then (blame 9a968b72/844368a9, both 384) is what lets it replace the next take's shade. Lookup itself #2.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. Async continuation mutating shared window state, in a very large PR.
- **Difficulty:** 4/5. Needs reasoning about two overlapping takes.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 + Sonnet 5.5 (trailers). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 85. cursor-tracker-starts-after-abort

- **Defect:** recordingAbort arriving before cursorTrackStart finished its display lookup found nothing to discard; the tracker (60 Hz sampling) and global mouse hook then started with nobody to stop them.
- **User-visible failure:** Cursor tracker + global mouse hook keep running while idle until quit (battery, privacy-relevant hook).
- **Fix:** PR #395; commits d757058c
- **Class:** resource leak
- **Introduced by:** PR #133; commits 2468bd10; confidence high; omission: True. Handler awaiting displayIdForSource then starting the tracker was wired in 2468bd10 (#133, Opus 5 trailer); SZZ strong #133 (1 line) plus #19/#392 context.
- **Replayability:** intro PR size {'files': 29, 'add': 1475, 'del': 27}; mixed: False; visible from diff: partial. Check-after-await missing; abort handler and start handler are in the same file.
- **Difficulty:** 4/5. Cross-handler ordering (abort vs async start).
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 + Sonnet 5.5 (trailers). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #133 merged 2026-09-22, before the AI reviewer.

### 86. renderer-crash-in-countdown-leaves-app-hidden

- **Defect:** render-process-gone called forceReset which did not reveal the app that a prepared region countdown had hidden.
- **User-visible failure:** Kill/crash of the renderer during 3-2-1 leaves the app invisible.
- **Fix:** PR #396; commits df513732
- **Class:** state machine
- **Introduced by:** PR #384; commits 844368a9; confidence medium; omission: True. Hiding the app for the region countdown is #384; the crash reset path predates it.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. Two code paths (countdown hide, crash reset) that need joining.
- **Difficulty:** 4/5. Cross-feature interaction.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 87. dead-renderer-take-handles-and-session-id-reuse

- **Defect:** RecordingWriter had no way to release open file handles of a dead renderer's takes, and renderer session ids (counter from 0) repeated after a restart, colliding with stale sessions.
- **User-visible failure:** Open handles after crash; a new take can collide with a stale session id.
- **Fix:** PR #396; commits 679568c3, 1ace9f4f
- **Class:** resource leak
- **Introduced by:** PR #2, #17; commits 106020fc, c860120a; confidence low; omission: True. Writer from #2; per-renderer counter in #17. Mostly omission. In the fix PR the AI reviewer caught that releaseAll was never called (fixed 1ace9f4f).
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: False; visible from diff: no. Initial import, poor replayability.
- **Difficulty:** 4/5. Cross-process lifecycle.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #2/#17 predate the AI reviewer. (On the fix PR #396 the reviewer did catch 'releaseAll is never called'.)

### 88. drag-out-copies-whole-file-across-volumes (LIB-B12 (a))

- **Correction 2026-11-02:** the introducing commit `749df1bc8` is not reachable from PR #269's head (`3159fb1c`); it reached `main` through PR #286 (`feat/NIW2-218-background-export`). The held-out replay of #269 confirmed the diff never touches `drag-copies.ts`. Read "#269" below as "#286".

- **Defect:** createDragCopy hard-linked into os.tmp/kaipu-drag, so a vault on another volume (EXDEV) or exFAT fell back to copyFile of the whole export before startDrag.
- **User-visible failure:** Dragging a titled export out from an external-drive vault stalls for seconds (or fails on ENOSPC) before the drag begins.
- **Fix:** PR #412; commits 3f729bd
- **Class:** platform-specific
- **Introduced by:** PR #269; commits 749df1bc8; confidence high; omission: False. All 18 changed lines of drag-copies.ts blame to 749df1bc8 (#269 drag exports under their title).
- **Replayability:** intro PR size {'files': 12, 'add': 1198, 'del': 26}; mixed: True; visible from diff: yes. #269 is 12 files mixing the export presets pipeline and drag-out.
- **Difficulty:** 4/5. Needs platform knowledge (EXDEV, FAT hard links) and the custom-vault feature.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 89. close-quit-guard-timeout-leaves-hub-recording-and-stale-listener (REC-B5)

- **Defect:** The close/quit guards closed or quit after a 5 s timeout without forceReset (hub stayed 'recording') and left their ipcMain.once(recordingStop) listener registered, which later closed the window the user got back.
- **User-visible failure:** After a slow finalize, hub reports 'already recording' until restart and the next take's stop closes the main window; quit mid-copyFile can leave a truncated mp4 in the vault.
- **Fix:** PR #413; commits 4514e8fe
- **Class:** state machine
- **Introduced by:** PR #17, #18; commits c860120a7, c3d0b3699; confidence high; omission: False. Close guard setTimeout+ipcMain.once blames to c860120a7 (#17); quit guard to c3d0b3699 (#18). #17 primary.
- **Replayability:** intro PR size {'files': 23, 'add': 1733, 'del': 552}; mixed: True; visible from diff: yes. #17 is 23 files +1733/-552 (lift recording engine out of page mount); the guard is a ~8-line block.
- **Difficulty:** 4/5. Needs knowing once() listeners persist and that closed does not reset the hub.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 90. dev-run-shares-userdata-with-installed

- **Defect:** A dev run and the installed app both named themselves kaipu-record, so they shared one userData dir: single-instance lock, auth.enc, settings.json, device id.
- **User-visible failure:** Opening the installed app while dev runs quits it at once (and the reverse); a dev-server session leaks into production.
- **Fix:** PR #428; commits 651da6b0
- **Class:** config/env
- **Introduced by:** PR #305, #333; commits 1197417f, ad20b60c; confidence low; omission: True. Single-instance lock added by 1197417f (mapped to #305); shared auth.enc session by ad20b60c (#333). No SZZ strong lines. Guess.
- **Replayability:** intro PR size {'files': 45, 'add': 1634, 'del': 219}; mixed: True; visible from diff: no. Omission: nothing separates dev from packaged.
- **Difficulty:** 4/5. Needs knowing Electron derives userData and lock from package.json name.
- **Found by:** Owner (SingletonLock on his machine). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #305 (2026-10-18) and #333 (2026-10-19) merged before the AI reviewer.

### 91. sidecar-read-error-mints-new-assetid (NIW2-568 (follow-up of LIB-B1/#367))

- **Defect:** LibraryVault.sidecar() returned {} on any read or JSON error, so ensureIdentity treated the item as legacy, minted a new assetId and the next write persisted it; compose-library then cleared the cloud association.
- **User-visible failure:** A transient EIO/EACCES, truncated sidecar or evicted cloud-synced file silently loses the item's title, tags, edit links and cloud link.
- **Fix:** PR #439; commits c59e58fb, e9c8961c
- **Class:** data loss
- **Introduced by:** PR #90; commits e1637cfdc; confidence high; omission: False. catch { return {}; } is 7ac9f84a8 (#2), but it became harmful when e1637cfdc (#90) added lazy assetId minting on empty sidecars and compose-library (0debf7721, #90) cleared the cloud link; #367 deliberately kept the behaviour. #90 primary.
- **Replayability:** intro PR size {'files': 91, 'add': 10300, 'del': 475}; mixed: True; visible from diff: partial. #90 is a 91-file PR; the harm requires reading sidecar() and ensureIdentity together.
- **Difficulty:** 4/5. Swallowed error plus a downstream consumer that treats empty as legacy; spans library-vault and compose-library.
- **Found by:** unknown (not in the 2026-10-15 audit docs; related to LIB-B1 evidence and LIB-B6 pattern). **Fixed by:** Claude Sonnet 5.5 (trailer) with Claude Opus 5.5 follow-up commit. Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR #90 merged before the AI reviewer existed. The reviewer ran on the fix PR #439 and raised 2 Consider findings on the fix itself (untested metadataIssue branch; quarantine set never cleared), both fixed in e9c8961c.

### 92. camera-bubble-chrome-leaks-into-first-frames

- **Defect:** The bubble's hover chrome (outline, size label, grip, close) hid only once the take was 'active'; that broadcast reaches the bubble window after capture started, so a resting pointer could leave the chrome in the first frames.
- **User-visible failure:** Pink outline and controls on the webcam circle in the first frames of the video.
- **Fix:** PR #453; commits b0f9062b
- **Class:** race/ordering
- **Introduced by:** PR #384; commits 099fa524; confidence high; omission: False. SZZ strong 384 (099fa524, hover chrome, Fable 5.1). The commit message says 'None of it renders once a recording starts, so the bubble on screen is the one in the video'.
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: partial. Condition 'active' only; pending state not considered.
- **Difficulty:** 4/5. Cross-window timing (broadcast arrives after capture starts).
- **Found by:** Owner report NIW2-588. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 93. stop-ignored-during-countdown (FABLE-#19)

- **Defect:** useScreenRecorder.stop() early-returns when no engine exists; the countdown is owned a level up and only cleared by the page Stop button.
- **User-visible failure:** Stop shortcut during the countdown does nothing; recording starts anyway.
- **Fix:** PR #17; commits c860120a
- **Class:** state machine
- **Introduced by:** PR #2; commits 5efda2e4d, 7f800e570; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Early-return in use-screen-recorder.ts blamed to 5efda2e4d; countdown ownership from 7f800e570, both PR #2. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 3/5. Ownership split between two hooks.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 94. camera-bubble-in-screenshot (FABLE-#22)

- **Defect:** captureWindowHooks.beforeCapture hides only the panel and main window; the always-on-top camera bubble remains in the screencapture region.
- **User-visible failure:** Screenshot includes the floating webcam bubble.
- **Fix:** PR #17; commits c860120a
- **Class:** UI/cosmetic
- **Introduced by:** PR #13; commits 04382f9f8; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. captureWindowHooks written in PR #13; camera bubble window from #2/#4.
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: yes. Hook visible in PR #13; bubble existence is in earlier code.
- **Difficulty:** 3/5. Needs awareness of the always-on-top bubble from another feature.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 95. start-shortcut-reveals-window-mid-recording (FABLE-#23)

- **Defect:** triggerStartRecording never checks hub activity and calls showMainWindow during a recording.
- **User-visible failure:** Window pops into the recording with a live sidebar, no feedback.
- **Fix:** PR #17; commits c860120a
- **Class:** state machine
- **Introduced by:** PR #4; commits c372abd69; confidence high; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. triggerStartRecording blamed to c372abd69 (PR #4). Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 44, 'add': 6129, 'del': 82}; mixed: True; visible from diff: partial. PR #4 mixes many changes; activity state is defined elsewhere (hub, PR #2).
- **Difficulty:** 3/5. Missing guard against global state.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 96. chunk-write-failures-only-logged (FABLE-#7)

- **Defect:** recordingWrite handler only console.error's writer.write rejections; the recorder keeps encoding and finalize reports success on a truncated file.
- **User-visible failure:** Disk full mid-recording goes unnoticed; a corrupt or truncated video is saved as success.
- **Fix:** PR #19; commits 2cc79912
- **Class:** data loss
- **Introduced by:** PR #2; commits df2927f67; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Strong blame on the console.error line: df2927f67 (recording hub) in PR #2.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: yes. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app). The swallowed error is visible in the hub commit diff.
- **Difficulty:** 3/5. Fire-and-forget write plus a catch that only logs; needs cross-process reasoning about who observes the failure.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 97. settings-written-non-atomically (FABLE-#28)

- **Defect:** settings.json and preferences.json are written with direct writeFileSync; a crash leaves a truncated file, load() resets to defaults and mints a new deviceId.
- **User-visible failure:** Settings and shortcuts reset and analytics identity changes after a crash mid-write.
- **Fix:** PR #19; commits 2cc79912
- **Class:** data loss
- **Introduced by:** PR #2; commits 780d81d1a, 7ac9f84a8; confidence medium; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. settings-store persist (780d81d1a) and vault-location write (7ac9f84a8), both PR #2.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: yes. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 3/5. Classic non-atomic write; needs thinking about crash semantics.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 98. vault-folder-change-empties-library (FABLE-#30)

- **Defect:** chooseVaultDirectory persists the new path with no validation, migration or warning; list and media resolution then use the new empty folder.
- **User-visible failure:** Library appears empty and open playback breaks after changing the recordings folder.
- **Fix:** PR #22; commits 41c0cc0b
- **Class:** data loss
- **Introduced by:** PR #2; commits 7ac9f84a8, 64b109f47; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. chooseVaultDirectory authored in 7ac9f84a8 (PR #2).
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: yes. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 3/5. Design gap across IPC, library and media protocol.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 99. auth-web-typecheck-errors-hidden

- **Defect:** Renderer auth code (errorCopyKey returning bare string where t() needs a literal union; test mocks typed unknown) failed typecheck:web, but every task's verification only ran typecheck:node and vitest (esbuild strips types).
- **User-visible failure:** bun run build failed (4 TS errors); the app could not be built for manual verification.
- **Fix:** PR #77; commits c671553a
- **Class:** CI
- **Introduced by:** PR #73; commits 780dbbdb, 997e2753; confidence medium; omission: False. No removed lines (type annotation fixes); errorCopyKey in #73, use-auth-status.test.ts in #72. Fix commit c671553a is the one merged via #75's stack.
- **Replayability:** intro PR size {'files': 3, 'add': 237, 'del': 0}; mixed: False; visible from diff: partial. #73 diff shows errorCopyKey returning string; whether t() demands a literal union depends on the typed i18n helper elsewhere.
- **Difficulty:** 3/5. Type error that only a type-aware check catches; code reads fine.
- **Found by:** Sonnet 5 / orchestrator running bun run build. **Fixed by:** Claude Sonnet 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 100. auth-panel-stale-form-mode

- **Defect:** AccountPanel never reset its form `mode` to 'closed' after a successful sign-in/sign-up; fixed with a useEffect on the signed-in transition.
- **User-visible failure:** After signing out, the stale, still-filled sign-in/sign-up form reappeared instead of the 'Sign in'/'Create account' buttons.
- **Fix:** PR #79; commits 7807c94f
- **Class:** state machine
- **Introduced by:** PR #73; commits 780dbbdb; confidence high; omission: True. Missing reset logic (omission); strong blame on 780dbbdb account-panel.tsx where mode state is defined.
- **Replayability:** intro PR size {'files': 3, 'add': 237, 'del': 0}; mixed: False; visible from diff: yes. #73 is 237 lines/3 files, base is the previous stack branch.
- **Difficulty:** 3/5. Requires mentally simulating the sign-in then sign-out lifecycle across a status hook and local state; tests mocked that transition.
- **Found by:** Sonnet 5 during Task 12 manual verification. **Fixed by:** Claude Sonnet 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 101. auth-signed-out-flash-on-load

- **Defect:** useAuthStatus defaulted to signed-out with pending=false until the initial getAuthStatus() resolved, so AccountPanel rendered the signed-out buttons for an already-signed-in user.
- **User-visible failure:** Brief flash of 'Sign in'/'Create account' buttons on load for signed-in users.
- **Fix:** PR #79; commits 7807c94f, 2e627bca
- **Class:** race/ordering
- **Introduced by:** PR #72; commits 997e2753, 780dbbdb; confidence high; omission: False. use-auth-status.ts initial pending state (997e2753, #72) and account-panel.tsx closed-branch (780dbbdb, #73).
- **Replayability:** intro PR size {'files': 2, 'add': 210, 'del': 0}; mixed: False; visible from diff: yes. #72 is 210 lines/2 files; initial-state default is visible. Related latent issue (initial promise has no catch so pending would stick) was found in the fix itself and not counted.
- **Difficulty:** 3/5. Timing issue invisible with instant mocked promises; needs reasoning about initial-state semantics.
- **Found by:** Sonnet 5 during Task 12 manual verification. **Fixed by:** Claude Sonnet 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 102. verification-email-state-lost-on-remount

- **Defect:** 'Verification email sent' lived in React.useState inside CapacityCard (remounted on each cloud-screen visit), a failed send fell back to 'idle' indistinguishable from not clicking, and Refresh was rendered before any email was sent.
- **User-visible failure:** Leaving and returning to the Cloud screen re-enabled the resend button and dropped the 'check your inbox' line; failed sends showed nothing.
- **Fix:** PR #120; commits eacc93d9
- **Class:** state machine
- **Introduced by:** PR #107, #111; commits 1e6484ae, c64f0ec8; confidence medium; omission: False. 13 lines blamed to 1e6484ae (#107 resend action) and 3 to c64f0ec8 (#111 refresh button, always rendered).
- **Replayability:** intro PR size {'files': 42, 'add': 1076, 'del': 15}; mixed: True; visible from diff: partial. #107 is 42 files +1076 (transactional email); #111 is 3 files and replays well for the always-visible Refresh.
- **Difficulty:** 3/5. Component lifecycle issue (unmount resets state) that needs knowing how the card is mounted.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 103. web-two-headers-on-roadmap-and-legal

- **Defect:** __root.tsx chose chrome with pathname === '/', but /roadmap and the legal pages bring their own LandingNav/Footer, so they rendered two headers, two footers and nested <main> (fix: route staticData shell and a PublicShell component).
- **User-visible failure:** /roadmap showed two headers, two footers and a nested <main>; legal pages had duplicated headers and legal links.
- **Fix:** PR #126; commits 4df313c4
- **Class:** UI/cosmetic
- **Introduced by:** PR #122, #102; commits b1ecd499, 5f273250; confidence high; omission: False. Roadmap lines blamed to #122 (20) and legal-page.tsx to #102 (52); root condition from the initial commit/#7.
- **Replayability:** intro PR size {'files': 12, 'add': 464, 'del': 5}; mixed: False; visible from diff: partial. #122 (12 files +464) replays well; the duplicate chrome is visible only with __root.tsx in view (unchanged by the PR).
- **Difficulty:** 3/5. Interaction with an unmodified root layout file.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 104. export-poster-from-source-not-rendered-output

- **Defect:** Export hook derived the exported recording's poster by decoding the first frame of the original source blob instead of the rendered output; the export worker now encodes a JPEG of the first composed frame.
- **User-visible failure:** Library card of an edited export showed footage the user had cut away; latent privacy leak once blur/cover regions are burned in at export.
- **Fix:** PR #132; commits 191c4f57
- **Class:** data loss
- **Introduced by:** PR #43; commits 00be53b7; confidence medium; omission: False. use-video-export.ts generateThumbnail(sourceBlob) lines blamed to #43 (4) and #28 (4). #43 rewired the poster to the shared primitive but kept the source blob input.
- **Replayability:** intro PR size {'files': 8, 'add': 362, 'del': 88}; mixed: False; visible from diff: yes. #43 is 8 files +362/-88 and replays well; it is visible that the poster input is sourceBlob, the semantic wrongness is a design judgement.
- **Difficulty:** 3/5. Semantic: needs recognizing the poster should reflect the edited output; no failure signal in tests.
- **Found by:** Opus 5 during video-editor v2 audit. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 105. record-page-holds-microphone-open

- **Defect:** useMicrophones opened a real getUserMedia({audio:true}) stream on every mount just to unlock device labels for enumerateDevices, then stopped it.
- **User-visible failure:** Opening the Record page (default route, every launch) turned on the OS microphone indicator and moved the user's audio meter although nothing was recording.
- **Fix:** PR #181; commits 415f6ca6
- **Class:** resource leak
- **Introduced by:** PR #2; commits d0f431c5; confidence high; omission: False. 11 removed lines in use-microphones.ts blamed to d0f431c5 (#2 initial record feature).
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. #2 is the 276-file initial import; poor replay. The always-prime behavior was deliberate and test-asserted.
- **Difficulty:** 3/5. Deliberate-looking workaround; the harm is a privacy-visible OS indicator, not a failing test.
- **Found by:** Owner report ('se mueve mi audio...'). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 106. video-label-drawn-twice-under-editor

- **Defect:** While the inline editor was open the label kept rendering underneath the textarea (the screenshot editor skips it via a.id === editing?.id ? null : ...), and selection outline/handles were drawn on both.
- **User-visible failure:** Editing a video label showed the same words twice a hair apart, hard to read.
- **Fix:** PR #185; commits ae7b5150
- **Class:** UI/cosmetic
- **Introduced by:** PR #184; commits 2c33d5b8; confidence medium; omission: True. Omission (guard not ported); #28 weak blame; the behaviour appeared when #184 made labels editable with a textarea overlay.
- **Replayability:** intro PR size {'files': 7, 'add': 238, 'del': 24}; mixed: False; visible from diff: yes. #184 is 238+/24- over 7 files; a reviewer comparing against the screenshot editor's pattern could catch it.
- **Difficulty:** 3/5. Requires comparing with the sibling screenshot editor to notice a missing line.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 107. video-label-reopen-shows-one-line

- **Defect:** Reopening a multi-line label showed one line because the textarea starts at rows={1} and auto-grow lives in onInput, which never fires for a prefilled value.
- **User-visible failure:** Editing an existing multi-line label showed only the first line until the user arrowed down.
- **Fix:** PR #187; commits 859e0080
- **Class:** UI/cosmetic
- **Introduced by:** PR #184; commits 2c33d5b8; confidence medium; omission: True. Omission of the sizing effect that the screenshot editor has (ported behaviour incomplete).
- **Replayability:** intro PR size {'files': 7, 'add': 238, 'del': 24}; mixed: False; visible from diff: yes. #184 introduced the textarea editor; missing sizing effect visible against the sibling implementation.
- **Difficulty:** 3/5. Needs knowledge that onInput does not fire for prefilled values and comparison with the screenshot editor.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 108. annotation-handles-visible-while-editing-text

- **Defect:** Resize handles stayed drawn (and hit-tested) from the stored label geometry while the inline text editor was open, so the box deformed around the editor and an invisible corner could rescale the font mid-edit.
- **User-visible failure:** While typing in a text label the selection box/handles drew mismatched and could be grabbed.
- **Fix:** PR #194; commits d056bd4c
- **Class:** UI/cosmetic
- **Introduced by:** PR #52, #51; commits 8c823850, 4a387b6d; confidence low; omission: True. Missing guard; blame points at #14 annotation-layer lines (handle drawing). Guess: bug appears once labels were re-editable in place (#52) with wrap-resizable boxes (#51).
- **Replayability:** intro PR size {'files': 8, 'add': 244, 'del': 47}; mixed: False; visible from diff: yes. #52 is 244+/47- over 8 files.
- **Difficulty:** 3/5. Interaction between editing state and handle rendering/hit-test across two code paths in one file.
- **Found by:** Owner (annotation fixes, #194). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 109. annotation-long-word-overflows-box

- **Defect:** textLines kept a word wider than the text box whole (documented as overflowing on its own line), so the text escaped the box that outline, hit-test and export measure from.
- **User-visible failure:** Text label spills outside its frame in editor and export.
- **Fix:** PR #194; commits b28fb22a
- **Class:** UI/cosmetic
- **Introduced by:** PR #51; commits 4a387b6d; confidence high; omission: False. Doc comment and logic in tools.ts textLines from 4a387b6d (PR 51); PR 189 touched adjacent code.
- **Replayability:** intro PR size {'files': 7, 'add': 121, 'del': 35}; mixed: False; visible from diff: partial. Small PR; behaviour is stated in a code comment, so a reviewer would see it as intentional.
- **Difficulty:** 3/5. Design choice stated explicitly; defect only appears with later consumers.
- **Found by:** Opus 5 during annotation work. **Fixed by:** Claude Opus 5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 110. vault-sidecar-write-not-atomic

- **Defect:** writeMeta overwrote the sidecar in place, so a crash mid-write truncated it; truncated sidecar reads back as {} and loses title, identity and tags.
- **User-visible failure:** Rare loss of item title/identity/tags after a crash.
- **Fix:** PR #244; commits 8ca010e2
- **Class:** data loss
- **Introduced by:** PR #90; commits e1637cfd; confidence low; omission: False. writeMeta lines from e1637cfd (PR 90) and 64b109f4 (PR 2). Same commit also fixes tags accepting unknown/path-like ids, but that code is in PR 244 itself.
- **Replayability:** intro PR size {'files': 91, 'add': 10300, 'del': 475}; mixed: False; visible from diff: partial. PR 90 is huge: poor replay.
- **Difficulty:** 3/5. Non-atomic write pattern, visible on read.
- **Found by:** Opus 5.5 review of PR 244. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 111. retry-pending-deletes-starvation

- **Defect:** retryPendingDeletes listed `deleting` rows with a limit and only then skipped rows whose ticket window was open; enough deferred deletes filled every page so nothing settled, including deletes whose R2 call had really failed.
- **User-visible failure:** Cloud copies stay in 'deleting' forever; storage not freed.
- **Fix:** PR #342; commits 8ded5c29
- **Class:** state machine
- **Introduced by:** PR #276; commits f34df723; confidence high; omission: False. Filter-after-limit introduced in retry-pending-deletes.ts change of the WIP commit f34df72.
- **Replayability:** intro PR size {'files': 19, 'add': 641, 'del': 357}; mixed: True; visible from diff: yes. Same PR 276 as the race above.
- **Difficulty:** 3/5. Pagination then filter is visible, but the starvation scenario needs thinking about queue fill.
- **Found by:** Opus 5.5 reviewing the WIP in PR 342. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 112. capture-never-opens-editor-when-autosave

- **Defect:** decideAfterCapture opened the editor only when screenshotSave was 'manual' while the default is 'auto', so a Capture showed the toast instead of the editor.
- **User-visible failure:** Capture shortcut shows a toast, not the editor, with default settings.
- **Fix:** PR #354; commits d3ed49b9
- **Class:** state machine
- **Introduced by:** PR #309; commits 8c8404ca4; confidence medium; omission: False. after-capture-policy.ts / capture-handler.ts 8c8404ca4 (PR 309); setting default in PR 155.
- **Replayability:** intro PR size {'files': 86, 'add': 7540, 'del': 1376}; mixed: True; visible from diff: partial. PR 309 is huge: poor replay.
- **Difficulty:** 3/5. Branch on setting vs default is visible but intent unclear without spec.
- **Found by:** Production audit of capture flow (v0.14.0). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 113. tag-registry-wiped-on-unreadable-tags-json (LIB-B6)

- **Defect:** TagRepository.read() mapped every failure (corrupt JSON, newer version, EIO/EACCES) to 'no registry' and ran importLegacy(), which returns [] without writing; the next tag write then replaced tags.json with a single tag.
- **User-visible failure:** All user-defined tags vanish after a transient read error or a registry synced from a newer build; items keep orphan tagIds.
- **Fix:** PR #358; commits f522276e
- **Class:** data loss
- **Introduced by:** PR #245; commits ce8c22510; confidence high; omission: False. All 19 removed/changed lines in tag-repository.ts blame to ce8c22510 (tags-as-entities registry). #245 is a stacked PR that reached main via #244 (c2pr says 244); #245 is the real PR (base branch night/niw2-157). The `catch { return this.importLegacy(); }` in read() is in that commit.
- **Replayability:** intro PR size {'files': 52, 'add': 3920, 'del': 162}; mixed: True; visible from diff: yes. Stacked PR mixing tags registry, Library filters, app icon derivation and docs plans; bug is a 5-line read() in a new 266-line file. Replay #245 head, not #244.
- **Difficulty:** 3/5. A catch-all around JSON.parse+readFile looks natural; the harm needs reasoning about what importLegacy returns and that later writes use the empty list.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet (Co-Authored-By trailer, no version). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 114. recording-finalize-strands-part-in-tmpdir (REC-B6)

- **Defect:** RecordingWriter.finalize closed and deleted the session before creating the vault folder and moving the .part, so if mkdir/rename/copyFile failed the finished take stayed in os.tmpdir() with no way to recover (abort became a no-op); a failed copy could also leave a partial <id>.mp4 in the vault.
- **User-visible failure:** Unplugged/unwritable vault at stop time: the finished recording is lost (invisible kaipu-rec-*.mp4.part in tmp), user only sees a generic 'couldn't save'.
- **Fix:** PR #359; commits 18a764ef
- **Class:** data loss
- **Introduced by:** PR #2; commits 106020fc4; confidence high; omission: False. STRONG blame 14 lines to #2 (106020fc4 'positional MP4 disk writer + finalize to vault'). Order close->delete->mkdir->move is in the original finalize.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. #2 is the initial 276-file import; the finalize function is readable in the diff but buried in 15.8k added lines. Poor replayability.
- **Difficulty:** 3/5. Ordering of side effects in one function; error path (mkdir failure) must be imagined and its consequence (session gone, abort no-op) traced across writer and renderer store.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet (Co-Authored-By trailer, no version). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 115. shot-discard-deletes-manual-copy-keeps-autosaved (SHOT-B4)

- **Defect:** savedId was used both as 'item this editor is bound to' and 'item auto-save created'; after 'Save copy' rebound it to the copy, the still-visible Discard button deleted the copy and kept the auto-saved original.
- **User-visible failure:** Discard after Save copy deletes the user's chosen copy with no confirmation.
- **Fix:** PR #360; commits e5b25e63
- **Class:** state machine
- **Introduced by:** PR #155; commits d2dc78c9e; confidence medium; omission: False. Discard/autoSaved state came with d2dc78c9e (#155 auto-save with Discard); persist rebinding setSavedId is from #13 (04382f9f8). Buggy interaction is created by #155 adding Discard on top.
- **Replayability:** intro PR size {'files': 20, 'add': 692, 'del': 17}; mixed: False; visible from diff: yes. Feature PR #155 (20 files); needs spotting that persist() from earlier code rebinds savedId.
- **Difficulty:** 3/5. Two meanings of one state variable; need to read persist() in the same file.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet (Co-Authored-By trailer, no version). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 116. shot-editor-clicks-dropped-while-busy (SHOT-B9a)

- **Defect:** Copy/Save/Export used a `busy` ref that returned early, so a click during another export was silently dropped with no feedback or disabled state.
- **User-visible failure:** Copy click during auto-save does nothing; user pastes the previous clipboard thinking it worked.
- **Fix:** PR #360; commits e5b25e63
- **Class:** state machine
- **Introduced by:** PR #13; commits 04382f9f8; confidence medium; omission: False. busy ref lines blame to 04382f9f8 (#13, screenshots v1); later handlers (#194, #259) copied the pattern.
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: yes. #13 is a 105-file feature PR.
- **Difficulty:** 3/5. Silent early return is visible in the diff but its UX consequence needs thought.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet (Co-Authored-By trailer, no version). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 117. screenshot-orphan-png-when-sidecar-write-fails (SHOT-B3 (second half))

- **Defect:** saveScreenshotToVault wrote the PNG then the sidecar; if writeMeta failed for a NEW screenshot the PNG stayed, and the caller's retry minted a second id leaving an orphan duplicate.
- **User-visible failure:** Failed save followed by retry yields a duplicate item and a stray PNG.
- **Fix:** PR #367; commits 3377f73
- **Class:** data loss
- **Introduced by:** PR #309; commits 8c8404ca4; confidence low; omission: True. Missing cleanup (pure addition in fix). The write sequence was moved into screenshot-save.ts by 8c8404ca4 (#309); originally in screenshot-ipc.ts from #13. Guess: #309 since that is the code being replayed.
- **Replayability:** intro PR size {'files': 89, 'add': 8025, 'del': 1389}; mixed: True; visible from diff: yes. #309 is an 89-file mode rewrite.
- **Difficulty:** 3/5. Error-path rollback omission; reviewer must ask what happens after the second write fails.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 118. trim-start-handle-runs-away-from-pointer (VID-B1)

- **Defect:** sourceTimeFromPointer computed from the entry's CURRENT sourceStart, which changes on every live trim update, so each pointermove re-added the pointer-to-handle offset.
- **User-visible failure:** Dragging the left trim handle 1 px makes the trim jump several seconds; the start trim runs away.
- **Fix:** PR #368; commits 850d72c
- **Class:** state machine
- **Introduced by:** PR #28; commits 2f7961021; confidence high; omission: False. Strong blame: timeline-strip.tsx lines 284-307 all to 2f7961021 (#28).
- **Replayability:** intro PR size {'files': 63, 'add': 8737, 'del': 12}; mixed: False; visible from diff: yes. #28 is the 63-file video editor; bug is visible by reading timeline-strip pointer handlers and the page's handleTrim feedback.
- **Difficulty:** 3/5. Needs tracing a feedback loop through parent state re-render, but the code is local.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 119. trim-drag-no-pointercancel-handling (VID-B7)

- **Defect:** Clip trim, slide-duration and overlay-lane drags had no onPointerCancel/onLostPointerCapture handlers (other lanes do), so an aborted gesture left snapshot set and the editor stuck 'interacting'.
- **User-visible failure:** After a cancelled drag, undo/redo/split/delete silently do nothing and autosave never schedules.
- **Fix:** PR #368; commits 850d72c
- **Class:** state machine
- **Introduced by:** PR #28; commits 2f7961021; confidence high; omission: True. Missing handlers; blame to the surrounding timeline-strip/overlay-lane code in 2f7961021 (#28).
- **Replayability:** intro PR size {'files': 63, 'add': 8737, 'del': 12}; mixed: False; visible from diff: yes. Same #28 diff; other lanes in the same PR show the correct pattern.
- **Difficulty:** 3/5. Inconsistency with sibling lanes in the same diff is a hint.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 120. trim-drag-clamps-overlays-on-every-live-frame (VID-B8)

- **Defect:** handleTrim/handleSlideDuration called clampOverlays(controller.scene.overlays, duration) on every pointermove, reading the already clamped live scene, so shortening then lengthening within one drag permanently truncated or dropped annotations.
- **User-visible failure:** Annotations are cut or deleted by a trim drag that goes shorter and back; only undo restores them.
- **Fix:** PR #368; commits 850d72c
- **Class:** state machine
- **Introduced by:** PR #28; commits 2f7961021; confidence high; omission: False. video-editor-page.tsx lines 849 and 868 blame to 2f7961021 (#28).
- **Replayability:** intro PR size {'files': 63, 'add': 8737, 'del': 12}; mixed: False; visible from diff: yes. In the #28 diff.
- **Difficulty:** 3/5. Needs noticing that the input is the live scene, not the drag-start snapshot.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 121. screenshot-hotkey-during-recording-toast-in-hidden-window (SHOT-B7)

- **Defect:** During a take the main window is hidden; the screenshot shortcut was forwarded to the renderer, whose 'finish the recording first' guard showed a toast in the hidden window, so main never gave visible feedback.
- **User-visible failure:** User presses the screenshot shortcut while recording and sees nothing.
- **Fix:** PR #374; commits 801a362
- **Class:** cross-file contract
- **Introduced by:** PR #303; commits e0b6acea4; confidence medium; omission: True. Missing main-side hub check; the renderer-only guard was added in e0b6acea4 (#303 typed capture contract). c2pr assigns it to #303 which is titled docs(design) but carries code.
- **Replayability:** intro PR size {'files': 7, 'add': 675, 'del': 15}; mixed: True; visible from diff: partial. prs.json says #303 is 7 files +675 (docs); the code commit e0b6acea4 alone is 18 files +457/-119. Mixed docs+code; verify head commits before replay.
- **Difficulty:** 3/5. Needs knowing that the hub hides the window (other file) and that toasts are renderer-local.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 122. control-bar-shown-after-take-stopped

- **Defect:** The displayIdForSource(...).then callback called bar.show() with no check that the take is still active (the shade branch had the check).
- **User-visible failure:** A Stop or failed start landing before desktopCapturer.getSources resolves (100-500 ms) leaves the always-on-top bar over an idle app.
- **Fix:** PR #392; commits a179a00c
- **Class:** race/ordering
- **Introduced by:** PR #384; commits 844368a9; confidence medium; omission: False. SZZ strong 384 (1 line), the unguarded bar.show moved into the .then by 844368a9. The lookup itself dates from #2 (b49ec598).
- **Replayability:** intro PR size {'files': 136, 'add': 9155, 'del': 634}; mixed: True; visible from diff: yes. Unguarded async continuation next to a guarded one in the same block.
- **Difficulty:** 3/5. Stale async continuation; needs noticing the guard is on the wrong half.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. AI reviewer ran on #384 in 11 batches (7 findings: Size chip arrow keys, doc comment, ON/OFF i18n, throttled camera change, P-then-V ratio, armed pending start, test name). None touches this defect.

### 123. input-throw-strands-starting

- **Defect:** recorder-store switched status to 'starting' before resolveInput() ran; a throw (e.g. no source) left the store in 'starting' and beginEngine never ran.
- **User-visible failure:** Spinner stays, Esc registered system-wide, tray shows a pending take, window hidden, new starts refused.
- **Fix:** PR #392; commits e483ff9c
- **Class:** state machine
- **Introduced by:** PR #17; commits c860120a; confidence medium; omission: False. SZZ strong #17 (1 line) in recorder-store.ts; countdown-end code from #17, extended in #384/#391.
- **Replayability:** intro PR size {'files': 23, 'add': 1733, 'del': 552}; mixed: True; visible from diff: yes. State set before a throwing call; visible in the countdown-end function.
- **Difficulty:** 3/5. Ordering of state change vs fallible call.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #17 merged 2026-07-02, before the AI reviewer.

### 124. ci-verify-runs-empty-scripts-test

- **Defect:** PR 375 deleted scripts/claude-review.test.ts, the only test under scripts/, but check-workflows still ended with `bun test ./scripts/`, which exits 1 when no files match.
- **User-visible failure:** bun run verify and every release gate failed on main at its first step.
- **Fix:** PR #394; commits a66ba66c
- **Class:** CI
- **Introduced by:** PR #375; commits 534d6c98; confidence high; omission: True. Deleted-test side effect; the surviving script line is untouched by 375.
- **Replayability:** intro PR size {'files': 7, 'add': 32, 'del': 1266}; mixed: False; visible from diff: partial. Pure deletion PR; the stale caller is in package.json, outside the diff.
- **Difficulty:** 3/5. Needs grep for remaining users of the deleted test.
- **Found by:** Failing verify on main. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** caught. PR 375 review: 'Should fix (correctness): Deleting the only scripts/ test breaks check-workflows' (listed under Outside the diff).

### 125. control-bar-stale-saving-state

- **Defect:** The control bar is hidden, not destroyed, between takes and kept its last state ('Saving...'); nothing reset it when a new take started.
- **User-visible failure:** Next take shows the previous take's 'Saving...' while the engine acquires screen/mic (up to 10 s), reading as stuck.
- **Fix:** PR #395; commits 2d00eb79
- **Class:** state machine
- **Introduced by:** PR #2; commits 65473b53, bb10e8af; confidence low; omission: True. Missing reset; bar-window-reuse design is #2. Became noticeable when #384/#392/#393 lengthened/visible 'starting'. Guess.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: no. Initial import; no reset logic to see.
- **Difficulty:** 3/5. Stale UI state across reuse of a hidden window.
- **Found by:** Owner report. **Fixed by:** Claude Opus 5.5 + Sonnet 5.5 (trailers). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #2 predates the AI reviewer.

### 126. cancel-in-create-gap-starts-engine

- **Defect:** After #392 tracked the start as a PendingStart, a cancel landing while recordingCreate was pending was not rechecked when it resolved, so startEngine opened screen and mic for a take that was already gone.
- **User-visible failure:** Screen and mic stay open (recording indicator on) after Stop/cancel during file creation.
- **Fix:** PR #396; commits 20577a68
- **Class:** resource leak
- **Introduced by:** PR #392; commits fe7a6932; confidence high; omission: False. PendingStart.created awaited then startEngine called with no pendingStart!==start recheck; the structure is fe7a6932 (#392, Opus 5.5).
- **Replayability:** intro PR size {'files': 12, 'add': 502, 'del': 65}; mixed: False; visible from diff: yes. Small, focused PR; await followed by a use with no recheck is visible in recorder-store.ts.
- **Difficulty:** 3/5. Needs tracing the cancel path across the new await.
- **Found by:** Opus 5.5 audit of the hub/store/engine/writer. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. #392 AI review (1 finding): 10 s start timeout may fire during OS permission prompt; also mentioned discardStart not ending the cursor-track session. It did not flag the unchecked gap after recordingCreate.

### 127. stop-keeps-encoding-through-poster-wait

- **Defect:** engine.stop() awaited the poster-frame race (up to THUMBNAIL_STOP_WAIT_MS=1 s) before stopping the video/audio sources, so frames and samples after the Stop request were encoded.
- **User-visible failure:** Recording runs about 1 s past Stop; video/audio longer than the displayed duration.
- **Fix:** PR #396; commits 4de289c8
- **Class:** race/ordering
- **Introduced by:** PR #393; commits 47254561; confidence high; omission: True. THUMBNAIL_STOP_WAIT_MS and the poster wait on stop were added by 47254561 ('take the poster frame off the start', #393). SZZ weak 393.
- **Replayability:** intro PR size {'files': 24, 'add': 1555, 'del': 198}; mixed: False; visible from diff: yes. The new wait in stop() before the sources are stopped is visible in the diff.
- **Difficulty:** 3/5. Needs to read stop() ordering; no test of post-Stop frames.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** missed. #393 AI review: 2 'Consider' items (log control chars, constant placement); said it found no correctness problems.

### 128. metadata-failure-leaves-orphan-mp4

- **Defect:** finalize moved the .mp4 into the vault before writing its sidecar; a metadata/thumbnail failure left an orphan .mp4 in the vault with no sidecar.
- **User-visible failure:** Orphan video in the library; the take is not salvageable from staging.
- **Fix:** PR #396; commits 335ddd23, a743ca0f
- **Class:** data loss
- **Introduced by:** PR #2; commits 106020fc; confidence medium; omission: False. SZZ strong #2 (9 lines): move-then-writeMeta order in the original disk writer. #359 only added staging.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. Initial import.
- **Difficulty:** 3/5. Error path ordering.
- **Found by:** Opus 5.5 audit. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #2 predates the AI reviewer.

### 129. picked-mic-not-remembered

- **Defect:** Recording settings lived only in main's memory since e1f36936, so every launch started with no microphone and the renderer took microphones[0] (the first enumerated device).
- **User-visible failure:** Mic on picks the iPhone (Continuity) instead of the Yeti the owner had chosen, after every restart.
- **Fix:** PR #408; commits 640f43bf, 4d183449, 8c5c69e2
- **Class:** state machine
- **Introduced by:** PR #2; commits e1f36936; confidence medium; omission: True. e1f36936 (single source of truth for recording settings) is in #2. Omission: picked device never persisted, fallback microphones[0].
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: no. Initial import.
- **Difficulty:** 3/5. Product-level gap, not a visible coding error.
- **Found by:** Owner report. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #2 predates the AI reviewer.

### 130. tag-editor-paste-and-quick-removes-use-stale-list (LIB-B2)

- **Defect:** TagEditor built every onAssign from the `assigned` ids captured at render; a multi-tag paste called onAssign per piece from the same old list (only the last survived) and quick chip removals before the first save landed re-added the first one.
- **User-visible failure:** Pasting 'design, demo, ' keeps only the last tag; removing two chips quickly brings one back.
- **Fix:** PR #411; commits 479507a0, d0a92874
- **Class:** race/ordering
- **Introduced by:** PR #245; commits ce8c22510; confidence high; omission: False. 17 removed lines of tag-editor.tsx and fire-and-forget callers blame to ce8c22510 (tags as entities, in #245 which reached main via #244).
- **Replayability:** intro PR size {'files': 52, 'add': 3920, 'del': 162}; mixed: True; visible from diff: yes. #245 is a 52-file stacked PR; the reduce chain over `add` is visible in the new tag-editor.
- **Difficulty:** 3/5. Stale closure in a reduce chain of async calls; typical but easy to miss when reading the component.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 131. drag-out-second-drag-deletes-first-drag-file (LIB-B12 (b))

- **Defect:** Every createDragCopy first ran cleanupDragCopies() which rm -rf'd the whole kaipu-drag folder, deleting a previous drag's file while a drop target (Finder copy, browser upload) could still be reading it.
- **User-visible failure:** Second drag can break the first drop mid-read.
- **Fix:** PR #412; commits 3f729bd
- **Class:** race/ordering
- **Introduced by:** PR #269; commits 749df1bc8; confidence high; omission: False. Same lines/commit as above.
- **Replayability:** intro PR size {'files': 12, 'add': 1198, 'del': 26}; mixed: True; visible from diff: yes. Same #269 diff; the comment in the code even asserts the drop target has already read the file.
- **Difficulty:** 3/5. Needs thinking about lazy readers of dragged files.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 132. camera-bubble-permanent-pink-border

- **Defect:** .bubble in camera-bubble.module.css had a permanent 3px accent border; the bubble window sits on the recorded screen, so every take recorded the ring.
- **User-visible failure:** Pink ring around the webcam circle in every recording.
- **Fix:** PR #453; commits b0f9062b
- **Class:** UI/cosmetic
- **Introduced by:** PR #2; commits 81c60546; confidence low; omission: False. Border line from the original bubble infra (#2, SZZ strong #2 1 line). #384's hover-chrome work claimed the bubble in the video is clean but left the border. Guess.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. Initial import, poor replayability.
- **Difficulty:** 3/5. Needs to know the window is part of the capture.
- **Found by:** Owner report NIW2-588. **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #2 predates the AI reviewer; #384 reviewer also missed it.

### 133. countdown-cannot-be-cancelled (FABLE-#17)

- **Defect:** Full-screen countdown overlay covers the page, the Record button is disabled, no Escape handler exists and stop is a no-op before the engine exists.
- **User-visible failure:** User cannot abort the 3-2-1 countdown; a junk recording starts anyway.
- **Fix:** PR #17; commits c860120a
- **Class:** state machine
- **Introduced by:** PR #2; commits d0f431c55, 7f800e570; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission (no cancel path). Overlay (d0f431c55) and countdown wiring (7f800e570) in PR #2. Later fixes whose SZZ blames #17-era recorder-store/main code (hypothesis: follow-ups, not verified bug-by-bug): #392 (cancelled/failed record start strands app), #396 (release cancelled/closed/crashed takes), #386/#391 (countdown), #413 (main-side resources); #46 (post-record detail race) is instrumentation/defense-in-depth, not a proven #17 regression.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: yes. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 2/5. UX gap visible in the overlay/hook diff.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 134. editor-no-unsaved-changes-guard (FABLE-#8)

- **Defect:** Screenshot editor holds annotations and the unsaved capture in component state with no navigation blocker, so any navigation destroys them.
- **User-visible failure:** Annotations and the never-saved screenshot are lost silently when the user clicks away or presses another hotkey.
- **Fix:** PR #18; commits c3d0b369
- **Class:** data loss
- **Introduced by:** PR #13; commits 04382f9f8; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. Editor page and the 'future guard' comment in the router were written in PR #13.
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: yes. Absence of a guard is visible; router.tsx comment names it as future work.
- **Difficulty:** 2/5. Known gap flagged in a comment; product rule 'never lose progress' makes it findable.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 135. cmd-q-mid-recording-quits-silently (FABLE-#11)

- **Defect:** before-quit only unregisters shortcuts, destroys the tray and flushes analytics; it does not check for an active recording.
- **User-visible failure:** Cmd+Q or tray Quit mid-recording discards the whole recording with no confirmation.
- **Fix:** PR #18; commits c3d0b369
- **Class:** data loss
- **Introduced by:** PR #2; commits 7ac9f84a8; confidence low; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. before-quit handler written in 7ac9f84a8 (PR #2), later touched by #4.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: partial. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 2/5. Common-sense missing guard once a recording feature exists; but the hub is far from the quit handler.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 136. editor-save-copy-swallow-failures (FABLE-#6)

- **Defect:** persist() and onCopy() in the screenshot editor use try/finally without catch; callers use void, so rejections are unhandled and nothing is shown.
- **User-visible failure:** Failed save/copy (drive unplugged, disk full) gives no feedback; user closes editor believing it was saved.
- **Fix:** PR #19; commits 2cc79912
- **Class:** data loss
- **Introduced by:** PR #13; commits 04382f9f8; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. screenshot-editor-page.tsx persist/onCopy blamed to PR #13 (04382f9f8).
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: Later PR #360 (screenshot editor save races) blames #19 lines in the editor: possible follow-up from the fix, unverified.; visible from diff: yes. Visible in the PR #13 diff (missing catch) though the PR is large (105 files).
- **Difficulty:** 2/5. Missing error handling in a few lines; plain from the diff.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 137. library-list-failure-shown-as-empty (FABLE-#18)

- **Defect:** use-local-library refresh() catches any listLocalRecordings failure and sets an empty list.
- **User-visible failure:** Unreachable vault shows 'No recordings yet', indistinguishable from data loss.
- **Fix:** PR #19; commits 2cc79912
- **Class:** data loss
- **Introduced by:** PR #2; commits 6074ca228; confidence high; omission: False. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Strong blame: 6074ca228 (library feature) in PR #2.
- **Replayability:** intro PR size {'files': 276, 'add': 15860, 'del': 1161}; mixed: True; visible from diff: yes. PR #2 is the initial 276-file import (individual commits preserved in history but the PR replays as the whole app).
- **Difficulty:** 2/5. Visible swallow-all catch.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 138. duplicate-shortcut-bindings-allowed (FABLE-#29)

- **Defect:** Neither capture nor merge checks a new accelerator against the other bindings; the conflict is mislabelled 'in use by another app'.
- **User-visible failure:** One action's hotkey silently dies and the page blames another app.
- **Fix:** PR #20; commits 28912ae9
- **Class:** state machine
- **Introduced by:** PR #4; commits c372abd69; confidence medium; omission: True. Fix PR is a squash commit holding several findings, so SZZ was restricted to the files/hunks of this finding. Omission. Shortcuts page and settings merge written in PR #4.
- **Replayability:** intro PR size {'files': 44, 'add': 6129, 'del': 82}; mixed: True; visible from diff: yes. Visible in PR #4 diff.
- **Difficulty:** 2/5. Missing validation in a new feature.
- **Found by:** Claude Fable 5 audit (pre-testers audit, adversarially verified). **Fixed by:** Claude Opus 4.8 (1M context) (Co-Authored-By trailer; PR body 'Generated with Claude Code'). Fable found: True; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged 2026-06 (before AI reviewer, added 2026-10-20); review cache for the PR is empty.

### 139. web-tab-title-hardcoded-spanish

- **Defect:** SITE_TITLE and legal route titles were hardcoded Spanish strings in lib/seo.ts; og:locale pinned to es_PE; default locale was es.
- **User-visible failure:** Browser tab title stayed Spanish even with the language switcher on English.
- **Fix:** PR #126; commits 4df313c4
- **Class:** UI/cosmetic
- **Introduced by:** PR #103; commits 9727b958; confidence high; omission: False. seo.ts and __root.tsx lines blamed to #103 (86 strong).
- **Replayability:** intro PR size {'files': 25, 'add': 194, 'del': 12}; mixed: False; visible from diff: yes. #103 is 25 files +194; the hardcoded title is visible in lib/seo.ts.
- **Difficulty:** 2/5. Hardcoded Spanish copy in head metadata; visible but easy to overlook.
- **Found by:** Owner. **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 140. annotation-long-word-overflows-box

- **Defect:** textLines kept an over-long word whole, so it ran past the text box that selection outline, hit-test and export measure from (now breaks like overflow-wrap: break-word).
- **User-visible failure:** A long unbroken word overflowed the label box in the screenshot editor, export and video overlay.
- **Fix:** PR #194; commits b28fb22a
- **Class:** UI/cosmetic
- **Introduced by:** PR #51; commits 4a387b6d; confidence medium; omission: True. Mostly missing logic in the wrap function added by #51 (6 strong lines in tools.ts); #189 later touched it (3 lines).
- **Replayability:** intro PR size {'files': 7, 'add': 121, 'del': 35}; mixed: False; visible from diff: yes. #51 introduced the word-wrap function; edge case of over-long words is checkable from the diff.
- **Difficulty:** 2/5. Classic word-wrap edge case; visible to a careful reader.
- **Found by:** Owner (annotation fixes, #194). **Fixed by:** Claude Opus 5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

### 141. ci-preview-environment-says-production

- **Defect:** preview-web.yml declared `environment: production`, so the GitHub run page announced 'Deploying to production' for a job that only runs `wrangler versions upload`.
- **User-visible failure:** Misleading safety signal on a non-deploying job.
- **Fix:** PR #208; commits 6f553ab0
- **Class:** CI
- **Introduced by:** PR #207; commits 5d73a4719; confidence high; omission: False. environment line from 5d73a4719.
- **Replayability:** intro PR size {'files': 34, 'add': 1599, 'del': 609}; mixed: True; visible from diff: yes. Low severity; visible in workflow.
- **Difficulty:** 2/5. Misleading label, visible but judgement call.
- **Found by:** First real workflow run. **Fixed by:** Claude Opus 5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 142. asset-cursor-unvalidated

- **Defect:** GET assets cursor was z.string() and reached the DB layer unvalidated, so a malformed cursor produced a driver error instead of a 400 (audit F-9).
- **User-visible failure:** 500/driver error on a crafted cursor.
- **Fix:** PR #276; commits f34df723
- **Class:** cross-file contract
- **Introduced by:** PR #97; commits a6db5b7c4; confidence high; omission: False. cloud.contract.ts line `cursor: z.string().optional()` blamed to a6db5b7c4 (PR 97).
- **Replayability:** intro PR size {'files': 14, 'add': 472, 'del': 158}; mixed: False; visible from diff: yes. Small PR; contract and repository decodeCursor in one diff.
- **Difficulty:** 2/5. Opaque cursor accepted as free string; low severity, visible by reading the contract.
- **Found by:** API security audit 2026-10-12 (F-9). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: unknown; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. AI reviewer started 2026-10-20; introducing PR merged earlier (rev cache has no bot comments).

### 143. screenshot-overwrite-not-atomic (LIB-B10 / SHOT-B3)

- **Defect:** writeImage overwrote <id>.png in place with writeFile (truncate then write); ENOSPC/EIO/crash mid-write destroyed the only copy, and a concurrent media-protocol read could stream a shorter file than content-length.
- **User-visible failure:** Save -> Overwrite on a full disk or dropping external drive leaves an empty/partial screenshot; original and edit both gone.
- **Fix:** PR #367; commits 3377f73
- **Class:** data loss
- **Introduced by:** PR #13; commits 04382f9f8; confidence high; omission: False. writeImage line blames to 04382f9f8 (#13 screenshots v1).
- **Replayability:** intro PR size {'files': 105, 'add': 6280, 'del': 164}; mixed: True; visible from diff: yes. #13 is a 105-file feature PR; writeImage is a 3-line function next to atomic writeMeta in the same file at that time (only later made atomic).
- **Difficulty:** 2/5. A plain writeFile for overwrite of the sole copy is a known anti-pattern, visible locally.
- **Found by:** Opus auditor (audit 2026-10-15). **Fixed by:** Claude Sonnet 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. Introducing PR merged before the AI reviewer existed (2026-10-20); review cache is empty.

### 144. pause-resume-during-finalizing

- **Defect:** pauseRecording/resumeRecording only checked engine and clock, so a bar Pause racing the Stop shortcut paused the engine mid-flush and moved the store out of 'finalizing'.
- **User-visible failure:** Pause during saving could corrupt/stall the finalize and the store state.
- **Fix:** PR #395, #396; commits b5481644, 20577a68
- **Class:** state machine
- **Introduced by:** PR #17; commits c860120a; confidence medium; omission: False. SZZ strong #17 on '!engine || !clock' guard lines. Fixed twice (#395 and #396 hit the same lines).
- **Replayability:** intro PR size {'files': 23, 'add': 1733, 'del': 552}; mixed: True; visible from diff: yes. Guard missing the status check; visible in the function.
- **Difficulty:** 2/5. Missing state guard.
- **Found by:** Opus 5.5 audits (twice). **Fixed by:** Claude Opus 5.5 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. #17 predates the AI reviewer.

### 145. edited-title-hardcoded-spanish

- **Defect:** Exported edit's title suffix was hardcoded '(editado)' in use-video-export instead of a localized message (fixed with videoEditor.editedTitle).
- **User-visible failure:** Edited-video titles read '(editado)' in Spanish even when the UI language is English.
- **Fix:** PR #44; commits 48089ee6
- **Class:** UI/cosmetic
- **Introduced by:** PR #28; commits 2f796102; confidence medium; omission: False. use-video-export.ts lines blamed to #28 (6 strong). #32 (i18n stage 2, propagated translations) missed this string, which is a secondary contributor.
- **Replayability:** intro PR size {'files': 63, 'add': 8737, 'del': 12}; mixed: True; visible from diff: yes. #28 is large; the literal string is plainly visible in the diff.
- **Difficulty:** 1/5. Hardcoded Spanish string in an otherwise i18n'd app; obvious from the diff if the reviewer looks for it.
- **Found by:** Owner (called 'bonus bug' in #44 body). **Fixed by:** Claude Opus 4.8 (trailer). Fable found: False; Fable fixed: False.
- **Prior AI reviewer on intro PR:** did-not-run. PR merged before the AI reviewer existed (2026-10-20); no review comments in cache

## Skipped

- #23: finding 15: pages untested, tests only
- #23: finding 16: IPC doc wrong, doc-only
- #25: macOS system-audio not reproduced, hardening
- #358: LIB-A4/LIB-B7 repeated import: performance only
- #359: REC-A8 tmpdir staging: copy-cost performance
- #360: SHOT-B2 dropped: premise no longer holds
- #370: SHOT-A10 drag re-renders: pure performance
- #410: LIB-A3 preferences cache: pure performance
- #413: REC-B3 already fixed before this PR
- #386: cosmetic duplicate countdown styling
- #403: popover clipping, layout only
- #407: panel height ceiling, layout
- #417: title field min width, cosmetic
- #420: toolbar min-width regression, CSS/E2E
- #427: icon and watermark asset swap
- #434: Start button overlap, layout only
- #9: Worker rename, no defect
- #46: Defense-in-depth, no root cause found
- #75: Test copy expectations only
- #95: Settings gutter cosmetic tweak
- #98: Misleading copy, no logic defect
- #116: Runner macOS drift; dependency bump (electron-builder passed wrong password to security set-key-partition-list)
- #111: Feature (refresh button); defect folded into #120 record
- #44: Bug 1 is a feature gap (self-heal); only title record kept
- #194: Drag-guard fix is latent hardening; auto-copy part is a feature
- #81: Also: stale form error, missing server URL assertion are cleanups; 0f8777ff is a regression in its own fix
- #125: Turbo build env declaration and db:command removal are latent/dead-script, not recorded
- #79: E2E temp-dir leak and missing catch were self-review findings within the PR
- #253: New feature, icon generation
- #302: Owner-approved behaviour change
- #311: Disables feature behind flag
- #312: Overlay UX/tint design tweak
- #314: Windows key labels, copy only
- #343: Layout width tweak
- #363: Latent devDependency; template-origin
- #330: Fixes for dependency upgrade, same PR
- #hidden: ~100 fix commits fix code from same PR; not replayable (e.g. 449, 384, 399, 377, 309, 303)
