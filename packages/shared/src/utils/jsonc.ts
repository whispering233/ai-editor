// jsonc（pi `models.json` 的宽松 JSON）单一实现：去 `//` 注释与尾逗号 + 解析 + 丢失处数
//
// 语义与 pi `dist/utils/json.js` 的 `stripJsonComments` 一致：去 `//` 行注释与尾逗号，
// **字符串字面量不动**。pi 不从包根导出该函数，这里按同一语义实现——**升级 pi 时复查**
// （服务端配置校验 `checkConfigFileText` 依赖这份口径；客户端模型表单卡 3b 起才接线）。
//
// **不支持 `/* */` 块注释**（与 pi 一致）：块注释会被原样保留，随后 `parseJsonc` 解析失败，
// 报的就是 JSON.parse 的语法错误——不要为了「宽容」自己加一层块注释剥离。
//
// `countJsoncLosses` 与 `stripJsonComments` 共用 `stripJsonc`（同一套正则），不另写语义：
// 「会不会丢注释 / 尾逗号」与「丢了几处」必须永远是同一个答案。

/** 字符串字面量 | `//` 行注释（字符串分支整体回填，故 `"https://x"` 里的 `//` 不是注释） */
const COMMENT_PATTERN = /"(?:\\.|[^"\\])*"|\/\/[^\n]*/g;

/** 字符串字面量 | 尾逗号（逗号后仅空白再跟 `}` / `]`；捕获组回填空白与括号） */
const TRAILING_COMMA_PATTERN = /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g;

/** 去注释与尾逗号，顺带数出被去掉的处数（唯一实现） */
function stripJsonc(input: string): { text: string; losses: number } {
  let losses = 0;
  const text = input
    .replace(COMMENT_PATTERN, (m) => {
      if (m[0] === '"') return m;
      losses += 1;
      return "";
    })
    .replace(TRAILING_COMMA_PATTERN, (m, tail: string | undefined) => {
      if (tail === undefined) return m[0] === '"' ? m : "";
      losses += 1;
      return tail;
    });
  return { text, losses };
}

/** 去 `//` 注释与尾逗号（字符串字面量原样保留） */
export function stripJsonComments(input: string): string {
  return stripJsonc(input).text;
}

/** 被去掉的注释 / 尾逗号处数（0 = 文本本身就是严格 JSON，保存不会丢东西） */
export function countJsoncLosses(input: string): number {
  return stripJsonc(input).losses;
}

/** jsonc 解析结果：成功给值，失败给可读 reason（不抛） */
export type JsoncParseResult = { ok: true; value: unknown } | { ok: false; reason: string };

/** `stripJsonComments` + `JSON.parse`；BOM 直接去掉（编辑器 / Windows 常见） */
export function parseJsonc(text: string): JsoncParseResult {
  try {
    return { ok: true, value: JSON.parse(stripJsonComments(text.replace(/^\uFEFF/, ""))) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}