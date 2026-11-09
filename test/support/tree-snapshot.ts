import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every file under `dir` (a `.git` directory included) with its mode and a digest of its bytes. */
export function snapshotTree(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) Object.assign(out, snapshotTree(path, `${prefix}${name}/`));
    else out[`${prefix}${name}`] = `${stat.mode}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  }
  return out;
}
