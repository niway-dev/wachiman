import { resolve } from "node:path";

export type CommandShell = "posix" | "powershell";

/** Shell text is a suggestion only. Never pass this string to a subprocess. */
export function quoteArgument(value: string, shell: CommandShell): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return shell === "powershell" ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
}

export function projectCommand(command: "setup" | "local" | "doctor", repoDir: string, cwd = process.cwd(), shell: CommandShell = "posix"): string {
  const target = resolve(cwd, repoDir);
  const args = ["wachiman", command, ...(target === resolve(cwd) ? [] : ["--repo-dir", target])];
  return args.map((arg) => quoteArgument(arg, shell)).join(" ");
}

/** Windows users may be in either shell; name both rather than guess from PATH. */
export function projectCommands(command: "setup" | "local" | "doctor", repoDir: string, cwd = process.cwd(), platform = process.platform): string[] {
  return platform === "win32"
    ? [`PowerShell: ${projectCommand(command, repoDir, cwd, "powershell")}`, `Git Bash: ${projectCommand(command, repoDir, cwd)}`]
    : [projectCommand(command, repoDir, cwd)];
}
