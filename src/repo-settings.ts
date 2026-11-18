/**
 * The repository settings file `.wachiman.yml` as the engine reads it (ADR 0048, ADR 0049).
 *
 * `init` writes it with plain string handling (`src/init/settings.ts`); everything that reads it
 * goes through `parseRepoSettings`, so what counts as valid is decided in one place. The keys are
 * `kind` (metadata), `model`, `effort` and `paths` (the maintainer's path rules, ADR 0058).
 * Unknown keys are ignored.
 *
 * Where the file is read from is a spend decision, not a convenience: in Actions it comes from the
 * pull request's base commit and locally from the merge-base, never from the head, so a change
 * cannot raise the model or the effort it is reviewed under (`readBaseSettings` in engine.ts,
 * `localRepoSettings` in connectors/local-git.ts). The values lose to an explicit
 * `WACHIMAN_MODEL` / `WACHIMAN_EFFORT` (a workflow input or the environment) and win over the
 * built-in defaults. `paths` is read whatever those say: it is review policy, not a spend choice.
 */
import { UsageError, type EngineConfig, type SettingSource } from "./config";
import { PER_BATCH_USD } from "./estimate";
import { DEFAULT_MODELS } from "./providers";
import { DEFAULT_EFFORT, EFFORTS, type Effort } from "./providers/types";

/** The file's place: the repository root, in every mode. */
export const SETTINGS_PATH = ".wachiman.yml";

/** The older place of a development build; never read, only reported by `wachiman doctor`. */
export const OLD_SETTINGS_PATH = ".github/wachiman.yml";

/** How dangerous a path is. A set of its own, separate from finding severities (ADR 0058). */
export const PATH_SEVERITIES = ["critical", "high", "medium"] as const;
export type PathSeverity = (typeof PATH_SEVERITIES)[number];

/** One entry of `paths`: a glob, how dangerous the files it matches are, and the maintainer's reason. */
export interface PathRule {
  match: string;
  severity: PathSeverity;
  reason: string;
}

export interface RepoSettings {
  /** `monorepo` or `single` when `init` wrote it; any text a person typed otherwise. Metadata only. */
  kind?: string;
  model?: string;
  effort?: Effort;
  /** The maintainer's path rules; absent when the file has none. */
  paths?: PathRule[];
}

/**
 * The entries of a `paths` list, validated. `where` prefixes the usage error (`.wachiman.yml`, or
 * the input file's name) and each error names the entry by index. Unknown keys inside an entry are
 * ignored. A reason is kept on one line (it is quoted in a prompt's file list). An empty list is the
 * same as none.
 */
export function parsePathRules(value: unknown, where: string = SETTINGS_PATH): PathRule[] {
  if (!Array.isArray(value)) {
    throw new UsageError(`${where}: paths must be a list of { match, severity, reason } entries.`);
  }
  return value.map((entry, i) => {
    const at = `${where}: paths[${i}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new UsageError(`${at} must be a mapping with match, severity and reason.`);
    }
    const { match, severity, reason } = entry as Record<string, unknown>;
    if (typeof match !== "string" || match.trim() === "") {
      throw new UsageError(`${at}.match must be a glob such as "src/billing/**", got ${JSON.stringify(match)}.`);
    }
    if (typeof severity !== "string" || !(PATH_SEVERITIES as readonly string[]).includes(severity)) {
      throw new UsageError(`${at}.severity must be one of ${PATH_SEVERITIES.join(", ")}, got ${JSON.stringify(severity)}.`);
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new UsageError(`${at}.reason must be a non-empty text saying why the path matters, got ${JSON.stringify(reason)}.`);
    }
    return { match: match.trim(), severity: severity as PathSeverity, reason: reason.replace(/\s+/g, " ").trim() };
  });
}

const SEVERITY_RANK: Record<PathSeverity, number> = { critical: 3, high: 2, medium: 1 };

/** Compiled once per rule list: a review matches every changed file against the same list many times. */
const compiled = new WeakMap<readonly PathRule[], { rule: PathRule; glob: Bun.Glob }[]>();

/**
 * The rule that applies to `path`: the most severe match, the first in the file on a tie
 * (`paths` decision 3). Undefined when no rule matches or there are no rules.
 */
export function matchPathRule(path: string, rules: readonly PathRule[] | undefined): PathRule | undefined {
  if (!rules || rules.length === 0) return undefined;
  let globs = compiled.get(rules);
  if (!globs) {
    globs = rules.map((rule) => ({ rule, glob: new Bun.Glob(rule.match) }));
    compiled.set(rules, globs);
  }
  let best: PathRule | undefined;
  for (const { rule, glob } of globs) {
    if (glob.match(path) && (!best || SEVERITY_RANK[rule.severity] > SEVERITY_RANK[best.severity])) best = rule;
  }
  return best;
}

/**
 * The rule a pull request that edits the path rules is reviewed under, added to the base's rules
 * for that review only and never written anywhere: the file that sets the review's policy is read
 * first and a person decides on it (ADR 0058 decision 4).
 */
export const POLICY_EDIT_RULE: PathRule = { match: SETTINGS_PATH, severity: "critical", reason: "edits the review's path rules" };

/** `rules` and `POLICY_EDIT_RULE`; the base's rules still decide every other file. */
export const withPolicyEditRule = (rules: readonly PathRule[] | undefined): PathRule[] => [...(rules ?? []), POLICY_EDIT_RULE];

/** Whether a change touches `.wachiman.yml`: edits, adds, deletes or renames it away. */
export const touchesSettingsFile = (files: readonly { filename: string; previous_filename?: string }[]) =>
  files.some((f) => f.filename === SETTINGS_PATH || f.previous_filename === SETTINGS_PATH);

/**
 * Whether the head's `.wachiman.yml` sets different path rules than the base's. `headContent` is
 * null when the head has no such file. A head copy that cannot be parsed counts as a change: what
 * it would set is unknown. An edit of only `model`, `effort` or `kind` is not a change.
 */
export function pathsEdited(baseRules: readonly PathRule[] | undefined, headContent: string | null): boolean {
  let headRules: PathRule[] | undefined;
  if (headContent !== null) {
    try {
      headRules = parseRepoSettings(headContent).paths;
    } catch (error) {
      if (error instanceof UsageError) return true;
      throw error;
    }
  }
  // Rules are normalised by `parsePathRules`, so equal lists serialise alike.
  return JSON.stringify(headRules ?? []) !== JSON.stringify(baseRules ?? []);
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
    throw new UsageError(`${SETTINGS_PATH} must be a mapping of settings (kind, model, effort, paths), like \`effort: high\`.`);
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
  if (map.paths !== undefined && map.paths !== null) {
    const paths = parsePathRules(map.paths);
    if (paths.length > 0) settings.paths = paths;
  }
  return settings;
}

/** The warning for a broken file that a run ignores (it never blocks a review): what was wrong, and that defaults apply. */
export const ignoredSettingsNote = (reason: string, where: string) => `ignored ${SETTINGS_PATH} at ${where}: ${reason.trim().replace(/\.$/, "")}; using defaults`;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

const FAMILIES = Object.keys(PER_BATCH_USD);
const CLAUDE_ID = new RegExp(`^(claude-)?(${FAMILIES.join("|")})(-|$)`);

/**
 * Whether Wachiman knows `model` as a Claude one: its id has the shape of Claude's own
 * (`claude-sonnet-5-5`) or is a bare family alias (`sonnet`), for a family in the measured cost
 * table (`PER_BATCH_USD`). A substring would let `my-sonnet-proxy` through.
 */
export const isKnownClaudeModel = (model: string) => CLAUDE_ID.test(model.toLowerCase());

/** Why a file model is skipped on this provider, or undefined when it applies. Shared by runs and `wachiman doctor`. */
export function skippedFileModel(provider: string, model: string): string | undefined {
  if (provider !== "claude-code" || isKnownClaudeModel(model)) return undefined;
  return `not a Claude model Wachiman knows (its id is not claude-<${FAMILIES.join("|")}>-...)`;
}

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
    const skipped = skippedFileModel(config.provider, settings.model);
    if (skipped !== undefined) {
      opts.warn(`ignored model "${settings.model}" from ${SETTINGS_PATH} at ${opts.where}: ${skipped}; using ${config.model}`);
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
  /** Set when the file's model was skipped (a run would ignore it); `value` is then the default. */
  skipped?: string;
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
  const skipped = settings?.model !== undefined ? skippedFileModel(provider, settings.model) : undefined;
  return {
    model:
      model !== undefined
        ? { value: model, source: "env" }
        : settings?.model !== undefined && skipped === undefined
          ? { value: settings.model, source: "file" }
          : { value: defaultModel, source: "default", ...(skipped !== undefined ? { skipped } : {}) },
    effort: effort !== undefined ? { value: effort, source: "env" } : settings?.effort !== undefined ? { value: settings.effort, source: "file" } : { value: DEFAULT_EFFORT, source: "default" },
  };
}
