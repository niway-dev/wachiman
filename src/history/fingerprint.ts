/**
 * The deterministic identity of a finding (spec D5): a title key and a line hash, both pure
 * functions of text. No model decides whether two findings are the same.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const stripWhitespace = (s: string) => s.replace(/\s+/g, "");

/** A cited line shorter than this, once stripped, is too common to identify anything. */
export const MIN_LINE_CHARS = 8;

/** The title lowercased, backticks and punctuation removed, every digit run a `#`, whitespace collapsed. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\d+/g, "#")
    .replace(/[^a-z0-9#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The lines of a file in the snapshot, or undefined when it is missing, unreadable or outside `headDir`. */
export function readHeadFileLines(headDir: string, path: string): string[] | undefined {
  const full = resolve(headDir, path);
  const rel = relative(resolve(headDir), full);
  if (rel === "" || rel.startsWith("..")) return undefined;
  try {
    if (!existsSync(full) || !statSync(full).isFile()) return undefined;
    return readFileSync(full, "utf8").split("\n");
  } catch {
    return undefined;
  }
}

/**
 * SHA-256 of the cited line without whitespace, and that stripped text. Undefined for line 0, a
 * missing file or line, a stripped line under 8 characters, or a line that occurs more than once
 * in the file: `}` or `return null;` must not match every brace.
 */
export function lineHashOf(headDir: string, path: string, line: number): { hash: string; text: string } | undefined {
  if (!Number.isInteger(line) || line < 1) return undefined;
  const lines = readHeadFileLines(headDir, path);
  if (!lines || line > lines.length) return undefined;
  const text = stripWhitespace(lines[line - 1]);
  if (text.length < MIN_LINE_CHARS) return undefined;
  if (lines.filter((l) => stripWhitespace(l) === text).length > 1) return undefined;
  return { hash: sha256(text), text };
}

/** Ten hex digits, short enough to type after `--verdict`. */
export function findingId(key: string, headSha: string, path: string, line: number, topic: string, titleKeyOf: string): string {
  return sha256([key, headSha, path, String(line), topic, titleKeyOf].join("\n")).slice(0, 10);
}
