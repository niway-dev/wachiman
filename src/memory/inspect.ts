/** The pure check behind `wachiman memory check`, also used by `memory propose` on the result it is about to commit. Kept apart from `command.ts` so neither imports the other. */
import { resolveMemorySettings, type RepoSettings } from "../repo-settings";
import { parseIndexMap, parseMemoryFile, type MemoryProblem } from "./entries";
import { ARCHIVE_FILE, globsOf, INDEX_FILE, lineCount, matchesGlob, MEMORY_DIR } from "./load";

export interface CheckInput {
  /** The text of every file directly in `.wachiman/memory/`, by name. */
  files: Record<string, string>;
  /** Every file of the repository (tracked, and untracked but not ignored), as `/`-separated paths. */
  repoFiles: string[];
  settings: RepoSettings | undefined;
}

export interface CheckResult {
  problems: MemoryProblem[];
  notices: string[];
  entries: number;
}

export function inspectMemory(input: CheckInput): CheckResult {
  const { files, repoFiles } = input;
  const resolved = resolveMemorySettings(input.settings);
  const budget = resolved.settings;
  const problems: MemoryProblem[] = [];
  const add = (file: string, line: number, message: string) => problems.push({ file, line, message });
  const names = Object.keys(files).sort();
  const matchesSome = (glob: string) => repoFiles.some((p) => matchesGlob(glob, p));
  let entryCount = 0;

  for (const name of names) {
    const parsed = parseMemoryFile(name, files[name]);
    problems.push(...parsed.problems);
    entryCount += parsed.entries.length;
    for (const entry of parsed.entries) {
      for (const glob of globsOf(entry.scope)) {
        if (!matchesSome(glob)) add(name, entry.line, `scope \`${glob}\` of entry matches no file in the repository`);
      }
    }
  }

  const indexText = files[INDEX_FILE];
  if (indexText === undefined) {
    if (names.length > 0) add(INDEX_FILE, 1, "is missing: without it no review loads any memory");
  } else {
    const rows = parseIndexMap(indexText);
    const listed = new Set<string>();
    for (const row of rows) {
      listed.add(row.file);
      if (!(row.file in files) || row.file === INDEX_FILE) add(INDEX_FILE, row.line, `maps to \`${row.file}\`, which is not in ${MEMORY_DIR}/`);
      for (const glob of globsOf(row.glob)) {
        if (!matchesSome(glob)) add(INDEX_FILE, row.line, `glob \`${glob}\` matches no file in the repository`);
      }
    }
    for (const name of names) {
      if (name !== INDEX_FILE && name !== ARCHIVE_FILE && !listed.has(name)) add(name, 1, "is not listed in index.md, so no review loads it");
    }
    const indexLines = lineCount(indexText);
    if (indexLines > budget.maxIndexLines) add(INDEX_FILE, budget.maxIndexLines + 1, `has ${indexLines} lines, over memory.max_index_lines (${budget.maxIndexLines})`);
    if (indexLines > budget.maxLoadedLines) {
      add(INDEX_FILE, budget.maxLoadedLines + 1, `has ${indexLines} lines, over memory.max_loaded_lines (${budget.maxLoadedLines}): a review loads only its first ${budget.maxLoadedLines}`);
    }
    for (const name of names) {
      if (name === INDEX_FILE || name === ARCHIVE_FILE) continue;
      const n = lineCount(files[name]);
      if (indexLines + n > budget.maxLoadedLines) {
        add(name, 1, `has ${n} lines; with index.md's ${indexLines} it exceeds memory.max_loaded_lines (${budget.maxLoadedLines}), so no review can load it`);
      }
    }
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { problems, notices: resolved.notices, entries: entryCount };
}
