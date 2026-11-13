/**
 * The terminal session of the wizards, on Clack through the `Ui` seam. It keeps the contract of the
 * plain session in `./prompt.ts` (defaults, `null` on cancel, an earlier cancel ends the whole
 * session) and adds what only a terminal can show: the mascot intro, a framed session, a spinner,
 * notes and an outro. It never reads or writes a file and holds no wizard logic.
 */
import { playIntro } from "./mascot";
import type { Choice, Outcome, Prompter, PromptIO } from "./prompt";
import { describeCommand, terminalStyle, type Tone } from "./style";
import type { LogKind, Ui } from "./ui";

type Terminal = NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (mode: boolean) => unknown };
type TerminalOut = NodeJS.WritableStream & { isTTY?: boolean; columns?: number };

const toOptions = <T>(choices: Choice<T>[]) => choices.map((c, i) => ({ value: i, label: c.label, hint: c.description }));

export function createFancyPrompter(io: PromptIO, env: Record<string, string | undefined>, ui: Ui): Prompter {
  const output = io.output as TerminalOut;
  const paint = terminalStyle(output, env);
  const next: { note: string; commands: string[] }[] = [];
  let cancelled = false;
  let closed = false;

  const log = (kind: LogKind, text: string) => ui.log(kind, text);
  const say = (line: string, tone?: Tone) => {
    // The frame puts its own space between blocks, so an empty line would only widen it.
    if (line === "") return;
    if (tone === "success") return log("success", line);
    if (tone === "warning") return log("warn", line);
    if (tone === "error") return log("error", line);
    log("message", tone ? paint(line, tone) : line);
  };

  const pick = async <T>(ask: typeof ui.select, label: string, choices: Choice<T>[], defaultIndex: number): Promise<T | null> => {
    // An earlier Ctrl-C (also during the intro) ends the whole session.
    if (cancelled) return null;
    const index = await ask({ message: label, options: toOptions(choices), initial: defaultIndex });
    if (index === null) {
      cancelled = true;
      return null;
    }
    return choices[index].value;
  };

  return {
    fancy: true,
    say,
    report: (line, kind) => log(kind === "success" ? "success" : kind === "warning" ? "warn" : "message", line),
    note: (body, title) => ui.note(body, title),
    step(label, index, total) {
      log("step", `${label}  ${paint(`step ${index}${total === undefined ? "" : ` of ${total}`}`, "muted")}`);
    },
    // Clack owns the terminal only while a question is open, so there is nothing to hand back.
    suspend() {},
    select: (label, choices, defaultIndex) => pick((o) => ui.select(o), label, choices, defaultIndex),
    autocomplete: (label, choices, defaultIndex) => pick((o) => ui.autocomplete({ ...o, placeholder: "Type to filter" }), label, choices, defaultIndex),
    async text(label, defaultValue, validate) {
      if (cancelled) return null;
      const answer = await ui.text({
        message: label,
        placeholder: defaultValue ? defaultValue : undefined,
        defaultValue,
        validate: (value) => validate?.(value),
      });
      if (answer === null) {
        cancelled = true;
        return null;
      }
      return answer.trim() === "" && defaultValue !== undefined ? defaultValue : answer.trim();
    },
    async confirm(label, defaultYes) {
      if (cancelled) return null;
      const answer = await ui.confirm({ message: label, initial: defaultYes });
      if (answer === null) cancelled = true;
      return answer;
    },
    async intro(version, line) {
      // A caller that already played it (the launcher, before it dispatches) marks the environment.
      if (env.WACHIMAN_INTRO_DONE) return;
      const result = await playIntro({ ui, term: { input: io.input as Terminal, output }, env, version, line });
      if (result === "interrupted") {
        output.write("\n");
        cancelled = true;
      }
    },
    async task(label, work, ok) {
      const spinner = ui.spinner();
      spinner.start(label);
      try {
        const result = await work();
        if (ok ? ok(result) : true) spinner.stop(label);
        else spinner.fail(`${label}: needs attention`);
        return result;
      } catch (error) {
        spinner.fail(label);
        throw error;
      }
    },
    nextStep(command, note) {
      next.push({ note: note ? note[0].toUpperCase() + note.slice(1) : describeCommand(command), commands: [command] });
    },
    nextAction(note, commands = []) {
      next.push({ note, commands });
    },
    close(outcome: Outcome = "done", message?: string) {
      if (closed) return;
      closed = true;
      if (next.length > 0) {
        ui.note(
          next
            .flatMap((n, i) => [`${i + 1}. ${n.note}`, ...n.commands.map((c) => `     ${paint(c, "accent")}`)])
            .join("\n"),
          "Next steps",
        );
      }
      next.length = 0;
      if (outcome === "done") ui.outro(message ?? `${paint("Wachi:", "brand")} All set. I'll keep the watch.`);
      else ui.cancel(message ?? (outcome === "cancelled" ? "Cancelled." : "Stopped."));
    },
  };
}
