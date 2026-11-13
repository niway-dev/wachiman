/**
 * The repository settings file `.github/wachiman.yml`, written by `init` (ADR 0048). Today it holds
 * one key, `kind`, as metadata: nothing else in Wachiman reads it, and it never chooses an account,
 * a profile or a binary. It is plain string handling on purpose (no YAML library): init only ever
 * creates the file or replaces the one top-level `kind:` line, and keeps every other line as it was.
 *
 * It lives beside the workflows, not in them: GitHub parses every YAML file under
 * `.github/workflows/` as a workflow.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { UsageError } from "../config";
import type { ProjectKind } from "./options";
import { inspectTarget, type TargetState } from "./write";

export const SETTINGS_PATH = ".github/wachiman.yml";

const KIND_LINE = /^kind:[^\r\n]*/m;

/** The content of a new settings file. */
export const settingsContent = (kind: ProjectKind) =>
  [
    "# Wachiman settings for this repository, written by `wachiman init`. Commit it like any file.",
    '# kind: the shape of the repository, "monorepo" or "single". Metadata only for now.',
    `kind: ${kind}`,
    "",
  ].join("\n");

/** The value of the top-level `kind:` line (quotes and a trailing comment removed), or undefined when there is none. */
export function readKind(content: string): string | undefined {
  const line = KIND_LINE.exec(content);
  if (!line) return undefined;
  let value = line[0].slice("kind:".length).trim();
  const quoted = /^(["'])(.*?)\1/.exec(value);
  value = quoted ? quoted[2] : value.replace(/\s+#.*$/, "").trim();
  return value === "" ? undefined : value;
}

/** The file with only its top-level `kind:` line replaced (or `kind: X` appended when there is none). */
export function withKind(content: string, kind: ProjectKind): string {
  if (KIND_LINE.test(content)) return content.replace(KIND_LINE, `kind: ${kind}`);
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}kind: ${kind}\n`;
}

export type SettingsPlan =
  | { action: "create"; kind: ProjectKind; content: string; inspected: TargetState }
  | { action: "same"; kind: ProjectKind }
  | { action: "change"; kind: ProjectKind; from: string | undefined; content: string; inspected: TargetState };

/** Looks at the file without writing: what writing `kind` would do. Refuses a link or a non-file like the workflow does. */
export function planSettings(repoDir: string, kind: ProjectKind): SettingsPlan {
  const inspected = inspectTarget(repoDir, SETTINGS_PATH);
  if (!inspected.exists) return { action: "create", kind, content: settingsContent(kind), inspected };
  const current = readFileSync(inspected.target, "utf8");
  const from = readKind(current);
  if (from === kind) return { action: "same", kind };
  return { action: "change", kind, from, content: withKind(current, kind), inspected };
}

/** Writes a planned create or change: an exclusive temporary file, then a link (new) or a rename (only if the file is unchanged since the plan). */
export function writeSettings(repoDir: string, plan: Exclude<SettingsPlan, { action: "same" }>, hooks?: { beforeCommit?: () => void }): string {
  const { inspected } = plan;
  const dir = dirname(inspected.target);
  mkdirSync(dir, { recursive: true });
  const again = inspectTarget(repoDir, SETTINGS_PATH);
  if (again.exists !== inspected.exists || again.identity !== inspected.identity) {
    throw new UsageError(`${inspected.target} changed while init was running; nothing was written. Run it again.`);
  }
  const tmp = join(dir, `.${basename(inspected.target)}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, plan.content, { flag: "wx", mode: 0o644 });
  try {
    hooks?.beforeCommit?.();
    if (inspected.exists) {
      // Checked again right before the rename: an edit made since the plan is never overwritten.
      if (inspectTarget(repoDir, SETTINGS_PATH).identity !== inspected.identity) {
        throw new UsageError(`${inspected.target} changed while init was running; it was not replaced. Run it again.`);
      }
      renameSync(tmp, inspected.target);
    }
    else {
      try {
        linkSync(tmp, inspected.target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new UsageError(`${inspected.target} appeared while init was running; nothing was written.`);
        throw error;
      }
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Renamed into place, or already gone.
    }
  }
  return inspected.target;
}
