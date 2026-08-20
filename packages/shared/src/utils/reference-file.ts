// 参考资料文件工具纯函数（决策 43，批次十一）
// 职责：md 文件（YAML frontmatter + markdown 正文）的解析/序列化 + 文件名 sanitize。
// 约束（shared 硬约束）：纯 TS 无 Node 内置模块——仅字符串处理，client 可打包。
// 契约来源：doc/design/decisions.md 决策 43（文件 = 真相源：frontmatter 自包含可重建索引）、
//   doc/database/schema.md（reference data 字段 kind/file_name/file_mtime）。
//
// frontmatter 格式（决策 43 Q1=方案 A）：
//   ---
//   title: 五行相生相克 摘抄
//   category: material
//   tags: [五行, 设定]
//   ---
//   正文 markdown…
// 解析容错：frontmatter 缺失/非法 → 按纯 markdown 处理（title=undefined、category=undefined、
//   tags=[]、body=全文），调用方兜底（title=文件名去扩展名、category=material）。

/** YAML frontmatter 边界标记（须独占一行） */
export const FRONTMATTER_DELIMITER = "---";

/** 参考文件解析结果 */
export interface ReferenceFrontmatter {
  /** frontmatter title（缺失 → undefined，调用方兜底文件名） */
  title?: string;
  /** 分类枚举（缺失 → undefined，调用方兜底 material） */
  category?: string;
  /** 标签数组（缺失/非数组 → 空数组） */
  tags: string[];
  /** 未知字段原始行（外部编辑器自定义字段，序列化时原样保留防丢失） */
  extraLines: string[];
  /** 正文（frontmatter 之后的全部内容；无 frontmatter = 全文） */
  body: string;
}

/** 提取 frontmatter 块内原始行（不含 --- 边界）与正文偏移；无 frontmatter → null */
function splitFrontmatter(text: string): { rawLines: string[]; body: string } | null {
  // 首行必须是 ---（允许前导空行？不——严格首行，Obsidian/Typora 惯例）
  if (!text.startsWith(`${FRONTMATTER_DELIMITER}\n`)) return null;
  const firstNl = text.indexOf("\n");
  const rest = text.slice(firstNl + 1);
  // 找闭合 ---（独占一行）
  const lines = rest.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      const body = lines.slice(i + 1).join("\n");
      // 去掉 body 开头单个换行（--- 闭合行后紧跟空行是惯例，保留语义不吞内容）
      // 与末尾恰一个换行（POSIX 文件末尾换行惯例；roundtrip 稳定：serialize 输出 \n → parse 去掉）
      return { rawLines: lines.slice(0, i), body: body.replace(/^\n/, "").replace(/\n$/, "") };
    }
  }
  // 有起始无闭合 → 视为无 frontmatter（容错：全文当正文）
  return null;
}

/** 解析单行 `key: value`（引号剥离：'…'/"…"；值去首尾空白；无冒号 → null） */
function parseKeyValue(line: string): { key: string; value: string } | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  const raw = line.slice(idx + 1).trim();
  if (key === "") return null;
  // 行内数组 `tags: [a, b]` → 剥离括号后逗号分片
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return { key, value: raw.slice(1, -1) };
  }
  // 引号包裹值
  const unquoted = raw.replace(/^(['"])(.*)\1$/, "$2");
  return { key, value: unquoted.trim() };
}

/**
 * 解析 md 文件文本（frontmatter + 正文；决策 43）。
 * 容错：无 frontmatter / 起始无闭合 → 全当正文；单行值数组/引号/注释行（# 开头）跳过；
 * 重复 key 后者覆盖；未知 key 忽略（title/category/tags 之外的字段不进入索引，但序列化时保留——
 * 见 serializeReferenceFile 的 extraLines 参数）。
 */
export function parseReferenceFrontmatter(text: string): ReferenceFrontmatter {
  const block = splitFrontmatter(text);
  if (block === null) return { tags: [], extraLines: [], body: text };
  let title: string | undefined;
  let category: string | undefined;
  const tags: string[] = [];
  const unknown: string[] = [];
  for (const line of block.rawLines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const kv = parseKeyValue(trimmed);
    if (kv === null) continue;
    if (kv.key === "title") title = kv.value;
    else if (kv.key === "category") category = kv.value;
    else if (kv.key === "tags") {
      tags.length = 0;
      for (const part of kv.value.split(",")) {
        const t = part.trim();
        if (t !== "") tags.push(t);
      }
    } else {
      unknown.push(line); // 保留未知行（序列化时原样写回，防外部编辑器自定义字段丢失）
    }
  }
  return { title, category, tags, extraLines: unknown, body: block.body };
}

/** 序列化参考文件全文（frontmatter + 正文；决策 43 格式） */
export function serializeReferenceFile(input: {
  title: string;
  category: string;
  tags: string[];
  body: string;
  /** 额外 frontmatter 行（未知字段保留，来自 parseReferenceFrontmatter 的 unknown 行） */
  extraLines?: readonly string[];
}): string {
  const lines: string[] = [FRONTMATTER_DELIMITER];
  lines.push(`title: ${input.title}`);
  lines.push(`category: ${input.category}`);
  lines.push(`tags: [${input.tags.join(", ")}]`);
  for (const line of input.extraLines ?? []) lines.push(line);
  lines.push(FRONTMATTER_DELIMITER);
  // 全部前导换行归一（body 空行分隔：frontmatter 后恰一个空行再进正文）
  const body = input.body.replace(/^\n+/, "");
  if (body !== "") lines.push("", body);
  return `${lines.join("\n")}\n`;
}

/**
 * 文件名 sanitize（决策 43：创建时标题作文件名；禁路径分隔符/保留字符/控制字符/纯点）。
 * 规则对齐 sanitizeBackupName（B2.6）心智：Windows 保留字符 `\ / : * ? " < > |`、控制字符、
 * 首尾空白/点、纯点（. / ..）全部清除/替换；空结果 → "未命名"；截断 100 字符（name 上限）。
 * 返回不含 .md 扩展名的基名（调用方自行拼接）。
 */
export function sanitizeReferenceFileName(name: string): string {
  // 保留 CJK/字母数字/空格/常见标点（- _ . （）【】、，。；：！？·），其余替换为空格后折叠
  const cleaned = name
    // 控制字符与路径分隔符/保留字符 → 空格
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, " ")
    // 连续空白折叠 + 首尾清理
    .replace(/\s+/g, " ")
    .trim()
    // 首尾点清理（Windows 尾点/点号问题），保留内部点（如「1.2 节」）
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 100)
    .trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") return "未命名";
  return cleaned;
}
