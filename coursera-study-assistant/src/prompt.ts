import * as readline from 'node:readline/promises';

export const INTERRUPTED = '\u0000quit';

export interface Prompt {
  /** Ask one line. Aborting `signal` cancels the question (resolves INTERRUPTED). */
  ask(question: string, signal?: AbortSignal): Promise<string>;
  /** Yes/no question. Enter with no input takes `defaultYes` (default: no). */
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  close(): void;
}

const YES = /^(y|yes|c|co|có)$/i;

/** Enter takes the default; Ctrl+C / closed stdin is always "no". */
export function confirmAnswer(input: string, defaultYes: boolean): boolean {
  if (input === INTERRUPTED) return false;
  if (input === '') return defaultYes;
  return YES.test(input);
}

export function promptFromAsk(
  ask: (question: string, signal?: AbortSignal) => Promise<string>,
  close: () => void = () => undefined,
): Prompt {
  return {
    ask,
    async confirm(question, defaultYes = false) {
      return confirmAnswer(await ask(`${question} ${defaultYes ? '(Y/n)' : '(y/N)'} `), defaultYes);
    },
    close,
  };
}

/** Line-based prompt. Ctrl+C or closed stdin resolve to INTERRUPTED instead of killing the process. */
export function createPrompt(): Prompt {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });

  async function ask(question: string, signal?: AbortSignal): Promise<string> {
    if (closed) return INTERRUPTED;
    const controller = new AbortController();
    const onSigint = () => controller.abort();
    rl.once('SIGINT', onSigint);
    try {
      const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      return (await rl.question(question, { signal: combined })).trim();
    } catch {
      return INTERRUPTED;
    } finally {
      rl.off('SIGINT', onSigint);
    }
  }

  return promptFromAsk(ask, () => rl.close());
}
