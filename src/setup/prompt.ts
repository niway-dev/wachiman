/**
 * The questions of `wachiman setup` (command contract section 5.4, steps 1 to 3). They collect a
 * choice and write nothing but what the person explicitly confirmed: a managed directory plus a
 * Claude sign-in, which `ctx.createManaged` performs and the run reports even if the wizard is
 * cancelled later. The profile entry and the binding are saved by the run, together, afterwards.
 */
import { basename, join } from "node:path";
import { binaryProblem, checkExternalConfigDir, checkNewProfileName } from "../accounts/commands";
import type { ProjectBinding, WachimanConfigV1 } from "../accounts/config";
import { buildProfileList, managedDir, refersTo, type ProfileListEntry } from "../accounts/profile-list";
import { checkProfileName, ISOLATED_NAME, parseProfileRef } from "../accounts/resolve";
import { UsageError } from "../config";
import type { HistoryRepository } from "../history/types";
import type { Prompter } from "../wizard/prompt";
import type { RawSetupFlags } from "./options";

/** A profile the wizard proposes to register, written only together with the binding. */
export type PendingProfile =
  | { kind: "external"; name: string; configDir: string; binary?: string }
  | { kind: "managed"; name: string; configDir: string };

export interface SetupPromptContext {
  repo: HistoryRepository;
  /** What the repository is bound to now, if anything. */
  current?: ProjectBinding;
  config: WachimanConfigV1 | undefined;
  /** The Wachiman home. */
  home: string;
  /** What a leading `~` means. */
  userHome: string;
  /** Creates the managed directory and runs the sign-in; called only after the person confirmed that side effect. */
  createManaged: (name: string) => void;
  /** init already collected the local-mode choice; still confirm the final write. */
  fromInit?: boolean;
  initMode?: "local" | "both";
}

export type SetupAnswers =
  | { kind: "confirmed"; flags: RawSetupFlags; pending?: PendingProfile }
  /** The person said no to setting up this repository or to the final question: nothing is saved. */
  | { kind: "declined" }
  | { kind: "cancelled" };

const REGISTER = Symbol("register");
const CREATE = Symbol("create");

/** The scope sentence: what the binding covers. */
export const scopeSentence = (repo: HistoryRepository) =>
  repo.keyedBy === "remote" ? "every clone and worktree of this origin will use it" : "this repository and its worktrees will use it";

export const identityLine = (repo: HistoryRepository) =>
  repo.keyedBy === "remote" ? `keyed by origin: ${repo.remote ?? "(unparsed)"}` : `keyed by path: ${repo.path}`;

/** A profile name proposed from a directory: `.claude-work` becomes `claude-work`; taken or reserved names get a number. */
export function suggestProfileName(configDir: string, taken: (name: string) => boolean) {
  const base =
    basename(configDir)
      .toLowerCase()
      .replace(/^\.+/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28)
      .replace(/-+$/, "") || "external";
  const free = (name: string) => !taken(name) && name !== "default" && name !== ISOLATED_NAME;
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

const problemOf = (check: () => unknown): string | undefined => {
  try {
    check();
    return undefined;
  } catch (error) {
    if (error instanceof UsageError) return error.message;
    throw error;
  }
};

export async function promptForSetup(flags: RawSetupFlags, ctx: SetupPromptContext, prompter: Prompter): Promise<SetupAnswers> {
  const { repo, config, home } = ctx;
  const registered = (name: string) => Object.hasOwn(config?.profiles ?? {}, name);
  const say = (line: string) => prompter.say(line);

  const total = ctx.fromInit ? (ctx.initMode === "both" ? 7 : 6) : 4;
  if (!ctx.fromInit) {
    prompter.step("Project", 1, total);
    say(`repository: ${repo.name} (${repo.keyedBy === "remote" ? `origin ${repo.remote ?? "(unparsed)"}` : `path ${repo.path}`})`);
    if (ctx.current) say(`currently bound to ${ctx.current.profile}`);
    const go = await prompter.confirm("Set up this repository?", true);
    if (go === null) return { kind: "cancelled" };
    if (!go) return { kind: "declined" };
  }

  let name = flags.profile;
  prompter.step("Claude account", total - 2, total);
  if (ctx.fromInit && ctx.current) say(`currently bound to ${ctx.current.profile}`);
  let pending: PendingProfile | undefined;
  while (name === undefined) {
    const list = buildProfileList(home, config);
    const profiles: ProfileListEntry[] = [{ name: "default", kind: "default", registered: true, usedBy: [] }, ...list.profiles];
    const rows: { label: string; description?: string; value: string | typeof REGISTER | typeof CREATE }[] = profiles.map((p) => {
      const marks = [
        ctx.current && (ctx.current.profile === p.name || refersTo(ctx.current.profile, p.name)) ? "(current)" : "",
        list.defaultProfile !== undefined && (list.defaultProfile === p.name || refersTo(list.defaultProfile, p.name)) ? "(global default)" : "",
        p.registered ? "" : "(unregistered)",
      ].filter(Boolean);
      const where = p.kind === "external" ? `${p.configDir}, ${p.binary ? `binary ${p.binary}` : "claude from PATH"}` : p.configDir;
      const label = p.kind === "default" ? "Use my current Claude session" : `${p.name}  ${p.kind}`;
      return { label: `${label}${marks.length ? `  ${marks.join(" ")}` : ""}`, description: p.kind === "default" ? "Shares your normal Claude settings." : where, value: p.name };
    });
    rows.push({ label: "Create a new isolated profile (managed)", value: CREATE });
    rows.push({ label: "Register an existing Claude configuration directory (external)", value: REGISTER });
    const indexOf = (ref: string) => profiles.findIndex((p) => ref === p.name || refersTo(ref, p.name));
    const currentIndex = ctx.current ? indexOf(ctx.current.profile) : -1;
    const globalIndex = list.defaultProfile !== undefined ? indexOf(list.defaultProfile) : -1;
    const defaultIndex = currentIndex >= 0 ? currentIndex : globalIndex >= 0 ? globalIndex : 0;
    const label = "Which account profile should this repository use?";
    const picked = await prompter.select(label, rows, defaultIndex);
    if (picked === null) return { kind: "cancelled" };

    if (picked === REGISTER) {
      const dir = await prompter.text("Configuration directory (absolute; ~ is expanded)", undefined, (v) =>
        v === "" ? "A directory is required." : problemOf(() => checkExternalConfigDir(v, home, ctx.userHome, "Configuration directory")),
      );
      if (dir === null) return { kind: "cancelled" };
      const configDir = checkExternalConfigDir(dir, home, ctx.userHome, "Configuration directory");
      const binary = await prompter.text("claude binary (leave empty for PATH)", "", (v) => {
        if (v === "") return undefined;
        const problem = binaryProblem(v);
        return problem ? `${v} ${problem}.` : undefined;
      });
      if (binary === null) return { kind: "cancelled" };
      const proposed = suggestProfileName(configDir, (n) => registered(n) || problemOf(() => checkNewProfileName(n, home)) !== undefined);
      const chosen = await prompter.text("Profile name", proposed, (v) =>
        registered(v) ? `"${v}" is already registered; choose another name.` : problemOf(() => checkNewProfileName(v, home)),
      );
      if (chosen === null) return { kind: "cancelled" };
      pending = { kind: "external", name: chosen, configDir, ...(binary ? { binary } : {}) };
      name = chosen;
    } else if (picked === CREATE) {
      const chosen = await prompter.text("Profile name", ISOLATED_NAME, (v) =>
        registered(v)
          ? `"${v}" is already registered; pick it from the list instead.`
          : v === "default"
            ? `"default" is reserved (the built-in profile); choose another name.`
            : problemOf(() => checkProfileName(v)),
      );
      if (chosen === null) return { kind: "cancelled" };
      const dir = managedDir(home, chosen);
      const ok = await prompter.confirm(
        `Create ${dir} (mode 0700) and open Claude there so you can sign in? Nothing is registered yet, and Wachiman cannot undo a sign-in.`,
        true,
      );
      if (ok === null) return { kind: "cancelled" };
      if (!ok) continue;
      ctx.createManaged(chosen);
      pending = { kind: "managed", name: chosen, configDir: dir };
      name = chosen;
    } else {
      name = picked;
    }
  }
  parseProfileRef(name);

  const p = pending;
  const known = !p ? (config?.profiles && Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined) : undefined;
  const kind = p?.kind ?? known?.kind ?? (name === "default" ? "default" : "managed");
  const directory = p?.configDir ?? known?.configDir ?? (name === "default" ? undefined : join(home, `claude-${name.replace(/^isolated:/, "")}`));
  const binary = p?.kind === "external" ? p.binary : known?.kind === "external" ? known.binary : undefined;
  prompter.step("Confirm binding", total - 1, total);
  say("Bind this repository:");
  say(`  profile:    ${name}`);
  say(`  kind:       ${kind}`);
  say(`  directory:  ${directory ?? "(your shell's own Claude configuration)"}`);
  say(`  binary:     ${binary ?? "claude from PATH"}`);
  say(`  repository: ${repo.name}, ${identityLine(repo)}`);
  say(`  scope:      ${scopeSentence(repo)}`);
  say(`  will write: ${join(home, "config.json")}${p ? `, registering ${p.name} and binding ${repo.name} together` : `, binding ${repo.name}`}; nothing is written in the repository`);
  const bind = await prompter.confirm(`Bind ${repo.name} to ${name}?`, true);
  if (bind === null) return { kind: "cancelled" };
  if (!bind) return { kind: "declined" };
  return { kind: "confirmed", flags: { ...flags, profile: name }, ...(p ? { pending: p } : {}) };
}
