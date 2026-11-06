import { existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const COURSERA_ORIGIN = 'https://www.coursera.org';

export interface Config {
  courseSlug: string;
  cdpPort: number;
  chromePath: string | null;
  dataDir: string;
  profileDir: string;
  courseDir: string;
  progressPath: string;
  auditPath: string;
  sourcesDir: string;
  notesDir: string;
  probeDir: string;
  quizLogPath: string;
  studyLanguage: string;
  maxModules: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const courseSlug = env.COURSE_SLUG?.trim() || 'the-ai-transformation-advisor';
  const dataDir = path.join(ROOT_DIR, '.data');
  const courseDir = path.join(dataDir, 'courses', courseSlug);
  return {
    courseSlug,
    cdpPort: Number(env.CDP_PORT) || 9222,
    chromePath: env.CHROME_PATH?.trim() || detectChrome(env),
    dataDir,
    profileDir: path.join(dataDir, 'chrome-profile'),
    courseDir,
    progressPath: path.join(courseDir, 'progress.json'),
    auditPath: path.join(courseDir, 'audit.jsonl'),
    sourcesDir: path.join(courseDir, 'sources'),
    notesDir: path.join(courseDir, 'notes'),
    probeDir: path.join(courseDir, 'probe'),
    quizLogPath: path.join(courseDir, 'quiz-results.jsonl'),
    studyLanguage: env.STUDY_LANGUAGE?.trim() || 'Vietnamese',
    maxModules: Number(env.MAX_MODULES) || 12,
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

export function courseUrl(config: Config, suffix = ''): string {
  return `${COURSERA_ORIGIN}/learn/${config.courseSlug}${suffix}`;
}
