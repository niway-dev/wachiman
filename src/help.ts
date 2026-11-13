/**
 * The help text of every command. `wachiman --help` is a short index; `wachiman <command> --help`
 * and `wachiman help <command>` print one command's page, and `wachiman help ci` the commands that
 * only a GitHub Actions run uses. Nothing here loads configuration, reads the repository or calls a
 * model: `helpFor` is called by `main` before any of that. The full reference is docs/cli.md.
 */
import { terminalStyle, type Tone } from "./wizard/style";
import { askUsage } from "./local-ask";
import { dashboardUsage } from "./store/command";
import { doctorUsage } from "./doctor/run";
import { historyUsage } from "./history/command";
import { initUsage } from "./init/args";
import { localUsage } from "./local";
import { loopUsage } from "./loop/command";
import { profileUsage, projectUsage, setupUsage } from "./accounts/commands";
import { skillsUsage } from "./skills/install";
import { statusUsage } from "./status/command";

export const DOCS = "https://github.com/niway-dev/wachiman/blob/main/docs";

/** Colors the section headers only; plain text when the output is not a terminal or `NO_COLOR` is set. */
export type Paint = (text: string, tone: Tone) => string;

export const plain: Paint = (text) => text;

export function paintFor(output: { isTTY?: boolean }, env: Record<string, string | undefined>): Paint {
  return terminalStyle(output, env);
}

type Row = readonly [name: string, text: string];

interface Page {
  /** The usage lines (a usage constant of the command, or several lines for a parent command). */
  usage: string;
  summary: string;
  options?: readonly Row[];
  env?: readonly Row[];
  exit: readonly Row[];
  examples: readonly string[];
  docs: string;
  /** Pages of the nested commands (`profile create`, `skills install`, …). */
  subs?: Readonly<Record<string, Page>>;
}

const REPO_DIR: Row = ["--repo-dir <dir>", "The clone to read. Default: the current directory"];
const PROFILE: Row = ["--profile <name>", "The account to run on: `default` (your own claude), a registered profile, or `isolated[:<name>]`. Default: the project binding, WACHIMAN_PROFILE, the configured default, then `default`"];
const HOME_ENV: Row = ["WACHIMAN_HOME", "The Wachiman home, an absolute path. Default: ~/.wachiman"];
const PROFILE_ENV: Row = ["WACHIMAN_PROFILE", "The profile used when there is no --profile and no project binding"];
const KEY_ENV: Row = ["ANTHROPIC_API_KEY", "Must be unset: the run refuses to start (exit 2) so the call goes to your subscription"];
const OTHER_ENV: Row = ["WACHIMAN_*", `Other engine settings: ${DOCS}/configuration.md`];
const SCOPE: readonly Row[] = [
  ["--base <ref>", "Compare with this branch (merge-base to HEAD). Default: origin/HEAD, else main. No fetch is made"],
  ["--from <commit>", "From that commit forward: <commit>^ to HEAD. Excludes --base and --commit"],
  ["--commit <commit>", "Exactly that commit: <commit>^ to <commit>. Excludes --base and --from"],
  ["--working-tree staged|all", "Tracked local changes against HEAD: the index, or the index plus unstaged edits. Excludes --base, --from, --commit"],
  ["--max-depth <n>", "The most commits between the start and HEAD; deeper exits 2 before any call. Default: 250"],
];
const GH_EXIT: readonly Row[] = [
  ["0", "Posted, or nothing to do (with limit_mode: notice a spend limit also exits 0)"],
  ["1", "Engine error: a failed gh call, no review returned, or a missing provider binary or credential"],
  ["2", "Usage error: unknown flag, missing or invalid pull request number, missing GH_TOKEN, GITHUB_REPOSITORY or REQUEST, an invalid setting"],
  ["3", "The spend ledger stopped the run before any model call"],
];
const GH_ENV: readonly Row[] = [
  ["GH_TOKEN", "Token for gh. Never given to the agent"],
  ["GITHUB_REPOSITORY", "owner/name of the repository"],
  ["ANTHROPIC_API_KEY", "The claude-code provider needs this or CLAUDE_CODE_OAUTH_TOKEN (not in a dry run)"],
  ["CLAUDE_CODE_OAUTH_TOKEN", "A Claude subscription token (`claude setup-token`); when set it wins and the API key never reaches the agent"],
  OTHER_ENV,
];
const COMMENT_ENV: readonly Row[] = [
  ["WACHIMAN_COMMENT_AUTHOR", "The login of the comment's author"],
  ["WACHIMAN_COMMENT_ID", "The review comment's id; with it a question is answered in its thread"],
  ["WACHIMAN_COMMENT_IN_REPLY_TO", "The id of the comment this one replies to"],
  ["WACHIMAN_COMMENT_PATH, WACHIMAN_COMMENT_LINE", "The file and line the review comment is on"],
];
const CONFIRMATION_EXIT: readonly Row[] = [
  ["0", "Done (including a \"no\" answer)"],
  ["2", "Usage error"],
  ["130", "Cancelled (Escape, Ctrl-C, Ctrl-D); nothing pending is saved"],
];

const reviewPage: Page = {
  usage: "wachiman review <pr> [paths…] [--repo-dir <dir>]",
  summary: "Review a pull request (or only the given paths) and post one GitHub review. After the first review, only what changed since the last reviewed commit.",
  options: [["<pr>", "The pull request number (digits, greater than 0)"], ["[paths…]", "Only these paths"], ["--repo-dir <dir>", "The checked-out pull request head: every file the engine reads and the agent's working directory. Default: the current directory"]],
  env: GH_ENV,
  exit: GH_EXIT,
  examples: ["wachiman review 42 --repo-dir ./head", "wachiman review 42 src/engine.ts"],
  docs: `${DOCS}/cli.md#incremental-reviews`,
};

const commentPage: Page = {
  usage: "wachiman comment <pr> [--repo-dir <dir>]",
  summary: "Handle the operator's comment in $REQUEST: route it to a review or an answer. Takes no paths.",
  options: [["<pr>", "The pull request number"], ["--repo-dir <dir>", "The checked-out pull request head. Default: the current directory"]],
  env: [["REQUEST", "The comment text. Pass it through the environment, never interpolated into a shell command"], ...GH_ENV.slice(0, 2), ...COMMENT_ENV, ...GH_ENV.slice(2)],
  exit: GH_EXIT,
  examples: ['REQUEST="@wachiman review" wachiman comment 42 --repo-dir ./head'],
  docs: `${DOCS}/cli.md#what-comment-does`,
};

const threadsPage: Page = {
  usage: "wachiman threads <pr> [--repo-dir <dir>]",
  summary: "Answer the pending Wachiman threads, with no review; only when the pull request's head was already reviewed (an automatic run). Takes no paths.",
  options: [["<pr>", "The pull request number"], ["--repo-dir <dir>", "The checked-out pull request head. Default: the current directory"]],
  env: [...GH_ENV.slice(0, 2), ...COMMENT_ENV, ...GH_ENV.slice(2)],
  exit: GH_EXIT,
  examples: ["wachiman threads 42 --repo-dir ./head"],
  docs: `${DOCS}/cli.md#what-threads-does`,
};

const resetConfidencePage: Page = {
  usage: "wachiman reset-confidence <pr> [--commit <sha>]",
  summary: 'Write "cannot say" into the PR Confidence block. No model call; the first step of a review run with WACHIMAN_CONFIDENCE=1.',
  options: [["<pr>", "The pull request number"], ["--commit <sha>", "The commit under review"]],
  env: [["GH_TOKEN, GITHUB_REPOSITORY", "Required (unless confidence is off)"], ["WACHIMAN_CONFIDENCE", "Set to 1 to enable the block"]],
  exit: [["0", "Reset, or nothing to do; a failure inside the reset itself is a warning"], ["2", "Usage or configuration error: a bad pull request number or flag, an invalid WACHIMAN_* value, a missing GH_TOKEN or GITHUB_REPOSITORY"]],
  examples: ["wachiman reset-confidence 42 --commit 1a2b3c4"],
  docs: `${DOCS}/pr-confidence.md`,
};

const localPage: Page = {
  usage: localUsage,
  summary: "Review the committed branch of a clone on your signed-in claude and print it. Nothing is posted and no GitHub call is made.",
  options: [
    ["[paths…]", "Only the changed files under these paths. Default: the whole change"],
    ...SCOPE,
    ["--input <file>", "A wachiman.review-input/1 or /2 file instead of the local diff. Takes no --base, --from, --commit or paths"],
    ["--format terminal|markdown|json", "Plain text, a Markdown report with the prompt for your agent, or the ReviewResult JSON. Default: terminal"],
    ["--output <file>", "Write the report to a file; its path is printed on stderr. Default: stdout"],
    ["--agent-prompt", "With terminal, also print the prompt for your agent. Default: off"],
    PROFILE,
    ["--verify | --no-verify", "One more call tries to refute each finding above info. Default: follows WACHIMAN_VERIFY (off)"],
    ["--result-version 1|2", "With --format json only. Default: 1 for committed changes, 2 for --working-tree"],
    ["--history", "Save the run under ~/.wachiman/history and label each finding new or open. Default: off (or WACHIMAN_HISTORY=1)"],
    REPO_DIR,
  ],
  env: [
    KEY_ENV,
    HOME_ENV,
    PROFILE_ENV,
    ["WACHIMAN_HISTORY", "1 saves the run, as --history"],
    ["WACHIMAN_VERIFY, WACHIMAN_VERIFIER_MODEL", "Turn verification on, and pick the verifier's model"],
    ["WACHIMAN_BUDGET_USD", "The most one run may spend. Default: 3"],
    ["WACHIMAN_BATCH_BUDGET_USD", "The cap on each call (soft)"],
    ["WACHIMAN_SIZE_GATE_USD", "An estimate above this (or the budget, if larger) prints one warning and continues"],
    OTHER_ENV,
  ],
  exit: [
    ["0", "A report was printed (complete, partial, or ended by the account's usage limit)"],
    ["1", "No call returned a review, or the claude binary did not run"],
    ["2", "Usage error: an unknown option, ANTHROPIC_API_KEY set, a profile that cannot be resolved, a detached HEAD, a range deeper than --max-depth, no merge-base"],
    ["130", "Interrupted (Ctrl-C); the snapshot was removed"],
  ],
  examples: ["wachiman local --base main", "wachiman local --working-tree staged --format markdown --output review.md"],
  docs: `${DOCS}/local-review.md`,
};

const loopPage: Page = {
  usage: loopUsage,
  summary: "Run one round of a review loop on your signed-in claude: `local` with history on and a stop rule. The CLI never edits code; fix, or judge a finding wrong with a reason, between calls.",
  options: [
    ["--base <ref>", "Start a new loop; round 1 reviews the whole range. Without it, continue the open loop and review only the commits since the last round"],
    ["--max-rounds <n>", "The round cap. Default: 3"],
    ["--max-depth <n>", "The most commits from the start to HEAD. Default: 250"],
    ["--format terminal|json", "The round as text or wachiman.loop-round/1. Default: terminal"],
    PROFILE,
    ["--verify | --no-verify", "Verification of each finding. Default: follows WACHIMAN_VERIFY"],
    REPO_DIR,
  ],
  env: [KEY_ENV, HOME_ENV, PROFILE_ENV, ["WACHIMAN_VERIFY, WACHIMAN_VERIFIER_MODEL", "Turn verification on, and pick the verifier's model"], OTHER_ENV],
  exit: [
    ["0", "Converged: no Blocker or Fix is open"],
    ["10", "Findings are still open"],
    ["11", "Stopped without converging (round cap, or the review failed twice). A stop is never an approval"],
    ["2", "Usage error: no loop open, a detached HEAD, an unknown flag"],
    ["130", "Interrupted"],
  ],
  examples: ["wachiman loop --base main", "wachiman loop --max-rounds 5 --format json"],
  docs: `${DOCS}/cli.md#loop`,
};

const askPage: Page = {
  usage: askUsage,
  summary: "Answer one question about the change `local` would review, or explain it when there is no question. One call on your signed-in claude; no GitHub request. Grounded in the stored review when `local --history` kept one; never runs a review.",
  options: [
    ["[question…]", "The words are the question. None: a five-section walkthrough"],
    ...SCOPE,
    PROFILE,
    ["--format terminal|markdown|json", "Plain text with the cost line, Markdown, or wachiman.ask-result/1. Default: terminal"],
    ["--output <file>", "Write the answer to a file; its path is printed on stderr. Default: stdout"],
    REPO_DIR,
  ],
  env: [KEY_ENV, HOME_ENV, PROFILE_ENV, OTHER_ENV],
  exit: [
    ["0", "An answer was printed (it may say what it could not answer)"],
    ["1", "No answer: the call failed or returned nothing usable"],
    ["2", "Usage error: an unknown flag, a scope with no kept file, ANTHROPIC_API_KEY set"],
    ["130", "Interrupted"],
  ],
  examples: ['wachiman ask "how does the retry budget work?" --commit 1a2b3c4', "wachiman ask --working-tree all"],
  docs: `${DOCS}/cli.md#ask`,
};

const historyPage: Page = {
  usage: historyUsage,
  summary: "List, judge and forget the findings kept by `local --history`. Reads files and local git metadata only: no claude, no GitHub.",
  options: [
    ["--since <n>d", "Only findings seen in the last n days"],
    ["--all-repos", "Every repository in the history, not just this clone's"],
    ["--json", "The replayed state as wachiman.history-state/1"],
    ["--verdict <id> correct|partial|wrong", "Record your judgement of a finding (the id is in the report and the listing)"],
    ["--reason <text>", "With --verdict: why"],
    ["--forget [--all]", "Delete this repository's history, or all of it with --all. Takes no --all-repos, --json or --since"],
    REPO_DIR,
  ],
  env: [HOME_ENV],
  exit: [["0", "Listed, recorded or forgotten (no history prints one line)"], ["2", "Usage error, including a --verdict id that matches no finding"]],
  examples: ["wachiman history --since 7d", 'wachiman history --verdict 3f9a1c wrong --reason "the guard is two lines above"'],
  docs: `${DOCS}/cli.md#history`,
};

const statusPage: Page = {
  usage: statusUsage,
  summary: "Show what this laptop kept of its local runs and their estimated cost. Reads local history only; GitHub Actions runs are not counted.",
  options: [
    ["--since <n>d", "Only runs from the last n days"],
    ["--all-repos", "Every repository in the history"],
    ["--repo <name|key>", "One repository by name or key, from any directory"],
    ["--model <text>", "Only runs whose model id contains the text"],
    ["--profile <name>", "Only runs made with that account"],
    ["--by day|repo|model|profile", "How the table groups runs. Default: day"],
    ["--json", "wachiman.status/1: the filters, totals, groups and every run"],
    REPO_DIR,
  ],
  env: [HOME_ENV, ["WACHIMAN_HISTORY_DAYS", "How long a --history run is kept. Default: 30; 0 keeps all"]],
  exit: [["0", "Printed (with no run kept it says how to start)"], ["2", "Usage error"]],
  examples: ["wachiman status --since 7d --by model", "wachiman status --all-repos --json"],
  docs: `${DOCS}/cli.md#status`,
};

const dashboardPage: Page = {
  usage: dashboardUsage,
  summary: "Export one static HTML page (or JSON) with the spend, findings and loop rounds of every repository in the local history. No claude, no GitHub, no network, no server.",
  options: [
    ["--json", "Print wachiman.dashboard/1 on stdout instead of writing the page"],
    ["--out <file>", "Where to write the page. Default: ~/.wachiman/dashboard.html. Not allowed with --json"],
    ["--repo-dir <dir>", "Accepted and unused"],
  ],
  env: [HOME_ENV],
  exit: [["0", "Written or printed (also with no run kept)"], ["1", "A loop file, the index or the page could not be written"], ["2", "Usage error"]],
  examples: ["wachiman dashboard", "wachiman dashboard --json"],
  docs: `${DOCS}/local-dashboard.md`,
};

const setupPage: Page = {
  usage: setupUsage,
  summary: "Bind this repository to an account profile; written in the Wachiman home, never in the repository. On a terminal without --profile it asks, and can register or create a profile.",
  options: [
    ["--profile <name>", "The profile to bind. Without a terminal it is required and must already exist"],
    ["--yes", "No prompts. Requires --profile"],
    ["--json", "Print the result as JSON"],
    REPO_DIR,
  ],
  env: [HOME_ENV, ["CI", "true or 1 turns the prompts off, as no terminal does"]],
  exit: [["0", "Bound (including a \"no\" answer)"], ["1", "The closing doctor summary failed; the binding is already written"], ["2", "Usage error, such as no --profile when it cannot ask"], ["130", "Cancelled; nothing pending is saved"]],
  examples: ["wachiman setup", "wachiman setup --profile work --yes"],
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
};

const initPage: Page = {
  usage: initUsage,
  summary: "Write the GitHub Actions caller workflow (.github/workflows/wachiman-review.yml), or, with --mode local, write nothing and hand over to setup.",
  options: [
    ["--mode github|local|both", "What to set up. Required without a terminal"],
    ["--operator <login>", "The GitHub login allowed to command the reviewer. Required for github and both without a terminal"],
    ["--version <tag>", "vX.Y.Z or a 40-character commit SHA written after review.yml@. Default: the release bundled in this build"],
    ["--path <file>", "Default: .github/workflows/wachiman-review.yml; a .yml or .yaml file directly in .github/workflows/"],
    ["--force", "Replace an existing file after copying it to <file>.bak-<timestamp>"],
    ["--dry-run", "Print the file to stdout and write nothing"],
    ["--yes", "No prompts"],
    REPO_DIR,
  ],
  env: [HOME_ENV, ["CI", "true or 1 turns the prompts off"], ["NO_COLOR", "Turns styling off"]],
  exit: [["0", "Done (including a \"no\" answer)"], ["1", "Engine error"], ["2", "Usage error: an unknown flag, an existing file without --force, --mode local with a workflow flag"], ["130", "Cancelled; nothing is written"]],
  examples: ["wachiman init --mode both", "wachiman init --mode github --operator octocat --dry-run"],
  docs: `${DOCS}/cli.md#init`,
};

const doctorPage: Page = {
  usage: doctorUsage,
  summary: "Explain what a local run would use and what would fail. Makes no model call and no request.",
  options: [
    ["--json", "Print wachiman.doctor/1"],
    ["--profile <name>", "Check this profile instead of the resolved one"],
    ["--all-profiles", "Repeat the profile, auth and isolation rows for every profile. Excludes --profile"],
    ["--redact-paths", "Swap paths and URLs for placeholders so the output can be shared"],
    REPO_DIR,
  ],
  env: [HOME_ENV, PROFILE_ENV, ["ANTHROPIC_API_KEY", "When set, the environment row fails, because `local` would refuse to start"]],
  exit: [["0", "Every required check passed"], ["1", "A required check failed"], ["2", "Usage error"]],
  examples: ["wachiman doctor", "wachiman doctor --all-profiles --redact-paths"],
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
};

const ACCOUNT_ENV: readonly Row[] = [HOME_ENV, ["CI", "true or 1 means no terminal: confirmations need --yes"]];
const accountPage = (usage: string, summary: string, options: readonly Row[], examples: string[]): Page => ({
  usage, summary, options, env: ACCOUNT_ENV, exit: CONFIRMATION_EXIT, examples, docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
});

const profilePage: Page = {
  usage: profileUsage,
  summary: "Manage account profiles. A managed profile lives in ~/.wachiman/claude-<name>; an external one is your own Claude configuration directory, used in place. Run `wachiman profile <subcommand> --help` for one of them.",
  exit: CONFIRMATION_EXIT,
  env: ACCOUNT_ENV,
  examples: ["wachiman profile list", "wachiman profile create work"],
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
  subs: {
    list: accountPage("wachiman profile list [--json]", "List registered profiles and the unregistered claude-* directories under the home, with the projects bound to each and the default.", [["--json", "Print wachiman.profiles/1"]], ["wachiman profile list --json"]),
    create: accountPage("wachiman profile create [<name>]", "Create the managed profile <home>/claude-<name>, register it and start claude there so you can sign in (/login, then /exit).", [["<name>", "Default: isolated"]], ["wachiman profile create", "wachiman profile create work"]),
    add: accountPage("wachiman profile add <name> --config-dir <abs> [--binary <abs>] [--note <text>]", "Register a Claude configuration directory you already use, in place (an external profile). Wachiman never writes into it.", [
      ["--config-dir <abs>", "An absolute, existing directory outside the Wachiman home"],
      ["--binary <abs>", "An absolute, executable claude binary (an npm shim is refused). Default: claude on PATH"],
      ["--note <text>", "A note kept with the profile"],
    ], ["wachiman profile add work --config-dir ~/.claude-work"]),
    login: accountPage("wachiman profile login <name>", "Start claude for that profile (with `auth login` when this claude has it) so you can sign in again. It never reads the outcome.", [["<name>", "A registered profile"]], ["wachiman profile login work"]),
    remove: accountPage("wachiman profile remove <name> [--delete-dir] [--yes]", "Remove the registration and every binding and default that named it. The directory stays unless you pass --delete-dir.", [
      ["--delete-dir", "Also delete the directory: asks twice for a managed profile, a usage error for an external one"],
      ["--yes", "Skip the question; required without a terminal"],
    ], ["wachiman profile remove work --yes"]),
    default: accountPage("wachiman profile default <name> | --none", "Set or clear the configured default profile.", [["<name>", "A registered profile"], ["--none", "Clear the default"]], ["wachiman profile default work", "wachiman profile default --none"]),
  },
};

const projectPage: Page = {
  usage: projectUsage,
  summary: "Inspect or remove this repository's account binding. Run `wachiman project <subcommand> --help` for one of them.",
  exit: CONFIRMATION_EXIT,
  env: ACCOUNT_ENV,
  examples: ["wachiman project show", "wachiman project unbind --yes"],
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
  subs: {
    show: accountPage("wachiman project show [--json] [--repo-dir <dir>]", "Show the repository's key, its binding, and what `local` would use here now, with the rule and any ignored values.", [["--json", "Print wachiman.project/1"], REPO_DIR], ["wachiman project show --json"]),
    unbind: accountPage("wachiman project unbind [--repo-dir <dir>] [--yes]", "Remove this repository's binding. It asks first.", [["--yes", "Skip the question; required without a terminal"], REPO_DIR], ["wachiman project unbind --yes"]),
  },
};

const SKILLS_EXIT: readonly Row[] = [["0", "Done (copies left in place are warnings)"], ["1", "A copy could not be written or removed"], ["2", "Usage error or a refused target (anything under the Wachiman home)"]];
const SKILLS_ENV: readonly Row[] = [HOME_ENV, ["CLAUDE_CONFIG_DIR", "Its skills folder is a target too, when it exists"]];
const skillsPage: Page = {
  usage: skillsUsage,
  summary: "Copy the wachiman-review, wachiman-loop and wachiman-audit agent skills into ~/.agents/skills and each Claude Code config directory, or remove the copies it marked. Never touches ~/.wachiman.",
  options: [["--dir <path>", "Add a skills directory of your own; may repeat"], ["--json", "install only: print wachiman.skills/1"]],
  env: SKILLS_ENV,
  exit: SKILLS_EXIT,
  examples: ["wachiman skills install", "wachiman skills uninstall"],
  docs: `${DOCS}/cli.md#skills`,
  subs: {
    install: {
      usage: "wachiman skills install [--dir <path>]… [--json]",
      summary: "Copy the agent skills into ~/.agents/skills and each Claude Code config directory. A copy you edited, or one that is not marked as Wachiman's, is left as it is and warned about.",
      options: [["--dir <path>", "Add a skills directory of your own; may repeat"], ["--json", "Print wachiman.skills/1: one entry per copy"]],
      env: SKILLS_ENV, exit: SKILLS_EXIT, examples: ["wachiman skills install", "wachiman skills install --dir ./my-skills --json"], docs: `${DOCS}/cli.md#skills`,
    },
    uninstall: {
      usage: "wachiman skills uninstall [--dir <path>]…",
      summary: "Remove only the files that a Wachiman marker lists and whose content still matches. Edited files and anything unmarked stay, with a warning.",
      options: [["--dir <path>", "Also look in this skills directory; may repeat"]],
      env: SKILLS_ENV, exit: SKILLS_EXIT, examples: ["wachiman skills uninstall"], docs: `${DOCS}/cli.md#skills`,
    },
  },
};

/** The commands a GitHub Actions run uses; they are not in the root help. */
export const CI_COMMANDS = ["review", "comment", "threads", "reset-confidence"] as const;

const PAGES: Readonly<Record<string, Page>> = {
  local: localPage, loop: loopPage, ask: askPage,
  history: historyPage, status: statusPage, dashboard: dashboardPage,
  setup: setupPage, init: initPage, doctor: doctorPage, profile: profilePage, project: projectPage, skills: skillsPage,
  review: reviewPage, comment: commentPage, threads: threadsPage, "reset-confidence": resetConfidencePage,
};

export const COMMANDS = Object.keys(PAGES);

export function isCommand(word: string | undefined): word is string {
  return word !== undefined && Object.hasOwn(PAGES, word);
}

/** Breaks `text` into lines of at most `room` characters at word boundaries. */
function wrapText(text: string, room: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > room) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines;
}

/** Rows as a two-column block: the name padded, the text wrapped under it. A long name takes its own line. */
function block(rows: readonly Row[], width = 100): string[] {
  const pad = Math.min(Math.max(...rows.map(([name]) => name.length)) + 2, 34);
  const room = Math.max(width - pad - 2, 30);
  const lines: string[] = [];
  for (const [name, text] of rows) {
    const wrapped = wrapText(text, room);
    if (name.length + 2 > pad) {
      lines.push(`  ${name}`, ...wrapped.map((w) => `  ${" ".repeat(pad)}${w}`));
    } else {
      lines.push(`  ${name.padEnd(pad)}${wrapped[0]}`, ...wrapped.slice(1).map((w) => `  ${" ".repeat(pad)}${w}`));
    }
  }
  return lines;
}

function renderPage(page: Page, paint: Paint): string {
  const out: string[] = [];
  const header = (title: string) => out.push("", paint(title, "strong"));
  out.push(paint("Usage", "strong"));
  for (const line of page.usage.split("\n")) out.push(`  ${line}`);
  out.push("", ...wrapText(page.summary, 78));
  if (page.options && page.options.length > 0) { header("Options"); out.push(...block(page.options)); }
  if (page.subs) { header("Subcommands"); out.push(...block(Object.entries(page.subs).map(([name, sub]) => [name, sub.summary.split(/(?<=\.)\s/)[0]] as Row))); }
  if (page.env && page.env.length > 0) { header("Environment"); out.push(...block(page.env)); }
  header("Exit codes");
  out.push(...block(page.exit));
  header("Examples");
  for (const example of page.examples) out.push(`  ${example}`);
  out.push("", `Docs: ${page.docs}`);
  return `${out.join("\n")}\n`;
}

export function rootHelp(paint: Paint = plain): string {
  const rows = (items: readonly Row[]) => items.map(([name, text]) => `  ${name.padEnd(12)}${text}`);
  return [
    "Wachiman — review code on your Claude subscription.",
    "",
    "Usage: wachiman <command> [options]",
    "",
    paint("Review", "strong"),
    ...rows([["local", "Review a branch, commit, or working-tree changes"], ["loop", "Run one round of a tracked review loop"], ["ask", "Explain a change or ask a question"]]),
    "",
    paint("Results", "strong"),
    ...rows([["history", "Browse findings and record verdicts"], ["status", "Show local usage and estimated cost"], ["dashboard", "Export a local usage dashboard"]]),
    "",
    paint("Configuration", "strong"),
    ...rows([
      ["setup", "Bind this repository to an account profile"],
      ["init", "Write the GitHub caller workflow, or hand over to setup"],
      ["doctor", "Explain what a local run would use and what would fail"],
      ["profile", "List, create, add, log in, remove and default profiles"],
      ["project", "Show or remove this repository's binding"],
      ["skills", "Install or remove the agent skills"],
    ]),
    "",
    "Help: wachiman <command> --help · wachiman help ci",
    `Docs: ${DOCS}/cli.md`,
    "Options: -h, --help · -v, --version",
    "",
  ].join("\n");
}

export function ciHelp(paint: Paint = plain): string {
  const out: string[] = [];
  out.push(paint("Commands for GitHub Actions", "strong"), "");
  out.push(...wrapText("These run inside the reusable workflow, not on a laptop. They post to GitHub and need GH_TOKEN. Run `wachiman <command> --help` for one of them.", 78));
  out.push("", paint("Usage", "strong"));
  for (const name of CI_COMMANDS) out.push(`  ${PAGES[name].usage}`);
  out.push("", paint("Commands", "strong"));
  out.push(...block(CI_COMMANDS.map((name) => [name, PAGES[name].summary.split(/(?<=\.)\s/)[0]] as Row)));
  out.push("", paint("Environment", "strong"));
  out.push(...block([GH_ENV[0], GH_ENV[1], ["REQUEST", "comment: the comment text"], ...COMMENT_ENV, ...GH_ENV.slice(2), ["WACHIMAN_CONFIDENCE", "reset-confidence: 1 enables the PR Confidence block"]]));
  out.push("", paint("Exit codes", "strong"));
  out.push(...block(GH_EXIT));
  out.push("", paint("Examples", "strong"));
  out.push("  wachiman review 42 --repo-dir ./head", '  REQUEST="@wachiman review" wachiman comment 42');
  out.push("", `Docs: ${DOCS}/cli.md#environment`);
  return `${out.join("\n")}\n`;
}

/**
 * The page for `words` (the command, then maybe a subcommand), or undefined when no command has that
 * name. A subcommand that does not exist falls back to the command's own page.
 */
export function commandHelp(words: readonly string[], paint: Paint = plain): string | undefined {
  const [command, sub] = words;
  if (!isCommand(command)) return undefined;
  const page = PAGES[command];
  const nested = sub !== undefined && page.subs && Object.hasOwn(page.subs, sub) ? page.subs[sub] : undefined;
  return renderPage(nested ?? page, paint);
}

export type HelpRequest = { text: string } | { error: string };

/**
 * What `wachiman help …`, `wachiman <command> --help` and `-h` print, or undefined when the arguments
 * are not a help request. It looks at the arguments only: the caller returns before any configuration,
 * authentication, git or model use.
 */
export function helpFor(argv: readonly string[], paint: Paint = plain): HelpRequest | undefined {
  const [first, ...rest] = argv;
  if (first === "help") {
    const words = rest.filter((word) => !word.startsWith("-"));
    if (words.length === 0) return { text: rootHelp(paint) };
    if (words[0] === "ci") return { text: ciHelp(paint) };
    const text = commandHelp(words, paint);
    return text === undefined ? { error: `Unknown help topic "${words[0]}".` } : { text };
  }
  if (first === "--setup-profile" && rest.some((arg) => arg === "--help" || arg === "-h")) {
    return { text: commandHelp(["profile", "create"], paint)! };
  }
  if (isCommand(first) && rest.some((arg) => arg === "--help" || arg === "-h")) {
    return { text: commandHelp([first, ...rest.filter((arg) => !arg.startsWith("-"))], paint)! };
  }
  return undefined;
}
