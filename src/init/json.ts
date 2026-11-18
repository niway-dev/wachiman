/**
 * The `wachiman.init/1` document that `wachiman init --json` prints on stdout: one JSON object, for
 * a result and for a failure alike, so a program (a coding agent) never has to parse human text.
 * Every human status line goes to stderr in that mode. See docs/specs/2026-11-18-agent-operated-setup-design.md.
 */
import { quoteArgument } from "../wizard/command";
import type { InitMode } from "./options";

export const INIT_SCHEMA = "wachiman.init/1";

export type FileAction = "created" | "replaced" | "unchanged" | "would-create" | "would-replace" | "skipped" | "refused";

export interface InitFile {
  /** Relative to the repository top level. */
  path: string;
  action: FileAction;
  /** Where the earlier file was kept, relative to the repository when it is inside it. */
  backup?: string;
  /** The rendered workflow, only in a dry run (stdout stays one document). */
  content?: string;
}

/** What `runInit` records as it works; `buildDocument` turns it into the file list. */
export interface InitReport {
  workflow?: InitFile;
  settings?: InitFile;
  template?: InitFile[];
}

export type Readiness = "ready" | "pending" | "not-used";

export interface InitDocument {
  schema: typeof INIT_SCHEMA;
  ok: boolean;
  mode: InitMode | null;
  dryRun: boolean;
  repoDir: string;
  files: InitFile[];
  local: { status: Readiness; pending: string[] };
  github: { status: Readiness; pending: string[] };
  error: { code: "usage" | "failed"; message: string } | null;
}

const filesOf = (report: InitReport): InitFile[] => [report.workflow, report.settings, ...(report.template ?? [])].filter((f): f is InitFile => f !== undefined);

/** `init` never binds without a terminal and never touches GitHub, so a mode that includes either leaves it pending. */
export function buildDocument(p: { mode: InitMode; dryRun: boolean; repoDir: string; report: InitReport }): InitDocument {
  const { mode } = p;
  return {
    schema: INIT_SCHEMA,
    ok: true,
    mode,
    dryRun: p.dryRun,
    repoDir: p.repoDir,
    files: filesOf(p.report),
    local:
      mode === "github"
        ? { status: "not-used", pending: [] }
        : { status: "pending", pending: [`wachiman setup --profile <name> --yes --repo-dir ${quoteArgument(p.repoDir, "posix")}`] },
    github: mode === "local" ? { status: "not-used", pending: [] } : { status: "pending", pending: ["add ANTHROPIC_API_KEY secret", "commit and open a PR"] },
    error: null,
  };
}

/** A failure: `files` holds what was already written or refused, and the other fields say what is known. */
export function failureDocument(p: { mode: InitMode | null; dryRun: boolean; repoDir: string; report: InitReport; code: "usage" | "failed"; message: string }): InitDocument {
  return {
    schema: INIT_SCHEMA,
    ok: false,
    mode: p.mode,
    dryRun: p.dryRun,
    repoDir: p.repoDir,
    files: filesOf(p.report),
    local: { status: "not-used", pending: [] },
    github: { status: "not-used", pending: [] },
    error: { code: p.code, message: p.message },
  };
}

export const printDocument = (stdout: (text: string) => void, doc: InitDocument) => stdout(`${JSON.stringify(doc, null, 2)}\n`);
