import { existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const PARTNERU_ORIGIN = 'https://openai-partneru.sana.ai';

/** The program to follow first. Other programs: PROGRAM_ID in .env or --program <id>. */
export const DEFAULT_PROGRAM = {
  id: 'd4d206ae-aa74-4f86-b503-d5b2fbab1a0f',
  name: 'OpenAI Technical Practitioner',
} as const;

const PROGRAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Config {
  programId: string;
  cdpPort: number;
  chromePath: string | null;
  dataDir: string;
  /** Chrome profile of this tool only (separate from the Coursera tool's). */
  profileDir: string;
  programDir: string;
  auditPath: string;
  probeDir: string;
  progressPath: string;
  notesDir: string;
  /** AI summaries (npm run summary): one file per course + program.md. */
  summariesDir: string;
  /** STUDY_LANGUAGE (default Vietnamese): language of AI summaries; course terms stay in English. */
  studyLanguage: string;
  /** AUTO_ADVANCE=1: click Continue on content cards by itself after a short countdown. */
  autoAdvance: boolean;
  /** AUTO_ADVANCE_DELAY (seconds, default 3): countdown before each automatic Continue. */
  autoDelayMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const programId = env.PROGRAM_ID?.trim() || DEFAULT_PROGRAM.id;
  // The id becomes a folder name and a URL segment: accept only a UUID.
  if (!PROGRAM_ID.test(programId)) {
    throw new Error(`PROGRAM_ID không hợp lệ: "${programId}". Lấy id dạng UUID từ URL /program/<id>.`);
  }
  const dataDir = path.join(ROOT_DIR, '.data');
  const programDir = path.join(dataDir, 'programs', programId.toLowerCase());
  return {
    programId: programId.toLowerCase(),
    // 9223, not 9222: the Coursera tool's Chrome can stay open at the same time.
    cdpPort: Number(env.CDP_PORT) || 9223,
    chromePath: env.CHROME_PATH?.trim() || detectChrome(env),
    dataDir,
    profileDir: path.join(dataDir, 'chrome-profile'),
    programDir,
    auditPath: path.join(programDir, 'audit.jsonl'),
    probeDir: path.join(programDir, 'probe'),
    progressPath: path.join(programDir, 'progress.json'),
    notesDir: path.join(programDir, 'notes'),
    summariesDir: path.join(programDir, 'summaries'),
    studyLanguage: env.STUDY_LANGUAGE?.trim() || 'Vietnamese',
    autoAdvance: /^(1|true|yes|on)$/i.test(env.AUTO_ADVANCE?.trim() ?? ''),
    autoDelayMs: Math.min(120, Math.max(1, Number(env.AUTO_ADVANCE_DELAY) || 3)) * 1000,
  };
}

function detectChrome(env: NodeJS.ProcessEnv): string | null {
  const candidates =
    process.platform === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
          .filter((dir): dir is string => Boolean(dir))
          .map((dir) => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function programUrl(config: Config): string {
  return `${PARTNERU_ORIGIN}/program/${config.programId}`;
}
