# Telemetry client: working tasks

A working document for the branch `feat/optional-usage-telemetry`. The shipping PR deletes it.

Design: [optional usage telemetry spec](../specs/2026-11-24-optional-usage-telemetry-design.md).

## Done

- Consent store, gate (`telemetryAllowed`) and summary builder in `src/telemetry/`; `usageDataAllowed` now true unless `DO_NOT_TRACK`.

## Left

- Sender (`sendSummary`) and the call after `local` and `ask`.
- `wachiman telemetry on|off|status|reset` and its help page.
- The `init` question and the `telemetry` field of `init --json`.
- Docs (`telemetry-api.md`, on-your-machine, cli, README, local-review, faq, ADR status), `package.json` entry, CHANGELOG call-out.
- Egress test row; full `bun test`, lint, check.

## Next step

The sender.
