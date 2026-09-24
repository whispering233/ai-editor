// 文件名 sanitize（**唯一实现**：正文导入导出、小说文档导出都消费本模块）。
// **不 import zod / 不 import Node 内置**：纯函数，客户端可安全经 shared 根入口打包。

/** 文件名基名长度上限 */
const FILE_NAME_LIMIT = 100;

/**
 * 文件名 sanitize（章标题 → 文件名基名）：
 * 控制字符与 Windows 保留字符 `\ / : * ? " < > |` → 空格；折叠空白、去首尾空白与首尾点（保留内部点，
 * 如「1.2 节」）；截断 100 字符；空结果 → "未命名"。
 * 规则 = 路径分隔符/保留字符/控制字符 → 空格 + 首尾点去除 + 截断 `FILE_NAME_LIMIT`。
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
