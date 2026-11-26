import { describe, expect, test } from "bun:test";
import { doNotTrack, usageDataAllowed, usageGate } from "./tracking";

describe("doNotTrack", () => {
  test("is on for 1, true and any other non-empty value except 0 and false", () => {
    for (const v of ["1", "true", "yes", " TRUE ", "on"]) expect(doNotTrack({ DO_NOT_TRACK: v })).toBe(true);
  });

  test("is off when unset, empty, 0 or false", () => {
    for (const v of [undefined, "", "  ", "0", "false", " False "]) expect(doNotTrack({ DO_NOT_TRACK: v })).toBe(false);
    expect(doNotTrack({})).toBe(false);
  });
});

describe("usageDataAllowed", () => {
  test("follows DO_NOT_TRACK alone: the stored consent is checked elsewhere (src/telemetry/consent.ts)", () => {
    for (const v of [undefined, "", "0", "false"]) expect(usageDataAllowed({ DO_NOT_TRACK: v })).toBe(true);
    for (const v of ["1", "true", "yes"]) expect(usageDataAllowed({ DO_NOT_TRACK: v })).toBe(false);
  });

  test("when collection exists, DO_NOT_TRACK still wins", () => {
    expect(usageGate(true, { DO_NOT_TRACK: "1" })).toBe(false);
    expect(usageGate(true, {})).toBe(true);
    expect(usageGate(true, { DO_NOT_TRACK: "0" })).toBe(true);
  });
});
