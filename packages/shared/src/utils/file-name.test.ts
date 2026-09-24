// 文件名 sanitize 走查（自 `client/src/lib/document-io.test.ts` 原样搬入——实现随卡 E2 挪到 shared）。
// 消费方：正文 md / 块 JSON 导入导出的文件名、小说文档导出的每一段名字（`novel-export.ts`）。
import { describe, expect, it } from "vitest";
import { sanitizeDocumentFileName } from "./file-name.js";

describe("sanitizeDocumentFileName（章标题 → 文件名基名）", () => {
  it("中文标题原样保留；内部点保留（「1.2 节」不是路径穿越）", () => {
    expect(sanitizeDocumentFileName("第一章 起点")).toBe("第一章 起点");
    expect(sanitizeDocumentFileName("1.2 节")).toBe("1.2 节");
  });

  it("路径分隔符与 Windows 保留字符 → 空格并折叠（导出到 Windows 必需）", () => {
    expect(sanitizeDocumentFileName('第一章/起点: a*b?c"d<e>f|g\\h')).toBe(
      "第一章 起点 a b c d e f g h",
    );
  });

  it("控制字符清除；首尾空白与首尾点清理", () => {
    expect(sanitizeDocumentFileName("a\u0000b\u001fc")).toBe("a b c");
    expect(sanitizeDocumentFileName("  .隐藏.标题.  ")).toBe("隐藏.标题");
  });

  it("空 / 纯空白 / 纯点 → 「未命名」（不能落到空文件名或 . / ..）", () => {
    expect(sanitizeDocumentFileName("")).toBe("未命名");
    expect(sanitizeDocumentFileName("   ")).toBe("未命名");
    expect(sanitizeDocumentFileName("...")).toBe("未命名");
    expect(sanitizeDocumentFileName(" . ")).toBe("未命名");
  });

  it("超长截断到 100 字符", () => {
    const cleaned = sanitizeDocumentFileName(`超长${"标".repeat(150)}`);
    expect(cleaned).toHaveLength(100);
    expect(cleaned).toBe(`超长${"标".repeat(98)}`);
  });
});
