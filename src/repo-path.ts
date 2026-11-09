/**
 * Two kinds of path meet in this engine, and they must not be mixed.
 *
 * A repository-relative path is what git prints, what the findings carry and what the model is
 * told to report: always forward slashes, never absolute, never leaving the repository. It is
 * handled with `path.posix` on every OS, so a Windows run produces the same strings as Linux.
 *
 * An OS path (the snapshot directory, a file under it) is handled with `path` and never put into
 * a finding. `toOsPath` is the only crossing from the first kind to the second.
 */
import { join, posix } from "node:path";

/**
 * The forward-slash form of a path the user or the model typed, which on Windows may use
 * backslashes. On other systems a backslash is an ordinary file name character and stays.
 */
export function toRepoSlashes(input: string, platform: string = process.platform) {
  return platform === "win32" ? input.replace(/\\/g, "/") : input;
}

/**
 * The normalised repository-relative path, or null when the input is empty, absolute (a rooted
 * path, a drive such as `C:` or `C:x`, a UNC share), or climbs out of the repository with `..`.
 * Containment through symlinks is a separate check, made on real paths.
 */
export function repoRelative(input: string, platform: string = process.platform): string | null {
  const slashed = toRepoSlashes(input, platform);
  // A drive letter is only a drive on Windows; elsewhere `C:x` is an ordinary file name.
  if (slashed === "" || posix.isAbsolute(slashed) || (platform === "win32" && /^[A-Za-z]:/.test(slashed))) return null;
  const normal = posix.normalize(slashed).replace(/\/+$/, "");
  if (normal === "" || normal === "." || normal === ".." || normal.startsWith("../")) return null;
  return normal;
}

/** The OS path of a repository-relative path under `root`: `join` writes the OS's own separators. */
export function toOsPath(root: string, repoPath: string) {
  return join(root, ...repoPath.split("/"));
}
