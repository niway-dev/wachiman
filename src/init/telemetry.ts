/**
 * The usage-telemetry question of `wachiman init`: asked once, in a terminal, with No as the default
 * (docs/specs/2026-11-24-optional-usage-telemetry-design.md). Without a terminal, with `--json`, `--yes`
 * or `--dry-run`, nothing is asked and nothing is stored. `DO_NOT_TRACK` set means it is not asked at all.
 */
import { wachimanHome } from "../accounts/config";
import { blockedBy, readConsent, recordChoice } from "../telemetry/consent";
import { TELEMETRY_DOCS } from "../telemetry/command";
import { CONSENT_QUESTION, consentText } from "../telemetry/text";
import type { Prompter } from "../wizard/prompt";

type Env = Record<string, string | undefined>;

/** The `telemetry` field of `wachiman.init/1`: `pending` is the question an agent relays to the owner. */
export type TelemetryState = "pending" | "yes" | "no" | "blocked";

/** `blocked` when anything in the environment blocks sending (`DO_NOT_TRACK`, `WACHIMAN_TELEMETRY=0`, `CI`, `GITHUB_ACTIONS`), else the stored choice, else `pending`. A home that cannot be read is `pending`. */
export function telemetryState(env: Env): TelemetryState {
  if (blockedBy(env).length > 0) return "blocked";
  try {
    const consent = readConsent(wachimanHome(env));
    return consent === undefined ? "pending" : consent.choice;
  } catch {
    return "pending";
  }
}

/**
 * Asks the question when it is still open, and stores the answer. A cancelled prompt stores nothing.
 * Returns a warning line when the choice could not be stored, for the caller to print once the prompt session is closed.
 */
export async function askTelemetry(p: { env: Env; prompter: Prompter; dryRun: boolean }): Promise<string | undefined> {
  if (p.dryRun || telemetryState(p.env) !== "pending") return undefined;
  try {
    const home = wachimanHome(p.env);
    p.prompter.note(consentText(TELEMETRY_DOCS), "Usage metrics");
    const answer = await p.prompter.confirm(CONSENT_QUESTION, false);
    if (answer === null) return undefined;
    recordChoice(home, answer ? "yes" : "no");
    return undefined;
  } catch (error) {
    // Telemetry never fails an init that already wrote its files.
    return `telemetry: choice not stored (${error instanceof Error ? error.message : String(error)})`;
  }
}
