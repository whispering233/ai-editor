// 块编辑器封装的纯逻辑走查（卡 12.5）：`parseBlockContent`（块数组 JSON 字符串 → 初始块）。
// 编辑器本体（BlockNote 内部）**有意不测**：仓内无 jsdom，库内部行为由浏览器走查承担（tasks.md 卡 12.5）。
// ⚠ 关键口径 = 空缺内容一律 `undefined`：`[]` 会让 BlockNote 直接抛
// `Error creating document from blocks passed as \`initialContent\``（真事故：新章「写正文」整页被错误边界接管）。
import { describe, expect, it } from "vitest";
import { parseBlockContent } from "./document-editor";

describe("parseBlockContent（空缺内容 = undefined，交 BlockNote 默认空段落；坏数据不炸页面）", () => {
  it("空串 → undefined（服务端「从未写过」的语义；空数组会让编辑器崩）", () => {
    expect(parseBlockContent("")).toBeUndefined();
  });

  it('"[]"（合法但长度为 0 的块数组）→ undefined（本次真事故的回归用例）', () => {
    expect(parseBlockContent("[]")).toBeUndefined();
  });

  it("块数组 JSON → 原样块序", () => {
    const blocks = [{ type: "paragraph", content: "第一段" }, { type: "heading", content: "标题" }];
    expect(parseBlockContent(JSON.stringify(blocks))).toEqual(blocks);
  });

  it("解析失败 / 非数组 / null → undefined（不抛错）", () => {
    expect(parseBlockContent("{坏 JSON")).toBeUndefined();
    expect(parseBlockContent('{"type":"paragraph"}')).toBeUndefined();
    expect(parseBlockContent("null")).toBeUndefined();
    expect(parseBlockContent("[null]")).toBeUndefined(); // 数组元素含 null 也不合法（shared isBlockArray 口径）
  });
});
