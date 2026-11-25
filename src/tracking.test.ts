import { describe, expect, test } from "bun:test";
import { doNotTrack, usageDataAllowed } from "./tracking";

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
  test("is false whatever the environment says, because Wachiman collects nothing", () => {
    for (const v of [undefined, "", "0", "false", "1", "true", "yes"]) expect(usageDataAllowed({ DO_NOT_TRACK: v })).toBe(false);
  });

  test("when collection exists, DO_NOT_TRACK still wins", () => {
    expect(usageDataAllowed({ DO_NOT_TRACK: "1" }, true)).toBe(false);
    expect(usageDataAllowed({}, true)).toBe(true);
    expect(usageDataAllowed({ DO_NOT_TRACK: "0" }, true)).toBe(true);
  });
});
