import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_SCHEMA, WALKTHROUGH_SECTIONS } from "./ask";
import { parseAskArgs, NO_REVIEW_NOTICE } from "./local-ask";
import { recordChoice } from "./telemetry/consent";
import { A_HEAD, branchRepo, commit, removeTempRepos, type BranchRepo } from "../test/support/temp-repo";

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  removeTempRepos();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const BRANCH_FILES = ["CLAUDE.md", "img.png", "src/a.ts", "src/b.ts", "src/new.ts"];

/** The review `local --history` stores: one finding with a title this file can look for. */
const REVIEW_OUTPUT = {
  files_reviewed: BRANCH_FILES,
  files_skipped: [],
  findings: [
    {
      path: "src/a.ts",
      line: 2,
      severity: "fix",
      topic: "bug",
      confidence: "high",
      title: "Retry ignores the budget",
      body: "The retry loop does not read the budget.",
    },
  ],
  contracts: [],
  thread_replies: [],
  summary: "one finding",
};

/** An answer with one good reference, one to a missing file and one that escapes the repository. */
const ANSWER_OUTPUT = {
  sections: [
    {
      title: "What the change does",
      body: "It changes the value of b in src/a.ts.",
      refs: [
        { path: "src/a.ts", line: 2 },
        { path: "src/missing.ts", line: 1 },
        { path: "../outside", line: 1 },
      ],
    },
    { title: "Open findings", body: "No open finding bears on this.", refs: [] },
  ],
  not_answered: "",
};

function envelope(structured: object) {
  return JSON.stringify({
    is_error: false,
    subtype: "success",
    num_turns: 3,
    total_cost_usd: 0.01,
    duration_ms: 10,
    structured_output: structured,
  });
}

/**
 * A temporary `bin/`: a `gh` that leaves a canary, and a `claude` that records its prompt, the
 * material it was given (ask.diff, ask.json, review.md) and its working directory. A review prompt
 * gets `REVIEW_OUTPUT`; an ask prompt gets `ANSWER_OUTPUT`, or garbage with `garbage`.
 */
function stubs(garbage = false) {
  const bin = temp("wachiman-ask-bin-");
  const log = join(bin, "log");
  const canary = join(bin, "gh-called");
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho called >> "${canary}"\nexit 99\n`);
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh
if [ "$1" = "auth" ]; then
  echo "auth $CLAUDE_CONFIG_DIR" >> "${log}.probes"
  printf '{"loggedIn":true,"authMethod":"claude.ai","configDirectory":"%s"}\\n' "$CLAUDE_CONFIG_DIR"; exit 0
fi
echo "$*" >> "${log}.calls"
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
env | sort > "${log}.env"
cat > "${log}.prompt"
prev=""; material=""; head=""
for a in "$@"; do
  if [ "$prev" = "--add-dir" ] && [ -f "$a/ask.json" ]; then material="$a"; fi
  if [ "$prev" = "--add-dir" ] && [ -f "$a/src/a.ts" ] && [ -z "$head" ]; then head="$a"; fi
  prev="$a"
done
[ -n "$head" ] && cat "$head/src/a.ts" > "${log}.head-a"
for f in ask.diff ask.json review.md; do
  if [ -n "$material" ] && [ -f "$material/$f" ]; then cat "$material/$f" > "${log}.$f"; fi
done
if grep -q "Rules for every answer" "${log}.prompt"; then
  ${garbage ? `echo 'not json at all'; exit 3` : `cat <<'JSON'\n${envelope(ANSWER_OUTPUT)}\nJSON\nexit 0`}
fi
cat <<'JSON'
${envelope(REVIEW_OUTPUT)}
JSON
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  const read = (name: string) => (existsSync(`${log}.${name}`) ? readFileSync(`${log}.${name}`, "utf8") : undefined);
  return { bin, canary, read };
}

const cli = join(import.meta.dir, "cli.ts");

function runCli(args: string[], env: Record<string, string>) {
  const out = Bun.spawnSync([process.execPath, cli, ...args], { env, stdin: "ignore" });
  return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
}

/** One CLI run on `repo` with the stubs first on PATH and the given HOME (a fresh one by default). */
function run(args: string[], opts: { repo: BranchRepo; home?: string; garbage?: boolean; extraEnv?: Record<string, string> }) {
  const s = stubs(opts.garbage);
  const home = opts.home ?? temp("wachiman-ask-home-");
  const env: Record<string, string> = {
    PATH: `${s.bin}:${process.env.PATH ?? ""}`,
    HOME: home,
    USER: "dev",
    WACHIMAN_VERIFY: "0",
    ...opts.extraEnv,
  };
  return { ...runCli([...args, "--repo-dir", opts.repo.dir], env), ...s, home };
}

/** Stores a review of the branch with `local --history`, under `home`. */
function storeReview(repo: BranchRepo, home: string) {
  const r = run(["local", "--history", "--format", "json"], { repo, home });
  expect(r.code).toBe(0);
  return r;
}

const json = (stdout: string) => JSON.parse(stdout);

describe("parseAskArgs", () => {
  test("joins the words into the question; flags are not words", () => {
    const args = parseAskArgs(["why", "does", "b", "change?", "--base", "main", "--format", "markdown"]);
    expect(args.question).toBe("why does b change?");
    expect(args.base).toBe("main");
    expect(args.format).toBe("markdown");
    expect(args.paths).toEqual([]);
  });

  test("no words is the walkthrough", () => {
    expect(parseAskArgs([]).question).toBe("");
    expect(parseAskArgs(["   "]).question).toBe("");
  });

  test("a flag of local that ask does not take is a usage error for ask", () => {
    for (const flag of ["--verify", "--no-verify", "--input", "--history", "--agent-prompt", "--result-version"]) {
      expect(() => parseAskArgs([flag, "1"]), flag).toThrow(`Unknown option ${flag} for ask.`);
    }
  });

  test("the scope flags are the same parser as local: two of them exclude each other", () => {
    expect(() => parseAskArgs(["--base", "main", "--commit", "abc"])).toThrow("--base and --commit cannot be used together.");
  });
});

describe("usage telemetry after an answer (opt-in; src/telemetry/)", () => {
  // The synchronous `run` would freeze a server in this process, so these runs are asynchronous.
  async function askAsync(opts: { garbage?: boolean; env: Record<string, string> }) {
    const repo = branchRepo();
    const s = stubs(opts.garbage);
    const child = Bun.spawn([process.execPath, cli, "ask", "What is b?", "--format", "json", "--repo-dir", repo.dir], {
      env: { PATH: `${s.bin}:${process.env.PATH ?? ""}`, HOME: temp("wachiman-ask-home-"), USER: "dev", WACHIMAN_VERIFY: "0", ...opts.env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = [await new Response(child.stdout).text(), await new Response(child.stderr).text(), await child.exited];
    return { stdout, stderr, code };
  }
  const withServer = async (fn: (url: string, bodies: string[]) => Promise<void>) => {
    const bodies: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => (bodies.push(await req.text()), new Response(null, { status: 204 })),
    });
    try {
      await fn(`http://127.0.0.1:${server.port}/v1/usage`, bodies);
    } finally {
      server.stop(true);
    }
  };
  const consented = () => {
    const whome = temp("wachiman-whome-");
    recordChoice(whome, "yes");
    return whome;
  };

  test("a stored yes sends one ask summary; the answer and the exit code are the ones of a run with telemetry off", async () => {
    await withServer(async (url, bodies) => {
      const whome = consented();
      const off = await askAsync({ env: { WACHIMAN_HOME: whome, WACHIMAN_TELEMETRY: "0" } });
      expect(bodies).toEqual([]);
      const sent = await askAsync({ env: { WACHIMAN_HOME: whome, WACHIMAN_TELEMETRY_URL: url } });
      expect(bodies.length).toBe(1);
      expect(JSON.parse(bodies[0])).toMatchObject({ format: "wachiman.telemetry/1", mode: "ask", outcome: { state: "complete" } });
      expect(sent.code).toBe(0);
      expect(sent.code).toBe(off.code);
      expect(JSON.parse(sent.stdout).sections).toEqual(JSON.parse(off.stdout).sections);
    });
  }, 90_000);

  test("without a stored yes nothing is sent", async () => {
    await withServer(async (url, bodies) => {
      const r = await askAsync({ env: { WACHIMAN_HOME: temp("wachiman-whome-"), WACHIMAN_TELEMETRY_URL: url } });
      expect(r.code).toBe(0);
      expect(bodies).toEqual([]);
    });
  }, 60_000);

  test("a failed answer sends outcome failed, and the exit code and stderr stay as they were", async () => {
    await withServer(async (url, bodies) => {
      const whome = consented();
      const off = await askAsync({ garbage: true, env: { WACHIMAN_HOME: whome, WACHIMAN_TELEMETRY: "0" } });
      const sent = await askAsync({ garbage: true, env: { WACHIMAN_HOME: whome, WACHIMAN_TELEMETRY_URL: url } });
      expect(bodies.length).toBe(1);
      expect(JSON.parse(bodies[0])).toMatchObject({ mode: "ask", outcome: { state: "failed" } });
      expect(sent.code).toBe(1);
      expect(sent.code).toBe(off.code);
      expect(sent.stdout).toBe("");
      expect(sent.stderr).toContain("Wachiman could not answer");
      expect(sent.stderr).not.toContain("telemetry");
    });
  }, 90_000);
});

describe("wachiman ask", () => {
  test("a question goes inside <request>, asked by the developer about the local change, one call, and no gh", () => {
    const repo = branchRepo();
    const r = run(["ask", "Why does b change?", "--format", "json"], { repo });
    expect(r.code).toBe(0);
    expect(existsSync(r.canary)).toBe(false);
    const prompt = r.read("prompt") ?? "";
    expect(prompt).toContain("The developer asked about their local change:\n\n<request>\nWhy does b change?\n</request>");
    expect(prompt).not.toContain("The repository operator asked");
    expect(prompt).toContain("the local change in repository");
    expect(prompt).toContain("No review of this change is available");
    // One provider call for the answer; the `--version` probe is not a call.
    const calls = (r.read("calls") ?? "").split("\n").filter((l) => l !== "" && l !== "--version");
    expect(calls).toHaveLength(1);
  }, 60_000);

  test("no question is the walkthrough: the five sections in order, and the JSON says so", () => {
    const repo = branchRepo();
    const r = run(["ask", "--format", "json"], { repo });
    expect(r.code).toBe(0);
    const prompt = r.read("prompt") ?? "";
    expect(prompt).not.toContain("<request>");
    let at = 0;
    WALKTHROUGH_SECTIONS.forEach((title, i) => {
      const found = prompt.indexOf(`${i + 1}. ${title}`, at);
      expect(found, `section ${title} in order`).toBeGreaterThan(-1);
      at = found;
    });
    const out = json(r.stdout);
    expect(out.walkthrough).toBe(true);
    expect(out.question).toBe("");
  }, 60_000);

  test("the model sees the diff of the scope, annotated with head line numbers, and the file list", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?", "--format", "json"], { repo });
    expect(r.code).toBe(0);
    const diff = r.read("ask.diff") ?? "";
    expect(diff).toContain("### src/a.ts");
    expect(diff).toContain("export const b = 20;");
    const meta = JSON.parse(r.read("ask.json") ?? "{}");
    expect(meta.files.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
    // The model reads the head snapshot (the committed bytes), which is the review's own input.
    expect(r.read("head-a")).toBe(A_HEAD);
  }, 60_000);

  test("a stored review of this change is used: review.md holds its finding, and hasReview is true", () => {
    const repo = branchRepo();
    const home = temp("wachiman-ask-home-");
    storeReview(repo, home);
    const r = run(["ask", "Is the retry safe?", "--format", "json"], { repo, home });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain(NO_REVIEW_NOTICE);
    expect(r.read("review.md")).toContain("Retry ignores the budget");
    expect(r.read("prompt")).toContain("review.md holds the review Wachiman already ran on this change");
    expect(json(r.stdout).hasReview).toBe(true);
  }, 90_000);

  test("a stored review of an older head is not this change: notice on stderr, hasReview false", () => {
    const repo = branchRepo();
    const home = temp("wachiman-ask-home-");
    storeReview(repo, home);
    commit(repo.dir, { "src/a.ts": `${A_HEAD}export const e = 5;\n` }, "one more commit");
    const r = run(["ask", "Is the retry safe?", "--format", "json"], { repo, home });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(NO_REVIEW_NOTICE);
    expect(json(r.stdout).hasReview).toBe(false);
    expect(r.read("prompt")).toContain("No review of this change is available");
    expect(r.read("review.md")).toBeUndefined();
  }, 90_000);

  test("without a stored review: the notice on stderr, hasReview false, and the answer still comes", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?", "--format", "json"], { repo });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(
      'No stored review of this change: answering from the diff alone. Run "wachiman local --history" first to ground answers in a review.',
    );
    expect(json(r.stdout).hasReview).toBe(false);
  }, 60_000);

  test("references to a missing file and to ../outside are removed and counted; the rest stays", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?", "--format", "json"], { repo });
    expect(r.code).toBe(0);
    const out = json(r.stdout);
    expect(out.removedRefs).toBe(2);
    expect(out.sections[0].refs).toEqual([{ path: "src/a.ts", line: 2 }]);
  }, 60_000);

  test("the JSON result has exactly the documented keys and shapes", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?", "--format", "json"], { repo });
    expect(r.code).toBe(0);
    const out = json(r.stdout);
    expect(Object.keys(out).sort()).toEqual(
      ["format", "hasReview", "notAnswered", "provider", "question", "removedRefs", "sections", "walkthrough"].sort(),
    );
    expect(out.format).toBe("wachiman.ask-result/1");
    expect(out.question).toBe("What is b?");
    expect(out.walkthrough).toBe(false);
    expect(out.notAnswered).toBe("");
    expect(typeof out.removedRefs).toBe("number");
    expect(out.sections).toHaveLength(2);
    for (const section of out.sections) expect(Object.keys(section).sort()).toEqual(["body", "refs", "title"]);
    expect(Object.keys(out.sections[0].refs[0]).sort()).toEqual(["line", "path"]);
    expect(Object.keys(out.provider).sort()).toEqual(["costUsd", "label", "model"]);
    expect(out.provider.costUsd).toBe(0.01);
  }, 60_000);

  test("terminal output: the sections, refs, the removed-references notice and the cost line; no markdown", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?"], { repo });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("What the change does\n");
    expect(r.stdout).toContain("Refs: src/a.ts:2");
    expect(r.stdout).toContain("2 references could not be checked and were removed.");
    expect(r.stdout).toContain("Cost: $0.01, an API-equivalent estimate");
    expect(r.stdout).not.toContain("###");
    expect(r.stdout).not.toContain("`");
  }, 60_000);

  test("markdown output: headings, references as code, no links", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?", "--format", "markdown"], { repo });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("### What the change does");
    expect(r.stdout).toContain("Refs: `src/a.ts:2`");
    expect(r.stdout).not.toContain("](");
  }, 60_000);

  test("--output writes the chosen format to the file and prints the path on stderr", () => {
    const repo = branchRepo();
    const out = join(temp("wachiman-ask-out-"), "answer.md");
    const r = run(["ask", "What is b?", "--format", "markdown", "--output", out], { repo });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`report: ${out}`);
    expect(readFileSync(out, "utf8")).toContain("### What the change does");
  }, 60_000);

  test("an unknown flag is a usage error: exit 2, the message names ask, no call", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?", "--verify"], { repo });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown option --verify for ask.");
    expect(r.read("calls")).toBeUndefined();
  }, 60_000);

  test("an answer that is not the schema is exit 1 with the reason, and nothing on stdout", () => {
    const repo = branchRepo();
    const r = run(["ask", "What is b?", "--format", "json"], { repo, garbage: true });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Wachiman could not answer");
  }, 60_000);

  test("--working-tree all asks about the uncommitted edit, the same change local --working-tree reviews", () => {
    const repo = branchRepo();
    writeFileSync(join(repo.dir, "src/a.ts"), `${A_HEAD}export const uncommitted = true;\n`);
    const r = run(["ask", "What is new?", "--working-tree", "all", "--format", "json"], { repo });
    expect(r.code).toBe(0);
    expect(r.read("ask.diff")).toContain("+export const uncommitted = true;");
    expect(json(r.stdout).hasReview).toBe(false);
  }, 60_000);

  test("the answer schema is the one the GitHub path uses", () => {
    expect(ASK_SCHEMA.required).toEqual(["sections", "not_answered"]);
  });
});
