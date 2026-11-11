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
    // The leading ./ keeps npm from reading dist/x.tgz as a GitHub user/repo (broke the v1.11.0 publish).
    expect(steps).toContain("npm publish \\\"./$tarball\\\" --provenance");
    expect(steps).toContain("11.5.1");
    expect(steps).not.toContain("npm pack");
  });

  test("the release job exports what the later jobs need", () => {
    expect(Object.keys(workflow.jobs["release-please"].outputs)).toEqual(expect.arrayContaining(["release_created", "version", "sha", "tag_name"]));
  });
});
