import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Append-only JSONL log of what the tool did (never cookie values or page text). */
export class AuditLog {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async log(event: string, detail: Record<string, unknown> = {}): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify({ ts: new Date().toISOString(), event, ...detail })}\n`, 'utf8');
  }
}
