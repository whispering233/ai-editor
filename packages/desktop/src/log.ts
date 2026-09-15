// 桌面版日志落盘（`docs/design/50-desktop.md` §2）。
//
// 为什么必须有：桌面版用户没有终端，出问题时 `console.*` 的输出无处可看——日志文件是唯一线索。
// 实现 = 拦截 console 三个方法，**同时**写 stdout（dev 态仍可见）与追加写日志文件；不引日志库。
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** 单条日志里单个值的最长字符数（防 BigInt/大对象把日志刷爆；超出截断并标注） */
const MAX_VALUE_CHARS = 2000;

/** 日志文件路径：`<userData>/logs/ai-editor.log` */
export function logFilePath(userDataDir: string): string {
  return join(userDataDir, "logs", "ai-editor.log");
}

/** 单个值的字符串化：Error 取 stack（无 stack 退 message），其余走 JSON / String */
function formatValue(value: unknown): string {
  let text: string;
  if (value instanceof Error) {
    text = value.stack ?? `${value.name}: ${value.message}`;
  } else if (typeof value === "object" && value !== null) {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value); // 循环引用等
    }
  } else {
    text = String(value);
  }
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…[truncated]` : text;
}

/** 把一次调用的参数拼成一行（多参数空格分隔） */
export function formatLogArgs(args: unknown[]): string {
  return args.map(formatValue).join(" ");
}

/** 一行完整日志：`<ISO 时间> [级别] 内容` */
export function formatLogLine(level: string, args: unknown[], at: Date = new Date()): string {
  return `${at.toISOString()} [${level}] ${formatLogArgs(args)}\n`;
}

/**
 * 把 console.log/warn/error 同时写进日志文件（stdout 行为不变）。
 * 写盘失败（磁盘满、权限）静默——日志写不进去不该影响创作主流程。
 *
 * 用**同步追加**而非写流：桌面版日志频率低（启动几条 + 错误），而「写即落盘」在崩溃现场
 * 比吞吐量重要——写流缓冲里的最后几行往往正是死因。
 */
export function redirectConsoleToFile(file: string): void {
  mkdirSync(dirname(file), { recursive: true });

  const levels: Array<["log" | "warn" | "error", string]> = [
    ["log", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];
  for (const [method, level] of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      try {
        appendFileSync(file, formatLogLine(level, args));
      } catch {
        // 静默：日志不可用不阻断
      }
    };
  }
}
