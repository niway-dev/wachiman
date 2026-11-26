# Telemetry client: working tasks

A working document for the branch `feat/optional-usage-telemetry`. The shipping PR deletes it.

Design: [optional usage telemetry spec](../specs/2026-11-24-optional-usage-telemetry-design.md).

## Done

- Consent store, gate (`telemetryAllowed`) and summary builder in `src/telemetry/`; `usageDataAllowed` now true unless `DO_NOT_TRACK`.

- Sender and the call after `local` and `ask` (`src/telemetry/send.ts`, `report.ts`).
- `wachiman telemetry on|off|status|reset` with its help page.
- `init` question (asked last, terminal only) and the `telemetry` field of `init --json`.
- Docs (`telemetry-api.md` with its contract test, on-your-machine, cli, README, local-review, faq), ADR status, `wachimanDataCollection`, CHANGELOG call-out.

## Left

- Full `bun test`, lint, check.

## Next step

The full run.
