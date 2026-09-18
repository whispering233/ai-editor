// 参考资料页共享纯逻辑（卡 12.8）：来源取值、保存载荷、「导入 md 新建」分派。
// 页面组件不参与单测（仓内无 jsdom），故这里覆盖页面里**会出错但看不见**的分支：
// 只认 url 的来源列、空 content 不可发送（服务端 400）、导入有损必须走确认分支。
import { describe, expect, it, vi } from "vitest";
import { planReferenceImport, referenceSaveData, referenceSource } from "./reference";

describe("referenceSource（来源列：只认 url）", () => {
  it("有 url → 原样返回", () => {
    expect(referenceSource({ url: "https://example.com/a" })).toBe("https://example.com/a");
  });

  it("文件机制遗留字段（kind / file_name / source）不再是来源", () => {
    expect(referenceSource({ kind: "file", file_name: "五行.md", source: "references/x.md" })).toBe(
      "",
    );
  });

  it("无 data / url 非字符串 → 空串（列表不显示来源）", () => {
    expect(referenceSource(undefined)).toBe("");
    expect(referenceSource({ url: 42 })).toBe("");
  });
});

describe("referenceSaveData（实体 PUT 的 data 载荷）", () => {
  const form = { type: "material", tagsInput: "", url: "" };

  it("空串 content（服务端「从未写过」）不发送——发空串会被块数组浅校验拒成 400", () => {
    expect(referenceSaveData(form, "")).not.toHaveProperty("content");
    expect(referenceSaveData(form, "[]")).toEqual({ type: "material", content: "[]" });
  });

  it("url / 标签为空不发；填了才带（partial update：不发 = 保持不动）", () => {
    expect(referenceSaveData({ ...form, tagsInput: "  " }, "[]")).not.toHaveProperty("tags");
    expect(
      referenceSaveData({ type: "灵感", tagsInput: "五行, 设定", url: " https://a.test " }, "[]"),
    ).toEqual({ type: "灵感", url: "https://a.test", tags: ["五行", "设定"], content: "[]" });
  });
});

describe("planReferenceImport（导入 md 新建：frontmatter 取名 + 有损必须确认）", () => {
  /** 假编辑器：md → 块 JSON；roundTripped 与原文一致 = 无有损 */
  const lossless = (markdown: string) => ({
    content: JSON.stringify([{ markdown }]),
    roundTripped: markdown,
  });

  it("frontmatter title 作条目名，正文走导入分派", () => {
    const plan = planReferenceImport("note.md", "---\ntitle: 五行考据\n---\n正文", lossless);
    expect(plan).toEqual({
      action: "apply",
      name: "五行考据",
      content: JSON.stringify([{ markdown: "正文" }]),
    });
  });

  it("无 frontmatter：条目名 = 文件名去扩展名", () => {
    const plan = planReferenceImport("五行考据.md", "正文", lossless);
    expect(plan).toEqual({
      action: "apply",
      name: "五行考据",
      content: JSON.stringify([{ markdown: "正文" }]),
    });
  });

  it("md 往返有差异 → confirm-lossy（页面必须先弹确认，不静默丢结构）", () => {
    const parseMarkdown = vi.fn((markdown: string) => ({
      content: "[]",
      roundTripped: `${markdown}\n（库里不支持的结构被丢了）`,
    }));
    const plan = planReferenceImport("note.md", "---\ntitle: 有损笔记\n---\n第一段", parseMarkdown);
    expect(plan).toMatchObject({ action: "confirm-lossy", name: "有损笔记", unsupportedCount: 1 });
    expect(parseMarkdown).toHaveBeenCalledWith("第一段"); // frontmatter 段不进解析
  });

  it("块 JSON 不合法（.json 文件名）→ error（页面报可见错误）", () => {
    const plan = planReferenceImport("note.json", "不是块数组", lossless);
    expect(plan.action).toBe("error");
  });
});
