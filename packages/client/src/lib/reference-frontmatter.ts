// 「导入 md 新建」的 frontmatter 取值（卡 12.8）：shared 的 frontmatter 工具已随文件机制退役（卡 12.7b），
// 这里按新契约做**本地最小实现**——只回答一件事：从 markdown 文本里取条目名 + 正文。
// 契约（docs/api/30-api-entity.md「参考资料正文的导入导出」）：文本以 `---` 行开头且存在闭合 `---` 行时，
// 块内 `title:` 值 = 条目名、闭合行之后的部分 = 正文；**不解析 tags/category**；无 frontmatter 用文件名去扩展名。
// 纯函数（node 环境可测）：md → 块的重活在持有编辑器实例的一侧（lib/document-io 的 planDocumentImport）。

/** frontmatter 段内的 title 行（键大小写不敏感；值可带成对引号） */
const TITLE_LINE = /^title\s*:\s*(.*)$/i;

/** 文件名去扩展名（`.md` / `.markdown`，不分大小写）；去完为空（如文件名就是 ".md"）→ 原名兜底 */
export function fileNameWithoutExtension(fileName: string): string {
  const base = fileName.replace(/\.(md|markdown)$/i, "").trim();
  return base === "" ? fileName : base;
}

/** title 值：去首尾空白 + 剥成对引号；剥完为空 → null（用文件名兜底） */
function normalizeTitle(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2")
    .trim();
  return value === "" ? null : value;
}

/** frontmatter 段内首个 title 行的值；没有该行或值为空 → null */
function readTitle(frontmatterLines: string[]): string | null {
  for (const line of frontmatterLines) {
    const matched = TITLE_LINE.exec(line);
    if (matched !== null) return normalizeTitle(matched[1]);
  }
  return null;
}

/**
 * 拆「条目名 + 正文」：
 * - 首行是 `---`（容忍 BOM / CRLF）且其后还有一行 `---` → frontmatter 块；名字取块内 `title`（空/无 → 文件名），
 *   正文 = 闭合行之后的原文（不改写、不 trim——首行空行留给编辑器解析）
 * - 无 frontmatter / 未闭合（只有开头没有结尾）→ 名字 = 文件名去扩展名，正文 = 原文（frontmatter 猜测不做）
 */
export function parseReferenceFrontmatter(
  fileName: string,
  text: string,
): { name: string; body: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const fallbackName = fileNameWithoutExtension(fileName);
  if (lines[0]?.trim() !== "---") return { name: fallbackName, body: text };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing === -1) return { name: fallbackName, body: text };
  return {
    name: readTitle(lines.slice(1, closing)) ?? fallbackName,
    body: lines.slice(closing + 1).join("\n"),
  };
}
