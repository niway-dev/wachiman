// Prints the batch prompts the golden test pins. Usage: bun scripts/prompt-golden.ts [repoDir] > src/questions/fixtures/prompt-before-questions.txt
// The fixture was generated from origin/main 47933f0, before the data-path questions existed. Regenerate it only when
// a prompt change is intended, and say so in the commit.
const { buildBatchPrompt } = await import(`${process.argv[2] ?? "."}/src/engine.ts`);
const ctx = { pr: 7, repo: "o/r", headSha: "a".repeat(40), since: null, paths: [], dropped: 0,
  everyFile: "- web/Button.tsx\n- docs/x.md\n- web/a.css", meta: { title: "t", body: "b" }, instructions: "" };
const f = (filename: string, patch: string) => ({ filename, status: "modified", additions: 2, deletions: 1, patch });
const batches = {
  ui: [f("web/Button.tsx", "@@ -1,2 +1,3 @@\n-const a = 1;\n+const a = 2;\n+export const B = () => <button onClick={() => setOpen(true)}>x</button>;"),
       f("web/a.css", "@@ -1 +1,2 @@\n+.row:hover { color: red; }\n+.tile { --tag: grey; }")],
  docs: [f("docs/x.md", "@@ -1 +1,2 @@\n+We remove old entries and retry with a timeout.\n+Cached values are written back.")],
  incr: [f("web/Button.tsx", "@@ -1 +1 @@\n-x\n+y")],
};
for (const [name, files] of Object.entries(batches)) {
  for (const hasThreads of [false, true]) {
    const c = name === "incr" ? { ...ctx, since: "b".repeat(40) } : ctx;
    process.stdout.write(`=== ${name} threads=${hasThreads}\n`);
    process.stdout.write(buildBatchPrompt(c, files, hasThreads, { index: 1, total: 2 }, "/tmp/d", "\n\n## Repository instructions\nbe nice", "") + "\n");
  }
}
