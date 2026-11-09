#!/usr/bin/env bun
/**
 * Builds the standalone Wachiman executable (ADR 0028 decision 3):
 *
 *   bun scripts/build-exe.ts --outfile wachiman.exe --target bun-windows-x64 --version 1.10.0
 *
 * The flags that matter are fixed here and checked by test/exe-build.test.ts:
 * - `--no-compile-autoload-dotenv` and `--no-compile-autoload-bunfig`: the executable never reads a
 *   `.env` or a `bunfig.toml` (whose `preload` runs code) from the directory it is started in,
 *   which is the reviewed repository;
 * - `--define WACHIMAN_VERSION=...`: the release version, because no package.json sits beside it;
 * - `--asset-naming='[dir]/[name].[ext]'`, `--root .` and every skill file as an extra entry
 *   point: the embedded files keep their repository-relative names, which `readAsset` looks up
 *   (src/install-kind.ts). The settings JSON and the caller template are embedded by being
 *   imported there with `{ type: "file" }`.
 *
 * Without `--target` it builds for the machine that runs it. Run it with the Bun version CI pins:
 * the build embeds that Bun's runtime. Writes only `--outfile`; never publishes anything.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface BuildOptions {
  outfile: string;
  version: string;
  /** A `bun build --target` such as `bun-windows-x64`; absent means this machine. */
  target?: string;
  /** Repository-relative, forward-slash paths of the skill files to embed. */
  skillFiles: string[];
}

/** The arguments after `bun`. */
export function buildArgs(o: BuildOptions): string[] {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(o.version)) throw new Error(`--version "${o.version}" is not a release version.`);
  return [
    "build",
    "--compile",
    ...(o.target ? ["--target", o.target] : []),
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--asset-naming=[dir]/[name].[ext]",
    "--root",
    ".",
    "--define",
    `WACHIMAN_VERSION=${JSON.stringify(o.version)}`,
    "src/cli.ts",
    ...o.skillFiles,
    "--outfile",
    o.outfile,
  ];
}

/** Every file under `skills/`, repository-relative with forward slashes, in a stable order. */
export function skillFilesOf(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(/[\\/]/).join("/"));
    }
  };
  walk(join(root, "skills"));
  return out;
}

export function packageVersion(root: string): string {
  return String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
}

function main(argv: string[]) {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const root = resolve(import.meta.dir, "..");
  const outfile = value("--outfile");
  if (!outfile) {
    console.error("usage: bun scripts/build-exe.ts --outfile <path> [--target <bun target>] [--version <x.y.z>]");
    return 2;
  }
  const args = buildArgs({ outfile: resolve(outfile), version: value("--version") ?? packageVersion(root), target: value("--target"), skillFiles: skillFilesOf(root) });
  console.log(`${process.execPath} ${args.join(" ")}`);
  const built = Bun.spawnSync([process.execPath, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" });
  return built.exitCode ?? 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
