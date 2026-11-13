/** Test helper: reads back the curl configuration (`--config -`) that `src/ledger.ts` writes to stdin. */
const UNESCAPES: Record<string, string> = { "\\": "\\", '"': '"', t: "\t", n: "\n", r: "\r", v: "\v" };

export function readCurlConfig(stdin: string | undefined): { headers: string[]; data?: string } {
  const out: { headers: string[]; data?: string } = { headers: [] };
  for (const line of (stdin ?? "").split("\n")) {
    const match = /^([a-z-]+) = "(.*)"$/.exec(line);
    if (!match) continue;
    const value = match[2]!.replace(/\\(.)/g, (_, c: string) => UNESCAPES[c] ?? c);
    if (match[1] === "header") out.headers.push(value);
    else if (match[1] === "data") out.data = value;
  }
  return out;
}

/** The text on every request that must stay out of argv: the config on stdin plus the argument list. */
export const everythingIn = (args: string[], stdin: string | undefined): string => `${args.join("\n")}\n${stdin ?? ""}`;
