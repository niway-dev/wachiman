/**
 * A readable line for each provider call in the job log, printed next to the JSON line that
 * scripts parse. The JSON stays the contract; this line is for the person reading the log.
 */

import type { ProviderErrorClass } from "./providers/errors";

export interface CallSummary {
  /** Which call: `batch 1/2`, `threads`, `question`. */
  label: string;
  isError: boolean;
  terminalReason: string;
  turns: number;
  costUsd: number;
  durationMs: number;
  providerError?: ProviderErrorClass;
  errorText?: string;
}

const MAX_TEXT = 300;

function quoted(text: string | undefined) {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return `"${flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat}"`;
}

const turnsText = (n: number) => `${n} turn${n === 1 ? "" : "s"}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const dollars = (usd: number) => `$${usd.toFixed(2)}`;

export function describeCall(call: CallSummary): string {
  const head = call.label;
  if (!call.isError && call.terminalReason === "success")
    return `✅ ${head}: finished in ${turnsText(call.turns)}, ${seconds(call.durationMs)}, ${dollars(call.costUsd)}.`;
  if (call.terminalReason === "budget")
    return `💸 ${head}: stopped at its budget after ${turnsText(call.turns)}, ${dollars(call.costUsd)}.`;
  if (call.terminalReason === "turns")
    return `⏹️ ${head}: hit the turn limit after ${turnsText(call.turns)}, ${dollars(call.costUsd)}.`;
  if (call.terminalReason === "timeout") return `⏱️ ${head}: killed at the time limit after ${seconds(call.durationMs)}.`;

  const said = quoted(call.errorText);
  const api = said ? ` API said: ${said}` : "";
  switch (call.providerError) {
    case "billing":
      return `❌ ${head}: the Anthropic API refused the call: the account has no credit. Top up, then re-run this job.${api}`;
    case "auth":
      return `❌ ${head}: the Anthropic API refused the call: the API key was rejected. Check the ANTHROPIC_API_KEY secret.${api}`;
    case "rate_limit":
      return `⏳ ${head}: the Anthropic API rate-limited the call. This is usually temporary.${api}`;
    default:
      return `❌ ${head}: the call failed after ${turnsText(call.turns)}.${said ? ` Error: ${said}` : ""}`;
  }
}
