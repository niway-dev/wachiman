# Review and configuration types: every external and internal contract

> **Default configuration update 2026-11-10:** The default is now Opus 5.5 at effort `high`, with verification off. Enable verification explicitly with `verify: true`, `AGENT_REVIEW_VERIFY=1`, or `local --verify`. This supersedes statements below about the 2026-11-09 defaults; historical decisions remain for context.

- **Status:** proposed 2026-11-09; detail of the
  [canonical design](2026-11-09-cli-and-verified-reviews-design.md) and the
  [command contract](2026-11-09-cli-command-contract.md). Types are TypeScript-like; the JSON
  Schemas named here are the contract for the external formats and are written in slice 2 of
  the [plan](../plans/2026-11-09-cli-and-verified-reviews.md). Each section says which types
  exist today (`src/…` at `b3f60be` or in the `findings-verifier-impl` worktree) and which are
  planned. Nothing planned exists.
- **Conventions:** `type X = A | B` with a `kind` or `status` discriminant; every optional field
  is written `?`; paths in configuration are always absolute; times are ISO-8601 UTC strings;
  money is USD as a JSON number.

## 1. Account configuration (`~/.wachiman/config.json`) — planned

### 1.1 File

```ts
/** The whole file. Written only by `profile`, `setup`, `project` commands, under the lock. */
interface WachimanConfigV1 {
  version: 1;
  /** Rung 4 of the resolution. Must resolve under the same ProfileNameRef rules as --profile. */
  defaultProfile?: string; // may also be built-in "default" or an isolated alias
  profiles: Record<ProfileName, ProfileEntry>;
  /** Keyed by `HistoryRepository.key` (`src/history/store.ts:repositoryKey`). */
  projects: Record<RepositoryKey, ProjectBinding>;
}

/** `^[a-z0-9][a-z0-9-]{0,31}$` (today's `NAME` in `src/profiles.ts`); never `default` or `isolated`-as-external. */
type ProfileName = string;
type ProfileNameRef = ProfileName | "default" | "isolated" | `isolated:${string}`;
/** `<name>-<8 hex>` as `repositoryKey` produces it. */
type RepositoryKey = string;

type ProfileEntry =
  | {
      kind: "managed";
      /** Always `<WACHIMAN_HOME>/claude-<name>`; stored for clarity, recomputed and compared on read. */
      configDir: string;
      createdAt: string;
      note?: string;
    }
  | {
      kind: "external";
      /** Absolute, existing directory, not under `<WACHIMAN_HOME>`. Never listed or opened by Wachiman. */
      configDir: string;
      /** Absolute path to a regular executable file; `.exe` on Windows; never `.cmd`/`.bat`/`.ps1`. Absent: `claude` from PATH. */
      binary?: string;
      createdAt: string;
      note?: string;
    };

interface ProjectBinding {
  profile: ProfileNameRef;
  /** How the key was made, copied from `repositoryKey` so `project show` can explain it. */
  keyedBy: "remote" | "path";
  /** The normalised origin URL without credentials, when `keyedBy === "remote"`. */
  remote?: string;
  /** The repository's basename, for listings. */
  name: string;
  boundAt: string;
  /** The working directory `setup` ran in; informational, never used for resolution. */
  boundFrom: string;
}
```

Example (paths illustrative):

```json
{
  "version": 1,
  "defaultProfile": "personal",
  "profiles": {
    "personal": { "kind": "managed", "configDir": "/Users/me/.wachiman/claude-personal", "createdAt": "2026-11-09T10:00:00Z" },
    "work-a": { "kind": "external", "configDir": "/Users/me/.claude-work-a", "binary": "/opt/claude/claude", "createdAt": "2026-11-09T10:05:00Z" },
    "work-b": { "kind": "external", "configDir": "/Users/me/.claude-work-b", "createdAt": "2026-11-09T10:06:00Z" }
  },
  "projects": {
    "kaipu-record-3f9a1c2d": { "profile": "work-a", "keyedBy": "remote", "remote": "ssh://github.com/acme/kaipu-record", "name": "kaipu-record", "boundAt": "2026-11-09T10:10:00Z", "boundFrom": "/Users/me/src/kaipu-record" }
  }
}
```

### 1.2 Reading: strict

```ts
type ConfigRead =
  | { kind: "absent" }                       // no file: no profiles, no bindings, no default
  | { kind: "ok"; config: WachimanConfigV1; path: string }
  | { kind: "corrupt"; path: string; problem: string };   // → UsageError, exit 2, never "absent"

function readConfig(home: string, io: { read: (p: string) => string; exists: (p: string) => boolean }): ConfigRead;
```

`corrupt` when: not JSON; `version !== 1`; `profiles` or `projects` not an object; an entry
without a valid `kind`; a `configDir` or `binary` that is not an absolute path; a `managed`
`configDir` that is not `<home>/claude-<name>`; a `defaultProfile` or binding `profile` that cannot resolve by ProfileNameRef (**dangling**); a profile name that fails the
name rule; a project key that fails `KEY_PATTERN`. Normal review/doctor readers fail on dangling references, never fall back. For recovery only,
`profile remove` and `project unbind` may use a structural read (same shape/path validation,
reference existence checks deferred) to remove the selected broken reference. They cannot run
a provider or silently clear unrelated values; validate final references before save.
Unknown extra fields at any level are kept
and rewritten unchanged (forward compatibility), never a reason to fail.

### 1.3 Writing: locked, atomic

```ts
interface ConfigWriteOptions { home: string; timeoutMs?: number /* default 5000 */; }
/** Read-modify-write under `config.json.lock`. `mutate` is pure and may throw a UsageError to abort. */
function updateConfig(opts: ConfigWriteOptions, mutate: (current: WachimanConfigV1) => WachimanConfigV1): WachimanConfigV1;
```

Algorithm: `mkdir -p <home>` (`0700`); open `<home>/config.json.lock` with `O_CREAT | O_EXCL |
O_WRONLY` and write the pid; on `EEXIST` retry every 50 ms until `timeoutMs`, then throw a
`UsageError` naming the lock file and its pid; inside the lock: `readConfig` (a structurally corrupt read aborts and releases the lock), `mutate`, serialise with two-space indent and a trailing newline,
write to `config.json.tmp-<pid>-<random>` with mode `0600`, `fsync`, `rename` over
`config.json`, `chmod 0600` (no-op where modes are not enforced); `finally` unlink the lock. Never remove a contended lock automatically. A PID/age check cannot make unlink/reacquire
race-free. After timeout, report the lock path and owner metadata and instruct explicit recovery
only after checking no writer is running. Include a random owner token; finally releases only the
lock owned by this writer. Create lock/temp files with exclusive creation and reject symlinks.
Fsync the parent directory where supported; Windows replacement semantics must pass the
concurrent-writer test before support is claimed.

### 1.4 Resolution and confirmation

```ts
type ProfileRef =
  | { kind: "default" }                                   // built-in: the shell's claude, as is
  | { kind: "managed"; name: string; configDir: string; registered: boolean }
  | { kind: "external"; name: string; configDir: string; binary?: string };

type Rung = "flag" | "binding" | "env" | "configDefault" | "builtIn";

interface ResolvedProfile {
  profile: ProfileRef;
  rung: Rung;
  /** Lower rungs that had a value and were ignored, for the stderr line. */
  overridden: { rung: Rung; value: string }[];
}

type ResolveFailure = { rung: Rung; value: string; problem: string };  // → UsageError, exit 2

/** Pure. `binding` is the repository's `ProjectBinding` or undefined. */
function resolveProfile(input: {
  flag?: string;
  binding?: ProjectBinding;
  env: { WACHIMAN_PROFILE?: string };
  config: WachimanConfigV1 | undefined;
  managedDirExists: (name: string) => boolean;
  home: string;
}): { ok: true; resolved: ResolvedProfile } | { ok: false; failure: ResolveFailure };
```

Precedence: flag > binding > env > configDefault > builtIn. A rung with a value that does not
resolve **fails**; it never falls through. Name spellings: `default`; `isolated` → managed
`isolated`; `isolated:<n>` → managed `<n>`; a registered name → its entry; an unregistered name
whose managed directory exists → managed, `registered: false`.

```ts
type AuthMethod = "none" | "claude.ai" | "oauth_token" | "api_key" | "api_key_helper" | "third_party" | "unknown";

interface AuthStatus {
  /** `claude auth status` exit code, 0 signed in, 1 not. */
  exitCode: number | null;
  authMethod: AuthMethod | undefined;
  /** From the JSON when the binary reports it; undefined on older binaries. */
  configDirectory?: string;
  /** Whether `configDirectory` equals the profile's directory. */
  directory: "matches" | "differs" | "unverified" | "n/a";
  /** Not observed: Wachiman cannot see what the subprocess did on the network. Always "unknown". */
  networkObserved: "unknown";
  /** Never the raw JSON; a one-line summary with no e-mail address. */
  summary: string;
}

type Confirmation =
  | { ok: true; binary: { path: string; version: string }; auth: AuthStatus }
  | { ok: false; stage: "directory" | "binary" | "auth"; problem: string; fix: string };

/** Spawns `<binary> --version` and `<binary> auth status` (JSON is the documented default) with `buildChildEnv(env, { auth: "subscription", configDir })`,
 *  cwd = an empty temp dir, timeout 15 s each, output cap 64 KiB; Wachiman itself opens no credential file. Apply the same explicit hardening settings and
 * subscription environment as reviews; probe which auth-subcommand flags are supported, with no unrestricted helper fallback. */
function confirmProfile(p: ResolvedProfile, env: Env, spawn: SpawnFn): Confirmation;
```

Rules: `exitCode !== 0` → `auth` failure, fix `wachiman profile login <name>`; `authMethod` not
`claude.ai` → failure (`api_key`: "a local run would be billed to a key; remove it from that
profile"; `api_key_helper`, `third_party`, `unknown`: "unsupported by the local mode"); for
managed and external, `directory: "differs"` → failure ("the binary reports another directory;
a shell function or an inherited setting may be interfering"), `"unverified"` → failure for a
review (strict), a failed required auth check for `doctor`; for `default`, `directory: "n/a"`. `confirmProfile` is
called by `local` before `provider.preflight()`, by `setup` step 5, by `doctor`.

## 2. Doctor — planned

```ts
type CheckLevel = "required" | "optional";
type CheckStatus = "ok" | "fail" | "warn" | "skip";

interface DoctorCheck {
  id: "wachiman" | "bun" | "git" | "tar" | "config" | "profile" | "auth" | "environment" | "project" | "history" | "skills" | "isolation";
  level: CheckLevel;
  /** Impure; receives injected spawn/fs/env so tests run it without a machine. */
  run(ctx: DoctorContext): DoctorRow;
}

interface DoctorRow {
  id: DoctorCheck["id"];
  level: CheckLevel;
  status: CheckStatus;
  /** One line, what was observed. Paths redacted when `--redact-paths`. */
  evidence: string;
  fix?: string;
  /** Row-specific structured detail; the `auth` row always carries `networkObserved: "unknown"`. */
  detail?: Record<string, string | number | boolean | null>;
}

interface DoctorReport {
  format: "wachiman.doctor/1";
  version: string;
  install: "npm" | "source" | "exe";
  platform: `${NodeJS.Platform}-${string}`;
  tier: "supported" | "built-and-smoke-tested" | "built-untested";
  profile?: { name: string; kind: ProfileRef["kind"]; rung: Rung };
  checks: DoctorRow[];
  failedRequired: number;
  exitCode: 0 | 1;
}
```

Tiers: `darwin-arm64`, `darwin-x64`, `linux-x64` running under Bun → `supported`;
`win32-x64` → `built-and-smoke-tested` until the Windows rows pass (then `supported`);
everything else → `built-untested`.

## 3. Wizards — planned

```ts
interface RawSetupFlags { profile?: string; repoDir?: string; yes?: boolean; json?: boolean; help?: boolean; }
interface SetupOptions { profile: ProfileName | "default" | `isolated:${string}`; repoDir: string; interactive: boolean; json: boolean; }

type InitMode = "github" | "local" | "both";
interface RawInitFlags { mode?: string; operator?: string; version?: string; path?: string; force?: boolean; dryRun?: boolean; yes?: boolean; repoDir?: string; help?: boolean; }
interface InitOptions {
  mode: InitMode;
  /** Present iff mode !== "local". */
  github?: { operator: string; tag: string; path: string; force: boolean; dryRun: boolean };
  repoDir: string;
  interactive: boolean;
}

type ResolveResult<T> = { ok: true; options: T } | { ok: false; error: string };
function resolveSetupOptions(flags: RawSetupFlags, ctx: { interactive: boolean }): ResolveResult<SetupOptions>;
function resolveInitOptions(flags: RawInitFlags, ctx: { interactive: boolean; defaultWorkflowRef?: string }): ResolveResult<InitOptions>;

/** Prompts produce the same raw flags the parser does; `null` means cancelled. */
function promptForSetup(flags: RawSetupFlags, ctx: SetupPromptContext, io: PromptIO): Promise<RawSetupFlags | null>;
function promptForInit(flags: RawInitFlags, ctx: InitPromptContext, io: PromptIO): Promise<RawInitFlags | null>;

interface PromptIO { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; /* stderr */ }

/** Pure: the caller template with its two anchors replaced. Throws when an anchor is missing. */
function renderCallerWorkflow(template: string, p: { operator: string; tag: string }): string;
```

`project show --json`:

```ts
interface ProjectShow {
  format: "wachiman.project/1";
  repository: { key: RepositoryKey; name: string; keyedBy: "remote" | "path"; remote?: string; path: string };
  binding?: ProjectBinding;
  /** What `local` would use here right now, with the rung and the ignored values. */
  resolved: { profile: string; kind: ProfileRef["kind"]; rung: Rung; overridden: { rung: Rung; value: string }[] } | { error: string };
}

interface ProfileList {
  format: "wachiman.profiles/1";
  defaultProfile?: string;
  profiles: Array<{
    name: string; kind: ProfileRef["kind"]; configDir?: string; binary?: string; registered: boolean;
    usedBy: RepositoryKey[];
  }>;
}
```

## 4. Review input — `wachiman.review-input/1` today, `/2` with the working tree (planned, slice 6)

`/1` is implemented (`src/formats.ts`, `docs/formats/review-input.v1.schema.json`) and unchanged
by slices 0–5. `/2` adds exactly one enum value:

```ts
interface ReviewChangeV2 /* extends ReviewChange */ {
  kind: "pull-request" | "branch" | "working-tree";   // /1 has the first two
  // for "working-tree": base.sha = HEAD, head.sha = the tree id, head.ref = "working tree (staged|all)"
}
```

The core accepts `/1` and `/2`; a `/2` file with `kind !== "working-tree"` is equivalent to `/1`.

## 5. Review result — `wachiman.review-result/2` (planned, slice 2)

The existing `/1` root/provider objects are closed. Its optional finding verification stub is
`{ checked: string; example?: string }`. No new key or incompatible value is emitted under `/1`.
Committed JSON output keeps `/1` by default; `--result-version 2` opts into the richer report.
Working-tree review requires `/2`. Terminal/Markdown/GitHub consume the richer internal result.

### 5.1 Shared imports and unchanged fields

```ts
import type { ReviewResult as ReviewResultV1, ReviewInput as ReviewInputV1,
  ReviewChange as ReviewChangeV1 } from "../../src/formats";
import type { ReviewFile, BaseInstructions, BatchReport } from "../../src/engine";
import type { Contract } from "../../src/contracts";
import type { TokenUsage } from "../../src/cost";
import type { ProviderAdapter, Effort } from "../../src/providers/types";
// Illustrative import paths are relative to this specs directory; no compiled module is added.
type Coverage = ReviewResultV1["coverage"];
type Execution = ReviewResultV1["execution"];
type ThreadReply = ReviewResultV1["threadReplies"][number];

type Severity = "blocker" | "fix" | "consider" | "info";
type Topic = "bug" | "security" | "rules" | "adr" | "docs" | "tests" | "perf" | "cleanup" | "question";
type Confidence = "high" | "medium" | "low";
type Origin = "introduced" | "pre-existing" | "unknown";
type VerificationStatus = "supported" | "refuted" | "inconclusive" | "unverified";
interface Citation {
  snapshot: "base" | "head";
  path: string; // contained repository-relative forward-slash path, no traversal/symlink escape
  line: number; // positive integer; line 0 is not evidence
}
interface FindingVerificationV2 {
  candidateId?: string; // absent when not selected for verification
  status: VerificationStatus;
  reason: string; // brief evidence-linked rationale, not hidden chain-of-thought
  checked: Citation[];
  disproof?: Citation; // required for accepted refuted status
  claimed?: "supported" | "refuted" | "inconclusive" | "none";
}
interface ResultFindingV2 {
  path: string;
  line: number; // 0 = whole file
  severity: Severity;
  topic: Topic;
  confidence?: Confidence;
  title: string;
  body: string;
  anchor: "diff" | "outside";
  origin: Origin; // unknown unless base/head evidence establishes it
  originReason?: string;
  originEvidence?: Citation[];
  verification: FindingVerificationV2;
  tier: "Important" | "Nit" | "Pre-existing"; // derived by tierWord, never trusted from a model
}
interface VerificationEntryV2 {
  id: string;
  path: string; line: number; title: string; topic: Topic; severity: Severity;
  status: VerificationStatus;
  claimed?: "supported" | "refuted" | "inconclusive" | "none";
  origin: Origin;
  originReason?: string;
  originEvidence?: Citation[];
  reason: string;
  checked: Citation[];
  disproof?: Citation;
  outcome: "dropped" | "kept" | "degraded" | "moved";
  severityAfter?: Severity;
}
interface ResultVerificationV2 {
  // verified means every candidate received a usable verdict, not that every bug was proved.
  status: "verified" | "partial" | "failed" | "nothing" | "skipped";
  model: string; effort: string; label?: string;
  costUsd: number; // API-equivalent on subscriptions, not a separate bill
  stop?: { kind: "budget" | "turns" | "timeout" | "quota" | "error"; detail: string };
  entries: VerificationEntryV2[]; // one per selected candidate, including dropped/never answered
  dropped: number;
  inconclusive: number;
}
interface ProviderV2 {
  label: string; model: string; effort: string;
  profile: "ci" | "default" | "isolated";
  account?: { name: string; kind: "default" | "managed" | "external"; rung: Rung };
  // No configDir, executable path, account email or origin URL in portable review results.
}
type WorkingTreeChange = Omit<ReviewChangeV1, "kind"> & {
  kind: "working-tree";
  workingTree: { mode: "staged" | "all"; baseCommit: string; tree: string };
};
type ResultChange = (ReviewChangeV1 | WorkingTreeChange) & { snapshot?: string };
interface ReviewResultV2 {
  format: "wachiman.review-result/2";
  change: ResultChange;
  engine: { version: string };
  provider: ProviderV2;
  coverage: Coverage;
  findings: ResultFindingV2[];
  contracts: Contract[];
  summary: string;
  batches: BatchReport[];
  threadReplies: ThreadReply[];
  instructionChanges: { files: string[]; baseSha: string };
  execution: Execution; // totals include coverage + verifier calls, turns, usage and cost
  verification?: ResultVerificationV2; // absent when disabled
}
```

`review-result.v2.schema.json` closes root and provider, requires finding origin/verification/tier,
and constrains snapshot-qualified citations. Validators enforce the semantic rules below in
addition to shape. Unknown origin is not an error; invented origin is.

### 5.2 Verifier request/response and admission

```ts
interface Candidate { id: string; finding: ResultFindingV2; }
interface VerifierVerdict {
  id: string;
  verdict: "supported" | "refuted" | "inconclusive";
  reason: string;
  checked: Citation[];
  disproof?: Citation;
  severity?: Severity;
  origin?: Origin;
  originReason?: string;
  originEvidence?: Citation[];
}
interface VerifierOutput { verdicts: VerifierVerdict[]; }
interface VerificationContext {
  baseSha: string; headSha: string;
  headDir: string;
  // In-memory only. Materialise once, only with verifier enabled and candidates present.
  baseDir?: string;
  candidates: Candidate[];
  files: ReviewFile[];
}
```

Every finding above `info` is a candidate after coverage merge/dedupe. Keep reviewer findings
and verifier evidence distinct. The head is immutable; lazily materialise base once per review
and give the official CLI read-only access through its existing allowed-directory mechanism.
No snapshot directory is a wire-format field. Candidate ids are assigned once and matched
exactly: ignore unknown ids; duplicate ids invalidate that candidate's verdict (inconclusive).

Accept only fully parsed, schema-valid structured output, including a complete valid envelope
returned alongside a non-success stop. Do not salvage arbitrary truncated JSON. Reconcile missing
ids explicitly. Preserve usable verdicts if quota/budget/turn/timeout ends the call; unanswered
selected candidates are inconclusive with the stop reason. No usable output is failed; no call
because allowance is exhausted is skipped; zero candidates is nothing. Disabled verification
leaves all findings unverified and origin unknown, unless an independent existing origin check
has evidence. Info notices remain unverified and are not sent to the verifier.

A supported verdict needs a nonempty rationale and at least one valid checked citation. A refuted
verdict additionally needs a valid disproof citation; invalid evidence becomes inconclusive and
never drops the finding. Paths/lines are checked inside the indicated immutable snapshot,
including symlink containment. **Reference validation establishes that evidence exists, not that
the model's argument is true.** Known origin needs base/head or diff evidence about the causal
behaviour: an unchanged line can become reachable because of changed code elsewhere. Missing
base evidence or an uncertain attribution stays unknown. Pre-existing true bugs are retained.

The verifier may move severity at most one adjacent level (existing implementation rule); never
raise confidence merely because a second model agreed. Inconclusive findings remain in the report
under an explicitly inconclusive group; apply the existing low-confidence question rule to
high-severity assertions. Fail-open preserves findings, not the appearance that verification passed.

Reserve `min(AGENT_REVIEW_VERIFY_BUDGET_USD, totalBudgetUsd / 2)` before coverage; default reserve
$1, verifier model uses existing DEFAULT_VERIFIER_MODEL, effort high. Coverage cannot spend the
reserve. At most one verifier call; no verifier retry/fan-out/recursive investigation. All work
counts in execution totals, on the same account and hardening as coverage. The USD guard is
API-equivalent on a subscription. The verifier is on by default (ADR 0027 amendment, 2026-11-09);
--no-verify or AGENT_REVIEW_VERIFY=0 turns it off, and the benchmark gate checks the default. Never silently switch a model/profile if the account
cannot use it.

### 5.3 Downgrade `toResultV1(r: ReviewResultV2): ReviewResultV1`

For committed changes only: retain the surviving findings and unchanged /1 fields, remove
provider.account, root verification and every new per-finding field. Leave the reserved /1
verification stub absent. Append one textual verification summary to the existing
execution.notices array. Do not expose paths/account details or encode unsupported semantics as
an old value. A working-tree change cannot downgrade: exit 2 before calls when /1 is requested.
The JSON result defaults to /1 for committed changes until a separately announced major release;
new terminal/Markdown/GitHub rendering does not require that external default change.

A literal illustrative JSON fragment (not observed output):

```json
{
  "path": "src/cache.ts", "line": 42, "severity": "fix", "topic": "bug", "confidence": "high",
  "title": "stale write-back after a failed refresh", "body": "Failure path explanation", "anchor": "diff",
  "origin": "unknown", "tier": "Important",
  "verification": {
    "candidateId": "c1", "status": "supported", "reason": "The failure path retains stale state.",
    "checked": [{ "snapshot": "head", "path": "src/cache.ts", "line": 42 }]
  }
}
```

### 5.4 Reconcile existing verifier branch

Reuse `src/verify.ts` on `feat/findings-verifier`: rename confirmed→supported and
unconfirmed→inconclusive, add snapshot-qualified citations and origin unknown, update
applyVerdicts and VERIFY_SCHEMA, and teach verifyFindings partial/skipped outcomes. The existing
branch's top-level verification field must not ship under /1. Reuse its prompt/admission code,
then make the origin/evidence behaviour above the explicit amendment to draft ADR 0027.

### 5.5 History wrapper

The internal `wachiman.history-run/1` wrapper reads both result versions. Preserve existing /1
files; unknown future embedded result versions are skipped with a warning and left in place,
not renamed as unreadable data. Working-tree results store their explicit workingTree metadata;
never feed a tree id to git merge-base/ancestor/commit lookup. If an old snapshot cannot be
reconstructed, tracking may mark unknown rather than claim fixed. Fingerprints still match the
reported path/line/text; attribution across committed and working-tree runs needs its own tests.

## 6. Engine options (internal) — implemented plus the verifier fields

```ts
import type { ReviewOptions as CurrentReviewOptions, CoreDeps as CurrentCoreDeps } from "../../src/engine";
type ReviewOptions = CurrentReviewOptions & {
  verify?: { model: string; budgetUsd: number };
};
type CoreDeps = CurrentCoreDeps & {
  verifier?: ProviderAdapter;
  baseSnapshot?: () => { dir: string; release(): void };
};
```

`local` builds `verifier` as a second `ClaudeCodeProvider` on the same profile environment and
`options.verify.model`; the GitHub modes do the same with the API key. Nothing else differs.

## 7. Launcher and packaging (internal) — planned

```ts
/** Pure. The argv the Node launcher gives to bun. */
function launcherArgs(pkgDir: string, argv: string[]): string[];
// → ["--no-env-file", `--config=${join(pkgDir, "bunfig.toml")}`, join(pkgDir, "src", "cli.ts"), ...argv]

/** Where this process's assets live. */
type InstallKind =
  | { kind: "source"; root: string }          // bun src/cli.ts from a clone (import.meta.dir/..)
  | { kind: "npm"; root: string }             // the package directory; same layout as source
  | { kind: "exe"; version: string };         // import.meta.dir starts with "/$bunfs/"; assets via Bun.embeddedFiles

function detectInstall(): InstallKind;
/** Templates, skills and the settings JSON, read from the clone/package or the embedded files. */
function readAsset(install: InstallKind, name: "templates/wachiman-review-caller.yml" | "src/providers/claude-code.settings.json" | `skills/${string}`): string | Uint8Array;
```

`package.json` after slice 4 (planned):

```json
{
  "name": "wachiman",
  "version": "<release-please>",
  "bin": { "wachiman": "bin/wachiman.js", "agent-review": "bin/wachiman.js" },
  "type": "module",
  "files": ["bin/wachiman.js", "bin/launcher-args.js", "src/", "skills/", "templates/", "bunfig.toml", "LICENSE", "README.md"],
  "engines": { "bun": ">=1.3", "node": ">=20" },
  "repository": { "type": "git", "url": "git+https://github.com/niway-dev/wachiman.git" },
  "publishConfig": { "access": "public", "provenance": true }
}
```

`files: ["src/"]` includes src/*.test.ts; it does not exclude tests automatically. Add an
deterministic packaging/staging manifest excluding **/*.test.ts and fixtures and inspect npm pack --json. The packed artifact smoke test must install that
exact tarball with Node+Bun and run with unrelated registry access disabled.

## 8. Security invariants (checked by tests; each names its test idea)

1. **No credential is read.** Across `profile`, `setup`, `doctor`, `local`: the only file opened
   under any profile directory is `settings.json` of a **managed** profile. Test: inject `read`
   and `exists` recorders; assert the set of opened paths.
2. **No credential is written or moved.** No code path writes under an external `configDir`;
   Wachiman creates managed directories; Claude itself writes its own auth state; nothing renames a directory. Test: fs
   recorder over a full `setup`.
3. **Nothing in the reviewed repository selects the binary or the account.** Test: planted
   `.wachiman.json`, `.wachiman/config.json`, `package.json#wachiman`; resolution unchanged;
   spawned path equals the profile's.
4. **The only stored executable path is `ProfileEntry.binary`,** written by `profile add` or
   `setup` from an absolute path validated at write time and again at run time. No environment
   variable names a binary. Test: `WACHIMAN_CLAUDE_BIN=/tmp/evil` has no effect.
5. **Spawn by path, never a shell.** Every `spawnSync` of `claude` or `bun` uses `shell: false`
   (the default) and an argv array. Test: grep-level test over `src/` for `shell: true`.
6. **Child environment is the allowlist.** `buildChildEnv` is the only builder; `profile login`,
   `confirmProfile`, the verifier and the batches all use it. Test: each call site's env equals
   `buildChildEnv(...)`.
7. **No fallback between accounts.** `resolveProfile` fails on the rung that failed. Test: the
   precedence table with every failure injected.
8. **Strict config.** A `corrupt` read is exit 2 everywhere. Test: each corruption of 1.2.
9. **Atomic writes.** Two concurrent `updateConfig` calls keep both changes; a killed writer
   leaves either the old or the new file, never a partial one. Test: concurrent writers; a
   temp-file-without-rename simulation.
10. **No Wachiman-owned network request** from `local`, `doctor`, `setup`, `init`, `profile`,
    `project`, `skills`: the parent process's `fetch` is stubbed to throw in tests. **This proves
    nothing about the Claude subprocess**, and every output that could be read as an offline
    claim says so (`networkObserved: "unknown"`).
11. **Isolation flags on every call.** `buildClaudeArgs` is the only argv builder; the verifier
    call passes through it. Test: the verifier's argv contains `--restricted`,
    `--strict-mcp-config`, `--tools Read,Glob,Grep`, `--disallowedTools Bash,…`.
12. **A `/2` result never pretends to be `/1`.** `renderJson` writes the format string of the
    object it renders; `toResultV1` validates against the `/1` schema in tests.
13. **The launcher changes nothing.** `launcherArgs` is pure; the launcher sets and unsets no
    environment variable (test on the module's side effects with a spawn stub).
14. **Prompts never run without a TTY.** `interactive` is computed once; tests cover
    `CI=true`, piped stdin, piped stdout.
15. **Writes under confirm.** Every disk write in `setup` and `init` is preceded by a printed
    statement of the path and a confirm (or `--yes`/non-TTY with mandatory flags). Test: a
    scripted cancellation before final save leaves the config unchanged; completed explicitly
    authorised directory/login/workflow effects are accurately reported.


## 9. Command argument types (normalised, planned unless noted)

These are parser outputs, not another source of defaults. The command contract is normative for
validation and mutual exclusions. Existing GitHub/history argument spellings remain unchanged.

```ts
type RangeSelector =
  | { kind: "branch"; base?: string }
  | { kind: "commit"; commit: string }
  | { kind: "from"; commit: string }
  | { kind: "input"; file: string }
  | { kind: "working-tree"; mode: "staged" | "all" };
interface LocalOptions {
  range: RangeSelector; paths: string[]; repoDir: string; maxDepth: number;
  format: "terminal" | "markdown" | "json"; resultVersion: 1 | 2;
  output?: string; profile?: ProfileNameRef;
  verify: boolean; agentPrompt: boolean; history: boolean;
}
type HistoryOptions =
  | { kind: "list"; repoDir: string; sinceDays?: number; allRepos: boolean; json: boolean }
  | { kind: "verdict"; repoDir: string; id: string; verdict: "correct" | "partial" | "wrong"; reason?: string }
  | { kind: "forget"; repoDir: string; all: boolean };
type ProfileCommand =
  | { kind: "list"; json: boolean }
  | { kind: "create"; name: string }
  | { kind: "add"; name: string; configDir: string; binary?: string; note?: string }
  | { kind: "login"; profile: ProfileNameRef }
  | { kind: "remove"; name: string; deleteDir: boolean; yes: boolean }
  | { kind: "default"; profile: ProfileNameRef | null };
type ProjectCommand =
  | { kind: "show"; repoDir: string; json: boolean }
  | { kind: "unbind"; repoDir: string; yes: boolean };
interface DoctorOptions {
  repoDir: string; profile?: ProfileNameRef; allProfiles: boolean;
  json: boolean; redactPaths: boolean;
}
interface SkillsOptions { action: "install" | "uninstall"; dirs: string[]; json: boolean; }
interface SkillInstallReport {
  format: "wachiman.skills/1";
  entries: { target: string; action: "installed" | "removed" | "preserved" | "failed"; reason?: string }[];
  exitCode: 0 | 1;
}
interface SkillInstallMarker {
  format: "wachiman.skill-install/1";
  version: string; installedAt: string;
  files: Record<string, string>; // safe relative path -> sha256 of copied bytes
}
type GitHubCommand =
  | { kind: "review"; pr: number; paths: string[]; repoDir: string }
  | { kind: "comment"; pr: number; repoDir: string }
  | { kind: "threads"; pr: number; repoDir: string };
```

### 9.1 Complete review-input /2 shape

```ts
interface ReviewInputFileV2 {
  format: "wachiman.review-input/2";
  change: ReviewChangeV1 | WorkingTreeChange;
  files: ReviewFile[];
  instructions: BaseInstructions;
  scope: string[];
  since?: ReviewInputV1["since"];
  conversation?: ReviewInputV1["conversation"];
}
type ReviewInputV2 = ReviewInputFileV2 & { headDir: string; baseDir?: string };
```

headDir/baseDir are in-memory connector capabilities only and forbidden in input JSON. A
working-tree input loaded from a file needs its tree object to exist in the selected clone; a
tree stored only in a previous temporary object database is unavailable and fails explicitly.
The connector owns snapshot lifetimes until review and annotation finish.


## 10. Injected execution contexts

These are internal implementation seams, not serialised data. Reuse the existing provider/Git
runner types rather than creating incompatible versions of them. Stream output with inherited
stdio is reserved for explicit login; diagnostic output is captured and redacted.

```ts
type Env = Record<string, string | undefined>;
interface SpawnResult { status: number | null; stdout: string; stderr: string; error?: Error; }
type SpawnFn = (binary: string, args: string[], options: {
  cwd: string; env: Record<string, string>; timeout: number; maxBuffer: number;
  shell: false; encoding: "utf8";
}) => SpawnResult;
interface DoctorContext {
  home: string; repoDir?: string; env: Env; spawn: SpawnFn;
  config: ConfigRead; resolved?: ResolvedProfile;
  install: InstallKind;
  // fs operations injected through concrete existing filesystem adapters during implementation.
}
interface SetupPromptContext {
  repoDir: string; repository: ProjectShow["repository"];
  profiles: ProfileList; currentBinding?: ProjectBinding;
}
interface InitPromptContext { repoDir: string; defaultWorkflowRef?: string; }
interface PendingSetup {
  profile: ProfileNameRef;
  registration?: { name: ProfileName; entry: ProfileEntry };
  binding: ProjectBinding;
}
```

Registration and binding are committed by one updateConfig call after the final confirmation.
No prompt or provider call occurs while holding a config lock. Stale locks require explicit
recovery; no writer may unlink another writer's lock based only on PID and age.
