import { describe, expect, test } from "bun:test";
import { QUESTION } from "./destructive-step";

const applies = (lines: string[], filename = "src/main/thing.ts") => QUESTION.applies(lines, filename);

describe("destructive-step question", () => {
  test("has the contract fields and stays within 120 words", () => {
    expect(QUESTION.id).toBe("destructive-step");
    expect(QUESTION.title.length).toBeGreaterThan(0);
    expect(QUESTION.title).not.toContain("\n");
    expect(QUESTION.text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(120);
    expect(QUESTION.text).not.toMatch(/^#/m);
  });

  describe("fires on the real lines from the field run", () => {
    // kaipu-record #479, commit aac7202, apps/kaipu-record/src/main/workspaces/move-item.ts:672-676
    // (roll-forward healing: D1 deletes the source unverified, D2 drops the journal after a swallowed
    // unlink failure, D4 wipes every drag copy).
    test("#479 roll-forward healing", () => {
      expect(
        applies(
          [
            "    // A drag copy of the item could still name its bytes in the source (decision 11).",
            '    await rm(join(sourceDir, META_DIR, "drag"), { recursive: true, force: true }).catch(() => {});',
            "    if (sourcePresent) await unlink(sourceMedia).catch(() => {});",
            "    await removeCompanions(from.companionPaths(journal.sourceId));",
            "    return done();",
          ],
          "apps/kaipu-record/src/main/workspaces/move-item.ts",
        ),
      ).toBe(true);
    });

    test("#479: each deleting line fires on its own", () => {
      const file = "apps/kaipu-record/src/main/workspaces/move-item.ts";
      expect(applies(["    if (sourcePresent) await unlink(sourceMedia).catch(() => {});"], file)).toBe(true);
      expect(applies(["    await removeCompanions(from.companionPaths(journal.sourceId));"], file)).toBe(true);
      expect(
        applies(['    await rm(join(sourceDir, META_DIR, "drag"), { recursive: true, force: true }).catch(() => {});'], file),
      ).toBe(true);
    });

    // kaipu-record #439, commit c59e58f (the commit Wachiman reviewed),
    // apps/kaipu-record/src/main/library/library-vault.ts:499-511 (remove() with no sidecar check).
    test("#439 remove() deletes sidecar and media without reading the sidecar", () => {
      expect(
        applies(
          [
            "  async remove(id: string): Promise<void> {",
            "    // Under the sidecar lock so a racing writeMeta cannot recreate the sidecar just after it is deleted.",
            "    await withLock(this.sidecarPath(id), () =>",
            "      Promise.allSettled([",
            "        rm(this.sidecarPath(id), { force: true }),",
            "        rm(this.thumbnailPath(id), { force: true }),",
            "        rm(this.cursorTrackPath(id), { force: true }),",
            "        // An interrupted writeCursorTrack can leave the temp file behind.",
            "        rm(`${this.cursorTrackPath(id)}.tmp`, { force: true }),",
            "      ]),",
            "    );",
            "    await rm(await this.filePath(id), { force: true });",
            "  }",
          ],
          "apps/kaipu-record/src/main/library/library-vault.ts",
        ),
      ).toBe(true);
    });

    // kaipu-record #482, commit 833ca60, apps/kaipu-record/src/main/workspaces/workspace-settings.ts:319-320
    // (copyToAll clears every other workspace's override whatever the state of the source).
    test("#482 copyToAll clears every other workspace's overrides", () => {
      expect(
        applies(
          [
            "    for (const ws of this.deps.workspaces()) {",
            "      const result = await this.resetOverrides(ws.id, wanted);",
            "      if (result.ok) continue;",
          ],
          "apps/kaipu-record/src/main/workspaces/workspace-settings.ts",
        ),
      ).toBe(true);
    });
  });

  describe("fires on the other usual spellings", () => {
    const cases: [string, string, string][] = [
      ["unlinkSync", "  unlinkSync(path);", "a.ts"],
      ["fs.promises.rm", "  await fs.promises.rm(dir, { recursive: true });", "a.js"],
      ["rmSync", "  rmSync(dir, { recursive: true, force: true });", "a.mts"],
      ["rmdir", "  await rmdir(dir);", "a.tsx"],
      ["trash", "  await trash(path);", "a.ts"],
      ["shell.trashItem", "  await shell.trashItem(path);", "a.ts"],
      ["SQL DELETE", '  db.run("DELETE FROM items WHERE id = ?", [id]);', "a.ts"],
      ["SQL file", "DELETE FROM sessions WHERE expires_at < now();", "migrations/002.sql"],
      ["deleteMany", "  await prisma.item.deleteMany({ where: { workspaceId } });", "a.ts"],
      ["python rmtree", "    shutil.rmtree(target)", "tool.py"],
      ["go RemoveAll", "\tos.RemoveAll(dir)", "main.go"],
      ["rust remove_file", "    fs::remove_file(path)?;", "main.rs"],
    ];
    for (const [name, line, file] of cases) {
      test(name, () => expect(applies([line], file)).toBe(true));
    }
  });

  describe("stays quiet on ordinary code", () => {
    test("plain reads and writes", () => {
      expect(
        applies([
          'const text = await readFile(path, "utf8");',
          "if (existsSync(path)) await writeFile(other, text);",
          "const entries = await readdir(dir);",
        ]),
      ).toBe(false);
    });

    test("words that merely contain rm, unlink or trash", () => {
      expect(
        applies([
          "const ok = confirm(message);",
          "form(values);",
          "const t = term(input);",
          "const unlinked = links.filter(isUnlinked);",
          "const trashed = items.filter((i) => i.inTrash);",
        ]),
      ).toBe(false);
    });

    test("non-filesystem delete and remove that UI code uses", () => {
      expect(
        applies([
          "seen.delete(id);",
          "node.classList.remove('open');",
          "element.remove();",
          "localStorage.removeItem('draft');",
          "items.splice(index, 1);",
        ]),
      ).toBe(false);
    });

    test("timers and UI resets inside a loop", () => {
      expect(
        applies([
          "for (const id of ids) {",
          "  clearTimeout(timers.get(id));",
          "  resetForm(id);",
          "}",
        ]),
      ).toBe(false);
    });

    test("a clear call with no loop around it", () => {
      expect(applies(["await this.resetOverrides(ws.id, wanted);"])).toBe(false);
    });

    test("a clear call far below the loop header", () => {
      expect(
        applies([
          "for (const ws of workspaces) {",
          "  a();",
          "  b();",
          "  c();",
          "  d();",
          "  await this.resetOverrides(ws.id, wanted);",
        ]),
      ).toBe(false);
    });

    test("comments that name a delete", () => {
      expect(
        applies([
          "// then unlink(sourceMedia) and rm the folder",
          " * calls rmSync(dir) when done",
          "# os.remove(path) happens in cleanup",
          "-- DELETE FROM items is done by the job",
        ]),
      ).toBe(false);
    });

    test("lower-case prose in a string is not SQL", () => {
      expect(applies(['const hint = "delete from the list to hide it";'])).toBe(false);
    });

    test("an empty batch", () => {
      expect(applies([])).toBe(false);
    });
  });

  describe("file scope", () => {
    const deleting = ["await rm(dir, { recursive: true, force: true });"];

    test("test files are excluded: their rm cleans temp dirs", () => {
      for (const file of [
        "src/engine.test.ts",
        "src/engine.spec.js",
        "src/__tests__/helpers.ts",
        "test/fixtures/setup.ts",
        "e2e/clean.ts",
        "pkg/store_test.go",
        "tests/test_store.py",
        "test_store.py",
      ]) {
        expect(applies(deleting, file)).toBe(false);
      }
    });

    test("docs, styles, config and shell scripts are excluded", () => {
      const prose = ["Run rm(dir) and DELETE FROM items to reset."];
      for (const file of ["README.md", "docs/adr/0001.mdx", "styles/app.css", "package.json", "ci.yml", "build.sh", "Dockerfile"]) {
        expect(applies(prose, file)).toBe(false);
        expect(applies(deleting, file)).toBe(false);
      }
    });

    test("a source file whose name only contains 'test' as a word part still counts", () => {
      expect(applies(deleting, "src/latest/store.ts")).toBe(true);
      expect(applies(deleting, "src/contest.ts")).toBe(true);
    });
  });

  test("applies is pure and fast on a large batch", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `  const value${i} = compute(${i}, "x".repeat(40));`);
    const start = performance.now();
    const first = applies(lines);
    const again = applies(lines);
    expect(performance.now() - start).toBeLessThan(500);
    expect(first).toBe(false);
    expect(again).toBe(first);
    expect(lines).toHaveLength(20_000);
  });
});
