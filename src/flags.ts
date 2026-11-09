/**
 * The argument parser the account and doctor commands share: positionals, `--flag value`,
 * `--flag=value` and boolean flags, with the contract's usage errors (command contract section 1).
 */
import { UsageError } from "./config";

export interface FlagSpec {
  /** Flags that take a value. */
  values: readonly string[];
  /** Flags that take none; `--flag=x` is a usage error. */
  booleans: readonly string[];
}

export interface ParsedFlags {
  positionals: string[];
  values: Record<string, string>;
  booleans: Record<string, true>;
}

/** An unknown flag, a missing value, a value on a boolean or a repeated value flag throws a UsageError naming `command`. */
export function parseFlags(argv: readonly string[], spec: FlagSpec, command: string): ParsedFlags {
  const out: ParsedFlags = { positionals: [], values: {}, booleans: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (spec.booleans.includes(name)) {
      if (eq !== -1) throw new UsageError(`${name} takes no value.`);
      out.booleans[name] = true;
    } else if (spec.values.includes(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value === "" || (eq === -1 && value.startsWith("--"))) throw new UsageError(`${name} needs a value.`);
      if (Object.hasOwn(out.values, name)) throw new UsageError(`${name} given twice.`);
      out.values[name] = value;
    } else {
      throw new UsageError(`${command} does not take ${name}.`);
    }
  }
  return out;
}
