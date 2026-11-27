/** The consent text, shown by `wachiman init` and `wachiman telemetry on`. The wording is fixed by the design spec. */
export const CONSENT_QUESTION = "Share usage metrics?";

/** Everything above the `[y/N]` question; `link` is the page that lists what is sent and how to turn it off. */
export function consentText(link: string): string {
  return [
    "Would you like to share usage metrics to help improve Wachiman?",
    "",
    "Metrics include diff sizes, chunk counts, token usage, review duration,",
    "error categories, finding counts, and repository languages and layout.",
    "A random installation ID links your usage reports, so they are",
    "pseudonymous, not anonymous. The receiver sees your network address",
    "and does not keep it.",
    "",
    "We do not send code, prompts, responses, repository names, file paths,",
    "or identifiers from any of your accounts.",
    "",
    `What is sent, and how to turn it off: ${link}`,
  ].join("\n");
}
