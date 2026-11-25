# Supported languages

This page lists what Wachiman does for each language today, so you can see what to expect.
It states only what the code does on `main`. Nothing here is planned work.

Last checked against the code: 2026-11-25, version 1.20.1.

The model reviews every text file in the diff, whatever the language. Binary files are not
reviewed. A few paths are left out by default whatever the language: lock files (`*.lock`,
`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`), `dist/`, `build/`, `out/`,
`*.min.js`, `*.map`, `*.snap` and `*.generated.*` (`DEFAULT_EXCLUDE` in `src/engine.ts`).

What changes by language is the **evidence** Wachiman gathers before the model runs
([Call-site evidence](architecture.md#call-site-evidence-evidencejson)). It takes four steps, all in
`src/evidence.ts`:

1. Read the added lines of files with a listed extension (`SOURCE_EXTENSIONS`).
2. Pull call names out of them with one regular expression (`CALL_RE`) shared by every language.
3. Drop names the added lines declare themselves (`definedSymbols`), so a local helper is not
   searched for.
4. Search the repository for the other places that call each remaining name (`git grep` over the
   same list of extensions), and rank test files lower (`TEST_FILE`).

Evidence is text matching. It is a lead for the model, not a resolved call graph.

## The table

| Language | Extensions | Diff reviewed by the model | Call names extracted | Call sites searched | Local declarations recognized | Test files recognized | How |
| --- | --- | --- | --- | --- | --- | --- | --- |
| JavaScript | `js` `jsx` `mjs` `cjs` | ✅ | ✅ | ✅ | ⚠️ [1] | ✅ | generic regex |
| TypeScript | `ts` `tsx` | ✅ | ✅ | ✅ | ⚠️ [1] | ✅ | generic regex |
| Vue | `vue` | ✅ | ✅ | ✅ | ⚠️ [1] | ⚠️ [6] | generic regex, whole file |
| Svelte | `svelte` | ✅ | ✅ | ✅ | ⚠️ [1] | ⚠️ [6] | generic regex, whole file |
| Go | `go` | ✅ | ✅ | ✅ | ⚠️ [2] | ✅ | generic regex |
| Python | `py` | ✅ | ✅ | ✅ | ⚠️ [3] | ⚠️ [7] | generic regex |
| Rust | `rs` | ✅ | ✅ | ✅ | ⚠️ [4] | ⚠️ [6] | generic regex |
| Java | `java` | ✅ | ✅ | ✅ | ⚠️ [5] | ⚠️ [6] | generic regex |
| Kotlin | `kt` | ✅ | ✅ | ✅ | ⚠️ [5] | ⚠️ [6] | generic regex |
| Swift | `swift` | ✅ | ✅ | ✅ | ⚠️ [8] | ⚠️ [6] | generic regex |
| Ruby | `rb` | ✅ | ❌ | ❌ | ❌ | ❌ | none |
| PHP | `php` | ✅ | ❌ | ❌ | ❌ | ❌ | none |
| C# | `cs` | ✅ | ❌ | ❌ | ❌ | ❌ | none |
| C | `c` `h` | ✅ | ❌ | ❌ | ❌ | ❌ | none |
| C++ | `cpp` `cc` `hpp` | ✅ | ❌ | ❌ | ❌ | ❌ | none |
| Any other text file | any | ✅ | ❌ | ❌ | ❌ | ❌ | none |

✅ works. ⚠️ partly works; the note says where. ❌ does nothing today.

Notes:

1. Recognized: `function`, `class`, `interface`, `type` and `enum` names; names after `const`,
   `let` and `var`; object destructuring (`const { a, b: c } = x`); methods and object properties
   that hold a function; parameters of a function or arrow written on one line. Not recognized:
   array destructuring (`const [value, setValue] = useState()`).
2. Recognized: `func Name(`, `var name`, and `type` names. Not recognized: short declarations
   (`worker := newWorker()`), and methods with a receiver (`func (s *Server) Handle(`).
3. Recognized: `def` and `class` names. Not recognized: plain assignments (`helper = lambda x: x`)
   and the parameters of a `def`. A call through `self.` is treated as the class's own call.
4. Recognized: `fn`, `struct`, `trait` and `enum` names, and `let name`. Not recognized:
   `let mut name`. The extractor records the word `mut` instead of the variable.
5. Recognized: `class`, `interface` and `enum` names. Kotlin also: `val` and `var`. Not recognized:
   Java methods and local variables, and Kotlin `fun`. For a Java method such as
   `public void run(int count) {` the extractor records the parameter type (`int`), not a name.
6. Test files are recognized only inside a directory named `test`, `tests`, `__tests__`, `e2e` or
   `fixtures`. A file such as `FooTest.java`, or a directory such as Swift's `Tests/`, is not.
7. Recognized: `test_*.py` and the directories in note 6. Not recognized: `*_test.py`.
8. Recognized: `func`, `let`, `var`, `class`, `struct` and `enum` names. Not recognized: `protocol`.
   `init(name: String) {` records `init` and `name`.

What recognizing a test file changes: evidence ranks a call site in a test file below one in
production code. The model still reviews test files.

Extensions not in the list get no evidence even when the language looks close: `mts`, `cts` and
`kts`. Declaration files (`*.d.ts`) are read, but the call-site search skips them.

## Known gaps

- Ruby, PHP, C#, C, C++ and every other language get the model's review of the diff and nothing
  else. A caller written in one of them is also never found when you change a function in a
  supported language, because the search only covers the listed extensions.
- A name Wachiman wrongly treats as not declared in the change costs one extra search. It does not
  produce a wrong finding by itself.
- Declarations are collected across all the files of a batch. A name declared in one file hides
  the same name called in another file of that batch, so its call sites are not shown.
- One list of keywords and builtins serves all languages. A common word in one language can hide a
  name from another.
- Calls are found by text, not by type. `a.run()` is a name, not a resolved method.

## Being worked on

Language-aware parsing is being studied, to replace the generic regex where it matters most. This
table changes when that lands, and not before.
