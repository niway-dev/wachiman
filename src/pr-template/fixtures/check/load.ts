import { readFileSync } from "node:fs";
import { join } from "node:path";

export const HEAD = "cfd77e4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const TITLE = "docs: describe the PR format";
export const ADR_LINK = "[One PR description template, checked by a script](../adr/0033-one-pr-description-template.md)";

/** The breaking-change footer text, joined here so no file in the repository spells it out. */
export const BREAKING_TEXT = ["BREAKING", "CHANGE"].join(" ");
export const BREAKING_HYPHEN = ["BREAKING", "CHANGE"].join("-");

export function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, name), "utf8");
}

/** A description that passes the default template, so a test can break exactly one thing. */
export function validBody({ risk = "🟢 Low, docs only", head = HEAD }: { risk?: string; head?: string } = {}): string {
  return fixture("valid.md").replaceAll("{{RISK}}", risk).replaceAll("{{HEAD}}", head.slice(0, 12));
}

/** The same, shaped for `custom-template.json`. */
export function validCustomBody({ risk = "🟢 Low, docs only", head = HEAD }: { risk?: string; head?: string } = {}): string {
  return fixture("valid-custom.md").replaceAll("{{RISK}}", risk).replaceAll("{{HEAD}}", head.slice(0, 12));
}

/** `validBody()` with a Decisions section whose Record cell is `record`. */
export function withDecisions(record: string): string {
  const section = fixture("valid-decisions.md").replace("{{RECORD}}", record);
  return validBody().replace("<details><summary><b>Changes", `${section}<details><summary><b>Changes`);
}
