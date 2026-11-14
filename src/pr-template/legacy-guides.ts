/**
 * The guide comments of the PR description template that was copied by hand before the catalog
 * existed (version 0). Adopting an unmanaged file (ADR 0052) treats a comment with one of these
 * texts as guidance and replaces it, wherever it sits; every other comment that does not follow a
 * known heading, row or summary is the repository's own and is kept.
 *
 * Texts are compared with their whitespace collapsed, so a comment wrapped over several lines
 * still matches. This list is source, not a fixture, so it ships in the npm package.
 */

/** The first comment of the old file is recognised by its prefix only. */
export const LEGACY_HEADER_PREFIX = "<!-- PR description template.";

export const LEGACY_GUIDES: readonly string[] = [
  "One of: Feature, Fix, Refactor, Docs, Chore, CI",
  "[NIW2-123: issue title](link), or None",
  "🟢 Low, 🟡 Medium or 🔴 High, then the reason in a few words. Start from `pr_body.py risk`; raise it if you know more, never lower it. Risk is what the change touches, not whether it is right: a small, correct change to authentication is still High; whether it is right is the reviewer's grade.",
  "When this reaches users. One of: Direct on deploy (no flag) / New flag `NAME` (default OFF, production OFF) / Existing flag `NAME` (production ON) / Manual step: which / No production effect",
  "What the release tool will do: No release, patch, minor. Major only if the owner asked for it",
  "What kind exists: Screenshots, Video, Command output, or Not verified: reason. Detail in ## Evidence",
  "Each decision in a few words with a link to its ADR, or None",
  'Everything only the owner can do or decide: text to read, a decision to accept or veto, a manual step, a secret to set. Checkboxes, with the link or the command. If there is nothing: "Nothing. Merge when checks are green."',
  "What changed and the result someone can observe. Two or three sentences, in the reader's terms. No file list.",
  "The problem this solves and why it was needed now. For a defect: the concrete failure.",
  'One row per acceptance criterion of the issue; with no issue, one row per claim this PR makes. Evidence is something the owner can open: a screenshot, a recording, an output, a CI check by name. A row with no evidence says "not verified: reason". Do not list commands CI already runs.',
  'Only decisions a later reader will ask "why this and not that" about. Say what was decided, link the ADR by title, and mark the ones the owner may want to veto. Delete this section when there are none (the status table then says None).',
  'One row per thing that is now true, not per file. At most seven rows; group the rest. Mechanical bulk is one row ("212 files renamed, no behaviour change").',
  "How the owner reproduces the result: directory, environment, command, input, steps and the expected result. Highest risk first.",
  "What was not run or checked, and why. Anything here that the owner must act on also appears in Needs you.",
  "Only commands CI does not run, with their exit codes.",
  "Context that fits no other section.",
];

export const collapseSpace = (text: string) => text.trim().split(/\s+/).join(" ");

const KNOWN = new Set(LEGACY_GUIDES.map(collapseSpace));

export const isLegacyGuide = (text: string) => KNOWN.has(collapseSpace(text));
