import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedBy, consentPath, readConsent, recordChoice, resetInstallation, telemetryAllowed, UUID_V4 } from "./consent";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wachiman-telemetry-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("the consent store", () => {
  test("is unset until a choice is recorded, and a missing or broken file is unset, never a yes", () => {
    expect(readConsent(home)).toBeUndefined();
    writeFileSync(consentPath(home), "{not json");
    expect(readConsent(home)).toBeUndefined();
    writeFileSync(consentPath(home), JSON.stringify({ choice: "yes" }));
    expect(readConsent(home)).toBeUndefined(); // a yes without an installation is not a consent
    writeFileSync(consentPath(home), JSON.stringify({ choice: "yes", installation: "not-a-uuid" }));
    expect(readConsent(home)).toBeUndefined();
    writeFileSync(consentPath(home), JSON.stringify({ choice: "maybe" }));
    expect(readConsent(home)).toBeUndefined();
  });

  test("a yes creates a random v4 UUID, kept in the home with mode 0600, and holds only the choice and the id", () => {
    const consent = recordChoice(home, "yes");
    expect(consent.choice).toBe("yes");
    expect(consent.installation).toMatch(UUID_V4);
    expect(readConsent(home)).toEqual(consent);
    expect(Object.keys(JSON.parse(readFileSync(consentPath(home), "utf8"))).sort()).toEqual(["choice", "installation"]);
    expect(statSync(consentPath(home)).mode & 0o777).toBe(0o600);
  });

  test("a no stores no UUID when there was none, and keeps the one that exists; a new yes reuses it", () => {
    expect(recordChoice(home, "no")).toEqual({ choice: "no" });
    const first = recordChoice(home, "yes");
    expect(recordChoice(home, "no")).toEqual({ choice: "no", installation: first.installation });
    expect(recordChoice(home, "yes").installation).toBe(first.installation);
  });

  test("reset makes a new UUID and keeps the choice; with no installation it changes nothing", () => {
    expect(resetInstallation(home)).toBeUndefined();
    expect(existsSync(consentPath(home))).toBe(false);
    const first = recordChoice(home, "yes");
    const next = resetInstallation(home)!;
    expect(next.choice).toBe("yes");
    expect(next.installation).toMatch(UUID_V4);
    expect(next.installation).not.toBe(first.installation);
  });
});

describe("telemetryAllowed", () => {
  const yes = { choice: "yes", installation: "7b0f3a52-7f0e-4b0e-9d6a-1f2f3a4b5c6d" } as const;

  test("is true only with a stored yes and a clean environment", () => {
    expect(telemetryAllowed({}, yes)).toBe(true);
    expect(telemetryAllowed({}, undefined)).toBe(false);
    expect(telemetryAllowed({}, { choice: "no" })).toBe(false);
    expect(telemetryAllowed({}, { choice: "no", installation: yes.installation })).toBe(false);
    expect(telemetryAllowed({}, { choice: "yes" })).toBe(false);
  });

  test("DO_NOT_TRACK, WACHIMAN_TELEMETRY=0, CI and GITHUB_ACTIONS each turn it off", () => {
    expect(telemetryAllowed({ DO_NOT_TRACK: "1" }, yes)).toBe(false);
    expect(telemetryAllowed({ DO_NOT_TRACK: "0" }, yes)).toBe(true);
    expect(telemetryAllowed({ WACHIMAN_TELEMETRY: "0" }, yes)).toBe(false);
    expect(telemetryAllowed({ WACHIMAN_TELEMETRY: "1" }, yes)).toBe(true); // nothing turns it on without the stored yes
    expect(telemetryAllowed({ CI: "true" }, yes)).toBe(false);
    expect(telemetryAllowed({ CI: "false" }, yes)).toBe(false); // any non-empty value: errs toward privacy
    expect(telemetryAllowed({ CI: "" }, yes)).toBe(true);
    expect(telemetryAllowed({ GITHUB_ACTIONS: "true" }, yes)).toBe(false);
  });

  test("WACHIMAN_TELEMETRY blocks on 0, false, off and no in any case, with spaces, and on nothing else", () => {
    for (const value of ["0", "false", "FALSE", "Off", " no ", "NO"]) {
      expect(telemetryAllowed({ WACHIMAN_TELEMETRY: value }, yes)).toBe(false);
      expect(blockedBy({ WACHIMAN_TELEMETRY: value })).toEqual([`WACHIMAN_TELEMETRY=${value.trim()}`]);
    }
    for (const value of ["1", "true", "on", "yes", ""]) expect(telemetryAllowed({ WACHIMAN_TELEMETRY: value }, yes)).toBe(true);
  });

  test("WACHIMAN_TELEMETRY=1 never makes an unset or declined consent allowed", () => {
    expect(telemetryAllowed({ WACHIMAN_TELEMETRY: "1" }, undefined)).toBe(false);
    expect(telemetryAllowed({ WACHIMAN_TELEMETRY: "1" }, { choice: "no" })).toBe(false);
  });

  test("blockedBy names what blocks it now", () => {
    expect(blockedBy({})).toEqual([]);
    expect(blockedBy({ DO_NOT_TRACK: "1", WACHIMAN_TELEMETRY: "0", CI: "true", GITHUB_ACTIONS: "true" })).toEqual([
      "DO_NOT_TRACK",
      "WACHIMAN_TELEMETRY=0",
      "CI",
      "GITHUB_ACTIONS",
    ]);
  });
});
