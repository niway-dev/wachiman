/**
 * `wachiman ledger connect <url> | disconnect | pull [--since <n>d]` (ADR 0039). `pull` is the only
 * command here that makes a request, and only to the URL the user connected, with `GET /v1/entries`.
 * The token is read from standard input without echo and never printed.
 */
import { wachimanHome } from "../accounts/config";
import { UsageError } from "../config";
import { deleteCredentials, normaliseLedgerUrl, resolveCredentials, writeCredentials, credentialsPath } from "./credentials";
import { DEFAULT_PULL_DAYS, MAX_PULL_DAYS, pullLedger, realPullDeps, type PullDeps } from "./pull";

export const ledgerUsage = `wachiman ledger connect <url>            ask for the read token (not echoed) and keep it, mode 0600
wachiman ledger disconnect              delete the stored credentials
wachiman ledger pull [--since <n>d]     download the last ${DEFAULT_PULL_DAYS} days (at most ${MAX_PULL_DAYS}) of the ledger's entries`;

export type LedgerArgs = { action: "connect"; url: string } | { action: "disconnect" } | { action: "pull"; sinceDays?: number };

export function parseLedgerArgs(argv: string[]): LedgerArgs | { help: true } {
  const [action, ...rest] = argv;
  if (action === undefined || action === "--help" || action === "-h") return { help: true };
  if (rest.includes("--help") || rest.includes("-h")) return { help: true };
  if (action === "connect") {
    if (rest.length !== 1 || rest[0].startsWith("--")) throw new UsageError("ledger connect takes one argument: the ledger URL.");
    return { action, url: rest[0] };
  }
  if (action === "disconnect") {
    if (rest.length > 0) throw new UsageError("ledger disconnect takes no argument.");
    return { action };
  }
  if (action === "pull") {
    let sinceDays: number | undefined;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      if (name !== "--since") throw new UsageError(`ledger pull does not take "${arg}".`);
      const v = eq === -1 ? rest[++i] : arg.slice(eq + 1);
      if (v === undefined || !/^\d+d$/.test(v)) throw new UsageError(`--since takes a number of days such as 7d, got "${v ?? ""}".`);
      sinceDays = Number.parseInt(v, 10);
      if (sinceDays < 1 || sinceDays > MAX_PULL_DAYS) throw new UsageError(`--since takes 1 to ${MAX_PULL_DAYS} days.`);
    }
    return { action, ...(sinceDays !== undefined ? { sinceDays } : {}) };
  }
  throw new UsageError(`Unknown ledger action "${action}".`);
}

/** One line from standard input; on a terminal, typed without echo. */
export async function readSecretLine(stderr: (text: string) => void): Promise<string> {
  const stdin = process.stdin;
  stderr("Read token (input is hidden): ");
  if (stdin.isTTY) {
    return await new Promise<string>((resolve, reject) => {
      let text = "";
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      const done = (fn: () => void) => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        stderr("\n");
        fn();
      };
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") return done(() => resolve(text));
          if (ch === "\u0003") return done(() => reject(new Error("cancelled")));
          if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
          else text += ch;
        }
      };
      stdin.on("data", onData);
    });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  stderr("\n");
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

export interface LedgerIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readToken?: () => Promise<string>;
  pull?: PullDeps;
}

export async function runLedger(args: LedgerArgs, env: Record<string, string | undefined>, io: LedgerIo): Promise<number> {
  const home = wachimanHome(env);
  if (args.action === "connect") {
    const url = normaliseLedgerUrl(args.url);
    const token = (await (io.readToken ?? (() => readSecretLine(io.stderr)))()).trim();
    if (token === "") throw new UsageError("No token was given.");
    writeCredentials(home, { url, token });
    io.stdout(`Connected to ${url}. Credentials kept in ${credentialsPath(home)} (mode 0600). Run \`wachiman ledger pull\` to download entries.\n`);
    return 0;
  }
  if (args.action === "disconnect") {
    io.stdout(deleteCredentials(home) ? "Disconnected: the stored credentials were deleted. Downloaded entries stay on disk.\n" : "No stored credentials to delete.\n");
    if (resolveCredentials(home, env)) io.stderr("wachiman: WACHIMAN_LEDGER_URL and WACHIMAN_LEDGER_TOKEN are still set in the environment.\n");
    return 0;
  }
  const result = await pullLedger(home, env, args.sinceDays, io.pull ?? realPullDeps);
  io.stdout(`Pulled ${result.entries} entr${result.entries === 1 ? "y" : "ies"} for ${result.from} to ${result.to} from account ${result.account} (${result.daysWritten} day file${result.daysWritten === 1 ? "" : "s"} written).\n`);
  if (result.daysRemoved > 0) io.stdout(`${result.daysRemoved} day file${result.daysRemoved === 1 ? "" : "s"} deleted: the ledger no longer returns entries for ${result.daysRemoved === 1 ? "that day" : "those days"} (days outside this pull are kept).\n`);
  return 0;
}
