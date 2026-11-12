/** The author's text and Wachiman's own block (ADR 0033 decisions 4 and 7): pure string work. */
import { describe, expect, test } from "bun:test";
import { BLOCK_END, BLOCK_START, blockDigest, claimsDigest, claimsInput, stripBlock } from "./digest";

const block = (inner = "## 👮 Wachiman · PR Confidence\n\n> B") => `${BLOCK_START}\n${inner}\n${BLOCK_END}`;

describe("stripBlock", () => {
  test("a body with no markers is returned unchanged", () => {
    expect(stripBlock("Adds an export button.\n")).toBe("Adds an export button.\n");
  });

  test("removes the block and the blank line after it, so a block put at the top leaves the author's body", () => {
    const body = "Adds an export button.\n\n- one\n- two\n";
    expect(stripBlock(`${block()}\n\n${body}`)).toBe(body);
  });

  test("removes a block in the middle of the text and the blank line after it", () => {
    expect(stripBlock(`intro\n\n${block()}\n\noutro`)).toBe("intro\n\noutro");
  });

  test("removes a block at the end", () => {
    expect(stripBlock(`intro\n\n${block()}`)).toBe("intro\n\n");
  });

  test("accepts a CRLF blank line after the block, as GitHub stores a body edited in the browser", () => {
    expect(stripBlock(`${block()}\r\n\r\nbody`)).toBe("body");
  });

  test("removes every block when an agent pasted two", () => {
    expect(stripBlock(`${block("one")}\n\nmiddle\n\n${block("two")}\n\nend`)).toBe("middle\n\nend");
  });

  test("a start marker with no end after it is not a block and stays in the text", () => {
    const text = `${BLOCK_START}\nhalf a block\n\nbody`;
    expect(stripBlock(text)).toBe(text);
  });

  test("an orphan start marker before a whole block does not swallow the text between them", () => {
    const text = `${BLOCK_START}\nstray\n\nauthor words\n\n${block()}\n\nend`;
    expect(stripBlock(text)).toBe(`${BLOCK_START}\nstray\n\nauthor words\n\nend`);
  });

  test("an end marker with no start is left alone", () => {
    const text = `body\n${BLOCK_END}\nmore`;
    expect(stripBlock(text)).toBe(text);
  });
});

describe("claimsDigest", () => {
  test("is a sha256 in hex, the same for the same text", () => {
    const d = claimsDigest("Export button", "Adds an export button.");
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(claimsDigest("Export button", "Adds an export button.")).toBe(d);
  });

  test("a body that holds the block gives the same digest and the same claims input as the body without it", () => {
    const body = "Adds an export button.\n\n- one\n";
    const withBlock = `${block()}\n\n${body}`;
    expect(claimsDigest("T", withBlock)).toBe(claimsDigest("T", body));
    expect(claimsInput("T", withBlock)).toEqual(claimsInput("T", body));
  });

  test("a different block inside the markers does not change the digest", () => {
    expect(claimsDigest("T", `${block("A")}\n\nbody`)).toBe(claimsDigest("T", `${block("C, much longer")}\n\nbody`));
  });

  test("any edit to the title or the author's body changes the digest", () => {
    const base = claimsDigest("T", "body");
    expect(claimsDigest("T2", "body")).not.toBe(base);
    expect(claimsDigest("T", "body!")).not.toBe(base);
  });

  test("moving a word from the title to the body changes the digest", () => {
    expect(claimsDigest("a b", "")).not.toBe(claimsDigest("a", "b"));
    expect(claimsDigest("a", "b")).not.toBe(claimsDigest("a\nb", ""));
  });

  test("line endings and trailing space around the body do not count as an edit", () => {
    expect(claimsDigest("T", "one\r\ntwo\r\n")).toBe(claimsDigest("T", "one\ntwo"));
  });

  test("a missing body is the same as an empty one", () => {
    expect(claimsDigest("T", null)).toBe(claimsDigest("T", ""));
  });
});

describe("blockDigest", () => {
  test("reads the digest the block was stamped with, and nothing from a body with no block", () => {
    const stamped = `${BLOCK_START}\n<!-- wachiman:digest:${"ab".repeat(32)} -->\nx\n${BLOCK_END}\n\nbody`;
    expect(blockDigest(stamped)).toBe("ab".repeat(32));
    expect(blockDigest("body")).toBeUndefined();
  });

  test("ignores a digest comment outside the block", () => {
    expect(blockDigest(`<!-- wachiman:digest:${"ab".repeat(32)} -->\nbody`)).toBeUndefined();
  });
});
