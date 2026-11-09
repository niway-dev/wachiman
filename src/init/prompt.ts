import { UsageError } from "../config";
import type { Prompter } from "../wizard/prompt";
import { DEFAULT_WORKFLOW_PATH, initModes, normaliseWorkflowPath, operatorProblem, tagProblem, type InitMode, type RawInitFlags } from "./options";

/** The values given on the command line are held to the same rules as answers: a bad one is exit 2, never silently asked again. */
function checkSupplied(flags: RawInitFlags) {
  if (flags.mode !== undefined && !initModes.includes(flags.mode as InitMode)) throw new UsageError(`--mode must be github, local or both, got "${flags.mode}".`);
  const problem =
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
export async function promptForInit(flags: RawInitFlags, ctx: { defaultWorkflowRef?: string }, prompter: Prompter): Promise<RawInitFlags | null> {
  checkSupplied(flags);
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

  const operator =
    flags.operator ?? (await prompter.text("GitHub login of the operator (the one person whose /wachiman comments start a run)", undefined, (v) => operatorProblem(v)));
  if (operator === null) return null;
  const version = flags.version ?? (await prompter.text("Release tag to pin", ctx.defaultWorkflowRef, (v) => tagProblem(v)));
  if (version === null) return null;
  const path =
    flags.path ??
    (await prompter.text("Workflow file", DEFAULT_WORKFLOW_PATH, (v) => {
      const p = normaliseWorkflowPath(v);
      return p.ok ? undefined : p.problem;
    }));
  if (path === null) return null;
  return { ...flags, mode, operator, version, path };
}
