/**
 * The repository settings file `.wachiman.yml` as the engine reads it (ADR 0048, ADR 0049).
 *
 * `init` writes it with plain string handling (`src/init/settings.ts`); everything that reads it
 * goes through `parseRepoSettings`, so what counts as valid is decided in one place. The keys are
 * `kind` (metadata), `model` and `effort`. Unknown keys are ignored.
 *
 * Where the file is read from is a spend decision, not a convenience: in Actions it comes from the
 * pull request's base commit and locally from the merge-base, never from the head, so a change
 * cannot raise the model or the effort it is reviewed under (`readBaseSettings` in engine.ts,
 * `localRepoSettings` in connectors/local-git.ts). The values lose to an explicit
 * `WACHIMAN_MODEL` / `WACHIMAN_EFFORT` (a workflow input or the environment) and win over the
 * built-in defaults.
 */
import { UsageError, type EngineConfig, type SettingSource } from "./config";
import { PER_BATCH_USD } from "./estimate";
import { DEFAULT_MODELS } from "./providers";
import { DEFAULT_EFFORT, EFFORTS, type Effort } from "./providers/types";

/** The file's place: the repository root, in every mode. */
export const SETTINGS_PATH = ".wachiman.yml";

/** The older place of a development build; never read, only reported by `wachiman doctor`. */
export const OLD_SETTINGS_PATH = ".github/wachiman.yml";

export interface RepoSettings {
  /** `monorepo` or `single` when `init` wrote it; any text a person typed otherwise. Metadata only. */
  kind?: string;
  model?: string;
  effort?: Effort;
}

/**
 * The settings in a `.wachiman.yml`. An empty file, or one with only comments, holds nothing. A
 * key set to nothing (`model:`) counts as not set. Unparseable YAML, a file that is not a
 * mapping, a `model` that is not text and an unknown `effort` are usage errors that name the file:
 * a silent fallback would run the review under a model or effort nobody chose.
 */
export function parseRepoSettings(content: string): RepoSettings {
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(content);
  } catch (error) {
    throw new UsageError(`${SETTINGS_PATH} is not valid YAML (${oneLine(error instanceof Error ? error.message : String(error))}). Fix it, or remove the file to use the defaults.`);
  }
  if (doc === null || doc === undefined) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new UsageError(`${SETTINGS_PATH} must be a mapping of settings (kind, model, effort), like \`effort: high\`.`);
  }
  const map = doc as Record<string, unknown>;
  const settings: RepoSettings = {};
  if (typeof map.kind === "string" && map.kind.trim() !== "") settings.kind = map.kind.trim();
  const model = map.model;
  if (model !== undefined && model !== null) {
    if (typeof model !== "string" || model.trim() === "") {
      throw new UsageError(`${SETTINGS_PATH}: model must be a model name such as claude-sonnet-5-5, got ${JSON.stringify(model)}.`);
    }
    settings.model = model.trim();
  }
  const effort = map.effort;
  if (effort !== undefined && effort !== null) {
    if (typeof effort !== "string" || !(EFFORTS as readonly string[]).includes(effort)) {
      throw new UsageError(`${SETTINGS_PATH}: effort must be one of ${EFFORTS.join(", ")}, got "${String(effort)}".`);
    }
    settings.effort = effort as Effort;
  }
  return settings;
}

/** The warning for a broken file that a run ignores (it never blocks a review): what was wrong, and that defaults apply. */
export const ignoredSettingsNote = (reason: string, where: string) => `ignored ${SETTINGS_PATH} at ${where}: ${reason.trim().replace(/\.$/, "")}; using defaults`;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

/** Whether Wachiman knows `model` as a Claude one: its id names a family in the measured cost table (`PER_BATCH_USD`). */
export const isKnownClaudeModel = (model: string) => Object.keys(PER_BATCH_USD).some((family) => model.toLowerCase().includes(family));

/**
 * `config` with the file's `model` and `effort` where nothing explicit set them: a value that came
 * from the environment is never replaced, and a default always is. On Claude Code a file model
 * that is not a known Claude model is skipped with a warning naming `where` (Claude Code's
 * preflight never checks the model, so it would fail every batch, including the pull request that
 * fixes the file); Codex checks its own price table in preflight.
 */
export function applyRepoSettings(config: EngineConfig, settings: RepoSettings, opts: { where: string; warn: (line: string) => void }): EngineConfig {
  const next = { ...config };
  if (config.modelSource === "default" && settings.model !== undefined) {
    if (config.provider === "claude-code" && !isKnownClaudeModel(settings.model)) {
      opts.warn(`ignored model "${settings.model}" from ${SETTINGS_PATH} at ${opts.where}: not a Claude model Wachiman knows (its id names none of ${Object.keys(PER_BATCH_USD).join(", ")}); using ${config.model}`);
    } else {
      next.model = settings.model;
      next.modelSource = "file";
    }
  }
  if (config.effortSource === "default" && settings.effort !== undefined) {
    next.effort = settings.effort;
    next.effortSource = "file";
  }
  return next;
}

/** Whether the file may change anything: only a default is ever replaced, so an explicit pair needs no read. */
export const wantsRepoSettings = (config: Pick<EngineConfig, "modelSource" | "effortSource">) =>
  config.modelSource === "default" || config.effortSource === "default";

/** `model` and `effort` that came from the file, for a log line; undefined when neither did. */
export function fileSettingsNote(config: Pick<EngineConfig, "model" | "modelSource" | "effort" | "effortSource">, where: string): string | undefined {
  const parts = [
    ...(config.modelSource === "file" ? [`model ${config.model}`] : []),
    ...(config.effortSource === "file" ? [`effort ${config.effort}`] : []),
  ];
  return parts.length === 0 ? undefined : `${parts.join(", ")} from ${SETTINGS_PATH} at ${where}`;
}

export interface EffectiveSetting {
  value: string;
  source: SettingSource;
}

/**
 * What a run in this environment would use for the model and the effort, and why. Read-only and
 * forgiving, for `wachiman doctor`: an unusable environment value is reported as it is, never thrown.
 */
export function effectiveSettings(
  env: Record<string, string | undefined>,
  settings: RepoSettings | undefined,
): { model: EffectiveSetting; effort: EffectiveSetting } {
  const first = (...names: string[]) => names.map((n) => env[n]).find((v) => v !== undefined && v !== "");
  const provider = first("WACHIMAN_PROVIDER", "CLAUDE_REVIEW_PROVIDER") ?? "claude-code";
  const model = first("WACHIMAN_MODEL", "CLAUDE_REVIEW_MODEL");
  const effort = first("WACHIMAN_EFFORT", "CLAUDE_REVIEW_EFFORT", "WACHIMAN_REASONING_EFFORT", "CLAUDE_REVIEW_REASONING_EFFORT");
  const defaultModel = DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS] ?? DEFAULT_MODELS["claude-code"];
  return {
    model: model !== undefined ? { value: model, source: "env" } : settings?.model !== undefined ? { value: settings.model, source: "file" } : { value: defaultModel, source: "default" },
    effort: effort !== undefined ? { value: effort, source: "env" } : settings?.effort !== undefined ? { value: settings.effort, source: "file" } : { value: DEFAULT_EFFORT, source: "default" },
  };
}
