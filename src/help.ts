/**
 * The help text of every command. `wachiman --help` is a short index; `wachiman <command> --help`
 * and `wachiman help <command>` print one command's page, and `wachiman help ci` the commands that
 * only a GitHub Actions run uses. Nothing here loads configuration, reads the repository or calls a
 * model: `helpFor` is called by `main` before any of that. The full reference is docs/cli.md.
 */
import { plain, type Paint } from "./wizard/tone";
import { askUsage } from "./local-ask";
import { dashboardUsage } from "./store/command";
import { ledgerUsage } from "./ledger-read/command";
import { doctorUsage } from "./doctor/run";
import { calibrateUsage } from "./calibrate/command";
import { historyUsage } from "./history/command";
import { initUsage } from "./init/args";
import { localUsage } from "./local";
import { loopUsage } from "./loop/command";
import { profileUsage, projectUsage, setupUsage } from "./accounts/commands";
import { skillsUsage } from "./skills/install";
import { checkUsage, riskUsage, stripUsage } from "./pr-template/check-run";
import { formatUsage } from "./pr-template/format";
import { installUsage, showUsage, statusUsage as prTemplateStatusUsage } from "./pr-template/install";
import { statusUsage } from "./status/command";
import { prStateUsage } from "./pr-state";
import { upgradeUsage } from "./upgrade/command";

export const DOCS = "https://github.com/niway-dev/wachiman/blob/main/docs";

// Colors the section headers only. The page takes a `Paint`; `terminalStyle` in `src/wizard/style.ts` makes the one that uses
// chalk (plain text when the output is not a terminal or `NO_COLOR` is set), so this module, which
// the review engine's entry point imports, never loads it.
export { plain, type Paint };

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
const PROFILE: Row = [
  "--profile <name>",
  "The account to run on: `default` (your own claude), a registered profile, or `isolated[:<name>]`. Default: the project binding, WACHIMAN_PROFILE, the configured default, then `default`",
];
const DO_NOT_TRACK_ENV: Row = [
  "DO_NOT_TRACK",
  "Honored: Wachiman sends no usage data; set to 1 and no future opt-in can turn collection on",
];
const HOME_ENV: Row = ["WACHIMAN_HOME", "The Wachiman home, an absolute path. Default: ~/.wachiman"];
const PROFILE_ENV: Row = ["WACHIMAN_PROFILE", "The profile used when there is no --profile and no project binding"];
const KEY_ENV: Row = ["ANTHROPIC_API_KEY", "Must be unset: the run refuses to start (exit 2) so the call goes to your subscription"];
const OTHER_ENV: Row = ["WACHIMAN_*", `Other engine settings: ${DOCS}/configuration.md`];
const SCOPE: readonly Row[] = [
  ["--base <ref>", "Compare with this branch (merge-base to HEAD). Default: origin/HEAD, else main. No fetch is made"],
  ["--from <commit>", "From that commit forward: <commit>^ to HEAD. Excludes --base and --commit"],
  ["--commit <commit>", "Exactly that commit: <commit>^ to <commit>. Excludes --base and --from"],
  [
    "--working-tree staged|all",
    "Tracked local changes against HEAD: the index, or the index plus unstaged edits. Excludes --base, --from, --commit",
  ],
  ["--max-depth <n>", "The most commits between the start and HEAD; deeper exits 2 before any call. Default: 250"],
];
const GH_EXIT: readonly Row[] = [
  ["0", "Posted, or nothing to do (with limit_mode: notice a spend limit also exits 0)"],
  ["1", "Engine error: a failed gh call, no review returned, or a missing provider binary or credential"],
  [
    "2",
    "Usage error: unknown flag, missing or invalid pull request number, missing GH_TOKEN, GITHUB_REPOSITORY or REQUEST, an invalid setting",
  ],
  ["3", "The spend ledger stopped the run before any model call"],
];
const GH_ENV: readonly Row[] = [
  ["GH_TOKEN", "Token for gh. Never given to the agent"],
  ["GITHUB_REPOSITORY", "owner/name of the repository"],
  [
    "WACHIMAN_PRIORITY_TRIAL",
    "Set to 1 to run the finding priority A/B: each pull request shows the Important/Nit word or the Priority row, by a hash of repository and number",
  ],
  ["ANTHROPIC_API_KEY", "The claude-code provider needs this or CLAUDE_CODE_OAUTH_TOKEN (not in a dry run)"],
  [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "A Claude subscription token (`claude setup-token`); when set it wins and the API key never reaches the agent",
  ],
  OTHER_ENV,
];
const COMMENT_ENV: readonly Row[] = [
  ["WACHIMAN_COMMENT_AUTHOR", "The login of the comment's author"],
  ["WACHIMAN_COMMENT_ID", "The review comment's id; with it a question is answered in its thread"],
  ["WACHIMAN_COMMENT_IN_REPLY_TO", "The id of the comment this one replies to"],
  ["WACHIMAN_COMMENT_PATH, WACHIMAN_COMMENT_LINE", "The file and line the review comment is on"],
];
const CONFIRMATION_EXIT: readonly Row[] = [
  ["0", 'Done (including a "no" answer)'],
  ["2", "Usage error"],
  ["130", "Cancelled (Escape, Ctrl-C, Ctrl-D); nothing pending is saved"],
];

const reviewPage: Page = {
  usage: "wachiman review <pr> [paths…] [--repo-dir <dir>]",
  summary:
    "Review a pull request (or only the given paths) and post one GitHub review. After the first review, only what changed since the last reviewed commit.",
  options: [
    ["<pr>", "The pull request number (digits, greater than 0)"],
    ["[paths…]", "Only these paths"],
    [
      "--repo-dir <dir>",
      "The checked-out pull request head: every file the engine reads and the agent's working directory. Default: the current directory",
    ],
  ],
  env: GH_ENV,
  exit: GH_EXIT,
  examples: ["wachiman review 42 --repo-dir ./head", "wachiman review 42 src/engine.ts"],
  docs: `${DOCS}/cli.md#incremental-reviews`,
};

const commentPage: Page = {
  usage: "wachiman comment <pr> [--repo-dir <dir>]",
  summary: "Handle the operator's comment in $REQUEST: route it to a review or an answer. Takes no paths.",
  options: [
    ["<pr>", "The pull request number"],
    ["--repo-dir <dir>", "The checked-out pull request head. Default: the current directory"],
  ],
  env: [
    ["REQUEST", "The comment text. Pass it through the environment, never interpolated into a shell command"],
    ...GH_ENV.slice(0, 2),
    ...COMMENT_ENV,
    ...GH_ENV.slice(2),
  ],
  exit: GH_EXIT,
  examples: ['REQUEST="@wachiman review" wachiman comment 42 --repo-dir ./head'],
  docs: `${DOCS}/cli.md#what-comment-does`,
};

const threadsPage: Page = {
  usage: "wachiman threads <pr> [--repo-dir <dir>]",
  summary:
    "Answer the pending Wachiman threads, with no review; only when the pull request's head was already reviewed (an automatic run). Takes no paths.",
  options: [
    ["<pr>", "The pull request number"],
    ["--repo-dir <dir>", "The checked-out pull request head. Default: the current directory"],
  ],
  env: [...GH_ENV.slice(0, 2), ...COMMENT_ENV, ...GH_ENV.slice(2)],
  exit: GH_EXIT,
  examples: ["wachiman threads 42 --repo-dir ./head"],
  docs: `${DOCS}/cli.md#what-threads-does`,
};

const resetConfidencePage: Page = {
  usage: "wachiman reset-confidence <pr> [--commit <sha>]",
  summary: 'Write "cannot say" into the PR Confidence block. No model call; the first step of a review run with WACHIMAN_CONFIDENCE=1.',
  options: [
    ["<pr>", "The pull request number"],
    ["--commit <sha>", "The commit under review"],
  ],
  env: [
    ["GH_TOKEN, GITHUB_REPOSITORY", "Required (unless confidence is off)"],
    ["WACHIMAN_CONFIDENCE", "Set to 1 to enable the block"],
  ],
  exit: [
    ["0", "Reset, or nothing to do; a failure inside the reset itself is a warning"],
    [
      "2",
      "Usage or configuration error: a bad pull request number or flag, an invalid WACHIMAN_* value, a missing GH_TOKEN or GITHUB_REPOSITORY",
    ],
  ],
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
    [
      "--format terminal|markdown|json",
      "Plain text, a Markdown report with the prompt for your agent, or the ReviewResult JSON. Default: terminal",
    ],
    ["--output <file>", "Write the report to a file; its path is printed on stderr. Default: stdout"],
    ["--agent-prompt", "With terminal, also print the prompt for your agent. Default: off"],
    PROFILE,
    ["--verify | --no-verify", "One more call tries to refute each finding above info. Default: follows WACHIMAN_VERIFY (off)"],
    [
      "--result-version 1|2",
      "With --format json only. Default: 1 for committed changes, 2 for --working-tree and for a distributed-repo run that lists a sibling (read or not) or applied a contract. An explicit 1 with such a run exits 2",
    ],
    ["--history", "Save the run under ~/.wachiman/history and label each finding new or open. Default: off (or WACHIMAN_HISTORY=1)"],
    [
      "--no-memory",
      "Ignore .wachiman/memory/ for this run, as if the repository had none (the control arm of the memory replay). Default: off",
    ],
    [
      "--distributed-repo | --no-distributed-repo",
      "Also read the sibling repositories declared in the workspace manifest, for this run; the other flag turns a per-user default off. Default: off (or the default in ~/.wachiman/workspaces.json)",
    ],
    [
      "--sibling <dir>",
      "With --distributed-repo: also read this member of the workspace manifest in full, by its manifest dir. Repeatable. Exits 2 for a dir that is not a member",
    ],
    REPO_DIR,
  ],
  env: [
    KEY_ENV,
    HOME_ENV,
    PROFILE_ENV,
    ["WACHIMAN_HISTORY", "1 saves the run, as --history"],
    ["WACHIMAN_VERIFY, WACHIMAN_VERIFIER_MODEL", "Turn verification on, and pick the verifier's model"],
    ["WACHIMAN_BUDGET_USD", "The most one run may spend. Default: 3. An estimate above it prints one warning and the run continues"],
    ["WACHIMAN_BATCH_BUDGET_USD", "The cap on each call (soft)"],
    OTHER_ENV,
  ],
  exit: [
    ["0", "A report was printed (complete, partial, or ended by the account's usage limit)"],
    ["1", "No call returned a review, or the claude binary did not run"],
    [
      "2",
      "Usage error: an unknown option, ANTHROPIC_API_KEY set, a profile that cannot be resolved, a detached HEAD, a range deeper than --max-depth, no merge-base, conflicting --distributed-repo flags, --distributed-repo outside a workspace, a --sibling that is not a member or has no distributed-repo mode, --result-version 1 with a distributed-repo run that lists a sibling (read or not) or applied a contract",
    ],
    ["130", "Interrupted (Ctrl-C); the snapshot was removed"],
  ],
  examples: ["wachiman local --base main", "wachiman local --working-tree staged --format markdown --output review.md"],
  docs: `${DOCS}/local-review.md`,
};

const loopPage: Page = {
  usage: loopUsage,
  summary:
    "Run one round of a review loop on your signed-in claude: `local` with history on and a stop rule. The CLI never edits code; fix, or judge a finding wrong with a reason, between calls.",
  options: [
    [
      "--base <ref>",
      "Start a new loop; round 1 reviews the whole range. Without it, continue the open loop and review only the commits since the last round",
    ],
    ["--max-rounds <n>", "The round cap. Default: 3"],
    ["--max-depth <n>", "The most commits from the start to HEAD. Default: 250"],
    ["--format terminal|json", "The round as text or wachiman.loop-round/1. Default: terminal"],
    PROFILE,
    ["--verify | --no-verify", "Verification of each finding. Default: follows WACHIMAN_VERIFY"],
    [
      "--distributed-repo | --no-distributed-repo",
      "Every round also reads the sibling repositories declared in the workspace manifest, as `local` does; the other flag turns a per-user default off. A round that read a non-public sibling prints the private-context line. Default: off (or the default in ~/.wachiman/workspaces.json)",
    ],
    ["--sibling <dir>", "With --distributed-repo: also read this member of the workspace manifest in full, in every round. Repeatable"],
    REPO_DIR,
  ],
  env: [
    KEY_ENV,
    HOME_ENV,
    PROFILE_ENV,
    ["WACHIMAN_VERIFY, WACHIMAN_VERIFIER_MODEL", "Turn verification on, and pick the verifier's model"],
    OTHER_ENV,
  ],
  exit: [
    ["0", "Converged: no Blocker or Fix is open"],
    ["10", "Findings are still open"],
    ["11", "Stopped without converging (round cap, or the review failed twice). A stop is never an approval"],
    [
      "2",
      "Usage error: no loop open, a detached HEAD, an unknown flag, or a distributed-repo flag combination `local` refuses (both flags together, --distributed-repo outside a workspace, a --sibling that is not a member)",
    ],
    ["130", "Interrupted"],
  ],
  examples: ["wachiman loop --base main", "wachiman loop --max-rounds 5 --format json"],
  docs: `${DOCS}/cli.md#loop`,
};

const askPage: Page = {
  usage: askUsage,
  summary:
    "Answer one question about the change `local` would review, or explain it when there is no question. One call on your signed-in claude; no GitHub request. Grounded in the stored review when `local --history` kept one; never runs a review.",
  options: [
    ["[question…]", "The words are the question. None: a five-section walkthrough"],
    ...SCOPE,
    PROFILE,
    ["--format terminal|markdown|json", "Plain text with the cost line, Markdown, or wachiman.ask-result/1. Default: terminal"],
    ["--output <file>", "Write the answer to a file; its path is printed on stderr. Default: stdout"],
    [
      "--distributed-repo",
      "Assert that the stored review read sibling repositories. ask re-creates the snapshots that review read, by their stored commits, with or without it, and selects no sibling itself. Exits 2 with no stored review or one that read no sibling",
    ],
    REPO_DIR,
  ],
  env: [KEY_ENV, HOME_ENV, PROFILE_ENV, OTHER_ENV],
  exit: [
    ["0", "An answer was printed (it may say what it could not answer)"],
    ["1", "No answer: the call failed or returned nothing usable"],
    [
      "2",
      "Usage error: an unknown flag, a scope with no kept file, ANTHROPIC_API_KEY set, --distributed-repo with no stored review that read a sibling",
    ],
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
    [
      "--verdict <id> correct|partial|wrong|intentional|not-important",
      "Record your judgement of a finding (the id is in the report and the listing)",
    ],
    ["--reason <text>", "With --verdict: why"],
    ["--forget [--all]", "Delete this repository's history, or all of it with --all. Takes no --all-repos, --json or --since"],
    REPO_DIR,
  ],
  env: [HOME_ENV],
  exit: [
    ["0", "Listed, recorded or forgotten (no history prints one line)"],
    ["2", "Usage error, including a --verdict id that matches no finding"],
  ],
  examples: ["wachiman history --since 7d", 'wachiman history --verdict 3f9a1c wrong --reason "the guard is two lines above"'],
  docs: `${DOCS}/cli.md#history`,
};

const calibratePage: Page = {
  usage: calibrateUsage,
  summary:
    "Measure how the reviewer's findings fared on GitHub, draw a blind sample to judge, and propose the next priority table from your judgements. Reads GitHub through `gh`; changes nothing the engine reads.",
  options: [
    ["<owner/repo>", "The repository whose pull requests are read"],
    ["--prs <n>", "How many recent pull requests to read. Default: 50"],
    ["--json", "The outcome table as wachiman.calibration/1 JSON"],
    [
      "--judge",
      "Write a blind sample of findings (priority word hidden, unanswered included) to the Wachiman home, then stop. Set wouldAct on each line",
    ],
    ["--count <n>", "With --judge: findings to draw. Default: 40, spread over the 7 movable cells"],
    ["--seed <n>", "With --judge: the random seed. Default: today's date as YYYYMMDD"],
    [
      "--propose",
      "Fit the next table to your judgements and write proposed-table.json; prints each cell's change beside its fix and decline rates",
    ],
  ],
  env: [HOME_ENV, ["GH_TOKEN", "The `gh` login used to read pull requests"]],
  exit: [
    ["0", "Printed, drawn or proposed (no judgements prints one line and proposes no change)"],
    ["1", "A `gh` call failed"],
    ["2", "Usage error"],
  ],
  examples: [
    "wachiman calibrate niway-dev/wachiman --prs 50",
    "wachiman calibrate niway-dev/wachiman --judge --seed 7",
    "wachiman calibrate niway-dev/wachiman --propose",
  ],
  docs: `${DOCS}/calibration.md`,
};

const REFRESH: Row = [
  "--refresh",
  "Run `ledger pull` first (the only request it can make). A failed download warns and keeps the entries already on disk. With no ledger connected it exits 2",
];
const LEDGER_ENV: Row = ["WACHIMAN_LEDGER_URL, WACHIMAN_LEDGER_TOKEN", "Override the connected ledger (only read with --refresh)"];

const statusPage: Page = {
  usage: statusUsage,
  summary:
    "Show what this laptop kept of its local runs and their estimated cost; after `ledger pull`, GitHub Actions runs too. Reads local files only unless --refresh is given.",
  options: [
    ["--since <n>d", "Only runs from the last n days"],
    ["--all-repos", "Every repository in the history"],
    ["--repo <name|key>", "One repository by name or key, from any directory"],
    ["--model <text>", "Only runs whose model id contains the text"],
    ["--profile <name>", "Only runs made with that account (leaves out Actions runs)"],
    ["--by day|week|repo|pr|model|profile|source", "How the table groups runs. Default: day"],
    ["--source laptop|actions|all", "Only laptop runs, only Actions runs from the pulled ledger, or both. Default: all"],
    REFRESH,
    ["--json", "wachiman.status/1: the filters, totals, groups and every run"],
    REPO_DIR,
  ],
  env: [HOME_ENV, ["WACHIMAN_HISTORY_DAYS", "How long a --history run is kept. Default: 30; 0 keeps all"], LEDGER_ENV],
  exit: [
    ["0", "Printed (with no run kept it says how to start)"],
    ["2", "Usage error, or --refresh or --source actions with no ledger connected"],
  ],
  examples: ["wachiman status --since 7d --by model", "wachiman status --all-repos --source actions --json"],
  docs: `${DOCS}/cli.md#status`,
};

const dashboardPage: Page = {
  usage: dashboardUsage,
  summary:
    "Export one static HTML page (or JSON) with the spend, findings and loop rounds of every repository in the local history, and Actions spend once a ledger is pulled. No claude, no GitHub, no server; a request only with --refresh.",
  options: [
    ["--json", "Print wachiman.dashboard/1 on stdout instead of writing the page"],
    ["--out <file>", "Where to write the page. Default: ~/.wachiman/dashboard.html. Not allowed with --json"],
    REFRESH,
    ["--repo-dir <dir>", "Accepted and unused"],
  ],
  env: [HOME_ENV, LEDGER_ENV],
  exit: [
    ["0", "Written or printed (also with no run kept)"],
    ["1", "A loop file, the index or the page could not be written"],
    ["2", "Usage error, or --refresh with no ledger connected"],
  ],
  examples: ["wachiman dashboard", "wachiman dashboard --json"],
  docs: `${DOCS}/local-dashboard.md`,
};

const LEDGER_EXIT: readonly Row[] = [
  ["0", "Done"],
  ["1", "The ledger could not be reached, refused the token or answered something unexpected"],
  ["2", "Usage error, or pull with no ledger connected"],
];
const ledgerPage = (usage: string, summary: string, options: readonly Row[], examples: string[]): Page => ({
  usage,
  summary,
  options,
  env: [HOME_ENV, ["WACHIMAN_LEDGER_URL, WACHIMAN_LEDGER_TOKEN", "Override the credentials file"]],
  exit: LEDGER_EXIT,
  examples,
  docs: `${DOCS}/cli.md#ledger`,
});
const ledgerRoot = ledgerPage(
  ledgerUsage,
  "Connect with a read token (not the workflow's `ledger_url`) and download the spend ledger's entries, so status and dashboard can show Actions runs next to laptop runs. Only pull and --refresh make a request, and no run data is ever sent from the laptop. Run `wachiman ledger <subcommand> --help` for one of them.",
  [],
  ["wachiman ledger connect https://ledger.example.com", "wachiman ledger pull --since 14d"],
);
const ledgerSubs: Record<string, Page> = {
  connect: ledgerPage(
    "wachiman ledger connect <url>",
    "Ask for the read token on standard input (not echoed) and keep it in ~/.wachiman/ledger/credentials.json, mode 0600.",
    [["<url>", "https, or http only for localhost, 127.0.0.1 or [::1]"]],
    ["wachiman ledger connect https://ledger.example.com"],
  ),
  disconnect: ledgerPage(
    "wachiman ledger disconnect",
    "Delete the stored credentials. Entries already downloaded stay on disk.",
    [],
    ["wachiman ledger disconnect"],
  ),
  pull: ledgerPage(
    "wachiman ledger pull [--since <n>d]",
    "Download the ledger's entries into ~/.wachiman/ledger, one file per UTC day, replacing each day as a whole.",
    [["--since <n>d", "How many days back. Default: 35; at most 92"]],
    ["wachiman ledger pull", "wachiman ledger pull --since 7d"],
  ),
};
const ledgerPageWithSubs: Page = { ...ledgerRoot, options: undefined, subs: ledgerSubs };

const setupPage: Page = {
  usage: setupUsage,
  summary:
    "Bind this repository to an account profile; written in the Wachiman home, never in the repository. On a terminal without --profile it asks, and can register or create a profile.",
  options: [
    ["--profile <name>", "The profile to bind. Without a terminal it is required and must already exist"],
    ["--yes", "No prompts. Requires --profile"],
    ["--json", "Print the result as JSON"],
    REPO_DIR,
  ],
  env: [HOME_ENV, ["CI", "true or 1 turns the prompts off, as no terminal does"]],
  exit: [
    ["0", 'Bound (including a "no" answer)'],
    ["1", "The closing doctor summary failed; the binding is already written"],
    ["2", "Usage error, such as no --profile when it cannot ask"],
    ["130", "Cancelled; nothing pending is saved"],
  ],
  examples: ["wachiman setup", "wachiman setup --profile work --yes"],
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
};

const initPage: Page = {
  usage: initUsage,
  summary:
    "Write the GitHub Actions caller workflow (.github/workflows/wachiman-review.yml), or, with --mode local, write no workflow and hand over to setup. With a repository kind, also write .wachiman.yml. It writes a pointer to the wachiman-loop skill into AGENTS.md (or CLAUDE.md). It can also install the PR description template.",
  options: [
    ["--mode github|local|both", "What to set up. Required without a terminal"],
    ["--operator <login>", "The GitHub login allowed to command the reviewer. Required for github and both without a terminal"],
    ["--version <tag>", "vX.Y.Z or a 40-character commit SHA written after review.yml@. Default: the release bundled in this build"],
    ["--path <file>", "Default: .github/workflows/wachiman-review.yml; a .yml or .yaml file directly in .github/workflows/"],
    [
      "--project-kind monorepo|single",
      "The kind of repository, recorded in .wachiman.yml (metadata only). Asked on a terminal; without one, the file is left alone",
    ],
    [
      "--force",
      "Replace an existing workflow after copying it to <file>.bak-<timestamp>; with --project-kind, also change a different kind",
    ],
    [
      "--dry-run",
      "Write nothing. github and both print the rendered workflow to stdout; local reports on stderr what it would write (.wachiman.yml, the PR template)",
    ],
    [
      "--pr-template",
      "Also install the PR description template (`wachiman pr-template install`, files only, never a commit). A refusal is reported and does not fail init",
    ],
    ["--no-pr-template", "Do not install it and do not ask. Without either flag a terminal asks (default yes) and a script gets none"],
    ["--no-agent-pointer", "Do not write the wachiman pointer into AGENTS.md or CLAUDE.md. A failure to write it never fails init"],
    ["--yes", "No prompts"],
    [
      "--json",
      "Never prompt, and print one wachiman.init/1 document on stdout (files and their actions, local and GitHub readiness, error). Status lines go to stderr",
    ],
    REPO_DIR,
  ],
  env: [HOME_ENV, ["CI", "true or 1 turns the prompts off"], ["NO_COLOR", "Turns styling off"], DO_NOT_TRACK_ENV],
  exit: [
    ["0", 'Done (including a "no" answer)'],
    ["1", "Engine error"],
    [
      "2",
      "Usage error: an unknown flag, an existing file without --force, --mode local with a workflow flag (not --dry-run); with --json it is printed as the document",
    ],
    ["130", "Cancelled; nothing is written"],
  ],
  examples: [
    "wachiman init --mode both",
    "wachiman init --mode github --operator octocat --dry-run",
    "wachiman init --mode local --project-kind single --json",
  ],
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
  exit: [
    ["0", "Every required check passed"],
    ["1", "A required check failed"],
    ["2", "Usage error"],
  ],
  examples: ["wachiman doctor", "wachiman doctor --all-profiles --redact-paths"],
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
};

const upgradePage: Page = {
  usage: upgradeUsage,
  summary:
    "Update the CLI to the latest release, then move the Wachiman workflow pin in this repository to it. Rewrites the files and prints the git commands; it never commits. A clone or a wachiman-dev build is not upgraded.",
  options: [
    ["--check", "Print the installed and the latest version and change nothing"],
    ["--repo-only", "Rewrite the pins to the installed version (or --to) and leave the CLI alone"],
    [
      "--to <version>",
      "Install this release (v1.2.3) and pin it. It never downgrades the CLI: when the CLI is already on that version or newer, nothing is installed and the pins move. If the install fails the pins stay and the exit is 1; with --repo-only no install is attempted",
    ],
    REPO_DIR,
  ],
  env: [HOME_ENV, DO_NOT_TRACK_ENV],
  exit: [
    ["0", "Done, nothing to do, or the CLI is a clone or a dev build and was not upgraded"],
    ["1", "The package manager failed, a version could not be read, or a workflow file could not be read or written"],
    ["2", "Usage error"],
  ],
  examples: ["wachiman upgrade --check", "wachiman upgrade", "wachiman upgrade --repo-only"],
  docs: `${DOCS}/cli.md#upgrade`,
};

const ACCOUNT_ENV: readonly Row[] = [HOME_ENV, ["CI", "true or 1 means no terminal: confirmations need --yes"]];
const accountPage = (usage: string, summary: string, options: readonly Row[], examples: string[]): Page => ({
  usage,
  summary,
  options,
  env: ACCOUNT_ENV,
  exit: CONFIRMATION_EXIT,
  examples,
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
});

const profilePage: Page = {
  usage: profileUsage,
  summary:
    "Manage account profiles. A managed profile lives in ~/.wachiman/claude-<name>; an external one is your own Claude configuration directory, used in place. Run `wachiman profile <subcommand> --help` for one of them.",
  exit: CONFIRMATION_EXIT,
  env: ACCOUNT_ENV,
  examples: ["wachiman profile list", "wachiman profile create work"],
  docs: `${DOCS}/cli.md#setup-doctor-profile-and-project`,
  subs: {
    list: accountPage(
      "wachiman profile list [--json]",
      "List registered profiles and the unregistered claude-* directories under the home, with the projects bound to each and the default.",
      [["--json", "Print wachiman.profiles/1"]],
      ["wachiman profile list --json"],
    ),
    create: accountPage(
      "wachiman profile create [<name>]",
      "Create the managed profile <home>/claude-<name>, register it and start claude there so you can sign in (/login, then /exit).",
      [["<name>", "Default: isolated"]],
      ["wachiman profile create", "wachiman profile create work"],
    ),
    add: accountPage(
      "wachiman profile add <name> --config-dir <abs> [--binary <abs>] [--note <text>]",
      "Register a Claude configuration directory you already use, in place (an external profile). Wachiman never writes into it.",
      [
        ["--config-dir <abs>", "An absolute, existing directory outside the Wachiman home"],
        ["--binary <abs>", "An absolute, executable claude binary (an npm shim is refused). Default: claude on PATH"],
        ["--note <text>", "A note kept with the profile"],
      ],
      ["wachiman profile add work --config-dir ~/.claude-work"],
    ),
    login: accountPage(
      "wachiman profile login <name>",
      "Start claude for that profile (with `auth login` when this claude has it) so you can sign in again. It never reads the outcome.",
      [["<name>", "A registered profile"]],
      ["wachiman profile login work"],
    ),
    remove: accountPage(
      "wachiman profile remove <name> [--delete-dir] [--yes]",
      "Remove the registration and every binding and default that named it. The directory stays unless you pass --delete-dir.",
      [
        ["--delete-dir", "Also delete the directory: asks twice for a managed profile, a usage error for an external one"],
        ["--yes", "Skip the question; required without a terminal"],
      ],
      ["wachiman profile remove work --yes"],
    ),
    default: accountPage(
      "wachiman profile default <name> | --none",
      "Set or clear the configured default profile.",
      [
        ["<name>", "A registered profile"],
        ["--none", "Clear the default"],
      ],
      ["wachiman profile default work", "wachiman profile default --none"],
    ),
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
    show: accountPage(
      "wachiman project show [--json] [--repo-dir <dir>]",
      "Show the repository's key, its binding, and what `local` would use here now, with the rule and any ignored values.",
      [["--json", "Print wachiman.project/1"], REPO_DIR],
      ["wachiman project show --json"],
    ),
    unbind: accountPage(
      "wachiman project unbind [--repo-dir <dir>] [--yes]",
      "Remove this repository's binding. It asks first.",
      [["--yes", "Skip the question; required without a terminal"], REPO_DIR],
      ["wachiman project unbind --yes"],
    ),
  },
};

const SKILLS_EXIT: readonly Row[] = [
  ["0", "Done (copies left in place are warnings)"],
  ["1", "A copy could not be written or removed"],
  ["2", "Usage error or a refused target (anything under the Wachiman home)"],
];
const SKILLS_ENV: readonly Row[] = [HOME_ENV, ["CLAUDE_CONFIG_DIR", "Its skills folder is a target too, when it exists"]];
const skillsPage: Page = {
  usage: skillsUsage,
  summary:
    "Copy the wachiman-review, wachiman-loop and wachiman-audit agent skills into ~/.agents/skills and each Claude Code config directory, or remove the copies it marked. Never touches ~/.wachiman.",
  options: [
    ["--dir <path>", "Add a skills directory of your own; may repeat"],
    ["--json", "install only: print wachiman.skills/1"],
  ],
  env: SKILLS_ENV,
  exit: SKILLS_EXIT,
  examples: ["wachiman skills install", "wachiman skills uninstall"],
  docs: `${DOCS}/cli.md#skills`,
  subs: {
    install: {
      usage: "wachiman skills install [--dir <path>]… [--json]",
      summary:
        "Copy the agent skills into ~/.agents/skills and each Claude Code config directory. A copy you edited, or one that is not marked as Wachiman's, is left as it is and warned about.",
      options: [
        ["--dir <path>", "Add a skills directory of your own; may repeat"],
        ["--json", "Print wachiman.skills/1: one entry per copy"],
      ],
      env: SKILLS_ENV,
      exit: SKILLS_EXIT,
      examples: ["wachiman skills install", "wachiman skills install --dir ./my-skills --json"],
      docs: `${DOCS}/cli.md#skills`,
    },
    uninstall: {
      usage: "wachiman skills uninstall [--dir <path>]…",
      summary:
        "Remove only the files that a Wachiman marker lists and whose content still matches. Edited files and anything unmarked stay, with a warning.",
      options: [["--dir <path>", "Also look in this skills directory; may repeat"]],
      env: SKILLS_ENV,
      exit: SKILLS_EXIT,
      examples: ["wachiman skills uninstall"],
      docs: `${DOCS}/cli.md#skills`,
    },
  },
};

const PR_TEMPLATE_DOCS = `${DOCS}/pr-template.md`;
const PR_TEMPLATE_EXIT: readonly Row[] = [
  ["0", "Done, the description passes, or the template is current"],
  ["1", "check found a problem; status is anything but current; a git commit made by install --commit failed"],
  ["2", "Usage or configuration error: an unknown flag or section, an invalid .github/pr-template.json, a refused install, a missing tool"],
];
const prTemplatePage = (usage: string, summary: string, options: readonly Row[], examples: string[]): Page => ({
  usage,
  summary,
  options,
  exit: PR_TEMPLATE_EXIT,
  examples,
  docs: PR_TEMPLATE_DOCS,
});

const prTemplatePageRoot: Page = {
  usage: "wachiman pr-template <show|install|status|check|format|risk|strip> [options]",
  summary:
    "Install the PR description template, report its state, and check, reorder and strip a description. The template is generated from a section catalog plus an optional .github/pr-template.json; no model is called. Run `wachiman pr-template <subcommand> --help` for one of them.",
  options: [REPO_DIR],
  exit: PR_TEMPLATE_EXIT,
  examples: ["wachiman pr-template install", "wachiman pr-template check --pr 42"],
  docs: PR_TEMPLATE_DOCS,
  subs: {
    show: prTemplatePage(
      showUsage,
      "Print the template this repository would get: the default, or the one .github/pr-template.json describes. Writes nothing.",
      [["--from <json>", "Preview a definition from this file instead of .github/pr-template.json"], REPO_DIR],
      ["wachiman pr-template show", "wachiman pr-template show --from ./pr-template.json"],
    ),
    install: prTemplatePage(
      installUsage,
      "Write .github/pull_request_template.md, generated from the catalog and .github/pr-template.json. Files only: it never pushes. An existing template without the Wachiman stamp is adopted and backed up; a hand-edited one is refused.",
      [
        ["--from <json>", "Copy this definition into .github/pr-template.json before generating"],
        [
          "--force",
          "Replace a hand-edited template, or an existing, different .github/pr-template.json, after a backup in the git directory (wachiman/backups)",
        ],
        ["--commit", "Make one commit with only the files written; hooks run, nothing is pushed"],
        REPO_DIR,
      ],
      ["wachiman pr-template install", "wachiman pr-template install --commit"],
    ),
    status: prTemplatePage(
      prTemplateStatusUsage,
      "Print the state of the installed template: missing, current, outdated, edited by hand, unmanaged or invalid. Exits 0 only for current.",
      [["--json", "Print {state, version, installedVersion}"], REPO_DIR],
      ["wachiman pr-template status", "wachiman pr-template status --json"],
    ),
    check: prTemplatePage(
      checkUsage,
      "Check a PR description against the template: headings and their order, the status rows, Needs you, the Risk floor, the footer commit, and the breaking-change marker. Findings go to stderr.",
      [
        ["<file>", "A description on disk; needs --title. The template is read from the working tree"],
        ["--pr <n>", "Read title, body, head, commits and files through gh; the template is read at the PR's head commit"],
        ["--repo <owner/name>", "With --pr: the repository on GitHub. Default: the one gh finds in the directory"],
        ["--title <t>", "With a file: the pull request title"],
        ["--head <sha>", "With a file: the commit the footer must name. Default: HEAD"],
        ["--base <ref>", "With a file: compare with this branch for the Risk floor. Default: origin/main"],
        ["--allow-breaking", "Allow a breaking-change marker or a `!` title"],
        REPO_DIR,
      ],
      ["wachiman pr-template check body.md --title 'feat: add x'", "wachiman pr-template check --pr 42"],
    ),
    format: prTemplatePage(
      formatUsage,
      "Print a description reordered to the template: sections and status rows in template order, missing required headings added empty, unknown sections moved into Notes. No text is deleted. It never edits a pull request on GitHub.",
      [["[<file>]", "The description. Default: standard input"], ["--write", "Rewrite the file instead of printing"], REPO_DIR],
      ["wachiman pr-template format body.md", "wachiman pr-template format body.md --write"],
    ),
    risk: prTemplatePage(
      riskUsage,
      "Compute the risk floor of this branch from the files it changed, as 🟢 Low, 🟡 Medium or 🔴 High. A .github/pr-risk.toml on the base can only raise it.",
      [["--base <ref>", "Compare with this branch. Default: origin/main"], REPO_DIR],
      ["wachiman pr-template risk", "wachiman pr-template risk --base origin/develop"],
    ),
    strip: prTemplatePage(
      stripUsage,
      "Print a description without its guide comments and the stamp, keeping the Wachiman block markers. Run it before posting.",
      [["<file>", "The description to clean"], REPO_DIR],
      ["wachiman pr-template strip body.md"],
    ),
  },
};

const MEMORY_DOCS = `${DOCS}/cli.md#memory`;
const MEMORY_EXIT: readonly Row[] = [
  [
    "0",
    "Done: the memory is clean (or the repository has no .wachiman/memory/ folder; suggestions do not count), the entry was recorded, or the entry was archived",
  ],
  [
    "1",
    "check found a problem; archive could not move the entry (no such entry, already archived, no memory folder, or a symbolic link in the way) and wrote nothing; or propose or remember refused or failed and wrote nothing (not proposable, text does not match the id, pull request closed, push failed), or it recorded the entry but could not open the draft pull request",
  ],
  ["2", "Usage or configuration error: an unknown subcommand, an unknown id, a bad flag, or an invalid .wachiman.yml"],
];
const MEMORY_USAGE = [
  "wachiman memory check [--repo-dir <dir>]",
  "wachiman memory archive <id> [--repo-dir <dir>]",
  "wachiman memory report [--since <date>] [--format terminal|json] [--repo-dir <dir>]",
  "wachiman memory candidates [--format terminal|json] [--repo-dir <dir>]",
  "wachiman memory add --kind convention|exception --scope <glob> --rule <text> --why <text> [options]",
  "wachiman memory show <id> [--repo-dir <dir>]",
  "wachiman memory propose <id> [--personal | --team] [--repo-dir <dir>]",
  "wachiman memory propose --from-personal [<id>...] [--repo-dir <dir>]",
  "wachiman memory remember <pr> [--repo-dir <dir>]",
].join("\n");
const memoryPage: Page = {
  usage: MEMORY_USAGE,
  summary:
    "Check the repository memory in .wachiman/memory/ (Markdown files that teach Wachiman how code is written here), and propose new entries from the laptop. No model is called. `add` writes only a file under the Wachiman home; `propose` is the only subcommand that writes to a remote, and only a branch on origin and a draft pull request. A review loads this memory from the base commit: conventions go into the review prompt, and findings an exception covers are muted after discovery (see the docs).",
  options: [REPO_DIR],
  exit: MEMORY_EXIT,
  examples: ["wachiman memory check", "wachiman memory candidates", "wachiman memory show 4c1e9a2", "wachiman memory propose 4c1e9a2"],
  docs: MEMORY_DOCS,
  subs: {
    report: {
      usage: "wachiman memory report [--since <date>] [--format terminal|json] [--repo-dir <dir>]",
      summary:
        "Print, per month and in total, what the local review history says about memory: comments by outcome (fixed, wrong, intentional, not important, unjudged), findings muted by memory with the entry ids, the memory's size in the working tree, and the entries no review used. Outcomes come from `wachiman local --history` runs and `wachiman history --verdict`; with no history it says so and exits 0. No model is called.",
      options: [
        ["--since <date>", "Only runs saved on or after this day (YYYY-MM-DD)"],
        ["--format terminal|json", "Default: terminal. json prints wachiman.memory-report/1"],
        REPO_DIR,
      ],
      exit: MEMORY_EXIT,
      examples: ["wachiman memory report", "wachiman memory report --since 2026-11-01 --format json"],
      docs: MEMORY_DOCS,
    },
    check: {
      usage: "wachiman memory check [--repo-dir <dir>]",
      summary:
        "Read .wachiman/memory/ from the working tree and print every problem as <path>:<line>: <message>: a malformed entry, an entry id that is not its digest, a glob that matches no file, an index row that names a missing file, an area file index.md does not list, and a line-budget overrun (memory.max_index_lines, memory.max_loaded_lines). After the problems it prints suggestions, which never change the exit code: likely duplicates (same kind, overlapping scopes, rules at least 80% alike by word overlap; contradictions are not detected) and entries not used in memory.archive_after_days (from the laptop's record of use; not made in GitHub Actions, nor when that record is missing or unreadable, where a note says use is unknown).",
      options: [REPO_DIR],
      exit: MEMORY_EXIT,
      examples: ["wachiman memory check"],
      docs: MEMORY_DOCS,
    },
    archive: {
      usage: "wachiman memory archive <id> [--repo-dir <dir>]",
      summary:
        "Move one entry from its file to .wachiman/memory/archive.md, which no review loads. It changes the working tree only: nothing is committed or pushed, so commit the change yourself. Wachiman only ever suggests archiving; this runs only when you ask.",
      options: [REPO_DIR],
      exit: MEMORY_EXIT,
      examples: ["wachiman memory archive 4c1e9a2"],
      docs: MEMORY_DOCS,
    },
    candidates: {
      usage: "wachiman memory candidates [--format terminal|json] [--repo-dir <dir>]",
      summary:
        "List the memory candidates kept on this laptop for the repository, and which can be proposed. A candidate found by the tool needs memory.min_evidence pieces of evidence from different pull requests or branches; an explicit instruction needs one. A fix supports only a convention.",
      options: [
        [
          "--format terminal|json",
          "Default: terminal. json prints wachiman.memory-candidates/1 with the evidence counts and the reason a candidate is not proposable",
        ],
        REPO_DIR,
      ],
      exit: MEMORY_EXIT,
      examples: ["wachiman memory candidates --format json"],
      docs: MEMORY_DOCS,
    },
    add: {
      usage: "wachiman memory add --kind convention|exception --scope <glob> --rule <text> --why <text> [options]",
      summary:
        "Record a drafted entry as a candidate, with its first piece of evidence. This is how a coding agent hands over the entry it drafted from the code and the owner's intent; no model is called here. The same entry again (same kind, scope, rule, why and holds-while) only adds evidence.",
      options: [
        ["--kind <kind>", "convention or exception"],
        ["--scope <glob>", "The paths it applies to; several globs separated by commas"],
        ["--rule <text>", "What to do, or what not to report"],
        ["--why <text>", "The reason the owner gave"],
        [
          "--holds-while <paths>",
          "The paths a fact the reason depends on lives in; for an exception whose reason is a fact about the code",
        ],
        ["--title <text>", "A short heading. Default: the start of the rule"],
        ["--file <path>", "A JSON object with the same fields (kind, scope, rule, why, holdsWhile, title); flags override it"],
        ["--source <source>", "instruction (default), judged or fixed. judged and fixed need --finding"],
        [
          "--finding <id>",
          "A finding id from the local loop history. judged needs a `wrong` verdict with a reason; fixed needs the loop to have marked it probably fixed",
        ],
        ["--pr <n>", "The pull request the evidence came from. Default: the current branch"],
        ["--branch <name>", "The branch the evidence came from, for an instruction"],
        ["--agent", "A coding agent wrote the instruction or reply on the owner's behalf; recorded in the evidence"],
        REPO_DIR,
      ],
      exit: MEMORY_EXIT,
      examples: [
        'wachiman memory add --kind convention --scope "src/**" --rule "Prefer named exports." --why "Renames then show in every importer." --pr 709',
      ],
      docs: MEMORY_DOCS,
    },
    show: {
      usage: "wachiman memory show <id> [--repo-dir <dir>]",
      summary:
        "Print the exact entry text of a candidate: what `propose` writes, byte for byte. Show it to the owner and propose only what they approved.",
      options: [REPO_DIR],
      exit: MEMORY_EXIT,
      examples: ["wachiman memory show 4c1e9a2"],
      docs: MEMORY_DOCS,
    },
    propose: {
      usage:
        "wachiman memory propose <id> [--personal | --team] [--repo-dir <dir>]\nwachiman memory propose --from-personal [<id>...] [--repo-dir <dir>]",
      summary:
        "Add the entry to the branch wachiman/memory on origin as one commit, and open the draft pull request `chore(wachiman): memory` if none is open. It builds the commit in a temporary worktree, so your branch, index and uncommitted changes are untouched; it never force-pushes and writes only under .wachiman/memory/. It uses your own git credentials and `gh`. It runs none of your git hooks in that worktree. A pull request closed without merging stops it. It says `recorded` only after the push succeeded. `--personal` instead writes the entry to your personal memory for this repository (under the Wachiman home, keyed by the URL of origin) with no commit and no push; an explicit `--personal` also makes no network call, while a plain `propose` may fetch from origin to learn whether the team has memory; only your laptop reviews of that repository load it. In a repository whose default branch has no .wachiman/memory/, a first `propose` without a flag asks which of the two you want (or exits 1 when it cannot ask): use `--personal` or `--team` to choose. `--from-personal` sends your personal entries (all, or the ids given) to the team's pull request.",
      options: [
        ["--personal", "Write to your personal memory instead of the team's branch"],
        ["--team", "Propose to the team's branch without the first-time question"],
        ["--from-personal", "Send personal entries (all, or the ids given) to the team's memory pull request"],
        REPO_DIR,
      ],
      exit: MEMORY_EXIT,
      examples: ["wachiman memory propose 4c1e9a2"],
      docs: MEMORY_DOCS,
    },
    remember: {
      usage: "wachiman memory remember <pr> [--repo-dir <dir>]",
      summary:
        'The write job of memory in GitHub Actions: it records the entry an operator approved with `/wachiman remember <id>` in a thread. It reads the comment from REQUEST, WACHIMAN_COMMENT_AUTHOR and WACHIMAN_COMMENT_IN_REPLY_TO, finds the reply of Wachiman in that thread that showed the id, and writes the text shown with the same one commit on wachiman/memory and draft pull request as `propose`. It writes nothing unless the commenter is WACHIMAN_OPERATOR and the digest of the text shown is the id. It replies in the thread and never resolves it. Needs GH_TOKEN and GITHUB_REPOSITORY, and a token with contents: write and pull-requests: write; opening the pull request also needs the repository setting "Allow GitHub Actions to create and approve pull requests". No model is called.',
      options: [REPO_DIR],
      exit: MEMORY_EXIT,
      examples: ["wachiman memory remember 709"],
      docs: MEMORY_DOCS,
    },
  },
};

const prStatePage: Page = {
  usage: prStateUsage,
  summary:
    "Say what Wachiman's own review of a pull request needs next, as one JSON object (wachiman.pr-state/1) and an exit code: wait, act, blocked, done or closed. Read-only: it reads the pull request through `gh`, never posts, resolves, replies or edits, and stores nothing. `done` means only that Wachiman has nothing pending on the current head; other reviewers, CI and merge conflicts are not read.",
  options: [
    ["<pr>", "The pull request number. Default: the pull request of the current branch"],
    ["--repo <owner/repo>", "The repository. Default: the one `gh` resolves for the current directory"],
    ["--json", "Accepted; JSON is the only output"],
    [
      "--wait",
      "Read again until `next` is not `wait`, one read per interval, then print that last state. On timeout it prints the last state with `why: timeout`. Uses `gh event listen` to wake sooner when this `gh` has it, and polls when it does not (said once on stderr)",
    ],
    ["--timeout <s>", "With --wait: seconds to wait before giving up. Default: 540"],
    ["--interval <s>", "With --wait: seconds between reads, at least 20. Default: 30"],
  ],
  env: [["GH_TOKEN", "Optional: `gh` uses its own sign-in when it is not set"]],
  exit: [
    ["0", "done (nothing pending on the head) or closed (the pull request is closed or merged)"],
    ["20", "act: an unresolved Wachiman finding thread, or a Blocker or Fix finding with no thread"],
    ["21", "wait: no review of the current head yet, or the head moved while reading; with --wait, also the timeout (`why: timeout`)"],
    ["22", "blocked: the review was refused, skipped or partial, or its job finished without one"],
    ["1", "GitHub or `gh` failed; nothing is printed on stdout"],
    ["2", "Usage error"],
  ],
  examples: [
    "wachiman pr-state 42 --json",
    "wachiman pr-state --repo niway-dev/wachiman 42 --json",
    "wachiman pr-state --json   # the current branch's pull request",
    "wachiman pr-state 42 --wait --timeout 300   # until Wachiman's review of the head lands",
  ],
  docs: `${DOCS}/pr-state.md`,
};

/** The commands a GitHub Actions run uses; they are not in the root help. */
export const CI_COMMANDS = ["review", "comment", "threads", "reset-confidence"] as const;

const PAGES: Readonly<Record<string, Page>> = {
  local: localPage,
  loop: loopPage,
  ask: askPage,
  "pr-state": prStatePage,
  history: historyPage,
  calibrate: calibratePage,
  status: statusPage,
  dashboard: dashboardPage,
  ledger: ledgerPageWithSubs,
  setup: setupPage,
  init: initPage,
  doctor: doctorPage,
  profile: profilePage,
  project: projectPage,
  skills: skillsPage,
  upgrade: upgradePage,
  "pr-template": prTemplatePageRoot,
  memory: memoryPage,
  review: reviewPage,
  comment: commentPage,
  threads: threadsPage,
  "reset-confidence": resetConfidencePage,
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
  if (page.options && page.options.length > 0) {
    header("Options");
    out.push(...block(page.options));
  }
  if (page.subs) {
    header("Subcommands");
    out.push(...block(Object.entries(page.subs).map(([name, sub]) => [name, sub.summary.split(/(?<=\.)\s/)[0]] as Row)));
  }
  if (page.env && page.env.length > 0) {
    header("Environment");
    out.push(...block(page.env));
  }
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
    ...rows([
      ["local", "Review a branch, commit, or working-tree changes"],
      ["loop", "Run one round of a tracked review loop"],
      ["ask", "Explain a change or ask a question"],
    ]),
    "",
    paint("Results", "strong"),
    ...rows([
      ["history", "Browse findings and record verdicts"],
      ["calibrate", "Measure and calibrate the finding priority"],
      ["status", "Show local usage and estimated cost"],
      ["dashboard", "Export a local usage dashboard"],
      ["ledger", "Download GitHub Actions spend from the ledger"],
      ["pr-state", "Read what Wachiman needs next on a pull request"],
    ]),
    "",
    paint("Configuration", "strong"),
    ...rows([
      ["setup", "Bind this repository to an account profile"],
      ["init", "Write the GitHub caller workflow, or hand over to setup"],
      ["doctor", "Explain what a local run would use and what would fail"],
      ["profile", "List, create, add, log in, remove and default profiles"],
      ["project", "Show or remove this repository's binding"],
      ["skills", "Install or remove the agent skills"],
      ["pr-template", "Install and check the PR description template"],
      ["memory", "Check and propose repository memory (.wachiman/memory)"],
      ["upgrade", "Update the CLI and the workflow pin in this repository"],
    ]),
    "",
    `Help: wachiman <command> --help · wachiman help ci · docs: ${DOCS}/cli.md`,
    "Options: -h, --help · -v, --version",
    "",
  ].join("\n");
}

export function ciHelp(paint: Paint = plain): string {
  const out: string[] = [];
  out.push(paint("Commands for GitHub Actions", "strong"), "");
  out.push(
    ...wrapText(
      "These run inside the reusable workflow, not on a laptop. They post to GitHub and need GH_TOKEN. Run `wachiman <command> --help` for one of them.",
      78,
    ),
  );
  out.push("", paint("Usage", "strong"));
  for (const name of CI_COMMANDS) out.push(`  ${PAGES[name].usage}`);
  out.push("", paint("Commands", "strong"));
  out.push(...block(CI_COMMANDS.map((name) => [name, PAGES[name].summary.split(/(?<=\.)\s/)[0]] as Row)));
  out.push("", paint("Environment", "strong"));
  out.push(
    ...block([
      GH_ENV[0],
      GH_ENV[1],
      ["REQUEST", "comment: the comment text"],
      ...COMMENT_ENV,
      ...GH_ENV.slice(2),
      ["WACHIMAN_CONFIDENCE", "reset-confidence: 1 enables the PR Confidence block"],
    ]),
  );
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
/**
 * Whether `rest` (the arguments after a command) ask for help. Free text and option values are not flags:
 * nothing after a `--` counts, `ask` takes it only as its first argument (the rest is the question), and
 * the value of `--reason` is never a request.
 */
function asksForHelp(command: string, rest: readonly string[]): boolean {
  const end = rest.indexOf("--");
  const args = end === -1 ? rest : rest.slice(0, end);
  const isHelp = (arg: string) => arg === "--help" || arg === "-h";
  if (command === "ask") return args.length > 0 && isHelp(args[0]);
  return args.some((arg, i) => isHelp(arg) && args[i - 1] !== "--reason");
}

export function helpFor(argv: readonly string[], paint: Paint = plain): HelpRequest | undefined {
  const [first, ...rest] = argv;
  if (first === "help") {
    const words = rest.filter((word) => !word.startsWith("-"));
    if (words.length === 0) return { text: rootHelp(paint) };
    if (words[0] === "ci") return { text: ciHelp(paint) };
    const text = commandHelp(words, paint);
    return text === undefined ? { error: `Unknown help topic "${words[0]}".` } : { text };
  }
  if (first === "--setup-profile" && asksForHelp(first, rest)) {
    return { text: commandHelp(["profile", "create"], paint)! };
  }
  if (isCommand(first) && asksForHelp(first, rest)) {
    return { text: commandHelp([first, ...rest.filter((arg) => !arg.startsWith("-"))], paint)! };
  }
  return undefined;
}
