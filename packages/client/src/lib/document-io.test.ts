// 正文导入导出通用件（卡 12.6）走查：md 往返有损判定、块 JSON 浅校验 / 空文档分支、
// 导入分派（坏 JSON → 可见错误 / md 有损 → 先确认 / 无差异 → 直接覆盖）。契约 docs/api/110-api-manuscript.md「导入导出（无端点）」。
// （文件名 sanitize 的用例已随实现搬到 shared `utils/file-name.test.ts`）
// 「块 JSON ↔ md」由持有编辑器实例的一侧以函数参数传入，本文件用 stub 替代（仓内无 jsdom，真实互转
// 与下载的系统文件行为由浏览器走查承担——同 tasks.md 卡 12.5 口径）。
import { describe, expect, it } from "vitest";
import {
  exportDocumentJson,
  exportDocumentMarkdown,
  MARKDOWN_LOSSY_NOTICE,
  markdownImportCheck,
  markdownImportConfirmMessage,
  parseDocumentJson,
  planDocumentImport,
  readTextFile,
} from "./document-io";

describe("exportDocumentJson（无损，可再导入）", () => {
  it('空文档（空串 / 纯空白）→ body 用 "[]"（空串不是合法 JSON，导回去会被浅校验拒）', () => {
    expect(exportDocumentJson("", "第一章")).toEqual({ fileName: "第一章.json", body: "[]" });
    expect(exportDocumentJson("   ", "第一章").body).toBe("[]");
  });

  it("非空内容原样（不重新序列化：保格式、保未知字段）", () => {
    const content = '[{"type":"paragraph","content":"含引号 \\"x\\" 的正文"}]';
    expect(exportDocumentJson(content, "第一章 起点")).toEqual({
      fileName: "第一章 起点.json",
      body: content,
    });
  });

  it("文件名走 sanitize（章标题含保留字符也能落地）", () => {
    expect(exportDocumentJson("[]", "第一章 / 起点").fileName).toBe("第一章 起点.json");
  });
});

describe("exportDocumentMarkdown（有损：文件名 + 有损提示）", () => {
  it("文件名 = 章标题 + .md；正文来自调用点传入的「块 → md」转换", () => {
    const calls: string[] = [];
    const file = exportDocumentMarkdown("[]", "第一章 / 起点", (content) => {
      calls.push(content);
      return "# 标题\n\n第一段\n";
    });
    expect(file).toEqual({ fileName: "第一章 起点.md", body: "# 标题\n\n第一段\n" });
    expect(calls).toEqual(["[]"]); // 转换拿到的就是待导出内容（本文件不自己解析块）
  });

  it("有损提示文案覆盖 md 的四种无表达结构（导出前必须给用户看）", () => {
    for (const word of ["颜色", "对齐", "嵌套", "媒体"]) {
      expect(MARKDOWN_LOSSY_NOTICE).toContain(word);
    }
  });
});

describe("markdownImportCheck（原文 vs 解析后回写的往返比对）", () => {
  it("完全一致 → 不报有损", () => {
    const text = "# 标题\n\n第一段\n";
    expect(markdownImportCheck(text, text)).toEqual({ lossy: false, unsupportedCount: 0 });
  });

  it("仅换行差异（CRLF / 行尾空白 / 连续空行 / 文件首尾空行）→ 不报有损", () => {
    const original = "\r\n# 标题  \r\n\r\n\r\n第一段\t\r\n";
    const roundTripped = "# 标题\n\n第一段";
    expect(markdownImportCheck(original, roundTripped)).toEqual({
      lossy: false,
      unsupportedCount: 0,
    });
  });

  it("颜色（HTML 行内样式）与嵌套（缩进）无法回写 → 报有损并给出条数", () => {
    // 原文两处 md 表达不了：颜色包裹 + 非列表块的子块缩进（导出 md 时会被摊平）
    const original = '<span style="color:red">红字</span>\n\n母块\n  子块\n';
    const roundTripped = "红字\n\n母块\n子块\n";
    expect(markdownImportCheck(original, roundTripped)).toEqual({
      lossy: true,
      unsupportedCount: 2,
    });
  });

  it("行数不同（段落被合并/丢弃）也计入差异条数", () => {
    expect(markdownImportCheck("第一段\n第二段\n", "第一段\n")).toEqual({
      lossy: true,
      unsupportedCount: 1,
    });
  });

  it("确认文案列出条数（不静默丢结构）", () => {
    expect(markdownImportConfirmMessage(3)).toBe("含 3 处编辑器不支持的结构，继续将丢弃这些");
  });
});

describe("parseDocumentJson（导入浅校验：isBlockArray 口径）", () => {
  it("合法块数组原样通过（含空数组）", () => {
    const content = '[{"type":"paragraph","content":"正文"}]';
    expect(parseDocumentJson(content)).toBe(content);
    expect(parseDocumentJson("[]")).toBe("[]");
  });

  it("坏 JSON / 非数组 / 元素含 null → null（调用点据此报可见错误）", () => {
    expect(parseDocumentJson("{坏 JSON")).toBeNull();
    expect(parseDocumentJson('{"type":"paragraph"}')).toBeNull();
    expect(parseDocumentJson("null")).toBeNull();
    expect(parseDocumentJson("[null]")).toBeNull();
  });
});

describe("planDocumentImport（导入分派：json 浅校验 / md 往返比对）", () => {
  const parsedBlockJson = '[{"type":"paragraph","content":"导入的正文"}]';
  /** 编辑器解析 stub（真实互转由浏览器走查保证）：content 固定，roundTripped 由用例给 */
  function parseStub(roundTripped: string | ((markdown: string) => string)) {
    return (markdown: string) => ({
      content: parsedBlockJson,
      roundTripped: typeof roundTripped === "function" ? roundTripped(markdown) : roundTripped,
    });
  }

  it(".json 合法 → 直接落地（内容原样，不重写）", () => {
    expect(planDocumentImport("章.json", ` ${parsedBlockJson} `, parseStub(""))).toEqual({
      action: "apply",
      content: ` ${parsedBlockJson} `,
    });
  });

  it(".json 坏内容 → error（页面报可见错误，不静默覆盖）", () => {
    expect(planDocumentImport("章.JSON", "{坏", parseStub(""))).toEqual({
      action: "error",
      message: "文件不是合法的块 JSON（应为块数组）",
    });
  });

  it(".md 无差异 → 直接覆盖编辑器内容", () => {
    expect(planDocumentImport("章.md", "# 标题\n", parseStub("# 标题\n"))).toEqual({
      action: "apply",
      content: parsedBlockJson,
    });
  });

  it(".md / .txt 有差异 → confirm-lossy（列条数；用户确认前不落地）", () => {
    const lossy = parseStub("红字\n"); // 编辑器回写时丢掉 HTML 颜色包裹
    expect(planDocumentImport("章.md", '<span style="color:red">红字</span>\n', lossy)).toEqual({
      action: "confirm-lossy",
      content: parsedBlockJson,
      unsupportedCount: 1,
    });
    expect(planDocumentImport("章.txt", "红字\n", parseStub(""))).toEqual({
      action: "confirm-lossy",
      content: parsedBlockJson,
      unsupportedCount: 1,
    });
  });
});

describe("readTextFile（<input type=\"file\"> 的 File → 文本）", () => {
  it("按 UTF-8 读全文（含中文与换行）", async () => {
    const file = new File(["第一段\n第二段\n"], "章.md", { type: "text/markdown" });
    await expect(readTextFile(file)).resolves.toBe("第一段\n第二段\n");
  });
});
