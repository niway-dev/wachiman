/**
 * The interactive launcher: bare `wachiman` on a terminal opens a menu instead of printing the
 * help. It collects what a command needs (the scope, a base, a question), shows the equivalent
 * command line, and hands over to the real command through `dispatch`; it holds no review logic.
 *
 * It opens only when stdin, stdout and stderr are terminals and `CI` is unset. Anything else keeps
 * the old behavior of a bare `wachiman`.
 *
 * Nothing runs before the person confirms. For a command that spends the Claude subscription (a
 * review, an answer, a loop round) the confirmation first shows the repository, the scope, the
 * profile and the command. The prompt session is closed before `dispatch`, so the command owns the
 * terminal.
 */
import { UsageError } from "../config";
import { spawnGit, type GitRunner } from "../evidence";
import { projectShow } from "../accounts/commands";
import { repositoryKey } from "../history/store";
import { quoteArgument } from "./command";
import { createPrompter, type Choice, type Prompter, type PromptIO } from "./prompt";

export interface LauncherStreams {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
  stderr: { isTTY?: boolean };
}

/** The launcher opens on a real terminal outside CI; anything else gets the help text it always got. */
export function shouldLaunch(env: Record<string, string | undefined>, streams: LauncherStreams): boolean {
  return streams.stdin.isTTY === true && streams.stdout.isTTY === true && streams.stderr.isTTY === true && !env.CI;
}

export type Scope =
  | { kind: "branch"; base: string }
  | { kind: "commit"; commit: string }
  | { kind: "staged" }
  | { kind: "tree" };

/** The flags of `local`, `ask` and `loop` that select what is looked at. */
export function scopeArgs(scope: Scope): string[] {
  switch (scope.kind) {
    case "branch":
      return ["--base", scope.base];
    case "commit":
      return ["--commit", scope.commit];
    case "staged":
      return ["--working-tree", "staged"];
    case "tree":
      return ["--working-tree", "all"];
  }
}

export function scopeLabel(scope: Scope): string {
  switch (scope.kind) {
    case "branch":
      return `this branch against ${scope.base}`;
    case "commit":
      return `the commit ${scope.commit}`;
    case "staged":
      return "the staged changes";
    case "tree":
      return "all uncommitted changes in the working tree";
  }
}

export type Action =
  | "review"
  | "ask"
  | "loop-start"
  | "loop-continue"
  | "history"
  | "status"
  | "dashboard"
  | "setup"
  | "init"
  | "doctor"
  | "profile"
  | "skills";

/** What each menu entry runs. The scope, base and question come from the questions asked before. */
export function commandArgs(action: Action, o: { scope?: Scope; question?: string; base?: string } = {}): string[] {
  switch (action) {
    case "review":
      return ["local", ...(o.scope ? scopeArgs(o.scope) : [])];
    case "ask":
      return ["ask", ...(o.question ? [o.question] : []), ...(o.scope ? scopeArgs(o.scope) : [])];
    case "loop-start":
      return ["loop", "--base", o.base ?? ""];
    case "loop-continue":
      return ["loop"];
    case "profile":
      return ["profile", "list"];
    case "skills":
      return ["skills", "install"];
    default:
      return [action];
  }
}

/** Only these call `claude` on the subscription. */
export const SPENDING: ReadonlySet<Action> = new Set<Action>(["review", "ask", "loop-start", "loop-continue"]);

/** The command as someone would type it. */
export const commandLine = (argv: string[]) => ["wachiman", ...argv].map((a) => quoteArgument(a, "posix")).join(" ");

/** The branch a change is compared against: origin's default branch, else the first of origin/main, main, origin/master, master that exists. */
export function detectBase(cwd: string, git: GitRunner = spawnGit): string | undefined {
  const run = (args: string[]) => git(args, { cwd, timeoutMs: 10_000 });
  const head = run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.status === 0 && head.stdout.trim() !== "") return head.stdout.trim();
  return ["origin/main", "main", "origin/master", "master"].find((ref) => run(["rev-parse", "--verify", "--quiet", ref]).status === 0);
}

export interface LauncherDeps {
  env: Record<string, string | undefined>;
  version: string;
  /** Runs a command the way `wachiman <argv>` would, and returns its exit code. */
  dispatch: (argv: string[]) => Promise<number>;
  streams?: LauncherStreams;
  promptIO?: PromptIO;
  cwd?: string;
  git?: GitRunner;
}

/** `undefined` when the launcher does not apply (the caller keeps its old behavior). */
export async function maybeLaunch(deps: LauncherDeps): Promise<number | undefined> {
  const streams = deps.streams ?? { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
  if (!shouldLaunch(deps.env, streams)) return undefined;
  return runLauncher(deps);
}

type Top = "review" | "ask" | "loop" | "findings" | "configure" | "exit";
type Back = "back";

const TOP: Choice<Top>[] = [
  { label: "Review changes", value: "review" },
  { label: "Ask about changes", value: "ask" },
  { label: "Review loop", value: "loop" },
  { label: "Findings & usage", value: "findings", description: "history, status, dashboard" },
  { label: "Configure", value: "configure", description: "setup, init, doctor, profile, skills" },
  { label: "Exit", value: "exit" },
];

const SCOPES: Choice<Scope["kind"]>[] = [
  { label: "This branch against its base", value: "branch" },
  { label: "One commit", value: "commit" },
  { label: "Staged changes", value: "staged" },
  { label: "All working-tree changes", value: "tree" },
];

const FINDINGS: Choice<Action | Back>[] = [
  { label: "History of findings", value: "history" },
  { label: "Status and estimated cost", value: "status" },
  { label: "Dashboard (an HTML page)", value: "dashboard" },
  { label: "Back", value: "back" },
];

const CONFIGURE: Choice<Action | Back>[] = [
  { label: "Set up this repository", value: "setup", description: "bind it to a Claude account profile" },
  { label: "Write the GitHub workflow", value: "init" },
  { label: "Doctor", value: "doctor", description: "check what a local run would use" },
  { label: "Account profiles", value: "profile" },
  { label: "Agent skills", value: "skills", description: "install the wachiman-review skills" },
  { label: "Back", value: "back" },
];

/** A ref or a commit: not empty, and not something `git` or the CLI would read as a flag. */
const refProblem = (what: string) => (v: string) => (v === "" ? `${what} is required.` : v.startsWith("-") ? `${what} cannot start with a dash.` : undefined);

interface Plan {
  action: Action;
  argv: string[];
  scope?: Scope;
}

export async function runLauncher(deps: LauncherDeps): Promise<number> {
  const { env, version } = deps;
  const cwd = deps.cwd ?? process.cwd();
  const prompter = createPrompter(deps.promptIO ?? { input: process.stdin, output: process.stderr }, env);
  const finish = (code: number) => {
    // The prompt session ends before the command starts: it takes the terminal for itself.
    prompter.close();
    return code;
  };
  try {
    await prompter.intro(version);
    const context = repoContext(cwd, env, deps.git);
    prompter.say(context.line, "muted");

    for (;;) {
      prompter.say("");
      const top = await prompter.select<Top>("What would you like to do?", TOP, 0);
      if (top === null) return finish(cancelled(prompter));
      if (top === "exit") return finish(0);
      if ((top === "review" || top === "ask" || top === "loop") && !context.name) {
        // Fail before the scope, base and question prompts: none of these can run outside a clone.
        prompter.say("This needs a git repository. Run wachiman from inside a clone.", "error");
        continue;
      }
      const plan = await planFor(top, prompter, { cwd, git: deps.git, context });
      if (plan === "back") continue;
      if (plan === null) return finish(cancelled(prompter));

      const line = commandLine(plan.argv);
      if (SPENDING.has(plan.action) || plan.action === "skills") {
        if (!context.name && plan.action !== "skills") {
          prompter.say("This needs a git repository. Run wachiman from inside a clone.", "error");
          continue;
        }
        prompter.say("");
        const rows: [string, string][] = SPENDING.has(plan.action)
          ? [["repository", context.name ?? "-"], ["scope", plan.scope ? scopeLabel(plan.scope) : "the open loop"], ["profile", context.profile], ["command", line]]
          : [["command", line]];
        for (const [k, v] of rows) prompter.say(`  ${k.padEnd(10)} ${v}`);
        prompter.say(
          SPENDING.has(plan.action) ? "  It runs your signed-in Claude and counts against your subscription." : "  It copies the skills into ~/.agents/skills and each Claude Code config directory.",
          "muted",
        );
        const go = await prompter.confirm(SPENDING.has(plan.action) ? "Run it?" : "Install them?", true);
        if (go === null) return finish(cancelled(prompter));
        if (!go) {
          prompter.say("Nothing was run.", "muted");
          continue;
        }
      } else prompter.say(`  ${line}`, "muted");
      prompter.close();
      return await deps.dispatch(plan.argv);
    }
  } catch (error) {
    prompter.close();
    throw error;
  }
}

function cancelled(prompter: Prompter): number {
  prompter.say("cancelled: nothing was run.", "warning");
  return 130;
}

/** The repository name and the profile a run here would use, for the first line and the confirmation. Never throws. */
function repoContext(cwd: string, env: Record<string, string | undefined>, git?: GitRunner): { name?: string; profile: string; line: string } {
  let name: string | undefined;
  try {
    name = repositoryKey(cwd, git).name;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
  }
  let profile = "unresolved";
  if (name) {
    try {
      const { resolved } = projectShow(cwd, env, { git });
      profile =
        "error" in resolved
          ? "unresolved (run wachiman setup)"
          : resolved.rung === "binding"
            ? resolved.profile
            : resolved.rung === "builtIn"
              ? `${resolved.profile}, not bound to this repository`
              : `${resolved.profile} (from ${resolved.rung})`;
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
    }
  }
  return { name, profile, line: name ? `${name} · profile ${profile}` : "not inside a git repository" };
}

/** Asks what the chosen entry needs. `"back"` returns to the main menu; `null` is a cancellation. */
async function planFor(top: Exclude<Top, "exit">, prompter: Prompter, ctx: { cwd: string; git?: GitRunner; context: { name?: string } }): Promise<Plan | Back | null> {
  if (top === "findings" || top === "configure") {
    const picked = await prompter.select<Action | Back>(top === "findings" ? "Findings & usage" : "Configure", top === "findings" ? FINDINGS : CONFIGURE, 0);
    if (picked === null) return null;
    return picked === "back" ? "back" : { action: picked, argv: commandArgs(picked) };
  }
  if (top === "loop") {
    const mode = await prompter.select<"start" | "continue" | Back>(
      "Review loop",
      [
        { label: "Start a new loop", value: "start", description: "round 1 reviews everything since the base" },
        { label: "Continue the open loop", value: "continue", description: "reviews only the commits since the last round" },
        { label: "Back", value: "back" },
      ],
      1,
    );
    if (mode === null) return null;
    if (mode === "back") return "back";
    if (mode === "continue") return { action: "loop-continue", argv: commandArgs("loop-continue") };
    const base = await prompter.text("Base (the branch or commit the loop starts from)", detectBase(ctx.cwd, ctx.git), refProblem("The base"));
    if (base === null) return null;
    return { action: "loop-start", argv: commandArgs("loop-start", { base }), scope: { kind: "branch", base } };
  }

  const kind = await prompter.select<Scope["kind"]>(top === "review" ? "What should be reviewed?" : "What is the question about?", SCOPES, 0);
  if (kind === null) return null;
  let scope: Scope;
  if (kind === "branch") {
    const base = await prompter.text("Base (the branch or commit this one is compared against)", detectBase(ctx.cwd, ctx.git), refProblem("The base"));
    if (base === null) return null;
    scope = { kind, base };
  } else if (kind === "commit") {
    const commit = await prompter.text("Commit", "HEAD", refProblem("The commit"));
    if (commit === null) return null;
    scope = { kind, commit };
  } else scope = { kind };

  if (top === "review") return { action: "review", argv: commandArgs("review", { scope }), scope };
  const question = await prompter.text("Question (leave empty for a walkthrough of the change)", "", (v) => (v.startsWith("-") ? "Start the question with a word, not a dash." : undefined));
  if (question === null) return null;
  return { action: "ask", argv: commandArgs("ask", { scope, question }), scope };
}
