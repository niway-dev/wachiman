/**
 * The release gate, read from the workflow file: nothing here runs a release. These pin the
 * properties the design's Distribution rows ask for, so an edit that drops one fails a test
 * instead of a release.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(import.meta.dir, "..", ".github", "workflows", "release-please.yml");
const text = readFileSync(path, "utf8");
const workflow = Bun.YAML.parse(text) as { permissions: Record<string, string>; jobs: Record<string, any> };
const { publish, verify } = workflow.jobs;
const stepText = (job: any) => JSON.stringify(job.steps);

describe("release-please.yml", () => {
  test("publishes with npm trusted publishing: id-token on the publish job only, and no npm token anywhere", () => {
    expect(publish.permissions["id-token"]).toBe("write");
    expect(workflow.permissions["id-token"]).toBeUndefined();
    expect(verify.permissions["id-token"]).toBeUndefined();
    expect(workflow.jobs["release-please"].permissions?.["id-token"]).toBeUndefined();
    const code = text.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(code.filter((line) => /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\.[A-Z_]*NPM/.test(line))).toEqual([]);
  });

  test("publish waits for the verify job, which waits for the release, and both run only when a release was created", () => {
    expect(publish.needs).toEqual(expect.arrayContaining(["release-please", "verify"]));
    expect(verify.needs).toBe("release-please");
    expect(String(publish.if)).toContain("release_created == 'true'");
    expect(String(verify.if)).toContain("release_created == 'true'");
  });

  test("verify checks out the tagged commit and runs the tests and both tarball checks before packing the artifact", () => {
    const steps = stepText(verify);
    expect(steps).toContain("needs.release-please.outputs.sha");
    expect(steps).toContain("bun test");
    expect(steps).toContain("verify-package.sh --tarball");
    expect(steps).toContain("--without-bun");
    expect(steps.indexOf("bun test")).toBeLessThan(steps.indexOf("npm pack"));
    expect(steps.indexOf("verify-package.sh")).toBeLessThan(steps.indexOf("upload-artifact"));
  });

  test("publish uploads the verified tarball with provenance and requires npm 11.5.1 or later", () => {
    const steps = stepText(publish);
    expect(steps).toContain("download-artifact");
    expect(steps).toContain("npm publish \\\"$tarball\\\" --provenance");
    expect(steps).toContain("11.5.1");
    expect(steps).not.toContain("npm pack");
  });

  test("the release job exports what the later jobs need", () => {
    expect(Object.keys(workflow.jobs["release-please"].outputs)).toEqual(expect.arrayContaining(["release_created", "version", "sha", "tag_name"]));
  });

  describe("the Windows executable", () => {
    const build = workflow.jobs["windows-exe"];
    const release = workflow.jobs["windows-exe-release"];
    const ci = Bun.YAML.parse(readFileSync(join(import.meta.dir, "..", ".github", "workflows", "ci.yml"), "utf8")) as { jobs: Record<string, any> };
    // Every Bun pin in a job: a setup-bun step's bun-version, and a `bun@<version>` installed by npm in a run step.
    const bunPins = (job: any) => [
      ...job.steps.filter((s: any) => String(s.uses).startsWith("oven-sh/setup-bun@")).map((s: any) => String(s.with["bun-version"])),
      ...job.steps.flatMap((s: any) => [...String(s.run ?? "").matchAll(/\bbun@(\d+\.\d+\.\d+)\b/g)].map((m) => m[1])),
    ];

    test("both jobs run only when a release was created, and the build also waits for the verified tagged commit", () => {
      expect(String(build.if)).toContain("release_created == 'true'");
      expect(String(release.if)).toContain("release_created == 'true'");
      expect(build.needs).toEqual(expect.arrayContaining(["release-please", "verify"]));
      expect(release.needs).toEqual(expect.arrayContaining(["release-please", "windows-exe"]));
      expect(JSON.stringify(build.steps)).toContain("needs.release-please.outputs.sha");
    });

    test("the job that runs the repository's code can only read; the job that writes checks out nothing", () => {
      expect(build.permissions).toEqual({ contents: "read" });
      expect(build["runs-on"]).toBe("windows-latest");
      expect(release.permissions).toEqual({ contents: "write", "id-token": "write", attestations: "write" });
      expect(release.steps.some((s: any) => String(s.uses).startsWith("actions/checkout@"))).toBe(false);
      expect(release.steps.some((s: any) => s.run && /\b(bun|npm|node)\b/.test(s.run))).toBe(false);
    });

    test("builds with the target and the pinned Bun, smoke-tests every row but the owner's, and only then uploads the artifact", () => {
      const steps = stepText(build);
      expect(steps).toContain("scripts/build-exe.ts --outfile dist/wachiman.exe --target bun-windows-x64");
      for (const row of ["W1,W2,W3,W6", "--rows W5"]) expect(steps).toContain(row);
      expect(steps).not.toContain("W7");
      expect(steps.indexOf("smoke-exe.ts")).toBeLessThan(steps.indexOf("upload-artifact"));
      expect(steps.indexOf("sha256sum -c")).toBeLessThan(steps.indexOf("upload-artifact"));
      // The version in the executable is the release's, not whatever the checkout says.
      expect(steps).toContain("--version \\\"$VERSION\\\"");
    });

    test("every Bun in CI and in the release is the same version, so the build is the one that was tested", () => {
      const pins: Record<string, string[]> = {
        "release-please.yml windows-exe": bunPins(build),
        "release-please.yml verify": bunPins(verify),
        "ci.yml test": bunPins(ci.jobs.test),
        "ci.yml package": bunPins(ci.jobs.package),
        "ci.yml windows": bunPins(ci.jobs.windows),
        "ci.yml windows-exe": bunPins(ci.jobs["windows-exe"]),
      };
      // The reference is whatever the first job pins; no version is written here, so a bump needs no test edit.
      // Each job must have exactly one pin equal to the reference, and a failure lists the jobs that differ.
      const reference = Object.values(pins).flat()[0];
      const drifted = Object.fromEntries(Object.entries(pins).filter(([, v]) => v.length !== 1 || v[0] !== reference));
      expect(drifted).toEqual({});
    });

    test("attests the file by a commit-pinned action, attaches it with its checksums, and states the tier in the notes", () => {
      const attest = release.steps.find((s: any) => String(s.uses).startsWith("actions/attest-build-provenance@"));
      expect(String(attest.uses)).toMatch(/^actions\/attest-build-provenance@[0-9a-f]{40}$/);
      expect(attest.with["subject-path"]).toBe("dist/wachiman.exe");
      const steps = stepText(release);
      expect(steps).toContain("gh release upload");
      expect(steps).toContain("SHA256SUMS");
      expect(steps).toContain("built and smoke-tested");
      // "supported" appears only to deny it: Windows is promoted by a later, docs-only change.
      expect(steps).not.toMatch(/\b(?<!not a )(?<!the )supported (platform|on Windows)/i);
      expect(steps).toContain("not a supported platform yet");
      expect(steps).not.toContain("npm publish");
    });

    test("the pull-request job has one step per smoke row and no write permission", () => {
      const job = ci.jobs["windows-exe"];
      expect(job["runs-on"]).toBe("windows-latest");
      expect(job.permissions).toBeUndefined();
      const names = job.steps.map((s: any) => String(s.name));
      for (const row of ["W1", "W2", "W3", "W5", "W6"]) expect(names.some((n: string) => n.startsWith(`${row}:`))).toBe(true);
      expect(names.some((n: string) => n.startsWith("W7"))).toBe(false);
    });

    test("every action the new jobs use is pinned to a commit", () => {
      for (const job of [build, release, ci.jobs["windows-exe"]]) {
        for (const step of job.steps.filter((s: any) => s.uses)) expect(String(step.uses)).toMatch(/@[0-9a-f]{40}$/);
      }
    });
  });
});
