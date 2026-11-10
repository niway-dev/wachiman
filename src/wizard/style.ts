/** Terminal colors are an enhancement: labels carry the meaning in plain output. */
export type Tone = "accent" | "muted" | "success" | "warning" | "error";

const CODES: Record<Tone, number> = { accent: 36, muted: 2, success: 32, warning: 33, error: 31 };

export function terminalStyle(output: { isTTY?: boolean }, env: Record<string, string | undefined>) {
  const color = output.isTTY === true && env.NO_COLOR === undefined && env.TERM !== "dumb";
  return (text: string, tone: Tone) => color ? `\x1b[${CODES[tone]}m${text}\x1b[0m` : text;
}

/** Only human-facing stderr is decorated; stdout remains byte-for-byte data. */
export function wizardIo<T extends { stderr: (line: string) => void }>(io: T, output: { isTTY?: boolean }, env: Record<string, string | undefined>): T {
  const paint = terminalStyle(output, env);
  return { ...io, stderr: (line: string) => {
    const tone = /^(bound:|wrote |account: signed in|All required checks passed|local: ready)/.test(line) ? "success"
      : /^(warning:|cancelled:|not written|nothing saved|These already happened|local: not ready|github: pending)/.test(line) ? "warning" : undefined;
    io.stderr(tone ? paint(line, tone) : line);
  } };
}
