---
name: wachiman-loop
description: Use when the developer asks you to review your own change with Wachiman and keep fixing what it finds until it is clean ("loop until clean", "run the wachiman loop", "fix what wachiman reports and run it again") on their laptop. Not for a single review or for judging a finding outside a loop; that is wachiman-review.
---

# Fix a branch with the Wachiman loop

## Why

`wachiman loop` runs **one review round per call** on the developer's signed-in `claude` and
tells you whether to stop. The CLI keeps the books: round count, which findings are still open,
retries and the stop rule. **You fix the code between calls; the CLI never edits it, and you never
review the code yourself.** Choose the account the way `wachiman-review` does ("Choose the
profile"): ask `wachiman project show --json`, never read inside a profile directory.

## The command

```sh
env -u ANTHROPIC_API_KEY wachiman loop --repo-dir <clone> --base <ref> --format json \
  [--profile <name>] [--max-rounds <n>] 2> <tmp>/loop.log
```

- `--base <ref>` **starts** a loop: round 1 reviews the whole branch range from that ref (the
  default branch, unless the developer names another). Run it from a directory outside the clone.
- The same command **without** `--base` continues the open loop of the branch: it reviews only the
  commits made since the previous round. **Commit your fix first**; uncommitted work is not reviewed.
- Three rounds by default. Raise `--max-rounds` only when the developer says so.

## The summary comment

The CLI writes the "Review summary — local" comment from its own record of each round (range,
version, models, cost, findings). **You never write or edit that table by hand**: a hand-kept table
drifts (a loop run by hand once used fix commits as round bases and left its fixes unreviewed). You
only ask the CLI to publish it, and say which agent you are:

```sh
env -u ANTHROPIC_API_KEY wachiman loop --repo-dir <clone> --summary --publish --agent "<your name>"
```

- **Run the loop before you open the pull request**, so the review is behind the branch from its first push.
- **Right after the pull request opens, publish the summary** with the command above, so it is the pull
  request's first comment. `--publish` needs an open pull request whose head is the branch.
- **After each later round, publish again.** The same command edits that comment in place; it never
  adds a second one. (`--publish` also works on a round call: `wachiman loop --publish --agent "<name>"`.)
- `--summary` alone, or `--format markdown`, only prints it. Use that to show the developer the
  summary before anything is posted if they ask.
- If the repository's `.wachiman.yml` sets `publishLoopSummary: true`, Wachiman publishes after every
  call by itself: do not publish again by hand.
- The comment is posted as the account `gh` is signed in with. If `gh` is not signed in, or the
  publish fails, stderr says why and the exit code of the round is unchanged: report it to the developer
  and do not work around it with `gh pr comment`.

## Read the exit code first

| Exit | Meaning | You do |
| --- | --- | --- |
| `0` | Converged: nothing keeps the loop open | Report it as below |
| `10` | Findings still open | Work through `open[]`, commit, call again |
| `11` | Stopped without converging (`outcome.reason`: `round cap` or `review failed`) | Stop. Report the reason and what is still open. Do not call again unless the developer says so |
| `2` | Usage error (no loop open, detached HEAD, bad flag) | Read stderr and fix the call |

A stop is never an approval. `0` means the rule found nothing open in the commits reviewed; it is
not a statement that the branch is safe to merge.

## Between rounds (exit 10)

The JSON has `open[]` (each with `id`, `path`, `line`, `severity`, `title`, `status`), `released[]`
(findings that no longer count, with `why`) and `notes[]` (🟡 and ⚪, which never keep the loop
open). For each finding in `open[]`:

1. Read the cited code in the repository and decide whether the finding is true.
2. **True:** fix it at that place and commit. The next round has to see the change; a finding at
   lines nobody changed stays open even if the reviewer does not repeat it.
3. **False, and you can say why in one sentence:** judge it, with the reason:

   ```sh
   wachiman history --repo-dir <clone> --verdict <id> wrong --reason "<why it is not a defect>"
   ```

   A `wrong` verdict without a reason does not release the finding.
4. **Not sure:** do not guess. Ask the developer, and leave the finding open.

**Never judge a finding `wrong` to make the loop converge.** The reason must be something you
checked in the code, not "out of scope" or "not worth fixing". Every finding you judge `wrong`
appears in the outcome, and the owner reads that list.

Then call `wachiman loop` again without `--base`. A call with no new commit makes no review call
(and still counts as a round), so use it only after a verdict, never to wait.

## At the end

Tell the developer, in this order:

1. The exit code and `outcome.message`, in your own words but with every caveat. A loop that
   converged at round 1 says "Round 1 reviewed the whole range". A loop that converged later says
   "converged on incremental rounds": round 1 read the whole range and later rounds only your fix
   commits; interactions with code outside them were not re-read. Pass on whichever caveat it
   printed.
2. What you fixed, with the commit of each.
3. Every finding in `released[]` with `why: "judged wrong"`, with its reason, so they can overrule
   you. Also name the findings released as `probably-fixed`: that is inferred from the code
   changing, not proved.
4. The `notes[]`, one line each, as optional.
5. Whether the summary comment was published (the URL is on stderr, `loop: summary created on ...`) or
   not, and why not.

## Never

| Tempting | Instead |
| --- | --- |
| Editing code inside the CLI, or asking it to apply a fix | You edit and commit; the CLI only reviews |
| Marking findings `wrong` until exit 0 | Fix the true ones; give a checked reason for the false ones; ask when unsure |
| Calling again after exit 11 to "try once more" | Report the stop; the developer decides |
| Running `wachiman review <pr>`, `gh` or a GitHub token | `loop` is local; nothing is posted unless you ask for `--publish` |
| Writing the summary table yourself, or posting it with `gh pr comment` | `wachiman loop --summary --publish`; the CLI writes it and edits it in place |
| Running with `ANTHROPIC_API_KEY` set | `env -u ANTHROPIC_API_KEY wachiman loop ...`; the subscription pays |
| Editing files under `~/.wachiman` to reset or close a loop | `--base <ref>` starts a new loop |
| Claiming the branch is approved or safe | Report the outcome and its limits |
