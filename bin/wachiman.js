#!/usr/bin/env node
// The npm `bin` for `wachiman` and `agent-review`: finds Bun on PATH and runs this package's
// TypeScript engine with it. All logic is in ./launcher-args.js.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./launcher-args.js";

// Node resolves the symlink npm puts in `bin/`, so this is the real package directory.
const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
process.exitCode = launch({ pkgDir, argv: process.argv.slice(2) });
