/**
 * `wachiman upgrade`: update the CLI, then the workflow pin in this repository.
 *
 * Step 1 installs the latest release with the package manager that owns the global install (bun or
 * npm); a clone or a `wachiman-dev` build is never upgraded here. Step 2 rewrites the pins in
 * `.github/workflows/*.yml` to that release and prints the git commands to commit them; it never
 * commits. Both the package manager and the registry lookup are injected, so no test touches
 * either. The pin is exact on purpose: a floating tag would run a new release in CI without a
 * reviewed change.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { UsageError } from "../config";
import { spawnGit, type GitRunner } from "../evidence";
import { parseFlags } from "../flags";
import { detectInstall, type InstallKind } from "../install-kind";
import { compareVersions, parseTag, rewritePins, scanWorkflows, type PinFs, type PinOutcome } from "./pin";

export interface UpgradeOptions {
  repoDir: string;
  check: boolean;
  repoOnly: boolean;
  /** `v1.2.3`, normalized. */
  to?: string;
}

export const upgradeUsage = "wachiman upgrade [--check] [--repo-only] [--to <version>] [--repo-dir <dir>]";

/** The arguments after `upgrade` (`--repo-dir` is already taken out and arrives as `repoDir`). */
export function parseUpgradeArgs(argv: string[], repoDir: string): UpgradeOptions | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const { positionals, values, booleans } = parseFlags(argv, { values: ["--to"], booleans: ["--check", "--repo-only"] }, "upgrade");
  if (positionals.length > 0) throw new UsageError(`upgrade takes no argument "${positionals[0]}".`);
  const check = booleans["--check"] === true;
  const repoOnly = booleans["--repo-only"] === true;
  if (check && (repoOnly || values["--to"] !== undefined)) throw new UsageError("--check cannot be used with --repo-only or --to.");
  let to: string | undefined;
  if (values["--to"] !== undefined) {
    const tag = parseTag(values["--to"]);
    if (!tag) throw new UsageError(`--to needs a release version such as v1.2.3, got "${values["--to"]}".`);
    to = `v${tag.join(".")}`;
  }
  return { repoDir, check, repoOnly, ...(to !== undefined ? { to } : {}) };
}

export interface UpgradeDeps {
  install?: InstallKind;
  /** The running CLI's version (`1.2.3`). */
  version: string;
  /** Runs a package manager with the terminal inherited; returns its exit status (null when it did not start). */
  run?: (command: string, args: string[]) => number | null;
  /** The latest published version (`1.2.3`), or undefined when it cannot be read. */
  latest?: () => string | undefined;
  git?: GitRunner;
  fs?: PinFs & { write: (path: string, text: string) => void };
}

const defaultRun = (command: string, args: string[]) => spawnSync(command, args, { stdio: "inherit" }).status;

/** `npm view wachiman version`; the one network request of `--check` and the first step. */
const defaultLatest = () => {
  const run = spawnSync("npm", ["view", "wachiman", "version"], { encoding: "utf8", timeout: 30_000 });
  const version = run.status === 0 ? run.stdout.trim() : "";
  return parseTag(version) ? version : undefined;
};

const realFs = {
  list: (path: string) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  read: (path: string) => readFileSync(path, "utf8"),
  write: (path: string, text: string) => writeFileSync(path, text),
};

/** The command that installs the latest release for this layout, or why it is not upgraded here. */
export type CliPlan = { kind: "command"; manager: "bun" | "npm"; command: string; args: string[] } | { kind: "refused"; reason: string };

export function planCliUpgrade(install: InstallKind, spec = "latest"): CliPlan {
  if (install.kind === "source") {
    return { kind: "refused", reason: "this is a clone or a development build (wachiman-dev); update a clone with `git pull` (then `bun install`), and rebuild a dev build with scripts/dev-build.sh" };
  }
  if (install.kind === "exe") return { kind: "refused", reason: "this is a standalone executable; download the newer one" };
  const bun = /[\\/]\.bun[\\/]install[\\/]global[\\/]/.test(install.root);
  return bun
    ? { kind: "command", manager: "bun", command: "bun", args: ["add", "-g", `wachiman@${spec}`] }
    : { kind: "command", manager: "npm", command: "npm", args: ["install", "-g", `wachiman@${spec}`] };
}

type Io = { stdout: (text: string) => void; stderr: (line: string) => void };

export function runUpgrade(opts: UpgradeOptions, io: Io, deps: UpgradeDeps): number {
  const install = deps.install ?? detectInstall(deps.version);
  const current = parseTag(deps.version);
  const latest = deps.latest ?? defaultLatest;

  if (opts.check) {
    const found = latest();
    io.stdout(`Installed: v${deps.version}\n`);
    if (found === undefined) {
      io.stderr("wachiman: could not read the latest version from the npm registry.");
      return 1;
    }
    const newer = current !== undefined && compareVersions(parseTag(found)!, current) > 0;
    io.stdout(`Latest:    v${found}\n${newer ? "Run `wachiman upgrade` to update.\n" : "You are up to date.\n"}`);
    return 0;
  }

  // The version the pins move to; undefined means the repository step is skipped.
  let target: string | undefined = opts.to;
  let code = 0;

  if (opts.repoOnly) {
    target ??= current ? `v${deps.version}` : undefined;
    if (target === undefined) {
      io.stderr(`wachiman: the installed version "${deps.version}" is not a release version; pass --to vX.Y.Z.`);
      return 1;
    }
  } else {
    const plan = planCliUpgrade(install, opts.to === undefined ? "latest" : opts.to.slice(1));
    if (plan.kind === "refused") {
      io.stdout(`The CLI is not upgraded: ${plan.reason}.\n`);
    } else {
      const found = opts.to === undefined ? latest() : opts.to.slice(1);
      if (found === undefined) {
        io.stderr("wachiman: could not read the latest version from the npm registry; nothing changed. Pass --to vX.Y.Z to choose one.");
        return 1;
      }
      if (current !== undefined && compareVersions(parseTag(found)!, current) <= 0) {
        io.stdout(`The CLI is already on v${deps.version}${opts.to ? ` (newer than or equal to ${opts.to})` : ""}; nothing to install.\n`);
        target ??= `v${found}`;
      } else {
        const shown = [plan.command, ...plan.args].join(" ");
        io.stdout(`Installing v${found} with ${plan.manager}: ${shown}\n`);
        const status = (deps.run ?? defaultRun)(plan.command, plan.args);
        if (status === 0) {
          target ??= `v${found}`;
          io.stdout(`The CLI is now v${found}.\n`);
        } else {
          io.stderr(`wachiman: ${shown} ${status === null ? "could not start" : `failed with exit ${status}`}; the CLI is unchanged.`);
          code = 1;
        }
      }
    }
    if (target === undefined) {
      io.stdout(`The repository pin was not touched: there is no new version to move it to. After upgrading the CLI by other means, run \`wachiman upgrade --repo-only\`, or pass --to vX.Y.Z.\n`);
      return code;
    }
  }

  return repoStep(opts, target, io, deps) || code;
}

function repoStep(opts: UpgradeOptions, target: string, io: Io, deps: UpgradeDeps): number {
  const fs = deps.fs ?? realFs;
  const top = (deps.git ?? spawnGit)(["rev-parse", "--show-toplevel"], { cwd: opts.repoDir, timeoutMs: 15_000 });
  const root = top.status === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : undefined;
  if (root === undefined) {
    io.stdout(`The repository pin was not touched: ${opts.repoDir} is not a git repository.\n`);
    return 0;
  }
  const files = scanWorkflows(root, fs);
  if (files.length === 0) {
    io.stdout("No workflow in .github/workflows calls a Wachiman reusable workflow; nothing to pin.\n");
    return 0;
  }
  const changed: string[] = [];
  const left: string[] = [];
  for (const { file } of files) {
    const path = `${root}/${file}`;
    const result = rewritePins(fs.read(path), target);
    if (result.outcomes.some((o) => o.kind === "rewritten")) {
      fs.write(path, result.text);
      changed.push(file);
    }
    for (const o of result.outcomes) {
      const why = leftReason(o, target);
      if (why !== undefined) left.push(`  ${file}: ${why}`);
    }
  }
  if (changed.length > 0) {
    io.stdout(`Pinned Wachiman to ${target} in:\n${changed.map((f) => `  ${f}`).join("\n")}\n`);
  } else {
    io.stdout(`No pin needed a change (target ${target}).\n`);
  }
  if (left.length > 0) io.stdout(`Left as it was:\n${left.join("\n")}\n`);
  if (changed.length > 0) {
    io.stdout(`\nNothing is committed. To commit it:\n  git add ${changed.join(" ")}\n  git commit -m "chore: pin Wachiman to ${target}"\n`);
  }
  return 0;
}

function leftReason(o: PinOutcome, target: string): string | undefined {
  if (o.kind === "newer") return `pinned to ${o.from}, newer than ${target}; never downgraded`;
  if (o.kind === "sha") return `pinned to the commit ${o.from.slice(0, 12)}; update it by hand`;
  if (o.kind === "other") return `pinned to "${o.from}", which is not a release tag; update it by hand`;
  return undefined;
}
