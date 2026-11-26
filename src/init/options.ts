/**
 * `init` options (command contract section 5.5): the raw flags a parser or the prompts produce,
 * and the one pure function that validates both. Nothing here touches the disk.
 */
import { posix } from "node:path";

export type InitMode = "github" | "local" | "both";

/** The shape of the repository. Metadata only for now: nothing else in Wachiman reads it. */
export type ProjectKind = "monorepo" | "single";
export const projectKinds: readonly ProjectKind[] = ["monorepo", "single"];

/** Why `kind` cannot be recorded, or undefined when it can. */
export function projectKindProblem(kind: string): string | undefined {
  if (projectKinds.includes(kind as ProjectKind)) return undefined;
  if (kind === "distributed") return "--project-kind distributed is not available yet; use monorepo or single.";
  return `--project-kind must be monorepo or single, got "${kind}".`;
}

export interface RawInitFlags {
  mode?: string;
  operator?: string;
  version?: string;
  path?: string;
  projectKind?: string;
  force?: boolean;
  dryRun?: boolean;
  /** Print one `wachiman.init/1` document on stdout; never prompt. */
  json?: boolean;
  yes?: boolean;
  /** `--pr-template` is true, `--no-pr-template` is false; absent means not given. */
  prTemplate?: boolean;
  /** `--no-agent-pointer` is false; absent means the pointer is written. */
  agentPointer?: boolean;
  repoDir?: string;
  help?: boolean;
}

export interface InitOptions {
  mode: InitMode;
  /** Present iff mode !== "local". */
  github?: { operator: string; tag: string; path: string; force: boolean; dryRun: boolean };
  /** Install the PR description template after the workflow work. Absent means no: a script that did not ask gets no new file. */
  prTemplate?: boolean;
  /** False (`--no-agent-pointer`) skips the pointer in AGENTS.md or CLAUDE.md; absent means write it. */
  agentPointer?: false;
  /** Present iff the kind was given (flag or answer); then `.wachiman.yml` is written or checked. `force` allows changing a different `kind:` without asking. */
  settings?: { kind: ProjectKind; force: boolean };
  /** Set only in local mode (github mode carries it in `github.dryRun`): preview `.wachiman.yml` and the PR template, write nothing. */
  dryRun?: true;
  repoDir: string;
  interactive: boolean;
}

export type ResolveResult<T> = { ok: true; options: T } | { ok: false; error: string };

/**
 * The release tag of the reusable workflow that `init` pins when `--version` is absent: a ref that
 * is known to be published and immutable. release-please bumps it at the release commit (see
 * docs/releasing.md); the CLI's own version is never a substitute,
 * because an unreleased or unrelated version would pin a workflow that does not exist.
 */
export const DEFAULT_WORKFLOW_REF: string | undefined = "v1.22.0"; // x-release-please-version

export const DEFAULT_WORKFLOW_PATH = ".github/workflows/wachiman-review.yml";
const WORKFLOWS_DIR = ".github/workflows/";

const OPERATOR = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const TAG = /^(?:v\d+\.\d+\.\d+|[0-9a-f]{40})$/;
const GITHUB_ONLY_FLAGS = [
  ["operator", "--operator"],
  ["version", "--version"],
  ["path", "--path"],
  ["force", "--force"],
] as const;

export const initModes: readonly InitMode[] = ["github", "local", "both"];

/** Why `login` cannot be the operator, or undefined when it can. */
export function operatorProblem(login: string): string | undefined {
  return OPERATOR.test(login)
    ? undefined
    : `--operator "${login}" is not a GitHub login: 1 to 39 letters, digits or single dashes, starting and ending with a letter or digit.`;
}

/** Why `tag` cannot be pinned, or undefined when it can. Only `vX.Y.Z` and a full lowercase commit SHA name a release. */
export function tagProblem(tag: string): string | undefined {
  return TAG.test(tag)
    ? undefined
    : `--version "${tag}" is not a release tag: use vX.Y.Z (for example v1.5.0) or a full 40-character commit SHA.`;
}

/** The workflow path in normal form, or why it is refused: relative, `.yml` or `.yaml`, directly under `.github/workflows/`. */
export function normaliseWorkflowPath(path: string): { ok: true; path: string } | { ok: false; problem: string } {
  const refuse = (why: string) => ({ ok: false as const, problem: `--path "${path}" ${why}.` });
  if (path.includes("\u0000") || path.includes("\\")) return refuse("contains a backslash or a NUL character; use forward slashes");
  if (posix.isAbsolute(path)) return refuse("is absolute; give a path relative to the repository");
  const normal = posix.normalize(path);
  if (!normal.startsWith(WORKFLOWS_DIR)) return refuse(`must stay under ${WORKFLOWS_DIR}`);
  const file = normal.slice(WORKFLOWS_DIR.length);
  if (file.includes("/")) return refuse(`must be a file directly in ${WORKFLOWS_DIR}; GitHub does not run workflows in subfolders`);
  if (!/^[^/]+\.ya?ml$/.test(file) || file.startsWith(".")) return refuse("must name a .yml or .yaml file");
  return { ok: true, path: normal };
}

/** Validates the flags, whoever produced them: a parser or the prompts. */
export function resolveInitOptions(
  flags: RawInitFlags,
  ctx: { interactive: boolean; defaultWorkflowRef?: string },
): ResolveResult<InitOptions> {
  const fail = (error: string) => ({ ok: false as const, error });
  if (flags.mode === undefined)
    return fail("init needs --mode github|local|both when it cannot ask; for this machine only, use --mode local.");
  if (!initModes.includes(flags.mode as InitMode)) return fail(`--mode must be github, local or both, got "${flags.mode}".`);
  const mode = flags.mode as InitMode;
  const repoDir = flags.repoDir ?? ".";
  const optionalFiles = {
    ...(flags.prTemplate === true ? { prTemplate: true } : {}),
    ...(flags.agentPointer === false ? { agentPointer: false as const } : {}),
  };
  if (flags.projectKind !== undefined) {
    const kindError = projectKindProblem(flags.projectKind);
    if (kindError) return fail(kindError);
  }
  const settings = flags.projectKind === undefined ? undefined : { kind: flags.projectKind as ProjectKind, force: flags.force === true };

  if (mode === "local") {
    // With a kind, --force means "change a different kind in the settings file", which local mode does write.
    const given = GITHUB_ONLY_FLAGS.filter(
      ([key]) => flags[key] !== undefined && flags[key] !== false && !(key === "force" && settings),
    ).map(([, name]) => name);
    if (given.length > 0)
      return fail(`${given.join(", ")} only apply to a workflow; --mode local writes none. Drop them, or use --mode github or both.`);
    return {
      ok: true,
      options: {
        mode,
        ...optionalFiles,
        ...(settings ? { settings } : {}),
        ...(flags.dryRun ? { dryRun: true as const } : {}),
        repoDir,
        interactive: ctx.interactive,
      },
    };
  }

  if (flags.operator === undefined)
    return fail(
      `init --mode ${mode} needs --operator <github login> when it cannot ask: the one person whose /wachiman comments start a run.`,
    );
  const operatorError = operatorProblem(flags.operator);
  if (operatorError) return fail(operatorError);

  let tag = flags.version;
  if (tag === undefined) {
    if (ctx.defaultWorkflowRef === undefined) {
      return fail(
        "init needs --version <vX.Y.Z or commit SHA>: this build bundles no known-published workflow ref, and the CLI's own version is never used as one.",
      );
    }
    if (!TAG.test(ctx.defaultWorkflowRef))
      return fail(`the bundled workflow ref "${ctx.defaultWorkflowRef}" is not a release tag; pass --version <vX.Y.Z>.`);
    tag = ctx.defaultWorkflowRef;
  } else {
    const tagError = tagProblem(tag);
    if (tagError) return fail(tagError);
  }

  const path = normaliseWorkflowPath(flags.path ?? DEFAULT_WORKFLOW_PATH);
  if (!path.ok) return fail(path.problem);

  return {
    ok: true,
    options: {
      mode,
      github: { operator: flags.operator, tag, path: path.path, force: flags.force === true, dryRun: flags.dryRun === true },
      ...optionalFiles,
      ...(settings ? { settings } : {}),
      repoDir,
      interactive: ctx.interactive,
    },
  };
}
