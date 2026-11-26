# Telemetry client: working tasks

A working document for the branch `feat/optional-usage-telemetry`. The shipping PR deletes it.

Design: [optional usage telemetry spec](../specs/2026-11-24-optional-usage-telemetry-design.md).

## Done

Everything in the brief: `src/telemetry/` (consent, gate, summary, sender, call sites), the `telemetry` command,
the `init` question and `init --json` field, docs, ADR status, `wachimanDataCollection`, CHANGELOG call-out,
tests. Lint and check match their baselines; `bun test`: 4708 pass, 1 flaky failure that passes alone.

## Left

- A clean full `bun test` run on a quiet machine (one timing flake in `src/connectors/working-tree.test.ts`).
- The `ask` call site has unit tests only, no end-to-end test.

## Next step

Open the PR, then delete this file in it.
