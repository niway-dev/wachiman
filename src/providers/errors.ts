/**
 * Telling apart why a provider call came back as an error, from the text the CLI printed.
 *
 * `billing` and `auth` mean the reviewer's own account cannot make the call (no credit, a spend
 * limit, a revoked key): the pull request is not at fault and retrying cannot help. `rate_limit`
 * is temporary. Anything else may be a real bug and keeps failing the job.
 */

export type ProviderErrorClass = "billing" | "auth" | "rate_limit" | "other";

/**
 * The patterns, checked in this order; the first class with a match wins. All are matched
 * case-insensitively.
 *
 * The wording is from memory of Anthropic's API and Claude Code and has not been verified against
 * every live response: adjust the lists here when a real message is classified wrongly. A bare
 * status code must not match random numbers, so each one needs an "API Error" / "HTTP" / "status"
 * prefix; the error type names (`authentication_error`, `rate_limit_error`) are matched as they are.
 */
const PATTERNS: { class: Exclude<ProviderErrorClass, "other">; patterns: RegExp[] }[] = [
  {
    class: "billing",
    patterns: [
      /credit balance/i, // "Your credit balance is too low to access the Anthropic API."
      /\bbilling\b/i,
      /spend limit/i,
      /usage limit/i,
      /purchase credits/i,
    ],
  },
  {
    class: "auth",
    patterns: [
      /authentication_error/i,
      /invalid x-api-key/i,
      /invalid api key/i,
      /permission_error/i,
      /\b(?:api error|http|status(?: code)?)\W{0,3}(?:401|403)\b/i,
    ],
  },
  {
    class: "rate_limit",
    patterns: [
      /rate_limit_error/i,
      /rate limit/i,
      /overloaded_error/i,
      /\boverloaded\b/i,
      /\b(?:api error|http|status(?: code)?)\W{0,3}(?:429|529)\b/i,
    ],
  },
];

export function classifyProviderError(text: string): ProviderErrorClass {
  for (const group of PATTERNS) {
    if (group.patterns.some((p) => p.test(text))) return group.class;
  }
  return "other";
}
