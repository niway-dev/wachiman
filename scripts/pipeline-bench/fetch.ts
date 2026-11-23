// Fetches one corpus case: a shallow clone of the merge commit, so `buildLocalInput` can diff it
// against its first parent. Prints the directory. Usage: bun fetch.ts <case-id> <dest-dir>
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [id, dest] = process.argv.slice(2);
if (!id || !dest) {
  console.error("usage: bun fetch.ts <case-id> <dest-dir>");
  process.exit(2);
}
const corpus = JSON.parse(await Bun.file(join(import.meta.dir, "corpus.json")).text());
const c = corpus.cases.find((x: { id: string }) => x.id === id);
if (!c) {
  console.error(`unknown case ${id}`);
  process.exit(2);
}

const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", dest, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
};

const have = () => {
  try {
    return existsSync(join(dest, ".git")) && git("rev-parse", "--verify", `${c.sha}^{commit}`) === c.sha && git("rev-parse", "--verify", `${c.sha}^`) !== "";
  } catch {
    return false;
  }
};

if (!have()) {
  mkdirSync(dest, { recursive: true });
  if (!existsSync(join(dest, ".git"))) git("init", "--quiet");
  try {
    git("remote", "add", "origin", `https://github.com/${c.repo}.git`);
  } catch {
    // The remote already exists from an earlier, interrupted fetch.
  }
  git("fetch", "--quiet", "--depth=2", "origin", c.sha);
  git("checkout", "--quiet", "--detach", c.sha);
}
console.log(dest);
