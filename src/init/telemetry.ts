/**
 * The usage-telemetry question of `wachiman init`: asked once, in a terminal, with No as the default
 * (docs/specs/2026-11-24-optional-usage-telemetry-design.md). Without a terminal, with `--json`, `--yes`
 * or `--dry-run`, nothing is asked and nothing is stored. `DO_NOT_TRACK` set means it is not asked at all.
 */
import { wachimanHome } from "../accounts/config";
import { doNotTrack } from "../tracking";
import { readConsent, recordChoice } from "../telemetry/consent";
import { TELEMETRY_DOCS } from "../telemetry/command";
import { CONSENT_QUESTION, consentText } from "../telemetry/text";
import type { Prompter } from "../wizard/prompt";

type Env = Record<string, string | undefined>;

/** The `telemetry` field of `wachiman.init/1`: `pending` is the question an agent relays to the owner. */
export type TelemetryState = "pending" | "yes" | "no" | "blocked";

/** `blocked` when `DO_NOT_TRACK` is set, else the stored choice, else `pending`. A home that cannot be read is `pending`. */
export function telemetryState(env: Env): TelemetryState {
  if (doNotTrack(env)) return "blocked";
  try {
    const consent = readConsent(wachimanHome(env));
    return consent === undefined ? "pending" : consent.choice;
  } catch {
    return "pending";
  }
}

/** Asks the question when it is still open, and stores the answer. A cancelled prompt stores nothing. */
export async function askTelemetry(p: { env: Env; prompter: Prompter; dryRun: boolean }): Promise<void> {
  if (p.dryRun || telemetryState(p.env) !== "pending") return;
  const home = wachimanHome(p.env);
  p.prompter.note(consentText(TELEMETRY_DOCS), "Usage metrics");
  const answer = await p.prompter.confirm(CONSENT_QUESTION, false);
  if (answer === null) return;
  recordChoice(home, answer ? "yes" : "no");
}
