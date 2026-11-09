import { ClaudeCodeProvider, type ClaudeAuth } from "./claude-code";
import { CodexProvider } from "./codex";
import type { Effort, ProviderAdapter } from "./types";

export type { NeutralTool, ProviderAdapter, ProviderRequest, ProviderResult } from "./types";

export const PROVIDER_NAMES = ["claude-code", "codex"] as const;
export const DEFAULT_PROVIDER = "claude-code";

/** The model each provider uses when `AGENT_REVIEW_MODEL` is not set. */
export const DEFAULT_MODELS: Record<(typeof PROVIDER_NAMES)[number], string> = {
  "claude-code": "claude-sonnet-5-5",
  codex: "gpt-6.1-sol",
};

export class UnknownProviderError extends Error {}

export function getProvider(
  name: string,
  options: {
    model: string;
    dryRun: boolean;
    pricePerMTok?: string;
    effort: Effort;
    /** Claude Code only; the local command refuses Codex before it gets here. */
    auth?: ClaudeAuth;
    configDir?: string;
    /** Claude Code, subscription mode: the stored path of an external profile's binary. */
    binary?: string;
  },
): ProviderAdapter {
  if (name === "claude-code") {
    const subscription = options.auth === "subscription";
    return new ClaudeCodeProvider({
      model: options.model,
      requireApiKey: !subscription && !options.dryRun,
      effort: options.effort,
      ...(subscription ? { auth: options.auth, configDir: options.configDir, binary: options.binary } : {}),
    });
  }
  if (name === "codex") {
    return new CodexProvider({
      model: options.model,
      requireApiKey: !options.dryRun,
      priceOverride: options.pricePerMTok,
      reasoningEffort: options.effort,
      // A dry run uses the machine's own Codex login, like the Claude Code adapter's dry run.
      codexHome: options.dryRun ? (process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`) : undefined,
    });
  }
  throw new UnknownProviderError(
    `Unknown provider "${name}". Accepted values: ${PROVIDER_NAMES.join(", ")}.`,
  );
}
