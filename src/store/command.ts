/**
 * `wachiman dashboard`: brings the local index up to date from the history files, then prints the
 * figures as `wachiman.dashboard/1` JSON or writes them as one static HTML file (ADR 0035). It writes
 * only the index and, without `--json`, the page; like `wachiman history`, it moves a damaged run
 * file aside. No `claude`, no GitHub, no network, no server, and it never opens a browser.
 */
import { existsSync, chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { wachimanHome } from "../accounts/config";
import { UsageError } from "../config";
import { readFigures, type Figures } from "./figures";
import { renderHtml, type DashboardDocument } from "./html";
import { credentialsPath } from "../ledger-read/credentials";
import { listLedgerAccounts } from "../ledger-read/files";
import { buildReport, deriveCoverage } from "../spend/report";
import { readSpendRows } from "./rows";
import { refreshIndex } from "./index";

export const DASHBOARD_FORMAT = "wachiman.dashboard/1";
export const DASHBOARD_FILE = "dashboard.html";

export const dashboardUsage = `wachiman dashboard [--json] [--out <file>] [--refresh] [--repo-dir <dir>]`;

export const LOCAL_ONLY = "Local runs only: those kept by `wachiman local --history` and `wachiman loop`. Runs by the GitHub Actions workflow are not counted.";

export interface DashboardArgs {
  json: boolean;
  out?: string;
  /** Download the ledger first (the only request `dashboard` can make). */
  refresh?: boolean;
}

/** The arguments after `dashboard` (`--repo-dir` is already taken out). Both `--x v` and `--x=v`. */
export function parseDashboardArgs(argv: string[]): DashboardArgs | { help: true } {
  const args: DashboardArgs = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!arg.startsWith("--")) throw new UsageError(`dashboard takes no argument "${arg}".`);
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (name === "--json") {
      if (eq !== -1) throw new UsageError("--json takes no value.");
      args.json = true;
    } else if (name === "--refresh") {
      if (eq !== -1) throw new UsageError("--refresh takes no value.");
      args.refresh = true;
    } else if (name === "--out") {
      const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (v === undefined || v === "" || (eq === -1 && v.startsWith("--"))) throw new UsageError("--out needs a file name.");
      args.out = v;
    } else throw new UsageError(`Unknown option ${name} for dashboard.`);
  }
  if (args.json && args.out !== undefined) throw new UsageError("--out writes the HTML page; --json prints to stdout and takes no --out.");
  return args;
}

/** Writes `text` to `path` at 0600 through a temporary name beside it: all or nothing. */
function writeFileAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Already gone.
    }
    throw error;
  }
}

/**
 * The figures from an up-to-date index. If reading them fails (a damaged or half-built index that
 * looked current), the index is rebuilt once and read again; a second failure is the caller's.
 */
export function loadFigures(home: string, warn: (line: string) => void, read: (path: string) => Figures = readFigures): Figures {
  const { path } = refreshIndex(home, warn);
  try {
    return read(path);
  } catch {
    refreshIndex(home, warn, { force: true });
    return read(path);
  }
}

export interface DashboardIo {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  now?: () => Date;
}

export function runDashboard(args: DashboardArgs, env: Record<string, string | undefined>, io: DashboardIo): number {
  const home = wachimanHome(env);
  const now = io.now?.() ?? new Date();
  const doc: DashboardDocument = {
    format: DASHBOARD_FORMAT,
    generatedAt: now.toISOString(),
    scope: LOCAL_ONLY,
    ...loadFigures(home, io.stderr),
  };
  // A ledger is "connected" when a credentials file exists or a pull left files (nothing is parsed or resolved here: only `--refresh` makes a request, and the CLI does that first); otherwise the page is as before (ADR 0039).
  if (existsSync(credentialsPath(home)) || listLedgerAccounts(home).length > 0) {
    const spend = readSpendRows(refreshIndex(home, io.stderr).path);
    const report = buildReport({ rows: spend.rows, coverage: deriveCoverage(spend.rows, spend.actions, now), limits: spend.limits, pulledAt: spend.pulledAt, now });
    doc.usage = { report, pulled: spend.pulledAt !== null };
    doc.scope = "Laptop runs kept by `wachiman local --history` and `wachiman loop`, and GitHub Actions runs downloaded from the ledger.";
  }
  if (args.json) {
    io.stdout(`${JSON.stringify(doc, null, 2)}\n`);
    return 0;
  }
  const out = args.out === undefined ? join(home, DASHBOARD_FILE) : resolve(args.out);
  writeFileAtomic(out, renderHtml(doc));
  io.stdout(`${out}\n`);
  return 0;
}
