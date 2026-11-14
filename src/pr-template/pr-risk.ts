/**
 * The risk floor of a PR description: the lowest level the diff allows, from path and content
 * rules (ADR 0050 decision 5). The rules are a literal port of the earlier Python checker's,
 * including its weights: authentication is High and CI workflows are Medium here. The engine's own
 * `RISK_RULES` (src/engine.ts) disagree on purpose until the two tables are unified, so this file
 * never imports it.
 *
 * `.github/pr-risk.toml` can add rules that raise the level; nothing in it can lower a default
 * rule's level. Pure: reading the file and running git live in gh.ts and check-run.ts.
 */

export const RISK_EXTENSION_FILE = ".github/pr-risk.toml";

export const LOW = 0;
export const MEDIUM = 1;
export const HIGH = 2;
export type RiskLevel = 0 | 1 | 2;

export const LEVELS: readonly (readonly [string, string])[] = [
  ["🟢", "Low"],
  ["🟡", "Medium"],
  ["🔴", "High"],
];

export interface ChangedFile {
  path: string;
  /** For a rename or a copy, the path it came from: the path rules look at it as well as at `path`. */
  from?: string;
  /** A (added), M (modified), D (deleted) or R (renamed). Default M. */
  status?: string;
  /** The hunk lines of the diff, `+` and `-` prefixed; empty when only the path is known. */
  patch?: string;
  /** The diff names this file but a path could not be read (`path` is then the raw header, or the source of a rename): the floor goes to High. */
  unreadable?: boolean;
}

export interface Risk {
  level: RiskLevel;
  rule: string | null;
  path: string | null;
}

export function formatRisk(risk: Risk): string {
  const [emoji, name] = LEVELS[risk.level]!;
  if (risk.rule === null) return `${emoji} ${name}: no high or medium rule matched`;
  return `${emoji} ${name}: ${risk.rule} (${risk.path})`;
}

/** Python-style pattern to RegExp: a leading `(?i)` becomes the `i` flag. Throws on an invalid pattern. */
function pattern(source: string): RegExp {
  if (source.startsWith("(?i)")) return new RegExp(source.slice(4), "i");
  return new RegExp(source);
}

// --------------------------------------------------------------------------- the rules

/** Files that never set a default risk: documentation, tests, plain text. */
const DEFAULT_EXCLUDE = String.raw`^(docs?|tests?)/|(^|/)tests?/|(^|/)test_[^/]*$|_test\.[A-Za-z]+$|\.(md|txt|rst)$`;
const DOCS_ONLY_EXCLUDE = String.raw`^(docs?|tests?)/|(^|/)tests?/`;

const CONTRACT_PATH = String.raw`(?i)(^|/)(openapi|swagger)[^/]*\.(ya?ml|json)$|\.(proto|graphql|gql)$`;
const MANIFEST_PATH =
  String.raw`(^|/)(package\.json|pyproject\.toml|requirements[^/]*\.txt|Pipfile|Cargo\.toml|go\.mod|` +
  String.raw`Gemfile|composer\.json|build\.gradle(\.kts)?)$`;
const DEP_LINE = /^[-+]\s*["']?([A-Za-z0-9@/_.\-]+)["']?\s*(?:[:=@]+|[<>~^!]=?|\s)\s*["']?[\^~<>=!v ]*(\d+)\.\d/;

const ROUTE_LINE =
  String.raw`^\s*(@(app|router|bp|blueprint)\.(get|post|put|patch|delete|route)\b|` +
  String.raw`(app|router|server|api)\.(get|post|put|patch|delete|all)\s*\(|` +
  String.raw`@(Get|Post|Put|Patch|Delete)Mapping|\[Http(Get|Post|Put|Patch|Delete)\])`;
const COMMAND_LINE =
  String.raw`^\s*([\w.]*\.add_parser\(|[\w.]*\.add_argument\(|[\w.]*\.command\(['"]|` + String.raw`@(click|app|cli)\.(command|group))`;
const CONTRACT_KEY_REMOVED =
  String.raw`^\s*(?:"?(?!(?:description|summary|example|examples|title)\b)[A-Za-z_][\w-]*"?\s*:|` +
  String.raw`(?:optional\s+|required\s+|repeated\s+)?[\w.]+\s+\w+\s*=\s*\d+\s*;)`;

/** A manifest change where the same dependency moves to another major version. */
function majorBump(change: ChangedFile): string | null {
  if (!new RegExp(MANIFEST_PATH).test(change.path)) return null;
  const removed = new Map<string, number>();
  const added = new Map<string, number>();
  for (const line of (change.patch ?? "").split("\n")) {
    const m = DEP_LINE.exec(line);
    if (!m || m[1] === "version") continue;
    (line[0] === "-" ? removed : added).set(m[1]!, Number(m[2]));
  }
  for (const [name, now] of added) {
    const before = removed.get(name);
    if (before !== undefined && before !== now) return `${name} ${before} to ${now}`;
  }
  return null;
}

interface RuleOptions {
  paths?: string[];
  content?: string[];
  scope?: "any" | "added" | "removed";
  statuses?: string;
  exclude?: string | null;
  contentIn?: string;
  predicate?: (change: ChangedFile) => string | null;
}

/** One risk rule. A change matches by path, by content on its patch lines, or by predicate. */
class Rule {
  readonly paths: RegExp[];
  readonly content: RegExp[];
  readonly scope: "any" | "added" | "removed";
  readonly statuses: string;
  readonly exclude: RegExp | null;
  readonly contentIn: RegExp | null;
  readonly predicate: ((change: ChangedFile) => string | null) | undefined;

  constructor(
    readonly level: RiskLevel,
    readonly name: string,
    o: RuleOptions = {},
  ) {
    this.paths = (o.paths ?? []).map(pattern);
    this.content = (o.content ?? []).map(pattern);
    this.scope = o.scope ?? "any";
    this.statuses = o.statuses ?? "AMDR";
    const exclude = o.exclude === undefined ? DEFAULT_EXCLUDE : o.exclude;
    this.exclude = exclude ? pattern(exclude) : null;
    this.contentIn = o.contentIn ? pattern(o.contentIn) : null;
    this.predicate = o.predicate;
  }

  /** The path that matched, or null. */
  matches(change: ChangedFile): string | null {
    const path = change.path;
    const status = change.status ?? "M";
    if (this.exclude?.test(path)) return null;
    if (this.paths.some((p) => p.test(path)) && this.statuses.includes(status)) return path;
    if (this.content.length > 0 && (this.contentIn === null || this.contentIn.test(path))) {
      for (const line of (change.patch ?? "").split("\n")) {
        const sign = line.slice(0, 1);
        const text = line.slice(1);
        if (sign !== "+" && sign !== "-") continue;
        if ((this.scope === "added" && sign !== "+") || (this.scope === "removed" && sign !== "-")) continue;
        if (this.content.some((c) => c.test(text))) return path;
      }
    }
    if (this.predicate && this.statuses.includes(status) && this.predicate(change)) return path;
    return null;
  }
}

const DEFAULT_RULES: Rule[] = [
  new Rule(HIGH, "database migrations or schema", {
    paths: [
      String.raw`(?i)(^|/)(migrations?|migrate|alembic)/`,
      String.raw`(?i)(^|/)schema\.(sql|prisma|rb)$`,
      String.raw`(?i)(^|/)(prisma|drizzle)/`,
      String.raw`(?i)\.sql$`,
    ],
    content: [String.raw`(?i)\b(CREATE|ALTER)\s+TABLE\b`],
  }),
  new Rule(HIGH, "authentication, sessions or permissions", {
    paths: [
      String.raw`(?i)(^|/)(auth|authn|authz|authentication|authorization|sessions?|permissions?|rbac|acl|` +
        String.raw`oauth|sso|login|passport)([/._-]|$)`,
    ],
    content: [
      String.raw`(?i)\b(jwt\.(sign|verify)|bcrypt\.|argo[n]2|password_has[h]|check_passwor[d]|set_passwor[d]|` +
        String.raw`has_permissio[n]|express-sessio[n])\b`,
    ],
  }),
  new Rule(HIGH, "secrets or key handling", {
    paths: [
      String.raw`(^|/)\.env(\.(?!example|sample|template)[\w.-]+)?$`,
      String.raw`(?i)\.(pem|key|p12|pfx|jks|keystore)$`,
      String.raw`(?i)(^|/)(secrets?|credentials?)([/._-]|$)`,
      String.raw`(^|/)id_(rsa|ed25519)$`,
    ],
    content: [
      String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
      String.raw`\bAKIA[0-9A-Z]{16}\b`,
      String.raw`(?i)\b(api[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|` + String.raw`secret_access_key)\b\s*[:=]`,
    ],
  }),
  new Rule(HIGH, "billing or money", {
    paths: [
      String.raw`(?i)(^|/)(billing|payments?|invoices?|checkout|stripe|paypal|subscriptions?|ledger|wallet)` + String.raw`([/._-]|$)`,
    ],
    content: [
      String.raw`(?i)\b(import|from)\s+stripe\b`,
      String.raw`(?i)\b(paymentInten[t]s?|payment_inten[t]s?)\b`,
      String.raw`(?i)\b(charges|refunds|invoices)\.create\b`,
      String.raw`(?i)\bcheckout\.sessions\b`,
    ],
  }),
  new Rule(HIGH, "deletion of stored data", {
    content: [
      String.raw`(?i)\b(DROP\s+(TABLE|COLUMN|DATABASE|SCHEMA)|TRUNCAT[E](\s+TABLE)?|DELETE\s+FROM)\b`,
      String.raw`\.(deleteMany|destroy_all|delete_many|drop_collection)\(`,
      String.raw`\bdrop_(table|column)\(`,
    ],
    scope: "added",
  }),
  new Rule(HIGH, "a deploy or infrastructure file that runs on merge", {
    paths: [
      String.raw`(?i)\.tf(vars)?$`,
      String.raw`(?i)(^|/)(terraform|infra|infrastructure|k8s|kubernetes|helm|pulumi|` + String.raw`ansible|deploy|deployment)/`,
      String.raw`(?i)(^|/)\.github/workflows/(deploy|release|publish|cd)[^/]*\.ya?ml$`,
    ],
  }),
  new Rule(HIGH, "a deploy or infrastructure file that runs on merge", {
    paths: [
      String.raw`(^|/)(Dockerfile[^/]*|fly\.toml|vercel\.json|wrangler\.toml|netlify\.toml|serverless\.ya?ml|` +
        String.raw`Procfile|app\.yaml|render\.yaml)$`,
    ],
    statuses: "MDR",
  }),
  new Rule(HIGH, "removal of a public route, field or command", {
    paths: [String.raw`(?i)(^|/)(routes?|api|endpoints?|handlers?|commands?|cli|bin)/`],
    statuses: "D",
  }),
  new Rule(HIGH, "removal of a public route, field or command", { content: [ROUTE_LINE, COMMAND_LINE], scope: "removed" }),
  new Rule(HIGH, "removal of a public route, field or command", {
    content: [CONTRACT_KEY_REMOVED],
    contentIn: CONTRACT_PATH,
    scope: "removed",
  }),
  new Rule(MEDIUM, "CI workflows", {
    paths: [
      String.raw`(^|/)\.github/(workflows|actions)/`,
      String.raw`(^|/)\.github/dependabot\.ya?ml$`,
      String.raw`(^|/)\.gitlab-ci\.ya?ml$`,
      String.raw`(^|/)\.circleci/`,
      String.raw`(^|/)Jenkinsfile`,
    ],
  }),
  new Rule(MEDIUM, "legal or public copy", {
    paths: [String.raw`(?i)(^|[/._-])(privacy|terms|tos|pricing|legal|cookies?|eula|disclaimer)([/._-]|$)`],
    exclude: DOCS_ONLY_EXCLUDE,
  }),
  new Rule(MEDIUM, "a major dependency bump", { predicate: majorBump, statuses: "M", exclude: DOCS_ONLY_EXCLUDE }),
  new Rule(MEDIUM, "a new service or deploy path", {
    paths: [
      String.raw`(^|/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|fly\.toml|vercel\.json|wrangler\.toml|` + String.raw`Procfile)$`,
      String.raw`^(services|apps)/[^/]+/(package\.json|pyproject\.toml|Dockerfile[^/]*)$`,
    ],
    statuses: "A",
  }),
  new Rule(MEDIUM, "a public contract extended", { content: [String.raw`\S`], contentIn: CONTRACT_PATH, scope: "added" }),
  new Rule(MEDIUM, "a public contract extended", { content: [ROUTE_LINE, COMMAND_LINE], scope: "added" }),
];

// --------------------------------------------------------------------------- the extension file

/** The parsed `.github/pr-risk.toml`: `[high]` and `[medium]` tables with `paths` and `content` lists of patterns. */
export type RiskExtension = Record<string, unknown>;

/**
 * Parse the text of `.github/pr-risk.toml`. A file that does not parse is reported through `warn`
 * and ignored, as the earlier checker did: the floor then comes from the default rules alone.
 */
export function parseRiskExtension(text: string, warn: (line: string) => void = () => {}): RiskExtension | null {
  try {
    const parsed = Bun.TOML.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as RiskExtension) : null;
  } catch (err) {
    warn(`cannot read ${RISK_EXTENSION_FILE}: ${(err as Error).message}`);
    return null;
  }
}

function extensionRules(extra: RiskExtension | null | undefined, warn: (line: string) => void): Rule[] {
  const rules: Rule[] = [];
  for (const [levelName, level] of [["high", HIGH], ["medium", MEDIUM]] as const) {
    const section = (extra?.[levelName] ?? {}) as Record<string, unknown>;
    for (const kind of ["paths", "content"] as const) {
      const list = Array.isArray(section[kind]) ? (section[kind] as unknown[]) : [];
      for (const pat of list) {
        if (typeof pat !== "string") continue;
        const name = `${RISK_EXTENSION_FILE} ${levelName} ${kind === "paths" ? "path" : "content"} /${pat}/`;
        try {
          rules.push(new Rule(level, name, kind === "paths" ? { paths: [pat], exclude: null } : { content: [pat], exclude: null }));
        } catch (err) {
          warn(`ignoring invalid regex ${JSON.stringify(pat)} in ${RISK_EXTENSION_FILE}: ${(err as Error).message}`);
        }
      }
    }
  }
  return rules;
}

/** The reason given when a diff names a file whose path could not be read. */
export const UNREADABLE_PATH_RULE = "a changed path that could not be read";

/**
 * The lowest level the diff allows: the highest matching rule, and the first one to match wins a
 * tie. Extension rules can only raise it, because they are tried after the defaults and replace
 * the answer only with a higher level. A file whose path could not be read counts as High: it could
 * have matched any rule, so it is never dropped.
 */
export function computeRisk(
  changes: readonly ChangedFile[],
  extra?: RiskExtension | null,
  warn: (line: string) => void = () => {},
): Risk {
  let best: Risk = { level: LOW, rule: null, path: null };
  // The source of a rename or copy is judged as a path of its own, without the hunk lines.
  const judged = changes.flatMap((c) => (c.from ? [c, { path: c.from, status: c.status }] : [c]));
  for (const rule of [...DEFAULT_RULES, ...extensionRules(extra, warn)]) {
    if (rule.level <= best.level) continue;
    for (const change of judged) {
      const path = rule.matches(change);
      if (path) {
        best = { level: rule.level, rule: rule.name, path };
        break;
      }
    }
  }
  if (best.level < HIGH) {
    const lost = changes.find((c) => c.unreadable);
    if (lost) best = { level: HIGH, rule: UNREADABLE_PATH_RULE, path: lost.path };
  }
  return best;
}

// --------------------------------------------------------------------------- diffs

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** A name in git's C style, `"..."` with escapes (`\"`, `\\`, `\t`, `\n`, octal bytes), as the text between the quotes; null when malformed. */
function unquote(text: string): string | null {
  if (text.length < 2 || text[0] !== '"' || text[text.length - 1] !== '"') return null;
  const bytes: number[] = [];
  const body = text.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '"') return null;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) return null;
    if (/[0-3]/.test(next)) {
      const octal = body.slice(i + 1, i + 4);
      if (!/^[0-3][0-7]{2}$/.test(octal)) return null;
      bytes.push(parseInt(octal, 8));
      i += 3;
    } else if (next in ESCAPES) {
      bytes.push(ESCAPES[next]!);
      i += 1;
    } else {
      return null;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** A name that is either quoted or plain text; null when it starts with a quote and is malformed. */
const readName = (text: string): string | null => (text.startsWith('"') ? unquote(text) : text);

/** The name after a `--- ` or `+++ ` marker, without git's trailing tab; `/dev/null` is null and `undefined` means unreadable. */
function markerPath(text: string, prefix: string): string | null | undefined {
  const raw = text.startsWith('"') ? text : text.split("\t")[0]!;
  if (raw === "/dev/null") return null;
  const name = readName(raw);
  return name !== null && name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
}

/**
 * The path in `diff --git a/<old> b/<new>`. Spaces are not quoted by git, so every split at a
 * space is tried: the one whose two halves name the same file wins, otherwise the only valid split.
 */
function headerPath(rest: string): string | undefined {
  const valid: { old: string; now: string }[] = [];
  for (let i = rest.indexOf(" "); i !== -1; i = rest.indexOf(" ", i + 1)) {
    const old = readName(rest.slice(0, i));
    const now = readName(rest.slice(i + 1));
    if (old !== null && now !== null && old.startsWith("a/") && now.startsWith("b/")) valid.push({ old: old.slice(2), now: now.slice(2) });
  }
  const same = valid.find((v) => v.old === v.now);
  if (same) return same.now;
  return valid.length === 1 ? valid[0]!.now : undefined;
}

/**
 * Split a unified diff into one entry per file; `patch` holds the hunk lines only. A file's path
 * comes from `rename to`, else the `+++` line (or the `---` line when the file is deleted), else the
 * `diff --git` header; the header alone is used for binary files and mode changes. The source of a
 * rename or copy is kept in `from`. When none of
 * them can be read the file is kept with `unreadable: true`, never dropped.
 */
export function parsePatch(text: string): ChangedFile[] {
  interface Current { header: string; status: string; lines: string[]; renameTo?: string | null; renameFrom?: string | null; minus?: string | null; plus?: string | null }
  const done: Current[] = [];
  let cur: Current | null = null;
  let inHunk = false;
  const diffLines = text.split("\n");
  if (diffLines[diffLines.length - 1] === "") diffLines.pop();
  for (const line of diffLines) {
    if (line.startsWith("diff --git ")) {
      if (cur) done.push(cur);
      cur = { header: line.slice("diff --git ".length), status: "M", lines: [] };
      inHunk = false;
    } else if (cur === null) {
      continue;
    } else if (!inHunk) {
      if (line.startsWith("new file mode")) cur.status = "A";
      else if (line.startsWith("deleted file mode")) cur.status = "D";
      else if (line.startsWith("rename from ")) {
        cur.status = "R";
        cur.renameFrom = readName(line.slice("rename from ".length));
      } else if (line.startsWith("copy from ")) cur.renameFrom = readName(line.slice("copy from ".length));
      else if (line.startsWith("rename to ")) cur.renameTo = readName(line.slice("rename to ".length));
      else if (line.startsWith("--- ")) cur.minus = markerPath(line.slice(4), "a/");
      else if (line.startsWith("+++ ")) cur.plus = markerPath(line.slice(4), "b/");
      else if (line.startsWith("@@")) inHunk = true;
    } else {
      cur.lines.push(line);
    }
  }
  if (cur) done.push(cur);
  return done.map((c): ChangedFile => {
    const path = c.renameTo || (c.plus === undefined ? undefined : c.plus) || (c.plus === null && c.minus ? c.minus : undefined) || headerPath(c.header);
    const patch = c.lines.join("\n");
    if (path && c.renameFrom === null) return { path, status: c.status, patch, unreadable: true };
    return path ? { path, status: c.status, patch, ...(c.renameFrom ? { from: c.renameFrom } : {}) } : { path: c.header, status: c.status, patch, unreadable: true };
  });
}
