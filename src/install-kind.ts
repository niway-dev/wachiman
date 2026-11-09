/**
 * Where this process's assets live, and how to read them. Three layouts exist:
 *
 * - `source`: `bun src/cli.ts` from a clone (`bin/wachiman`, `scripts/install-local.sh`);
 * - `npm`: the package directory under `node_modules`, started by the Node launcher; it has the
 *   same layout as the clone, so assets are plain files in both;
 * - `exe`: a Bun-compiled executable (the Windows `wachiman.exe`, planned: ADR 0028, slice 5),
 *   whose assets are embedded and read through `Bun.embeddedFiles`.
 *
 * Nothing calls `readAsset` yet. It is the tested seam for slice 5 (the Windows executable), where
 * commands start reading assets through it; its `exe` branch throws until then.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export type InstallKind = { kind: "source"; root: string } | { kind: "npm"; root: string } | { kind: "exe"; version: string };

/** The asset names the commands read. */
export type AssetName = "templates/wachiman-review-caller.yml" | "src/providers/claude-code.settings.json" | `skills/${string}`;

/** The package or clone root for a module directory at any depth below `src/`. */
function rootOf(dir: string) {
  for (let current = dir; ; current = dirname(current)) {
    if (basename(current) === "src") return dirname(current);
    if (dirname(current) === current) return join(dir, "..", "..");
  }
}

/**
 * `dir` is the directory of a module inside `src/` (this module's by default): inside a bundled
 * executable it starts with `/$bunfs/` (`B:\~BUN` on Windows).
 */
export function detectInstall(version: string, dir = import.meta.dir): InstallKind {
  if (dir.startsWith("/$bunfs/") || dir.startsWith("B:\\~BUN")) return { kind: "exe", version };
  return { kind: dir.split(/[\\/]/).includes("node_modules") ? "npm" : "source", root: rootOf(dir) };
}

/**
 * Templates and the engine settings come back as text; skill files come back as bytes, so a copy
 * is exact. A name that is absolute or climbs out of the root is refused.
 */
export function readAsset(install: InstallKind, name: AssetName): string | Uint8Array {
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.startsWith("/")) throw new Error(`readAsset: ${name} is not an asset name`);
  if (install.kind === "exe") {
    // Extension point for slice 5: read `name` from `Bun.embeddedFiles` here.
    throw new Error("readAsset: the executable layout is not implemented yet");
  }
  const path = resolve(install.root, name);
  if (name.split(/[\\/]/).includes("..") || !path.startsWith(resolve(install.root) + sep)) throw new Error(`readAsset: ${name} is outside the package`);
  return name.startsWith("skills/") ? new Uint8Array(readFileSync(path)) : readFileSync(path, "utf8");
}
