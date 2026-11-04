# Golden prompts

Every prompt the fake providers of `src/engine.fake.test.ts`, `src/ceiling.fake.test.ts` and
`src/threads.fake.test.ts` send, one JSON line per request, in order (`test/support/golden-prompts.ts`).
Run directories and the head directory are replaced by `<RUN_DIR>` and `<HEAD_DIR>`.

A fixture changes only with an intended change to what the model is asked. Regenerate with
`WACHI_UPDATE_GOLDEN=1 bun test src/engine.fake.test.ts src/ceiling.fake.test.ts src/threads.fake.test.ts`
and commit the regenerated diff, reviewed, in the same commit as the prompt change.
