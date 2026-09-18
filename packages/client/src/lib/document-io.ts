// 正文导入导出通用件（卡 12.6）：纯函数 + 极薄 DOM 封装（导出 md / 块 JSON，导入 md / 块 JSON）。
// 契约：docs/api/110-api-manuscript.md「导入导出（无端点）」——**纯客户端、不新增端点**；
// 浏览器形态与桌面形态同一套实现（`<input type="file">` 读文本 + `Blob` + `<a download>`），不加 preload 能力。
//
// 分层：本文件**不 import 任何 @blocknote 模块**——「块 JSON ↔ markdown」只能由持有编辑器实例的一侧做
// （components/blocknote/document-editor.tsx 的 `DocumentEditorApi`），以函数参数传进来；
// 本文件只负责文件名 sanitize、有损判定与提示文案，故 node 环境可测（仓内无 jsdom，编辑器本体不参与单测）。
// 对话框/下载的**渲染**部分（confirm 弹层、真实文件对话框）由页面接线 + 浏览器走查承担。
import { isBlockArray } from "@whispering233/ai-editor-shared";

/** 导出/导入载荷（文件名 + 文本） */
export interface DocumentFile {
  fileName: string;
  body: string;
}

/** 文件名基名长度上限（与参考资料导入的文件名 sanitize 同规则） */
const FILE_NAME_LIMIT = 100;

/**
 * 文件名 sanitize（章标题 → 文件名基名）：
 * 控制字符与 Windows 保留字符 `\ / : * ? " < > |` → 空格；折叠空白、去首尾空白与首尾点（保留内部点，
 * 如「1.2 节」）；截断 100 字符；空结果 → "未命名"。
 * 规则与 `lib/reference-frontmatter.ts` 的条目名 sanitize 同款（路径分隔符/保留字符/控制字符/首尾点，限长 100）。
 */
export function sanitizeDocumentFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, FILE_NAME_LIMIT)
    .trim();
  return cleaned === "" ? "未命名" : cleaned;
}

/** 导出块 JSON（**无损**：原样导出，可再导入）；空串 = 空文档 → `"[]"`（空串不是合法 JSON，导回去会报错） */
export function exportDocumentJson(content: string, title: string): DocumentFile {
  return {
    fileName: `${sanitizeDocumentFileName(title)}.json`,
    body: content.trim() === "" ? "[]" : content,
  };
}

/** markdown 导出的有损清单（导出前必须提示用户；docs/api/110-api-manuscript.md「导出」条款） */
export const MARKDOWN_LOSSY_NOTICE = "颜色、对齐、块嵌套与媒体不会写入 md";

/**
 * 导出 markdown（**有损**：颜色/对齐/块嵌套/媒体在 md 中无对应表达——调用点必须先让用户确认）。
 * `blocksToMarkdown` = 持有编辑器实例的一侧提供的「块 JSON → md」（本文件不 import @blocknote/core）。
 */
export function exportDocumentMarkdown(
  content: string,
  title: string,
  blocksToMarkdown: (content: string) => string,
): DocumentFile {
  return {
    fileName: `${sanitizeDocumentFileName(title)}.md`,
    body: blocksToMarkdown(content),
  };
}

/** 导入浅校验：文本 → 原样块数组 JSON；解析失败 / 非块数组（`isBlockArray` 口径）→ null（调用点报可见错误） */
export function parseDocumentJson(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isBlockArray(parsed) ? text : null;
  } catch {
    return null;
  }
}

/** markdown 往返比对结果 */
export interface MarkdownImportCheck {
  /** true = 解析回来的内容与原文不一致（编辑器不支持的结构，导入会丢） */
  lossy: boolean;
  /** 差异条数（归一化后逐行比对；确认文案「含 N 处…」用） */
  unsupportedCount: number;
}

/**
 * markdown 归一化（**刻意只做三件**，避免把有损差异洗成「无差异」）：
 * CRLF→LF、逐行去行尾空白、连续空行折叠为一行（含文件首尾的空行——末尾换行差异不算有损）。
 */
function normalizeMarkdown(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line === "" && lines[lines.length - 1] === "") continue; // 连续空行折叠
    lines.push(line);
  }
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * md 导入有损判定：原文 vs 编辑器解析后再回写（round-trip）的 md。
 * 不相等 ⇒ 存在无法导入的结构（颜色/对齐/嵌套/媒体等），**必须提示用户确认，不静默丢弃**。
 */
export function markdownImportCheck(originalText: string, roundTripped: string): MarkdownImportCheck {
  const before = normalizeMarkdown(originalText);
  const after = normalizeMarkdown(roundTripped);
  let unsupportedCount = Math.abs(before.length - after.length);
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    if (before[i] !== after[i]) unsupportedCount += 1;
  }
  return { lossy: unsupportedCount > 0, unsupportedCount };
}

/** 导入 md 的有损确认文案（「含 N 处编辑器不支持的结构，继续将丢弃这些」） */
export function markdownImportConfirmMessage(unsupportedCount: number): string {
  return `含 ${unsupportedCount} 处编辑器不支持的结构，继续将丢弃这些`;
}

/** 导入落地动作（页面按 action 分派：直接覆盖 / 先弹确认 / 报可见错误） */
export type DocumentImportPlan =
  | { action: "apply"; content: string }
  | { action: "confirm-lossy"; content: string; unsupportedCount: number }
  | { action: "error"; message: string };

/**
 * 导入分派：`.json`（不分大小写）→ 块 JSON 浅校验；其余（.md / .txt / 无扩展名）→ markdown 往返比对。
 * 返回 plan 而不直接落地：**有损时必须由用户确认**，页面据 action 决定是否弹确认框。
 */
export function planDocumentImport(
  fileName: string,
  text: string,
  parseMarkdown: (markdown: string) => { content: string; roundTripped: string },
): DocumentImportPlan {
  if (fileName.toLowerCase().endsWith(".json")) {
    const content = parseDocumentJson(text);
    return content === null
      ? { action: "error", message: "文件不是合法的块 JSON（应为块数组）" }
      : { action: "apply", content };
  }
  const parsed = parseMarkdown(text);
  const check = markdownImportCheck(text, parsed.roundTripped);
  return check.lossy
    ? { action: "confirm-lossy", content: parsed.content, unsupportedCount: check.unsupportedCount }
    : { action: "apply", content: parsed.content };
}

/** 下载文本文件（Blob + 临时 `<a download>`）；只在浏览器环境调用（桌面形态同一套，无原生能力） */
export function downloadTextFile({ fileName, body }: DocumentFile): void {
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 下一帧 revoke：下载发起前 revoke 会中断下载（同 Dashboard 导出备份的防御）
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 读取用户选择的文本文件（`<input type="file">` 的 File → 文本；编码同写侧 UTF-8） */
export function readTextFile(file: File): Promise<string> {
  return file.text();
}
