// pi 运行时：工具结果文本化与截断
//
// pi 只对内置工具做输出截断；自定义工具必须自己控制回填给模型的文本量，
// 否则 `get_outline` 整树 / `query_relationships` depth=3 会撑爆上下文。
// 契约（docs/design/20-context.md §2）：超上限即截断 + **显式告知**（模型必须知道数据不完整）。

/** 单条工具结果 token 上限（不可配——失控保护常量，见 docs/design/config.md） */
export const TOOL_RESULT_MAX_TOKENS = 8000;

/**
 * 保守 token 估算：ASCII 按 4 字符 ≈ 1 token，非 ASCII（CJK 等）按 1 字符 ≈ 1 token。
 * 中文真实密度约 1 字 ≈ 0.6 token——**故意高估**：预算宁可保守（截断偏早优于超窗）。
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else wide++;
  }
  return Math.ceil(ascii / 4) + wide;
}

/** 工具返回值 → 回填文本（字符串原样；其余 JSON 序列化；不可序列化 → String()） */
export function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    const json = JSON.stringify(result);
    return json === undefined ? String(result) : json;
  } catch {
    return String(result);
  }
}

/** 按 token 预算截断前缀（宽字符按 1 token 计，逐字符累计） */
function cutToTokenBudget(text: string, maxTokens: number): string {
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) < 128 ? 0.25 : 1;
    if (tokens > maxTokens) return text.slice(0, i);
  }
  return text;
}

/** 超上限 → 截断 + 结构化提示（未超限原样返回） */
export function truncateToolResultText(text: string, maxTokens: number = TOOL_RESULT_MAX_TOKENS): string {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) return text;
  const head = cutToTokenBudget(text, maxTokens);
  return `${head}\n\n[工具结果已截断：原始约 ${tokens} tokens，超出单条上限 ${maxTokens} tokens，当前数据不完整。请缩小查询范围或分页获取后重试。]`;
}
