/**
 * The fixed rules that explain a changed file without a claim (ADR 0033 decision 2): lockfiles,
 * generated files, formatting-only changes and tests of a confirmed claim. The list is short on
 * purpose and decided by the engine, never by the model: a file no rule here covers, and no claim
 * explains, is reported as unexplained. Rules look at the path, and at the diff only for
 * formatting. A file that says in its own text that it is generated is not trusted: an author
 * could write that line into hand-written code. A path is trusted on purpose, even for generated
 * names the engine still reviews: the list is short and a person sees a path in the file list.
 */
import type { ChangedFile } from "./types";

export type RuleName = "lockfile" | "generated" | "formatting-only" | "test-of-confirmed-claim";

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "Podfile.lock",
  "flake.lock",
  "mix.lock",
  "gradle.lockfile",
  "packages.lock.json",
]);

// Generated is decided by path alone. `dist`, `build`, `out`, `*.map` and `worker-configuration.d.ts`
// are skipped by the engine by default; `generated/`, `__generated__/`, `*.pb.go`, `*_pb2.py` and
// `*.min.css` are reviewed but still trusted by their path, because a generator owns those names.
const GENERATED_DIRS = new Set(["generated", "__generated__", "dist", "build", "out"]);
const GENERATED_NAME = [
  /\.generated\.[^./]+$/,
  /\.pb\.go$/,
  /_pb2(?:_grpc)?\.pyi?$/,
  /\.min\.(?:js|css)$/,
  /\.map$/,
  /^worker-configuration\.d\.ts$/,
];

const TEST_DIRS = new Set(["test", "tests", "__tests__", "__snapshots__", "spec", "specs"]);

/** Where a change of whitespace can change what the program does, so it is never formatting. */
const WHITESPACE_SENSITIVE_EXT = new Set(["py", "pyi", "yml", "yaml", "mk", "pug", "haml", "coffee", "nim", "md", "markdown", "mdx", "rst"]);
const MULTILINE_STRING_OPENER = ["`", '"""', "<<"];
const WHITESPACE_SENSITIVE_NAME = new Set(["Makefile", "makefile", "GNUmakefile"]);

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirSegments = (path: string) => path.split("/").slice(0, -1);
const extension = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "");
const withoutExtension = (name: string) => (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name);

export const isLockfile = (path: string): boolean => LOCKFILES.has(baseName(path)) || baseName(path).endsWith(".lock");

export const isGeneratedPath = (path: string): boolean =>
  dirSegments(path).some((s) => GENERATED_DIRS.has(s)) || GENERATED_NAME.some((re) => re.test(baseName(path)));

export function isTestPath(path: string): boolean {
  const name = baseName(path);
  return (
    dirSegments(path).some((s) => TEST_DIRS.has(s)) ||
    /\.(?:test|spec)\.[^./]+$/.test(name) ||
    /_test\.[^./]+$/.test(name) ||
    /^test_[^/]+$/.test(name) ||
    name.endsWith(".snap")
  );
}

/**
 * True when every hunk of the patch that changes anything removes and adds the same number of lines
 * and each added line equals the removed line at its place once the whitespace at its two edges is
 * trimmed. Whitespace inside a line is never touched, so a string literal, `a - -b` against `a --b`,
 * a run of spaces made one, or a statement split or joined over lines is a change. A hunk with a
 * backtick, a `"""` text block or a `<<` heredoc opener, on a changed line or on a context line
 * around it, is never formatting: the value of such a multiline string depends on its indentation (a
 * `<<` shift operator is caught too, which only makes the file unexplained). An opener further above
 * than the hunk's context is not seen.
 * Code that moved between hunks, a changed token, a patch with nothing changed and no patch at all
 * are all false.
 */
export function isFormattingOnly(patch: string | undefined): boolean {
  if (!patch) return false;
  let inHunk = false;
  let removed: string[] = [];
  let added: string[] = [];
  let context: string[] = [];
  let changedHunks = 0;
  const close = (): boolean => {
    const changed = removed.length + added.length > 0;
    if (changed) changedHunks++;
    const template = [...removed, ...added, ...context].some((line) => MULTILINE_STRING_OPENER.some((opener) => line.includes(opener)));
    const same = removed.length === added.length && removed.every((line, i) => line.trim() === added[i]!.trim());
    const ok = !changed || (same && !template);
    removed = [];
    added = [];
    context = [];
    return ok;
  };
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      if (inHunk && !close()) return false;
      inHunk = true;
    } else if (!inHunk) {
      continue;
    } else if (line.startsWith("-")) {
      removed.push(line.slice(1));
    } else if (line.startsWith("+")) {
      added.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      context.push(line.slice(1));
    }
  }
  if (inHunk && !close()) return false;
  return changedHunks > 0;
}

/**
 * The part of a test's path that names what it tests, without the test directory, the test marker
 * of the name and the extension: `test/fidelity/grade.test.ts` gives `fidelity/grade`.
 */
function testSubject(path: string): string {
  const name = baseName(path);
  const stem = withoutExtension(name.endsWith(".snap") ? name.slice(0, -".snap".length) : name)
    .replace(/\.(?:test|spec)$/, "")
    .replace(/_test$/, "")
    .replace(/^test_/, "");
  return [...dirSegments(path).filter((s) => !TEST_DIRS.has(s)), stem].join("/");
}

/** True when a path in `confirmed` is the source of this test: the same path, or the same tail. */
function testsAConfirmedFile(testPath: string, confirmed: ReadonlySet<string>): boolean {
  const subject = testSubject(testPath);
  for (const source of confirmed) {
    if (isTestPath(source)) continue;
    const bare = withoutExtension(source);
    if (bare === subject || bare.endsWith(`/${subject}`)) return true;
  }
  return false;
}

/**
 * The rule that explains this file without a claim, or undefined: the file stays unexplained unless
 * a claim covers it. `confirmedPaths` holds the paths a confirmed claim explains; it is what makes a
 * test explained.
 */
export function explainedByRule(
  file: ChangedFile,
  ctx: { confirmedPaths?: ReadonlySet<string> } = {},
): RuleName | undefined {
  if (isLockfile(file.path)) return "lockfile";
  if (isGeneratedPath(file.path)) return "generated";
  const name = baseName(file.path);
  const sensitive = WHITESPACE_SENSITIVE_EXT.has(extension(name)) || WHITESPACE_SENSITIVE_NAME.has(name);
  if (!sensitive && isFormattingOnly(file.patch)) return "formatting-only";
  if (isTestPath(file.path) && ctx.confirmedPaths && testsAConfirmedFile(file.path, ctx.confirmedPaths)) {
    return "test-of-confirmed-claim";
  }
  return undefined;
}
