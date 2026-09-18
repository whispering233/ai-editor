// 「导入 md 新建」的 frontmatter 取值（卡 12.8）：纯函数走查，重点是**没把握的边界不给惊喜**
// （未闭合当普通正文、title 空回退文件名、只有 frontmatter 时正文为空串）。
// 契约：docs/api/30-api-entity.md「参考资料正文的导入导出」。
import { describe, expect, it } from "vitest";
import { fileNameWithoutExtension, parseReferenceFrontmatter } from "./reference-frontmatter";

describe("parseReferenceFrontmatter（frontmatter title → 条目名，其余为正文）", () => {
  it("有 frontmatter：取 title 作条目名，正文 = 闭合行之后的部分", () => {
    const text = "---\ntitle: 五行考据\ntags: 设定\n---\n\n# 正文标题\n\n段落。";
    expect(parseReferenceFrontmatter("note.md", text)).toEqual({
      name: "五行考据",
      body: "\n# 正文标题\n\n段落。",
    });
  });

  it("无 frontmatter：条目名 = 文件名去扩展名，正文原样（含 CRLF 不改写）", () => {
    const text = "# 五行考据\r\n\r\n段落。";
    expect(parseReferenceFrontmatter("五行 考据.markdown", text)).toEqual({
      name: "五行 考据",
      body: text,
    });
  });

  it("frontmatter 未闭合（只有开头 `---`）：整篇当正文，不猜 frontmatter", () => {
    const text = "---\ntitle: 五行考据\n\n这就是正文";
    expect(parseReferenceFrontmatter("note.md", text)).toEqual({ name: "note", body: text });
  });

  it("title 带成对引号：剥引号（单双引号都认）", () => {
    expect(parseReferenceFrontmatter("a.md", '---\ntitle: "五行考据"\n---\n正文').name).toBe(
      "五行考据",
    );
    expect(parseReferenceFrontmatter("a.md", "---\ntitle: '灵感：雨夜'\n---\n正文").name).toBe(
      "灵感：雨夜",
    );
  });

  it("title 为空 / 只有键没值：回退文件名（不产生空名条目）", () => {
    expect(parseReferenceFrontmatter("note.md", "---\ntitle:\n---\n正文").name).toBe("note");
    expect(parseReferenceFrontmatter("note.md", '---\ntitle: ""\n---\n正文').name).toBe("note");
  });

  it("只有 frontmatter 没有正文：正文 = 空串（POST 不携带 content = 未写过）", () => {
    expect(parseReferenceFrontmatter("note.md", "---\ntitle: 空笔记\n---")).toEqual({
      name: "空笔记",
      body: "",
    });
  });

  it("frontmatter 里的 tags/category 不解析（有意口径：只认 title）", () => {
    const text = "---\ntags: 五行, 设定\ncategory: 素材摘抄\n---\n正文";
    expect(parseReferenceFrontmatter("note.md", text)).toEqual({ name: "note", body: "正文" });
  });
});

describe("fileNameWithoutExtension（文件名兜底名）", () => {
  it(".md / .markdown（不分大小写）去扩展名；无扩展名原样", () => {
    expect(fileNameWithoutExtension("note.md")).toBe("note");
    expect(fileNameWithoutExtension("note.MARKDOWN")).toBe("note");
    expect(fileNameWithoutExtension("note.txt")).toBe("note.txt");
  });

  it("去完为空（文件名就是 .md）→ 原名兜底，不产生空名", () => {
    expect(fileNameWithoutExtension(".md")).toBe(".md");
  });
});
