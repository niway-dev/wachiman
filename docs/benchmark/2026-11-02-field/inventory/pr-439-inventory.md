# kaipu-record #439: bot findings inventory

## F1 · Wachiman · inline · `apps/kaipu-record/src/shared/types/library-item.ts:118` · at `c59e58f` · 2026-10-30T07:34:18Z
https://github.com/niway-dev/kaipu-record/pull/439#discussion_r4421411054

🟡🧪 **Consider · tests: New `metadataIssue` branch of isCloudUploadEligible is untested**

`isCloudUploadEligible` now also returns false when `local.metadataIssue` is set. The only test for it, `library-item.test.ts:50-55`, still covers only `kind`. The function has no production caller yet: the only matches are in that test file. So the upload flow for NIW2-214 will depend on this rule without a test protecting it. Consider adding a case such as `isCloudUploadEligible({ kind: "recording", local: { metadataIssue: "corrupt" } }) === false`.

> **Reply by csdev19** (2026-10-30T20:25:06Z):
>
> Fixed in e9c8961c: `library-item.test.ts` now covers the `metadataIssue` branch (corrupt and unreadable refuse, a clean `local` stays eligible).

## F2 · Wachiman · inline · `apps/kaipu-record/src/main/library/library-vault.ts:290` · at `c59e58f` · 2026-10-30T07:34:18Z
https://github.com/niway-dev/kaipu-record/pull/439#discussion_r4421411062

🟡🐛 **Consider · bug: Quarantine set is never cleared, so a second corruption in the same session gets no copy**

`quarantinedSidecars` keeps a path for the rest of the process (line 73), and nothing removes it after the sidecar reads cleanly again. Here is the sequence: a sidecar is corrupt and gets copied aside. It is repaired, for example by a cloud sync, and later writes go into it. Then it becomes corrupt again (truncated again, or hand-edited). The second corrupt version is never copied, because `quarantine` returns early. Consider calling `quarantinedSidecars.delete(path)` in `sidecar()` when a parse succeeds. Alternatively, key the set by path plus size/mtime.

> **Reply by csdev19** (2026-10-30T20:25:09Z):
>
> Fixed in e9c8961c: a clean read now removes the path from `quarantinedSidecars`, so a sidecar that is repaired and corrupted again in the same session gets a new copy. New test `keeps a new copy when a repaired sidecar is corrupted again in the same session` fails without the change.


# Review bodies (may hold findings not posted inline)

## Review · Wachiman · at `c59e58f` · 2026-10-30T07:34:18Z
https://github.com/niway-dev/kaipu-record/pull/439#pullrequestreview-5709341526

**Agent review** of the whole pull request, at `c59e58f`: all 16 files reviewed.

2 finding(s): 2 to consider; 2 on their lines. Reply in a comment's thread to answer it.

### Summary

I reviewed all 16 files in this part and found nothing that blocks the merge. Only a missing sidecar (ENOENT) still counts as a legacy item. A read error or a corrupt sidecar now raises SidecarUnavailableError. The item is still listed, using a stand-in assetId that is never persisted. Every write path refuses to write for it: writeMeta, ensureIdentity, removeLocalCopy (checked before it deletes anything) and overwriting a screenshot. composeLibrary keeps the cloud association through lastSeenLocalId instead of clearing it. The tests cover EIO, EACCES, a mode-000 file, several corrupt shapes, copying a corrupt sidecar only once, and that the original identity comes back once the file reads again. The value import in src/shared is unchanged; only a type was added. I have two optional suggestions (consider): add a test for the new metadataIssue check in isCloudUploadEligible, and clear the quarantine set once a sidecar reads cleanly again.

[details elided]

<sub>Claude Opus 5.5 via Claude Code 2.1.304 · $0.21</sub>


# Issue comments
