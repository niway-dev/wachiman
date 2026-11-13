# Owner decisions after the test-quality research

- **Date:** 2026-11-12
- **Status:** owner intent, recorded before design. These are the inputs for the spec and ADRs;
  they are not yet a design. Where a decision needs a mechanism, the spec decides how.
- **Related:** [synthesis](synthesis.md), [skill draft](skill-draft-test-map.md), [index](README.md)

## What the owner asked for

1. **Wachiman annotates low-signal tests.** The categories the t3code purge deleted
   ([02-the-big-purge.md](t3code/02-the-big-purge.md)) are what Wachiman should point out: tests
   that check what types already guarantee, trivial logic, basic DOM behaviour, real-timer waits,
   mock-call mirrors, smoke tests, duplicate table rows, and wall-clock performance asserts.
   Reason given: these are not what a team needs, and removing them can cut test time
   considerably.
2. **The keep rules matter as much as the delete rules.** The owner's reading of the restores
   ([03-over-cuts-and-restores.md](t3code/03-over-cuts-and-restores.md)): even an aggressive
   maintainer over-cut, and had to restore regression tests, boundary cases (DST, revocation) and
   secret redaction. Any tool we build must carry those keep-guards.
3. **Turn the t3code purge strategy into a skill plus scripts** ("a linter, but for tests"): it
   tells what each test proves and whether we need it, and can move or delete large numbers of
   tests automatically. It lives in **cs-tack**, because AI agents generate many tests we probably
   do not need. It stays a separate function from `cs-audit-tests`.
4. **Use pingdotgg/t3code#26166 as a source too**: the written test rules, the `test-signal`
   review agent and its evals ([04-codified-criteria.md](t3code/04-codified-criteria.md)).
5. **Nothing gets lost.** Every finding and decision is written into a document in this folder or
   in the spec that follows it.

## Answers to the baseline corrections in the synthesis

1. **One owning layer per behaviour** (refines the hub's "overlap is coverage, not waste"):
   accepted.
2. **Fakes over mocked repositories in the application-unit layer:** accepted in principle; the
   owner asked whether we can implement it on our side (guidance, templates, lint). Open for the
   spec.
3. **Slow is not a reason to delete; move the test down a layer or use a fake clock:** accepted;
   "we already have much of this".

## Answers to the open decisions

1. **The test-map skill lives in cs-tack**, with its functions separate from `cs-audit-tests`
   (map and candidates vs per-test judgement).
2. **Wachiman's stance on tests is a suggestion, never a gate.** Wachiman is opinionated and always
   gives its verdict on the tests in a PR, but every team works differently: a team can adopt its
   own testing policy and change it with a flag in the workflow yml. Opinionated default,
   overridable per repository.
   - Asymmetric default accepted: on added tests ask for fewer and smaller; on removed tests in
     risk areas ask for evidence; on a bug fix without a regression test, ask for one.
