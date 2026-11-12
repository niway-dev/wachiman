/**
 * Wachiman's block in a pull request description and the digest of the author's own text (ADR 0033
 * decisions 4 and 7). The block is a mirror of the review, so it is never read as the author's
 * claim: `stripBlock` removes it before the title and body become the claims input, and the digest
 * is taken over what is left. Pure string work.
 */
import { createHash } from "node:crypto";

export const BLOCK_START = "<!-- wachiman:confidence:start -->";
export const BLOCK_END = "<!-- wachiman:confidence:end -->";

const DIGEST_COMMENT = /<!-- wachiman:digest:([0-9a-f]{64}) -->/;
const BLANK_LINE_AFTER = /^(?:\r?\n){2}/;

/** One block: `start` is where its start marker begins, `end` is just past its end marker. */
export interface BlockRegion {
  start: number;
  end: number;
}

/**
 * The whole blocks in a text, in order. A block is an end marker and the nearest start marker
 * before it, so a stray start marker earlier in the text never swallows what lies between it and a
 * real block, and a marker with no partner is not a block and stays where it is.
 */
export function blockRegions(text: string): BlockRegion[] {
  const regions: BlockRegion[] = [];
  let from = 0;
  for (;;) {
    const endAt = text.indexOf(BLOCK_END, from);
    if (endAt === -1) return regions;
    const startAt = text.lastIndexOf(BLOCK_START, endAt);
    if (startAt >= from) regions.push({ start: startAt, end: endAt + BLOCK_END.length });
    from = endAt + BLOCK_END.length;
  }
}

/**
 * The text without Wachiman's blocks. The blank line that separates a block from the text after it
 * goes with it, so the body the author wrote comes back exactly after `upsertBlock` put a block at
 * its top.
 */
export function stripBlock(body: string): string {
  const regions = blockRegions(body);
  if (regions.length === 0) return body;
  let out = "";
  let at = 0;
  for (const { start, end } of regions) {
    out += body.slice(at, start);
    at = end + (BLANK_LINE_AFTER.exec(body.slice(end))?.[0].length ?? 0);
  }
  return out + body.slice(at);
}

const normalise = (text: string) => text.replaceAll("\r\n", "\n").trim();

/** What the claims step reads: the title and the body without Wachiman's block. */
export function claimsInput(title: string, body: string | null | undefined): { title: string; body: string } {
  return { title: normalise(title), body: normalise(stripBlock(body ?? "")) };
}

/**
 * The sha256 of the author's text, in hex. Two bodies that differ only by Wachiman's block, line
 * endings or space around the text give the same digest; any other edit changes it.
 */
export function claimsDigest(title: string, body: string | null | undefined): string {
  const input = claimsInput(title, body);
  // A NUL cannot occur in a title, so "a" + "b" never collides with "a\nb" + "".
  return createHash("sha256").update(`${input.title}\u0000${input.body}`).digest("hex");
}

/** The digest a block was stamped with, or undefined when the body holds no block or no stamp. */
export function blockDigest(body: string): string | undefined {
  const first = blockRegions(body)[0];
  if (!first) return undefined;
  return DIGEST_COMMENT.exec(body.slice(first.start, first.end))?.[1];
}

/** The hidden line that stamps a block with the digest of the author's text. */
export const digestComment = (digest: string) => `<!-- wachiman:digest:${digest} -->`;
