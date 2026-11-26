/**
 * `wachiman telemetry on|off|status|reset`. `on` is a consent like the one `wachiman init` asks: it needs a
 * terminal, shows the same text and asks [y/N], and refuses when `CI` or `GITHUB_ACTIONS` is set. `off`,
 * `status` and `reset` work anywhere. Nothing here makes a request.
 */
import { askOnTerminal, type Answer, type CommandIo } from "../accounts/commands";
import { wachimanHome } from "../accounts/config";
import { DOCS } from "../help";
import { ConsentUnreadableError, blockedBy, readConsent, recordChoice, resetInstallation, telemetryAllowed } from "./consent";
import { rejectedEndpoint } from "./send";
import { CONSENT_QUESTION, consentText } from "./text";

type Env = Record<string, string | undefined>;

export const TELEMETRY_DOCS = `${DOCS}/on-your-machine.md#telemetry`;
const SUBCOMMANDS = ["on", "off", "status", "reset"];

export interface TelemetryDeps {
  /** Overrides the terminal check, for a test. */
  interactive?: boolean;
  ask?: (question: string, defaultYes: boolean) => Answer;
}

const onTerminal = () => process.stdin.isTTY === true && process.stdout.isTTY === true && process.stderr.isTTY === true;

/** Returns the exit code: 0 (`status` also when the stored choice cannot be read: it says so), 1 when `on`, `off` or `reset` find a stored choice that cannot be read, 2 for a usage error or a refusal, 130 for a cancel. */
export function runTelemetry(argv: string[], env: Env, io: CommandIo, deps: TelemetryDeps = {}): number {
  const [sub, ...extra] = argv;
  if (sub === undefined || !SUBCOMMANDS.includes(sub) || extra.length > 0) {
    io.stderr(
      `wachiman: telemetry takes one of ${SUBCOMMANDS.join(", ")}${extra.length > 0 ? `, and no more arguments (got "${extra[0]}")` : ""}.`,
    );
    return 2;
  }
  const home = wachimanHome(env);
  try {
    return runWithHome(sub, env, home, io, deps);
  } catch (error) {
    if (!(error instanceof ConsentUnreadableError)) throw error;
    io.stderr(error.message);
    return 1;
  }
}

function runWithHome(sub: string, env: Env, home: string, io: CommandIo, deps: TelemetryDeps): number {
  if (sub === "off") {
    recordChoice(home, "no");
    io.stdout("Usage telemetry is off. Nothing was deleted from what was already received.\n");
    return 0;
  }
  if (sub === "reset") {
    const next = resetInstallation(home);
    io.stdout(next ? `New installation ID: ${next.installation}\n` : "There is no installation ID yet; nothing to reset.\n");
    return 0;
  }
  if (sub === "status") return status(env, home, io);
  return turnOn(env, home, io, deps);
}

function status(env: Env, home: string, io: CommandIo): number {
  let consent: ReturnType<typeof readConsent>;
  try {
    consent = readConsent(home);
  } catch (error) {
    if (!(error instanceof ConsentUnreadableError)) throw error;
    io.stdout(
      [
        "Usage telemetry: unreadable",
        "Installation ID: unknown",
        "Sending now: no",
        `What is sent: ${TELEMETRY_DOCS}`,
        `${error.message}`,
        "",
      ].join("\n"),
    );
    return 0;
  }
  const blocked = blockedBy(env);
  io.stdout(
    [
      `Usage telemetry: ${consent === undefined ? "not asked" : consent.choice === "yes" ? "on" : "off"}`,
      `Installation ID: ${consent?.installation ?? "none"}`,
      `Sending now: ${telemetryAllowed(env, consent) ? "yes" : "no"}${blocked.length > 0 ? ` (blocked by ${blocked.join(", ")})` : ""}`,
      `What is sent: ${TELEMETRY_DOCS}`,
      ...(rejectedEndpoint(env) ? [`Warning: WACHIMAN_TELEMETRY_URL is not used and nothing is sent: it must be an https URL, or http on localhost, 127.0.0.1 or [::1].`] : []),
      "",
    ].join("\n"),
  );
  return 0;
}

function turnOn(env: Env, home: string, io: CommandIo, deps: TelemetryDeps): number {
  const ci = ["CI", "GITHUB_ACTIONS"].filter((name) => (env[name] ?? "").trim() !== "");
  if (ci.length > 0) {
    io.stderr(
      `wachiman: telemetry on is not available when ${ci.join(" or ")} is set: usage telemetry is for a laptop, and a workflow or an agent never gives this consent.`,
    );
    return 2;
  }
  if (!(deps.interactive ?? onTerminal())) {
    io.stderr(
      "wachiman: telemetry on needs a terminal: it shows what is sent and asks you. Run it in a terminal yourself; an agent never answers it.",
    );
    return 2;
  }
  readConsent(home); // throws ConsentUnreadableError before the question, not after the answer
  io.stderr(consentText(TELEMETRY_DOCS));
  const answer = (deps.ask ?? askOnTerminal)(CONSENT_QUESTION, false);
  if (answer === "cancel") {
    io.stderr("cancelled: nothing was stored.");
    return 130;
  }
  const consent = recordChoice(home, answer === "yes" ? "yes" : "no");
  if (consent.choice === "no") {
    io.stdout("Usage telemetry stays off.\n");
    return 0;
  }
  io.stdout(`Usage telemetry is on. Installation ID: ${consent.installation}\n`);
  if (blockedBy(env).length > 0) io.stderr(`wachiman: nothing is sent while ${blockedBy(env).join(", ")} is set.`);
  return 0;
}
