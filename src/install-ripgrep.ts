#!/usr/bin/env bun
/**
 * Installs the pinned ripgrep for the call-site evidence search, for CI and for anyone who wants
 * it without running `wachiman setup`. Prints what it does.
 *
 *   bun --no-env-file --config=bunfig.toml src/install-ripgrep.ts
 *
 * Exit 0: a usable ripgrep is there, or it could not be downloaded (the review then runs on
 * `git grep`, which is slower; the line says so). Exit 1: the download did not match the SHA-256
 * pinned in `src/ripgrep.ts`, and nothing was installed. Where it installs: `<Wachiman home>/bin`
 * (`WACHIMAN_HOME`, else `~/.wachiman`), the place the engine looks first after `WACHIMAN_RIPGREP`.
 */
import { ensureRipgrep } from "./ripgrep";

const { ok, result } = await ensureRipgrep(process.env, (line) => console.log(line));
// A missing download is a warning annotation in Actions; a refusal is an error.
if ("status" in result && result.status !== "installed") {
  console.log(`::${ok ? "warning" : "error"} title=ripgrep::${result.reason}`);
}
process.exit(ok ? 0 : 1);
