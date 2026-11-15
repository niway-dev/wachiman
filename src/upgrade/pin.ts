/**
 * The workflow pin: the `@<ref>` in a caller's `uses: niway-dev/wachiman/.github/workflows/<name>.yml@<ref>`.
 * `wachiman upgrade` rewrites it and `wachiman doctor` reads it, both through the functions here.
 * Only an exact release tag (`v1.2.3`) is ever compared or rewritten; a commit SHA, a branch, a
 * floating tag (`v1`) or a pre-release is reported and left alone.
 */

export const WORKFLOWS_DIR = ".github/workflows";

/** A `uses:` line (list item or not) that calls a Wachiman reusable workflow; group 1 is everything up to `@`, group 2 the ref. */
const USES = /^([ \t]*(?:-[ \t]+)?uses:[ \t]*["']?niway-dev\/wachiman\/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml@)([^\s"'#]+)/gm;

export type SemVer = [number, number, number];

export function parseTag(ref: string): SemVer | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(ref);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: SemVer, b: SemVer): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export type PinKind = "tag" | "sha" | "other";

export function classifyRef(ref: string): PinKind {
  if (parseTag(ref)) return "tag";
  if (/^[0-9a-f]{40}$/i.test(ref)) return "sha";
  return "other";
}

/** The pin lines of one file's text, in order. */
export function readPins(text: string): string[] {
  return [...text.matchAll(USES)].map((m) => m[2]);
}

export type PinOutcome =
  | { kind: "rewritten"; from: string }
  | { kind: "current" }
  | { kind: "newer"; from: string }
  | { kind: "sha" | "other"; from: string };

/**
 * Rewrites every release-tag pin older than `target` (`v1.2.3`) and leaves the rest of the text
 * byte for byte: the replacement touches the ref only, so line endings and comments stay.
 */
export function rewritePins(text: string, target: string): { text: string; outcomes: PinOutcome[] } {
  const wanted = parseTag(target);
  if (!wanted) throw new Error(`rewritePins: ${target} is not a release version`);
  const outcomes: PinOutcome[] = [];
  const next = text.replace(USES, (whole, head: string, ref: string) => {
    const kind = classifyRef(ref);
    if (kind !== "tag") return (outcomes.push({ kind, from: ref }), whole);
    const order = compareVersions(parseTag(ref)!, wanted);
    if (order === 0) return (outcomes.push({ kind: "current" }), whole);
    if (order > 0) return (outcomes.push({ kind: "newer", from: ref }), whole);
    outcomes.push({ kind: "rewritten", from: ref });
    return `${head}${target}`;
  });
  return { text: next, outcomes };
}

/** The slice of a file system the scan needs; `DoctorFs` has all of it. */
export interface PinFs {
  /** Names in a directory; empty when it cannot be listed. */
  list: (path: string) => string[];
  /** Like `list`, but throws when the directory exists and cannot be read; a missing one still throws ENOENT. */
  listStrict?: (path: string) => string[];
  read: (path: string) => string;
}

export interface FilePins {
  /** Repository-relative, with forward slashes. */
  file: string;
  refs: string[];
}

export interface WorkflowScan {
  files: FilePins[];
  /** Workflow files that exist but could not be read; their pins are unknown. */
  unreadable: string[];
  /** Set when `.github/workflows` exists but could not be listed. */
  unreadableDir?: string;
}

/** Workflow files at the top of `.github/workflows` that call a Wachiman reusable workflow. */
export function scanWorkflows(root: string, fs: PinFs): WorkflowScan {
  const dir = `${root.replace(/[\\/]+$/, "")}/${WORKFLOWS_DIR}`;
  const files: FilePins[] = [];
  const unreadable: string[] = [];
  let names: string[];
  try {
    names = (fs.listStrict ?? fs.list)(dir);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { files, unreadable };
    return { files, unreadable, unreadableDir: WORKFLOWS_DIR };
  }
  for (const name of names.filter((n) => /\.ya?ml$/.test(n)).sort()) {
    let text: string;
    try {
      text = fs.read(`${dir}/${name}`);
    } catch {
      unreadable.push(`${WORKFLOWS_DIR}/${name}`);
      continue;
    }
    const refs = readPins(text);
    if (refs.length > 0) files.push({ file: `${WORKFLOWS_DIR}/${name}`, refs });
  }
  return { files, unreadable };
}
