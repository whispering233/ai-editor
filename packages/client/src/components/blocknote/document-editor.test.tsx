// 块编辑器封装的纯逻辑走查（卡 12.5）：`parseBlockContent`（块数组 JSON 字符串 → 初始块）。
// 编辑器本体（BlockNote 内部）**有意不测**：仓内无 jsdom，库内部行为由浏览器走查承担（tasks.md 卡 12.5）。
import { describe, expect, it } from "vitest";
import { parseBlockContent } from "./document-editor";

describe("parseBlockContent（空串 = 空文档；坏数据不炸页面）", () => {
  it("空串 → 空数组（服务端「从未写过」的语义）", () => {
    expect(parseBlockContent("")).toEqual([]);
  });

  it("块数组 JSON → 原样块序", () => {
    const blocks = [{ type: "paragraph", content: "第一段" }, { type: "heading", content: "标题" }];
    expect(parseBlockContent(JSON.stringify(blocks))).toEqual(blocks);
  });

  it("解析失败 / 非数组 / null → 空文档（不抛错）", () => {
    expect(parseBlockContent("{坏 JSON")).toEqual([]);
    expect(parseBlockContent('{"type":"paragraph"}')).toEqual([]);
    expect(parseBlockContent("null")).toEqual([]);
    expect(parseBlockContent("[null]")).toEqual([]); // 数组元素含 null 也不合法（shared isBlockArray 口径）
  });
});
