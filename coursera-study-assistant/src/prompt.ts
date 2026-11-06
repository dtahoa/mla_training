import * as readline from 'node:readline/promises';

export const INTERRUPTED = '\u0000quit';

export interface Prompt {
  ask(question: string): Promise<string>;
  confirm(question: string): Promise<boolean>;
  close(): void;
}

/** Line-based prompt. Ctrl+C or closed stdin resolve to INTERRUPTED instead of killing the process. */
export function createPrompt(): Prompt {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });

  async function ask(question: string): Promise<string> {
    if (closed) return INTERRUPTED;
    const controller = new AbortController();
    const onSigint = () => controller.abort();
    rl.once('SIGINT', onSigint);
    try {
      return (await rl.question(question, { signal: controller.signal })).trim();
    } catch {
      return INTERRUPTED;
    } finally {
      rl.off('SIGINT', onSigint);
    }
  }

  return {
    ask,
    async confirm(question) {
      return /^(y|yes|c|co|có)$/i.test(await ask(`${question} (y/N) `));
    },
    close: () => rl.close(),
  };
}
