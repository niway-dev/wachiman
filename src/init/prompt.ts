import { UsageError } from "../config";
import type { Prompter } from "../wizard/prompt";
import { DEFAULT_WORKFLOW_PATH, initModes, normaliseWorkflowPath, operatorProblem, projectKindProblem, tagProblem, type InitMode, type ProjectKind, type RawInitFlags } from "./options";

/** The values given on the command line are held to the same rules as answers: a bad one is exit 2, never silently asked again. */
export function checkSupplied(flags: RawInitFlags) {
  if (flags.mode !== undefined && !initModes.includes(flags.mode as InitMode)) throw new UsageError(`--mode must be github, local or both, got "${flags.mode}".`);
  const problem =
    (flags.projectKind !== undefined ? projectKindProblem(flags.projectKind) : undefined) ??
    (flags.operator !== undefined ? operatorProblem(flags.operator) : undefined) ??
    (flags.version !== undefined ? tagProblem(flags.version) : undefined) ??
    (flags.path !== undefined ? (() => { const p = normaliseWorkflowPath(flags.path!); return p.ok ? undefined : p.problem; })() : undefined);
  if (problem) throw new UsageError(problem);
}

/**
 * Asks only for what the flags did not give, and returns the same raw flags the parser produces
 * (`null`: the person cancelled). Answers are validated as they are typed; the pure resolver
 * validates everything again.
 */
export async function promptForInit(flags: RawInitFlags, ctx: { defaultWorkflowRef?: string; githubLogin?: () => string | undefined }, prompter: Prompter): Promise<RawInitFlags | null> {
  checkSupplied(flags);
  prompter.step("Project type", 2);
  let projectKind = flags.projectKind as ProjectKind | undefined;
  if (projectKind === undefined) {
    const picked = await prompter.select<ProjectKind | "distributed">(
      "What kind of repository is this?",
      [
        { label: "Monorepo", value: "monorepo" },
        { label: "Single project", value: "single" },
        { label: "Distributed repository", value: "distributed", disabled: true },
      ],
      0,
    );
    if (picked === null) return null;
    projectKind = picked as ProjectKind;
  }
  flags = { ...flags, projectKind };

  prompter.step("Review mode", 3);
  let mode = flags.mode as InitMode | undefined;
  if (mode === undefined) {
    const picked = await prompter.select<InitMode>(
      "How will Wachiman review this repository?",
      [
        { label: "In GitHub Actions on pull requests", value: "github" },
        { label: "Only on this machine, with my Claude subscription", value: "local" },
        { label: "Both", value: "both" },
      ],
      0,
    );
    if (picked === null) return null;
    mode = picked;
  }
  if (mode === "local") return { ...flags, mode };

  prompter.step("GitHub workflow", 4, mode === "both" ? 6 : 5);

  // The signed-in `gh` user is the likely answer; a login that fails the same rule is not offered.
  const guess = ctx.githubLogin?.();
  const suggested = guess !== undefined && operatorProblem(guess) === undefined ? guess : undefined;
  if (suggested !== undefined && flags.operator === undefined) prompter.say(`Signed in to GitHub as https://github.com/${suggested}; press Enter to use it.`, "muted");
  const operator =
    flags.operator ??
    (await prompter.text("Your GitHub username, as in https://github.com/<username>: only this person's /wachiman comments start a paid run", suggested, (v) => operatorProblem(v)));
  if (operator === null) return null;
  // The release this CLI was published as, and the standard workflow path: neither is asked. `--version` and `--path` still override them.
  const version = flags.version ?? ctx.defaultWorkflowRef ?? (await prompter.text("Release tag to pin", undefined, (v) => tagProblem(v)));
  if (version === null) return null;
  const path = flags.path ?? DEFAULT_WORKFLOW_PATH;
  return { ...flags, mode, operator, version, path };
}
