---
name: verify
description: Capture Wachiman CLI evidence without calling a real model.
---

# Verify the local CLI

Use the hub's HTTP and CLI recipe: capture commands, output, exit codes and
runtime as text under git-ignored `.evidence/<topic>/`. Never invoke the real
provider or read credentials for a verification run.

For working-tree review:

1. `bun test src/connectors/working-tree.test.ts`: real temporary repositories,
   staged/all, races, byte and index isolation, unsafe Git configuration,
   symlink parents, conflicts, split/sparse indexes, gitlinks and history.
2. `bun test src/local.test.ts -t working-tree`: real CLI subprocesses with a
   fake Claude executable and isolated HOME, output versions, input files,
   cleanup after errors/interruption. No model or GitHub call.
3. `bun test src/formats.test.ts`: both published versions and schema checks.
4. `bun test`: committed-mode and all other regressions. Record exit and counts.

Copy durable proof counts into the PR; text captures stay uncommitted. A local
macOS run does not establish native Linux or Windows compatibility. Do not
claim merge readiness without the independent review and current-head CI.
