import { DEFAULT_PROGRAM, loadConfig, programUrl, type Config } from './config.ts';
import { isLoggedIn, openSession, waitForLogin } from './browser.ts';
import { runProbe } from './probe.ts';
import { printStatus, runSync } from './sync.ts';
import { runStudy } from './study.ts';
import { runBackfill } from './backfill.ts';
import { runSummary } from './summary.ts';

const HELP = `PartnerU Study Assistant (human-in-the-loop) — mặc định: ${DEFAULT_PROGRAM.name}

  npm run login              Mở Chrome (profile riêng) để bạn tự đăng nhập OpenAI PartnerU
  npm run sync               Lấy danh sách bước + tiến độ của program
  npm run status             Xem tiến độ (offline, từ lần sync cuối)
  npm run study              Học từng thẻ: lưu ghi chú, Continue; dừng ở Final Exam / Feedback
  npm run backfill           Lưu ghi chú cho thẻ bạn đã học ngoài tool (tab nền)   [-- --course 1]
  npm run summary            AI tóm tắt từ ghi chú: từng course + cả program       [-- --course 1]
  npm run probe              Báo cáo cấu trúc trang program/course/player + API  [-- --screenshots]

  Mọi lệnh nhận thêm -- --program <id> để chạy cho program khác (thay PROGRAM_ID trong .env).

Không bao giờ: đọc / trả lời / bỏ qua knowledge check, quiz, exam hay bài thi chứng chỉ;
giả lập xem video; điền Feedback; nhập mật khẩu.
"Continue" chỉ bấm trên thẻ nội dung (khi bạn nhấn Enter, hoặc tự động nếu AUTO_ADVANCE=1) và thẻ video (khi bạn nhấn Enter).`;

interface Flags {
  screenshots: boolean;
  /** --program <id>: work on another program for this one command (overrides PROGRAM_ID). */
  program?: string;
  /** --course <n>: only program step n (backfill, summary). */
  course?: number;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { screenshots: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--screenshots') flags.screenshots = true;
    else if (arg === '--program') flags.program = args[++i]?.trim() || undefined;
    else if (arg === '--course') {
      const value = Number(args[++i]);
      flags.course = Number.isInteger(value) && value > 0 ? value : undefined;
    }
  }
  return flags;
}

async function login(config: Config): Promise<void> {
  const session = await openSession(config, programUrl(config));
  try {
    if ((await isLoggedIn(session.page)) || (await waitForLogin(session, programUrl(config)))) {
      console.log('✓ Đã đăng nhập. Session được giữ trong partneru-study-assistant/.data/chrome-profile (đã gitignore).');
    } else {
      console.log('✖ Hết thời gian chờ đăng nhập.');
      process.exitCode = 1;
    }
  } finally {
    await session.disconnect();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const config = loadConfig(flags.program ? { ...process.env, PROGRAM_ID: flags.program } : process.env);

  switch (command) {
    case 'login':
      return login(config);
    case 'probe': {
      const report = await runProbe(config, { screenshots: flags.screenshots });
      console.log(`\n📄 Probe report: ${report}`);
      return;
    }
    case 'sync':
      return runSync(config);
    case 'study':
      return runStudy(config);
    case 'backfill':
      return runBackfill(config, { course: flags.course });
    case 'summary':
      return runSummary(config, { course: flags.course });
    case 'status':
      return printStatus(config);
    default:
      console.log(HELP);
  }
}

main().catch((error: unknown) => {
  console.error(`✖ ${(error as Error).message}`);
  process.exitCode = 1;
});
