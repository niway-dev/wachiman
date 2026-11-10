/** Tracked-only working-tree capture. All Git writes live in a disposable repository. */
import { spawnSync } from "node:child_process";
import {
  constants,
  closeSync,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { UsageError } from "../config";
import { GIT_BASE_ARGS, gitEnv, spawnGit, type GitRunner } from "../evidence";
import { REVIEW_INPUT_V2, type ReviewInput } from "../formats";
import { resolveScope } from "../engine";
import { localFiles, localInstructions } from "./local-git";

type Spawn = typeof spawnSync;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const identity = (s: ReturnType<typeof lstatSync>) => [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs].join(":");
const failure = () => new UsageError("The index, HEAD or tracked files changed during capture; retry --working-tree.");
export function workingTreeInput(p: {
  repoDir: string;
  mode: "staged" | "all";
  paths: string[];
  log: (s: string) => void;
  warn: (s: string) => void;
  git?: GitRunner;
  spawn?: Spawn;
  afterCapture?: () => void;
  afterManifest?: () => void;
}): { input: ReviewInput; release: () => void } {
  const source = p.git ?? spawnGit;
  const runSource = (args: string[]) => {
    const r = source(args, { cwd: p.repoDir, timeoutMs: 60000 });
    if (r.status !== 0 || r.error || r.outputCut)
      throw new UsageError(`Cannot capture working tree: git ${args[0]} failed: ${r.stderr ?? r.error}`);
    return r.stdout.replace(/\r?\n$/, "");
  };
  let base: string;
  try {
    base = runSource(["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch {
    throw new UsageError("Working-tree review requires an existing HEAD commit.");
  }
  const top = realpathSync(runSource(["rev-parse", "--show-toplevel"]));
  const index = resolve(p.repoDir, runSource(["rev-parse", "--git-path", "index"]));
  if (runSource(["rev-parse", "--shared-index-path"]))
    throw new UsageError("Working-tree review does not support a split index; disable split-index first.");
  const before = readFileSync(index);
  const beforeIdentity = identity(lstatSync(index));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-working-tree-")));
  const release = () => rmSync(root, { recursive: true, force: true });
  const spawn = p.spawn ?? spawnSync;
  try {
    const gitDir = join(root, "repository");
    const snapshot = join(root, "snapshot");
    mkdirSync(snapshot);
    const exec = (args: string[], input?: Buffer, cwd = top) => {
      const out = spawn("git", [...GIT_BASE_ARGS, "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null", ...args], {
        cwd,
        env: {
          ...gitEnv(),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_NO_LAZY_FETCH: "1",
        },
        input,
        timeout: 60000,
        maxBuffer: 512 * 1024 * 1024,
      });
      if (out.status !== 0 || out.error) throw new UsageError(`Working-tree git ${args[0]} failed: ${out.stderr?.toString() ?? out.error}`);
      return Buffer.from(out.stdout ?? "");
    };
    const format = runSource(["rev-parse", "--show-object-format"]);
    exec(["init", "--bare", "--template=", "--object-format=" + format, gitDir]);
    const objects = resolve(p.repoDir, runSource(["rev-parse", "--git-path", "objects"]));
    // Alternates are read-only: no command runs with the source repository as its git-dir.
    writeFileSync(join(gitDir, "objects/info/alternates"), JSON.stringify(objects) + "\n");
    copyFileSync(index, join(gitDir, "index"));
    const args = (a: string[]) => ["--git-dir=" + gitDir, ...a];
    const raw = (a: string[], input?: Buffer) => exec(args(a), input);
    const text = (a: string[]) => {
      const bytes = raw(a);
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new UsageError("Working-tree review requires UTF-8 Git paths.");
      }
    };
    const git: GitRunner = (a, o) => {
      try {
        return {
          status: 0,
          stdout: exec(args(a), undefined, o.cwd).toString("utf8"),
        };
      } catch (e) {
        return { status: 1, stdout: "", stderr: String(e) };
      }
    };
    if (text(["ls-files", "--unmerged", "-z"]))
      throw new UsageError("Working-tree review refuses an unmerged index. Resolve conflicts first.");
    if (
      text(["ls-files", "-v", "-z"])
        .split("\0")
        .some((s) => s.slice(0, 2).toUpperCase() === "S ")
    )
      throw new UsageError("Working-tree review does not support sparse checkout/skip-worktree entries.");
    const entries = text(["ls-files", "--stage", "-z"])
      .split("\0")
      .filter(Boolean)
      .map((s) => {
        const tab = s.indexOf("\t");
        const [mode, sha, stage] = s.slice(0, tab).split(" ");
        return { mode, sha, stage, path: s.slice(tab + 1) };
      });
    for (const e of entries) {
      if (e.mode === "160000") throw new UsageError("Working-tree review does not support submodule/gitlink snapshot content.");
      if (!["100644", "100755", "120000"].includes(e.mode)) throw new UsageError("Unsupported index mode " + e.mode);
    }
    // Read every parent with lstat; never follow a tracked path through a symlink.
    const read = (path: string, metadataOnly = false) => {
      const parts = path.split("/");
      if (parts.some((s) => !s || s === "." || s === ".." || s.toLowerCase() === ".git"))
        throw new UsageError("Unsafe tracked path " + path);
      let parent = top;
      const parents: string[] = [];
      for (const part of parts.slice(0, -1)) {
        parent = join(parent, part);
        try {
          const s = lstatSync(parent);
          if (!s.isDirectory() || s.isSymbolicLink()) throw new UsageError("Tracked path has a non-directory or symlink parent: " + path);
          parents.push(identity(s));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw e;
        }
      }
      const file = join(top, path);
      let stat;
      try {
        stat = lstatSync(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
      let bytes: Buffer;
      let mode: string;
      if (stat.isSymbolicLink()) {
        bytes = metadataOnly ? Buffer.alloc(0) : Buffer.from(readlinkSync(file));
        mode = "120000";
      } else if (stat.isFile()) {
        if (metadataOnly) {
          bytes = Buffer.alloc(0);
        } else {
          const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          try {
            if (identity(fstatSync(fd)) !== identity(stat)) throw failure();
            bytes = readFileSync(fd);
            if (identity(fstatSync(fd)) !== identity(stat)) throw failure();
          } finally {
            closeSync(fd);
          }
        }
        mode = stat.mode & 0o111 ? "100755" : "100644";
      } else throw new UsageError("Unsupported tracked file type: " + path);
      return {
        bytes,
        mode,
        identity: parents.join("|") + "|" + identity(stat),
        manifest: parents.join("|") + "|" + identity(stat) + "|" + hash(bytes),
      };
    };
    // Freeze identities for the complete path set before reading any file contents.
    const manifest = p.mode === "all" ? entries.map((e) => read(e.path, true)?.identity) : [];
    p.afterManifest?.();
    const captured =
      p.mode === "all"
        ? entries.map((e, i) => {
            const content = read(e.path);
            if (content?.identity !== manifest[i]) throw failure();
            return { ...e, content };
          })
        : [];
    if (p.mode === "all") {
      // Rebuild from the index's tracked path set. update-index --cacheinfo never invokes filters.
      raw(["read-tree", "--empty"]);
      for (const e of captured) {
        if (!e.content) continue;
        const sha = raw(["hash-object", "-w", "--stdin", "--no-filters"], e.content.bytes).toString().trim();
        raw(["update-index", "--add", "--cacheinfo", e.content.mode, sha, e.path]);
      }
    }
    const tree = text(["write-tree"]).trim();
    p.afterCapture?.();
    try {
      if (
        identity(lstatSync(index)) !== beforeIdentity ||
        !readFileSync(index).equals(before) ||
        runSource(["rev-parse", "--verify", "HEAD^{commit}"]) !== base
      )
        throw failure();
      for (const e of captured) {
        if (read(e.path)?.manifest !== e.content?.manifest) throw failure();
      }
    } catch {
      throw failure();
    }
    const files = localFiles(top, base, tree, git);
    const { paths, ignored } = resolveScope(
      p.paths,
      files.map((f) => f.filename),
    );
    if (ignored.length) p.log("Not paths in this change, ignored: " + ignored.join(" "));
    // Materialize raw blobs directly: no archive attributes, filters, tar traversal or live symlinks.
    const treeEntries = text(["ls-tree", "-r", "-z", tree]).split("\0").filter(Boolean);
    for (const entry of treeEntries) {
      const tab = entry.indexOf("\t");
      const [mode, type, sha] = entry.slice(0, tab).split(" ");
      const path = entry.slice(tab + 1);
      if (type !== "blob") throw new UsageError("Unsupported snapshot entry " + path);
      if (path.split("/").some((s) => !s || s === ".." || s === "." || s.toLowerCase() === ".git"))
        throw new UsageError("Unsafe snapshot path " + path);
      const dest = join(snapshot, path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, raw(["cat-file", "blob", sha]), {
        mode: mode === "100755" ? 0o755 : 0o644,
      });
    }
    // Evidence uses git grep in its own index; symlink entries remain textual blobs there too.
    exec(["init", "-q", "--template=", snapshot]);
    mkdirSync(join(snapshot, ".git/info"), { recursive: true });
    writeFileSync(join(snapshot, ".git/info/attributes"), "* -filter -text\n");
    exec(["-C", snapshot, "add", "-f", "-A"]);
    const name = basename(top);
    const input: ReviewInput = {
      format: REVIEW_INPUT_V2,
      change: {
        kind: "working-tree",
        describe: p.mode === "staged" ? `the staged changes of ${name}` : `the working tree of ${name}`,
        repository: { name },
        base: { sha: base, ref: "HEAD" },
        head: { sha: tree, ref: `working tree (${p.mode})` },
        workingTree: { mode: p.mode, baseCommit: base, tree },
      },
      files,
      instructions: localInstructions(top, base, p.warn, git),
      headDir: snapshot,
      scope: paths,
    };
    return { input, release };
  } catch (e) {
    release();
    throw e;
  }
}

/** A portable /2 input refers to a tree already present in this clone. Copy only raw blobs. */
export function snapshotWorkingTree(repoDir: string, tree: string, spawn: Spawn = spawnSync) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wachiman-tree-input-")));
  try {
    const exec = (args: string[], cwd = repoDir) => {
      const r = spawn("git", [...GIT_BASE_ARGS, ...args], {
        cwd,
        env: {
          ...gitEnv(),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_NO_LAZY_FETCH: "1",
          GIT_NO_REPLACE_OBJECTS: "1",
        },
        timeout: 60000,
        maxBuffer: 512 * 1024 * 1024,
      });
      if (r.status !== 0 || r.error) throw new UsageError("Cannot read working-tree input: " + (r.stderr?.toString() ?? r.error));
      return Buffer.from(r.stdout ?? "");
    };
    if (exec(["cat-file", "-t", tree]).toString().trim() !== "tree")
      throw new UsageError("Working-tree input head must be an existing tree object.");
    for (const entry of exec(["ls-tree", "-r", "-z", tree]).toString().split("\0").filter(Boolean)) {
      const tab = entry.indexOf("\t");
      const [mode, type, sha] = entry.slice(0, tab).split(" ");
      const path = entry.slice(tab + 1);
      if (type !== "blob" || !["100644", "100755", "120000"].includes(mode))
        throw new UsageError("Unsupported working-tree snapshot entry " + path);
      if (path.split("/").some((s) => !s || s === "." || s === ".." || s.toLowerCase() === ".git"))
        throw new UsageError("Unsafe snapshot path " + path);
      const dest = join(dir, path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, exec(["cat-file", "blob", sha]), {
        mode: mode === "100755" ? 0o755 : 0o644,
      });
    }
    exec(["init", "-q", "--template="], dir);
    mkdirSync(join(dir, ".git/info"), { recursive: true });
    writeFileSync(join(dir, ".git/info/attributes"), "* -filter -text\n");
    exec(["-c", "core.hooksPath=/dev/null", "add", "-f", "-A"], dir);
    return { dir };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
