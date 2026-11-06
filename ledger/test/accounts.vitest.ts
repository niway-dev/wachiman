import { describe, expect, it } from "vitest";
import { findAccount, parseAccounts } from "../src/accounts";

const table = JSON.stringify([
  {
    account_id: "a1",
    name: "Acme",
    limit_usd: 10,
    repositories: [
      { repository_id: "1", repository: "acme/app", limit_usd: 4, tags: ["web"] },
      { repository_id: "2", repository: "acme/api" },
    ],
  },
  { account_id: "a2", name: "Solo", limit_usd: 5, repositories: [{ repository_id: "3", repository: "me/tool" }] },
]);

describe("accounts", () => {
  it("resolves each repository to its account", () => {
    const accounts = parseAccounts(table);
    expect(findAccount(accounts, "1")?.account.account_id).toBe("a1");
    expect(findAccount(accounts, "1")?.repository.limit_usd).toBe(4);
    expect(findAccount(accounts, "3")?.account.account_id).toBe("a2");
  });

  it("returns null for an unknown repository id", () => {
    expect(findAccount(parseAccounts(table), "999")).toBeNull();
  });

  it("throws naming a repository id linked to two accounts", () => {
    const dup = JSON.stringify([
      { account_id: "a1", name: "A", limit_usd: 1, repositories: [{ repository_id: "7", repository: "x/y" }] },
      { account_id: "a2", name: "B", limit_usd: 1, repositories: [{ repository_id: "7", repository: "x/y" }] },
    ]);
    expect(() => parseAccounts(dup)).toThrow(/7/);
  });

  it("throws on a non-positive limit", () => {
    const zero = JSON.stringify([{ account_id: "a1", name: "A", limit_usd: 0, repositories: [] }]);
    expect(() => parseAccounts(zero)).toThrow(/limit_usd/);
    const repoZero = JSON.stringify([
      { account_id: "a1", name: "A", limit_usd: 1, repositories: [{ repository_id: "1", repository: "x/y", limit_usd: -1 }] },
    ]);
    expect(() => parseAccounts(repoZero)).toThrow(/limit_usd/);
  });
});
