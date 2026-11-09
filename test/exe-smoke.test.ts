/**
 * The smoke rows of the executable (scripts/smoke-exe.ts) against a native build of the same entry
 * point: this machine's own executable, so the rows run everywhere `bun test` runs. On macOS and
 * Linux this is the local stand-in for the Windows build; on `windows-latest` it is the real thing.
 * The cross-built `wachiman.exe` is smoke-tested by the CI and release workflows. A fake `claude`,
 * no model, no network.
 *
 * W5 (Ctrl-C) sends a console event on Windows, which is proven by its own CI step, not here.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgs, packageVersion, skillFilesOf } from "../scripts/build-exe";
import { ALL_ROWS, runSmoke, type Row } from "../scripts/smoke-exe";

const root = join(import.meta.dir, "..");
const version = packageVersion(root);
const out = mkdtempSync(join(tmpdir(), "wachiman-exe-build-"));
const exeName = process.platform === "win32" ? "wachiman.exe" : "wachiman";

const compile = (outfile: string, args = buildArgs({ outfile, version, skillFiles: skillFilesOf(root) })) => {
  const built = Bun.spawnSync([process.execPath, ...args], { cwd: root });
  if (built.exitCode !== 0) throw new Error(`compile failed: ${built.stderr.toString()}`);
  return outfile;
};

let exe = "";
beforeAll(() => {
  exe = compile(join(out, exeName));
}, 180_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

const rows = ALL_ROWS.filter((r) => r !== "W5" || process.platform !== "win32");

describe("the compiled executable, smoke-tested with a fake claude", () => {
  test.each(rows)("%s passes", async (row: Row) => {
    const [result] = await runSmoke({ exe, version, rows: [row] });
    expect(result).toEqual({ row, ok: true, detail: expect.any(String) });
  }, 180_000);

  // The same entry, built with one autoload flag dropped. If either of these passes, W1 proves nothing
  // about that flag. The message is matched whole: a W1 failure for any other reason names the same
  // directories, so a loose pattern would pass without the preload or the dotenv file ever taking effect.
  test.each([
    { flag: "--no-compile-autoload-bunfig", failure: "the bunfig.toml preload of the working directory ran" },
    { flag: "--no-compile-autoload-dotenv", failure: "(the dotenv file of the working directory reached the environment)" },
  ])("the sentinels bite: an executable built without $flag fails W1", async ({ flag, failure }) => {
    const outfile = join(out, `unsafe${flag}-${exeName}`);
    const unsafe = compile(outfile, buildArgs({ outfile, version, skillFiles: skillFilesOf(root) }).filter((a) => a !== flag));
    const [result] = await runSmoke({ exe: unsafe, version, rows: ["W1"] });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain(failure);
  }, 180_000);
});
