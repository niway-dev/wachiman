/**
 * The one place every `git` the workspace modules run gets its environment. A sibling's clone is
 * read as it is: Wachiman never fetches (ADR 0019, ADR 0043), so a partial clone must not fetch a
 * missing blob on the side.
 */
import { gitEnv, spawnGit, type GitRunner } from "../evidence";

/** The engine's minimal git environment, plus: no lazy fetch from a promisor remote. */
export const workspaceGitEnv = () => ({ ...gitEnv(), GIT_NO_LAZY_FETCH: "1" });

/**
 * The `GitRunner` of the workspace modules. It delegates to the engine's runner so the options
 * stay the same, with the workspace environment layered over the process one for the call.
 */
export const workspaceGit: GitRunner = (args, opts) => spawnGit(args, opts, workspaceGitEnv());

/** True when git's message says an object is absent locally (for instance a blob a partial clone never downloaded). */
export const isMissingObject = (message: string) => /could not fetch .* from promisor remote|lazy fetching disabled|unable to read/i.test(message);

export const MISSING_OBJECT_MESSAGE = "object not present locally; Wachiman never fetches";
