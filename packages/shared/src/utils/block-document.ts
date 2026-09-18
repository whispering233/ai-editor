// 块文档（块编辑器原生块数组）纯函数（卡片 12.3）
//
// 契约：docs/db/schema.md「document_records — 块文档表」、docs/api/110-api-manuscript.md。
// 真相 = `content`（块数组 JSON 字符串），派生 = `content_text`（服务端从 `content` 重算的
// 轻量 md 投影，供 AI 读取/列表摘要/搜索/字数）。
// **投影派生必须容错**：未知块跳过、结构错乱跳过、整体 try/catch 兜底——派生失败不得阻断保存。
// 纯 TS、零 Node 依赖，客户端可经 shared 根入口打包。

/**
 * 投影递归深度上限：防循环引用 / 畸形深层嵌套把投影拖爆栈。
 * 正常文档远达不到；超出即停（宁可少抽，不可抛错）。
 */
const MAX_PROJECTION_DEPTH = 200;

/** 列表项类型（其 children 缩进两空格）——唯一拼写 */
const LIST_ITEM_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 浅校验：是数组、且每项为非 null 对象。
 *
 * **不做块级 schema 校验**（块格式归编辑器所有，见 docs/db/schema.md「写入校验」）——
 * 写入侧据此回 400；投影侧不依赖本函数（走 `blocksToPlainMd` 的逐块容错）。
 */
export function isBlockArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((item) => isObject(item));
}

/** inline content → 文本：`text` 取 text；`link` → `[文本](href)`；其余元素忽略 */
function inlineToMd(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const item of content) {
    if (!isObject(item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      text += item.text;
    } else if (item.type === "link") {
      const label = inlineToMd(item.content);
      text += typeof item.href === "string" ? `[${label}](${item.href})` : label;
    }
  }
  return text;
}

/** 表格单元格：GFM 表格里裸 `|` 与换行会破表，转义/压平 */
function tableCellToMd(cell: unknown): string {
  return inlineToMd(cell).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/** tableContent → GFM 表格（首行作表头） */
function tableToMd(content: Record<string, unknown>): string {
  const rows = Array.isArray(content.rows) ? content.rows : [];
  const lines: string[] = [];
  for (const row of rows) {
    if (!isObject(row) || !Array.isArray(row.cells)) continue;
    const cells = row.cells.map(tableCellToMd).join(" | ");
    if (lines.length === 0) {
      lines.push(`| ${cells} |`, `| ${row.cells.map(() => "---").join(" | ")} |`);
    } else {
      lines.push(`| ${cells} |`);
    }
  }
  return lines.join("\n");
}

/**
 * 单块 → md 文本（含缩进）；未知类型 / 结构错乱 → `""`（调用方跳过该块，但其 children 仍投影）。
 * `marker` = 列表项前缀（`- ` / `1. ` / `- [x] `），仅列表项类型使用。
 */
function renderBlock(
  type: string,
  block: Record<string, unknown>,
  indent: string,
  marker: string,
): string {
  const props = isObject(block.props) ? block.props : {};
  switch (type) {
    case "paragraph":
      return indent + inlineToMd(block.content);
    case "heading": {
      const raw = typeof props.level === "number" ? Math.trunc(props.level) : 1;
      const level = Math.min(6, Math.max(1, raw));
      return `${indent}${"#".repeat(level)} ${inlineToMd(block.content)}`;
    }
    case "bulletListItem":
    case "numberedListItem":
    case "checkListItem":
      return indent + marker + inlineToMd(block.content);
    case "quote": {
      const lines = inlineToMd(block.content).split("\n");
      return lines.map((line) => (line === "" ? `${indent}>` : `${indent}> ${line}`)).join("\n");
    }
    case "codeBlock": {
      const language = typeof props.language === "string" ? props.language : "";
      return `${indent}\`\`\`${language}\n${inlineToMd(block.content)}\n${indent}\`\`\``;
    }
    case "divider":
      return `${indent}---`;
    case "image": {
      const caption = typeof props.caption === "string" ? props.caption : "";
      const alt = caption !== "" ? caption : typeof props.name === "string" ? props.name : "";
      return `${indent}![${alt}](${typeof props.url === "string" ? props.url : ""})`;
    }
    case "table":
      return isObject(block.content) && block.content.type === "tableContent"
        ? tableToMd(block.content)
        : "";
    default:
      return "";
  }
}

/**
 * 逐块投影（容错：坏元素跳过）。`counters` 按层级记同层连续编号（遇到非编号块即重起）——
 * 「同层序号」口径：每个 children 数组自成一个列表作用域，作用域内首项必从 1 起。
 */
function walk(blocks: unknown[], depth: number, counters: number[], out: string[]): void {
  if (depth > MAX_PROJECTION_DEPTH) return;
  const indent = "  ".repeat(depth);
  let continuingNumberedRun = false;
  for (const block of blocks) {
    if (!isObject(block)) {
      continuingNumberedRun = false;
      continue;
    }
    const type = typeof block.type === "string" ? block.type : "";
    const isListItem = LIST_ITEM_TYPES.has(type);
    let marker = "";
    if (type === "numberedListItem") {
      if (!continuingNumberedRun) counters[depth] = 0;
      counters[depth] = (counters[depth] ?? 0) + 1;
      marker = `${counters[depth]}. `;
    } else if (type === "checkListItem") {
      marker = isObject(block.props) && block.props.checked === true ? "- [x] " : "- [ ] ";
    } else if (type === "bulletListItem") {
      marker = "- ";
    }
    continuingNumberedRun = type === "numberedListItem";

    const text = renderBlock(type, block, indent, marker);
    if (text.trim() !== "") out.push(text);

    const children = Array.isArray(block.children) ? block.children : [];
    if (children.length > 0) walk(children, isListItem ? depth + 1 : depth, counters, out);
  }
}

/**
 * 块数组 → 轻量 md 投影（`content_text` 的唯一生成函数）。
 *
 * **绝不抛错**：非数组输入 → `""`；坏块跳过；循环引用/超深嵌套按深度上限截断；
 * 整体 try/catch 兜底（外层失败返回已累积文本）。块之间空行分隔、结果首尾 trim。
 */
export function blocksToPlainMd(blocks: unknown): string {
  const chunks: string[] = [];
  try {
    if (Array.isArray(blocks)) walk(blocks, 0, [], chunks);
  } catch {
    // 兜底：投影失败不得阻断保存（docs/db/schema.md「投影单一写入人」）
  }
  return chunks.join("\n\n").trim();
}
