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
const { publish, verify, "verify-tests": verifyTests } = workflow.jobs;
const stepText = (job: any) => JSON.stringify(job.steps);

describe("release-please.yml", () => {
  test("publishes with npm trusted publishing: id-token on the publish job only, and no npm token anywhere", () => {
    expect(publish.permissions["id-token"]).toBe("write");
    expect(workflow.permissions["id-token"]).toBeUndefined();
    expect(verify.permissions["id-token"]).toBeUndefined();
    expect(verifyTests.permissions["id-token"]).toBeUndefined();
    expect(workflow.jobs["release-please"].permissions?.["id-token"]).toBeUndefined();
    const code = text.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(code.filter((line) => /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\.[A-Z_]*NPM/.test(line))).toEqual([]);
  });

  test("publish waits for verify, which waits for the release and every test shard, and all run only when a release was created", () => {
    expect(publish.needs).toEqual(expect.arrayContaining(["release-please", "verify"]));
    expect(verify.needs).toEqual(expect.arrayContaining(["release-please", "verify-tests"]));
    expect(verifyTests.needs).toBe("release-please");
    for (const job of [publish, verify, verifyTests]) expect(String(job.if)).toContain("release_created == 'true'");
  });

  test("verify-tests runs the tagged commit's tests in four shards, each checking the split and its file count", () => {
    expect(verifyTests.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(verifyTests.strategy["fail-fast"]).toBe(false);
    const steps = stepText(verifyTests);
    expect(steps).toContain("needs.release-please.outputs.sha");
    expect(steps).toContain("scripts/test-shard.ts --check");
    expect(steps).toContain('bun test \\"${files[@]}\\"');
    expect(steps).toContain("across ${#files[@]} files");
  });

  test("verify checks out the tagged commit and runs both tarball checks before uploading the artifact", () => {
    const steps = stepText(verify);
    expect(steps).toContain("needs.release-please.outputs.sha");
    expect(steps).not.toContain("bun test");
    expect(steps).toContain("verify-package.sh --tarball");
    expect(steps).toContain("--without-bun");
    expect(steps.indexOf("npm pack")).toBeLessThan(steps.indexOf("verify-package.sh"));
    expect(steps.indexOf("verify-package.sh")).toBeLessThan(steps.indexOf("upload-artifact"));
  });

  test("publish uploads the verified tarball with provenance and requires npm 11.5.1 or later", () => {
    const steps = stepText(publish);
    expect(steps).toContain("download-artifact");
    // The leading ./ keeps npm from reading dist/x.tgz as a GitHub user/repo (broke the v1.11.0 publish).
    expect(steps).toContain('npm publish \\"./$tarball\\" --provenance');
    expect(steps).toContain("11.5.1");
    expect(steps).not.toContain("npm pack");
  });

  test("the release job exports what the later jobs need", () => {
    expect(Object.keys(workflow.jobs["release-please"].outputs)).toEqual(
      expect.arrayContaining(["release_created", "version", "sha", "tag_name"]),
    );
  });
});
