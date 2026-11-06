/** The account table: which repositories belong to which account, and their limits. */

export interface LinkedRepository {
  repository_id: string;
  repository: string;
  limit_usd?: number;
  tags?: string[];
}

export interface Account {
  account_id: string;
  name: string;
  organization_id?: string;
  limit_usd: number;
  repositories: LinkedRepository[];
}

function positive(n: unknown, what: string): void {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new Error(`${what}: limit_usd must be a positive number`);
}

/** Parses the `ACCOUNTS_JSON` secret. Throws on a repository id in two places or a non-positive limit. */
export function parseAccounts(json: string): Account[] {
  const accounts = JSON.parse(json) as Account[];
  if (!Array.isArray(accounts)) throw new Error("accounts must be a JSON array");
  const seen = new Map<string, string>();
  for (const account of accounts) {
    positive(account.limit_usd, `account ${account.account_id}`);
    for (const repo of account.repositories) {
      const id = String(repo.repository_id);
      if (repo.limit_usd !== undefined) positive(repo.limit_usd, `repository ${id}`);
      const owner = seen.get(id);
      if (owner !== undefined) {
        throw new Error(`repository_id ${id} is linked to both ${owner} and ${account.account_id}`);
      }
      seen.set(id, account.account_id);
    }
  }
  return accounts;
}

/** The account a repository is linked to, with its link entry, or null when it is not linked. */
export function findAccount(
  accounts: Account[],
  repositoryId: string,
): { account: Account; repository: LinkedRepository } | null {
  for (const account of accounts) {
    const repository = account.repositories.find((r) => String(r.repository_id) === repositoryId);
    if (repository) return { account, repository };
  }
  return null;
}
