/**
 * The usage-telemetry question of `wachiman init`: asked once, in a terminal, with No as the default
 * (docs/specs/2026-11-24-optional-usage-telemetry-design.md). Without a terminal, with `--json`, `--yes`
 * or `--dry-run`, nothing is asked and nothing is stored. Anything that blocks sending (`DO_NOT_TRACK`, `WACHIMAN_TELEMETRY` set to 0, false, off or no, `CI`, `GITHUB_ACTIONS`) or an earlier answer means it is not asked.
 */
import { wachimanHome } from "../accounts/config";
import { blockedBy, ConsentUnreadableError, readConsent, recordChoice } from "../telemetry/consent";
import { TELEMETRY_DOCS } from "../telemetry/command";
import { CONSENT_QUESTION, consentText } from "../telemetry/text";
import type { Prompter } from "../wizard/prompt";

type Env = Record<string, string | undefined>;

/** The `telemetry` field of `wachiman.init/1`: `pending` is the question an agent relays to the owner. */
export type TelemetryState = "pending" | "yes" | "no" | "blocked";

/** `blocked` when anything in the environment blocks sending (`DO_NOT_TRACK`, `WACHIMAN_TELEMETRY` set to 0, false, off or no, `CI`, `GITHUB_ACTIONS`), else the stored choice, else `pending`. A home that cannot be read is `pending`. */
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
 * Returns a warning line when the question was not asked (the stored choice cannot be read) or the choice could not be stored, for the caller to print once the prompt session is closed.
 */
export async function askTelemetry(p: { env: Env; prompter: Prompter; dryRun: boolean }): Promise<string | undefined> {
  if (p.dryRun || telemetryState(p.env) !== "pending") return undefined;
  try {
    const home = wachimanHome(p.env);
    readConsent(home); // a choice that cannot be read is not asked: the answer could not be stored
    p.prompter.note(consentText(TELEMETRY_DOCS), "Usage metrics");
    const answer = await p.prompter.confirm(CONSENT_QUESTION, false);
    if (answer === null) return undefined;
    recordChoice(home, answer ? "yes" : "no");
    return undefined;
  } catch (error) {
    if (error instanceof ConsentUnreadableError) return `telemetry: not asked (${error.message})`;
    // Telemetry never fails an init that already wrote its files.
    return `telemetry: choice not stored (${error instanceof Error ? error.message : String(error)})`;
  }
}
