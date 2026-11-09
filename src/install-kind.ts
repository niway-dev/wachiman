/**
 * Where this process's assets live, and how to read them. Three layouts exist:
 *
 * - `source`: `bun src/cli.ts` from a clone (`bin/wachiman`, `scripts/install-local.sh`);
 * - `npm`: the package directory under `node_modules`, started by the Node launcher; it has the
 *   same layout as the clone, so assets are plain files in both;
 * - `exe`: a Bun-compiled executable (the Windows `wachiman.exe`, ADR 0028, slice 5),
 *   whose assets are embedded and read through `Bun.embeddedFiles`.
 *
 * In the `exe` layout nothing exists next to the executable. `bun build --compile` embeds the
 * settings JSON and the caller template, which this module imports `with { type: "file" }` so the
 * bundler keeps them, and the build script lists every skill file as an extra entry point. With
 * `--asset-naming='[dir]/[name].[ext]'` each embedded file keeps its repository-relative name, so
 * `readAsset` looks the same name up that the other layouts read from disk.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
// Under `bun src/cli.ts` these are the real paths of the files; in a compiled executable they are
// paths inside the embedded file system. Either way they are readable with `readFileSync`.
import settingsFile from "./providers/claude-code.settings.json" with { type: "file" };
import callerTemplateFile from "../templates/wachiman-review-caller.yml" with { type: "file" };

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
  const slashed = dir.replaceAll("\\", "/");
  if (slashed.startsWith("/$bunfs/") || slashed.startsWith("B:/~BUN")) return { kind: "exe", version };
  return { kind: dir.split(/[\\/]/).includes("node_modules") ? "npm" : "source", root: rootOf(dir) };
}

/** The files compiled into an executable, by repository-relative name; replaceable in a test. */
export interface EmbeddedAssets {
  has(name: string): boolean;
  read(name: string): Uint8Array;
}

const SETTINGS_NAME = "src/providers/claude-code.settings.json";
const TEMPLATE_NAME = "templates/wachiman-review-caller.yml";

/** The embedded files of this process, from `Bun.embeddedFiles` (empty outside a compiled executable). */
export function bunEmbeddedAssets(): EmbeddedAssets {
  const slash = (path: string) => path.replace(/\\/g, "/");
  const names = new Set(Bun.embeddedFiles.map((file) => slash((file as Blob & { name: string }).name)));
  // The imported path is the platform's own spelling of an embedded location; every other embedded
  // file sits under the same root, at its repository-relative name.
  const root = slash(settingsFile).endsWith(SETTINGS_NAME) ? slash(settingsFile).slice(0, -SETTINGS_NAME.length) : undefined;
  return {
    has: (name) => names.has(name),
    read: (name) => {
      const path = name === SETTINGS_NAME ? settingsFile : name === TEMPLATE_NAME ? callerTemplateFile : root === undefined ? undefined : root + name;
      if (path === undefined) throw new Error(`readAsset: cannot locate ${name} inside the executable`);
      return new Uint8Array(readFileSync(path));
    },
  };
}

/**
 * Templates and the engine settings come back as text; skill files come back as bytes, so a copy
 * is exact. A name that is absolute or climbs out of the root is refused.
 */
export function readAsset(install: InstallKind, name: AssetName, embedded: EmbeddedAssets = bunEmbeddedAssets()): string | Uint8Array {
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name) || name.startsWith("/")) throw new Error(`readAsset: ${name} is not an asset name`);
  if (install.kind === "exe") {
    if (name.split(/[\\/]/).includes("..") || name.includes("\\")) throw new Error(`readAsset: ${name} is outside the package`);
    if (!embedded.has(name)) throw new Error(`readAsset: ${name} is not embedded in this executable`);
    const bytes = embedded.read(name);
    return name.startsWith("skills/") ? bytes : new TextDecoder().decode(bytes);
  }
  const path = resolve(install.root, name);
  if (name.split(/[\\/]/).includes("..") || !path.startsWith(resolve(install.root) + sep)) throw new Error(`readAsset: ${name} is outside the package`);
  return name.startsWith("skills/") ? new Uint8Array(readFileSync(path)) : readFileSync(path, "utf8");
}
