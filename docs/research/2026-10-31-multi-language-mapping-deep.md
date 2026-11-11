# Deep comparison: zero-dep vs tree-sitter WASM vs ast-grep for the Wachi risk map

Date: 2026-10-31. macOS arm64, Bun 1.4.2. Target: kaipu at `dac8318` (throwaway worktree,
removed). Everything was run unless marked **[UNVERIFIED]**. Scripts: `/tmp/mapper-exp/`.

Job: per symbol a PR adds/changes/newly calls: definition (file:line), references
`[{file,line,kind}]`, count, import/export edges, "new connections" (qualified member calls
such as `window.electronAPI.startFileDrag`, literal IPC channel strings).

## 1. Bottom line
1. **A (zero-dep) is better than the first survey implied; its defect is misses, not noise.**
   After excluding docs by extension and bucketing tests, nearly every hit is a real
   reference (only 3 comment lines and 4 test-local shadows are wrong). But `libraryChanged`
   returns 4 hits and 0 of its 2 renderer consumers, which use another name
   (`onLibraryChanged`). Grep cannot follow that alias.
2. **B and C both add what A lacks** (reference kind, receiver chain, comments excluded,
   definitions with positions, imports for non-TS). Measured parity: both found 16
   identifier-level references to `startFileDrag`. Neither resolves types or cross-file
   bindings; references stay by name.
3. **B's version pairing is solved, differently from the first survey:** per-grammar release
   `.wasm` files load under web-tree-sitter 0.25.10, 0.26.13 and 0.27.1; only the stale
   aggregate `tree-sitter-wasms@0.1.13` fails on 0.27.1.
4. **Co-change (E) did not surface either target file** (shared API use, not co-edits).
5. **Recommendation (close call):** A as floor everywhere, B as AST layer (TS/TSX first),
   ast-grep as validation oracle. Section 8 has the strongest case for C instead.

## 2. A: zero-dep baseline (measured)

`git grep -nwF <sym>` at `dac8318`, each hit classified (`a/baseline.ts`, checked by hand
against the full hit lists). **prod** = same entity in production code (definition, import,
call, type); **chan** = same name as `IPC_CHANNELS.x` / `x: "channel"` (a different entity
from the API method); **test** = `*.test.*` or `/test/`; **doc** = `.md/.mdx`.

| Symbol | all | prod | chan | comment | test | doc |
|---|---|---|---|---|---|---|
| markCopySeen | 11 | 6 | 0 | 0 | 5 | 0 |
| startFileDrag | 17 | 4 | 3 | 0 | 7 | 3 |
| useLocalLibrary | 65 | 12 | 0 | 1 | 12 | 40 |
| noteFinishedCopy | 25 | 3 | 0 | 0 | 22 | 0 |
| destinationOfPreset | 10 | 6 | 0 | 0 | 2 | 2 |
| recordingFinalize | 75 | 4 | 3 | 2 | 26 | 40 |
| libraryChanged | 5 | 0 | 4 | 0 | 0 | 1 |
| seedWebcamScene | 0 | - | - | - | - | - |
| **Total** | **208** | **35 (17%)** | **10 (5%)** | **3 (1%)** | **74 (36%)** | **86 (41%)** |

- **What counts as noise decides the rate.** Unfiltered: 17% direct production references,
  41% Markdown. `-- '*.ts' '*.tsx'` removes all 86 doc hits. After that, wrong hits are 3
  comments plus 4 test-local variables named like the symbol (`const startFileDrag =
  vi.fn()`): about 6% of 122.
- **Test volume is the main cost**: 74 low-value hits (`noteFinishedCopy`: 22 test vs 3
  prod); a path split into a bucket is zero-dep and reliable.
- **Same name, two entities** (API method and IPC channel key) for `startFileDrag` and
  `recordingFinalize`; `preload/index.ts:87` is both. Word-grep merges them.
- **Misses are the real defect.** `libraryChanged`: 5 hits, 0 consumers. The literal
  `"library:changed"`: 30 hits, 27 docs, 2 comments, 1 definition. The consumers
  (`use-local-library.ts:133`, `use-tags.ts:37`) are reached only through
  `IPC_CHANNELS.libraryChanged` -> preload property `onLibraryChanged`.
- **Symbol absent at base.** `seedWebcamScene` has 0 hits at `dac8318` (it appears 31 commits
  later: 1 definition, 10 test hits, 0 production callers). For a symbol a PR adds, "0
  existing refs" is right; the useful data is the PR's own call sites, from the diff.
- **Generic names degrade A** (counts only; all / ts-tsx / non-test): `refresh` 320/135/92,
  `remove` 322/98/74, `Props` 151/89/84, `id` 5694/2853/1982. Only a cap plus a "textual"
  label is honest; B and C do not fix this (no types).
- **#465 is reachable with A.** `git grep -nw startFileDrag` lists `export-status-cards.tsx:235`;
  `-B3` shows `markCopySeen(recording.assetId)` on line 234 right before it. "Context around
  sibling call sites of the same qualified call" is a zero-dep feature that finds the precedent.
- Cost: 40-90 ms per symbol on 2090 tracked files.
`Bun.Transpiler.scan()` (4.3 ms on `master-copies-panel.tsx`) returns `exports` names and
`imports: [{kind,path}]` only: **no imported names, no lines, no definitions, no calls**;
`import type` lines never appear. For "which symbols come from where" a regex over import
lines is the zero-dep stopgap.

## 3. B: web-tree-sitter 0.25.10 in Bun (measured)

### 3.1 TS/TSX output (real kaipu files)

One ~30-line query (`b/ts-queries.ts`) on `master-copies-panel.tsx` (8.4 KB): parse 7.2 ms,
query compile 23 ms (once per language), run 3 ms. It returned:

- Definitions with position (`MasterCopiesPanel@69:17`, `runningCopyOf@30:17`).
- Calls `destinationOfPreset@82:15` and **`window.electronAPI.startFileDrag@174:21`** (member
  call, full receiver chain as text).
- Imports: path and each imported name with position (`destinationOfPreset@14:10`).
- `string_fragment` nodes: literal channel strings are separable from identifiers.

Reference classification over 1267 TS/TSX files (`b/run-b2.ts`: `git grep -l`, parse only
hit files, match leaf identifiers by text, classify by parent):

| Symbol | grep lines (ts/tsx) | AST nodes | Time | Notes |
|---|---|---|---|---|
| markCopySeen | 11 | 11 | 56 ms | 1 def, 2 imports, 3 calls, 5 test |
| startFileDrag | 14 | 17 | 55 ms | 3 `member-call (window.electronAPI.startFileDrag)`, 2 `IPC_CHANNELS.x` reads, 2 object keys, 1 type member, +1 string literal (test spy) |
| recordingFinalize | 35 | 30 | 84 ms | 5 comment lines dropped; API method vs channel key split by receiver |
| libraryChanged | 4 | 4 | 43 ms | 0 consumers (same miss as A) |

Also run: `useLocalLibrary` (25 -> 24, comment dropped), `noteFinishedCopy` (25 = 25),
`destinationOfPreset` (8 = 8), `seedWebcamScene` (0), 40-51 ms each. AST over A: comments
excluded, a kind per hit, receiver text (splits API method from channel key), strings flagged.

**Alias chain solved in 8 lines** (`b/run-b3.ts`): find `IPC_CHANNELS.<key>` in
`preload/index.ts`, walk to the enclosing `pair`, read its key: `libraryChanged @104 ->
onLibraryChanged` (3 ms). A normal scan of `onLibraryChanged` then returns both hooks. This is
project-specific logic that B and C would both need; it is not parser-limited.

Whole-repo parse: 1267 files, 6.4 MB, 640-889 ms; unneeded (hit files only: 40-110 ms/symbol).

### 3.2 Other languages (hand-written samples in `samples/`)

Queries written from grammar knowledge (`wts-0.25.10/langq.ts`, 6-8 lines each); all six ran:

| Lang | Definitions | Member / qualified calls | Imports | Authoring notes |
|---|---|---|---|---|
| Go | func, method, type, interface | `svc.Default.Charge@30` | path + alias | clean |
| Rust | fn (incl. impl), struct, trait | `l.record@21`, `crate::audit::log_entry@12`, macros | `use` path text | `use a::{B, C as D}` is one node; flatten ourselves |
| Java | class, interface, method, ctor | receiver + name separate | incl. static import | none |
| Kotlin | class, interface, function | `log.record@8` | dotted path, alias | capture of `!xs[0].blank` includes the `!` |
| Swift | struct/class/enum = `class_declaration`, protocol, func | `log.record@11` | module name | `xs[0]` parses as a call (false positive) |
| Python | class, function | `os.path.join@15` | import / from-import / alias | clean |

**Official `tags.scm`** (from grammar tarballs): TypeScript's covers only signatures, abstract
classes and interfaces (function/class/call patterns live in the *JavaScript* grammar's file,
which uses `#select-adjacent!`/`#strip!` predicates web-tree-sitter does not implement).
Go/Rust/Java/Python are usable but capture calls by identifier only (no receiver). **Swift has
0 reference captures, Kotlin ships no `tags.scm`**; only Go captures imports. Plan ~30 lines
of our own query per language.

### 3.3 Bundling and size
Wachi runs TS source with no build step (`bin: src/cli.ts`; the workflow calls `bun … cli.ts`),
so the realistic form is vendored files beside the source. Tested:

- Source run with **no `node_modules`**, any cwd: works (`Parser.init({locateFile})`,
  `Language.load(`${import.meta.dir}/…`)`); runtime 151 KB JS + 205 KB wasm.
- `bun build --target=bun` (126 KB JS): works if `vendor/` sits next to the output.
- `bun build --compile` with `with {type:"file"}`: works isolated; 62.77 MB vs 61.88 MB bun.
- Grammar sizes: TS 1.41, TSX 1.45, Go 0.22, Python 0.46, Java 0.41, Rust 1.10, Kotlin 3.44,
  Swift 3.83 MB. All eight 12.3 MB; TS+TSX+Go+Python+Java+Rust 5.1 MB.

### 3.4 Pitfalls found
- **Version matrix** (`wts-*/matrix.ts`): official wasms (TS 0.23.2, Go 0.25.0, Rust 0.24.0,
  Java 0.23.5, Python 0.25.0, Kotlin 1.1.0, Swift 0.7.3; ABI 14/15) load under 0.25.10,
  0.26.13 and 0.27.1. `tree-sitter-wasms@0.1.13` (grammars built from `^0.20`, last
  published 2025-10-07, 51.8 MB) loads on 0.25.10 and throws an empty `Error` on 0.27.1.
  Rule: vendor per-grammar release wasms, pin the runtime, skip the aggregate bundle.
- **Parse errors on valid TS:** 11 of 1267 files (0.9%) have ERROR nodes with the newest TS
  grammar (13 with the old bundle), e.g. `importActual<typeof import("…")>()` and JSX text
  containing `&`. Errors are local; the rest of the file parses. Do not gate on `hasError`.
- Kotlin sets `hasError` on a clean sample with no ERROR node (cause unknown).

## 4. C: ast-grep v0.51.0 (measured)

Release 2026-10-15, `app-aarch64-apple-darwin.zip` 8.63 MB (53.1 MB unpacked), MIT.
**Checksum:** the releases API exposes `digest: sha256:…` per asset; computed sha256 equals
the published one (`e18e13c2…99cc8`). No `SHA256SUMS` file, signature or attestation was
listed **[attestation not checked]**. Linux x86_64 asset: 8.86 MB, `sha256:a7eead55…fa639`
(not executed here).

- Use `ast-grep`, not `sg` (deprecated shim that fails unless `ast-grep` is on PATH).
- **Languages** (`SupportLang` in `crates/language/src/lib.rs`, main): Bash, Cpp, CSharp, Css,
  Dart, Go, Elixir, Haskell, Hcl, Html, Java, JavaScript, Json, Kotlin, Lua, Markdown, Nix, Php,
  Python, Ruby, Rust, Scala, Solidity, Swift, Tsx, TypeScript, Yaml, Zig. All our targets included.
- **Output:** `--json=compact|stream|pretty`; per match `text`, `file`, `range` (`byteOffset`,
  **0-based** `line`/`column`), `lines`, `metaVariables` (e.g. `M` -> `getSettings` + range).

On `apps/kaipu-record/src`, wall time 43-92 ms:

| Query | Result |
|---|---|
| `window.electronAPI.$M($$$)` `-l tsx` / `-l ts` | 52 / 112 matches (**`-l` selects the file type: run twice**) |
| `window.electronAPI.startFileDrag($$$)` | exactly the 3 production calls (gif-viewer:27, master-copies-panel:174, export-status-cards:235) |
| `IPC_CHANNELS.$K` (ts) | 492 matches |
| `ast-grep outline --items all` | 769 files, 6497 items, 1.7 MB JSON, 92 ms |

**Authoring gotchas (measured):**
- **Patterns are shape-sensitive.** `export function $F($$$) { $$$ }` matches 2;
  `export function $F($$$): $R { $$$ }` matches 804. Async, generics and return types each
  need another pattern; `export const $F = ($$$) => $$$` matched 0 despite existing code.
  `kind:` YAML rules are the robust form.
- **A bare-name pattern matches only `identifier` nodes:** `startFileDrag` gave 6 (the rest
  are `property_identifier`), `recordingFinalize` and `libraryChanged` gave **0**. A YAML
  rule `any: [kind: identifier, property_identifier, type_identifier,
  shorthand_property_identifier]` + `regex: '^name$'` gave 16 = parity with B.

**`ast-grep outline`** is the standout (not in the first survey). With no patterns it returns
per file: `symbolType`, `name`, `range`, `signature`, `astKind`, `isExported`, `isImport`,
`members`; flags `--items imports|exports|structure|all`, `--type`, `--match`. Verified on all
six sample languages. Limits: imported names only inside the `signature` text; arrow-function
consts are `constant`, not `function`; the changelog adds outline rules each release (Java
annotation/enum/module/wildcard in 0.51), so **its output shape will move**; pin the version.

Patterns to maintain: 0 for definitions/imports (outline); one generated per queried
qualified call; 1 YAML by-name rule per language (~7).

**Cannot do (nor can B):** cross-file resolution, type-aware matching, alias following,
re-export tracing, data flow. Same ~1% parse-error files.

## 5. D: Python option (brief)
- **Semgrep 1.183.0** (LGPL-2.1, wheel 72.2 MB; venv install 7 s warm cache, 302 MB on disk):
  `-e 'window.electronAPI.$M(...)' --lang ts` on kaipu src gave 169 matches in **2 s**. Same
  idea as ast-grep at ~40x the latency and ~35x the disk. Cross-file/taint is a paid tier
  **[UNVERIFIED]**; my non-TS runs gave no usable output, so no multi-language numbers.
- **tree-sitter Python bindings** (0.26.0, 0.7 MB; `tree-sitter-language-pack` 1.22.1, MIT,
  2.5 MB, grammar delivery **[UNVERIFIED]**): same engine as B plus a second runtime.
- **`jedi` 0.20.1** (MIT, 4.9 MB): real name resolution, **Python repos only**. **`pyright`**
  (npm 19.5 MB, MIT; PyPI wrapper fetches the npm package at run time **[from memory]**):
  type-aware for Python and TS; needs project config; timings not run.
- Verdict: Python's one unique gain is **semantic references for Python repos**. It does
  nothing for Go/Rust/Java/Kotlin/Swift and adds a second runtime beside the API key.

## 6. E: co-change and churn (measured)
`cochange.ts`: `git log <rev> -n N --name-only --no-merges`, skip commits touching >40 files,
count pairs. At `dac8318^` (history a reviewer of that PR would have):

Results (`master-copies-panel.tsx`; `export-status-cards.tsx` and `ready-copies.ts` were
**absent at every window**): window 200 = 200 commits, 1 touching, 29 ms; window 500 = 500
commits (since 10-06), 1 touching, 38 ms; window 1500 = 1229 commits (whole history), 1
touching, 64 ms. At `dac8318` itself (PR commit included): 2 touching, same absence, 40-72 ms.

**Why it fails:** the panel was created one commit before the PR, so every co-changed file
has confidence 1.00 on a sample of 1 (CSS, tests, `master-tag.tsx`, i18n). The link to
`export-status-cards.tsx` is shared API use, not co-evolution. The reverse fails too:
`export-status-cards.tsx` (6 commits) co-changes with its test, `export-runner.ts`,
`export-sheet.tsx`, i18n; `ready-copies.ts` (1 commit) with `sidebar.tsx`, `rail.tsx`,
`use-prepare-copy.ts`. A `--depth=1` clone has 1 commit, so the signal is absent by default
**[CI `fetch-depth` cost not measured]**. Use as a prioritisation hint (Sol's indicators 3-5),
showing "N commits touching this file" and suppressing it when N < ~5.

## 7. Comparison table
| Capability | A zero-dep | B tree-sitter WASM | C ast-grep binary |
|---|---|---|---|
| Definition file:line (TS) | regex; `scan()` names only | yes, with kind | yes (`outline`); arrow consts = `constant` |
| Definitions in Go/Rust/Java/Kotlin/Swift/Python | regex heuristics | yes, ~7-line query each (6/6 ran) | yes, 0 patterns (6/6 ran) |
| References by name | `git grep -nw`, 40-90 ms | AST, 40-110 ms, comments out | YAML kind rule, 43-90 ms; bare pattern misses properties |
| Qualified member calls | text only | yes, receiver text | yes, native syntax, simplest to write |
| Literal channel strings | text; 27 of 30 hits are docs | `string_fragment`, exact | string patterns/rules |
| Import names + paths | paths via `scan()`; names by regex | yes, per name with position | path + statement text; names not split |
| Alias chain (channel -> preload method) | no | yes, 8 lines of ours | our logic as well |
| Type-aware / cross-file | no | no | no |
| Footprint | 0 | 0.36 MB runtime + 0.2-3.8 MB per grammar | 8.9 MB zip, ~53 MB unpacked, per platform |
| ADR 0002 | satisfied | vendored third-party code + wasm blobs | external binary beside the key |
| Authoring effort | lowest | ~30-line query + node table per language | shape-sensitive patterns; kind rules |

## 8. Recommendation and strongest counter-argument

**Recommendation.**
1. Ship the evidence format with provenance `text_match` and the A pipeline for every
   language: extension filter, test bucket, comment-line drop, cap and rank, `-B3` context
   around sibling call sites of the same qualified call.
2. Add **B for TS/TSX first** (the only measured demand): vendor web-tree-sitter 0.25.10 and
   the official TS/TSX wasm (~3.3 MB). Provenance `ast`. Gains: comments out, reference
   kinds, receiver text, strings vs identifiers, import names, the IPC alias chain.
3. Add Go, Python, Java, Rust (0.2-1.1 MB each) when a PR in that language is in the replay
   set; Kotlin and Swift (3.4 and 3.8 MB) only on demand.
4. Keep ast-grep out of the runtime; use it as a dev-time oracle. It independently
   reproduced B's count (16 vs 16), which is how to test each new language query.
5. Co-change: optional hint, minimum-history guard.

**Strongest counter-argument (C instead of B).** B means owning a ~30-line query and a
parent-node table per language, 12 MB of opaque wasm, and a runtime/grammar pairing we have
seen break (0.27.1 vs the popular bundle). ast-grep embeds the same grammars, is very active
(16k stars, release 2026-10-15), gives definitions and imports for 27 languages with zero
queries (`outline`), qualified calls in readable native syntax, and a sha256 per asset. For
many languages, one pinned 9 MB download is less code to own than N grammars; and the
decisive logic (alias chain, contract questions) is ours in both, since neither has types or
cross-file binding. I stay on B because (a) no download or network step in the job that holds
the API key, one artefact on any runner; (b) ast-grep's patterns and `outline` are
shape-sensitive or still moving (2 vs 804 matches for one function pattern). **Decision
rule:** if more than ~4 languages are expected soon, or vendored wasm is unwelcome, choose C
and pin `0.51.x` with the digest.

## 9. Artefacts to vendor or download
Option B (vendor; keep a `vendor/MANIFEST` with name, version, source URL, sha256, plus a test
that recomputes hashes; ship the web-tree-sitter `LICENSE`; do not use `tree-sitter-wasms`):

| Artefact | Version | Size | License | Checksum source |
|---|---|---|---|---|
| `tree-sitter.js` (web-tree-sitter) | 0.25.10 | 151 KB | MIT | GitHub release `v0.25.10` asset digest `sha256:d4fc466d…da42` (= npm file) |
| `tree-sitter.wasm` (runtime) | 0.25.10 | 205 KB | MIT | release asset digest `sha256:f38dcc4b…6d7f` (= npm file) |
| `tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm` | 0.23.2 | 1.41 + 1.45 MB | MIT | npm `dist.integrity` (sha512) of the tarball; file sha256 `778025db…`, `79e5da75…` |
| `tree-sitter-{go,python,java,rust}.wasm` | 0.25.0, 0.25.0, 0.23.5, 0.24.0 | 217, 458, 415 KB, 1.10 MB | MIT | npm integrity; sha256 `9504573f…`, `16108b50…`, `4fdeac4c…`, `f65f3542…` |
| `tree-sitter-kotlin.wasm` | `@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0 | 3.44 MB | MIT | npm integrity; sha256 `7009d694…` (GitHub asset has no digest) |
| `tree-sitter-swift.wasm` | 0.7.3, GitHub release of alex-pinkus/tree-sitter-swift (npm 0.7.1 has no wasm) | 3.83 MB | MIT | GitHub digest `sha256:0258a7ef…9eb2` (matches computed) |

Full sha256: `shasum -a 256 /tmp/mapper-exp/grammars/*.wasm`.
Option C (download in the workflow, verify, run `ast-grep` not `sg`): `ast-grep` 0.51.0,
`app-x86_64-unknown-linux-gnu.zip` (8.86 MB), MIT, expected
`sha256:a7eead5552d3a8daad70f5d50d935da44bd0c138e946b5b0a96b1d38169fa639` from
`gh api repos/ast-grep/ast-grep/releases/tags/0.51.0`; arm64 Linux asset 8.51 MB, `73af0ebe…b8b`.

## 10. Not verified
- ast-grep on Linux x86_64 (only macOS arm64 ran), its unpacked size, release attestations;
  Ubuntu 26.04; wasm load time on a cold runner.
- Why Kotlin sets `hasError` on a clean file; why 11 TS files still error.
- Semgrep on non-TS samples and paid-tier claims; `tree-sitter-language-pack` delivery;
  PyPI `pyright` wrapper; jedi/pyright timings; `fetch-depth` cost for 200 commits.
- Noise for generic names is counts only. Non-TS languages were tested on tiny hand-written
  samples, not real repositories. The compiled-binary route (3.3) is not needed: Wachi runs from source.

## Addendum 2026-10-31: how Pullfrog and CodeRabbit get cross-file context

**Pullfrog parses nothing.** Its change-impact artefact (`utils/changeImpact.ts` in v0.1.110)
takes identifiers from the diff with `/[A-Za-z_][A-Za-z0-9_]*/`, keeps those of 4+ characters
with an uppercase letter or an underscore, scores each 1–4 by the keyword before it (`class`,
`def`, `func`, `fn`, `struct`, `trait` → 4; `const`/`let`/`var` or a following `(`/`:` → 3), runs
one exact-word `git grep` over tracked text files, and caps everything: 24 candidates, 12 atoms,
6 references each, 160-character excerpts, 16 KB, 60 s. Language-agnostic by being textual. The
model does the rest with Read and Grep. This is the tool that caught four of five user-facing
bugs the field benchmark records, so **the textual floor (option A) is parity with Pullfrog in
every language**, and tree-sitter (option B) is beyond it, not catch-up.

**CodeRabbit indexes.** Its Code Graph Analysis builds, per review and on its servers, a graph of
symbol definitions and references across the whole repository plus files that co-change in
history, and gives the model definition files, reference files and related files. Nineteen
languages (TS, TSX, JS, Go, Rust, Java, Kotlin, Swift, Python, Ruby, C, C++, C#, PHP, Scala,
Elixir, Lua, Bash, CSS); Lite tier and above. That is the risk map of the flow-questions design,
hosted. Wachi's version runs in the consumer's runner at review time; the model gets a similar
slice without a hosted index. The selected code still goes to the model provider in the review's requests, as every review does; what stays on the runner is the index itself (corrected 2026-11-02 after GPT-6.1 Sol's review). Sources:
[docs](https://docs.coderabbit.ai/integrations/code-graph-analysis),
[changelog](https://docs.coderabbit.ai/changelog/code-graph-analysis); the per-review rebuild
detail is from a [secondary source](https://theaiengineer.substack.com/p/how-coderabbit-actually-works).

Neither tool resolves types: an interface in Java or a trait in Rust is invisible to both without
a build. Nobody does that on an arbitrary PR checkout.
