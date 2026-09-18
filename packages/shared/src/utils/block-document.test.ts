// 块文档纯函数测试（卡片 12.3）
// 覆盖：全部启用块型（段落/标题/无序/有序/任务/引用/代码/分隔/图/表格）+ 嵌套列表缩进 +
// inline link + 未知块跳过（children 仍投影）+ 坏输入（非数组/字符串/null/缺 children/循环引用）。
import { describe, expect, it } from "vitest";
import { blocksToPlainMd, isBlockArray } from "./block-document.js";

/** 造文本 inline 元素（块级内容的最小合法形状） */
function text(value: string) {
  return [{ type: "text", text: value, styles: {} }];
}

/** 造块（默认段落；children 缺省 = 无） */
function block(type: string, props: Record<string, unknown>, content: unknown, children?: unknown[]) {
  const value: Record<string, unknown> = { id: `b-${type}`, type, props, content };
  if (children) value.children = children;
  return value;
}

describe("isBlockArray（浅校验）", () => {
  it("空数组 / 对象元素数组 → true", () => {
    expect(isBlockArray([])).toBe(true);
    expect(isBlockArray([{}])).toBe(true);
    expect(isBlockArray([{ type: "paragraph" }, { type: "image" }])).toBe(true);
  });

  it("非数组 / 含 null 或原始值 → false", () => {
    expect(isBlockArray("[]")).toBe(false);
    expect(isBlockArray(null)).toBe(false);
    expect(isBlockArray(undefined)).toBe(false);
    expect(isBlockArray({})).toBe(false);
    expect(isBlockArray([null])).toBe(false);
    expect(isBlockArray([1])).toBe(false);
    expect(isBlockArray([{ type: "paragraph" }, null])).toBe(false);
  });
});

describe("blocksToPlainMd（各块型）", () => {
  it("段落 / 标题（含默认级别与越界级别夹取到 6）", () => {
    const md = blocksToPlainMd([
      block("paragraph", {}, text("第一段")),
      block("heading", { level: 2 }, text("二级")),
      block("heading", { level: 9 }, text("越界")),
      block("heading", {}, text("缺 level")),
    ]);
    expect(md).toBe(["第一段", "## 二级", "###### 越界", "# 缺 level"].join("\n\n"));
  });

  it("无序 / 有序 / 任务列表（同层序号 + 勾选态）", () => {
    const md = blocksToPlainMd([
      block("bulletListItem", {}, text("苹果")),
      block("numberedListItem", {}, text("一")),
      block("numberedListItem", {}, text("二")),
      block("checkListItem", { checked: true }, text("已办")),
      block("checkListItem", { checked: false }, text("未办")),
      block("checkListItem", {}, text("缺 checked")),
      block("numberedListItem", {}, text("中途重起")),
    ]);
    expect(md).toBe(
      [
        "- 苹果",
        "1. 一",
        "2. 二",
        "- [x] 已办",
        "- [ ] 未办",
        "- [ ] 缺 checked",
        "1. 中途重起",
      ].join("\n\n"),
    );
  });

  it("引用（每行前缀）/ 代码块（语言围栏）/ 分隔线", () => {
    const md = blocksToPlainMd([
      block("quote", {}, text("行一\n行二")),
      block("codeBlock", { language: "ts" }, text("const a = 1;")),
      block("codeBlock", {}, text("无语言")),
      block("divider", {}, undefined),
    ]);
    expect(md).toBe(
      ["> 行一\n> 行二", "```ts\nconst a = 1;\n```", "```\n无语言\n```", "---"].join("\n\n"),
    );
  });

  it("图片（caption 优先，回退 name）", () => {
    const md = blocksToPlainMd([
      block("image", { url: "https://x/y.png", caption: "图说", name: "未用" }, undefined),
      block("image", { url: "https://x/z.png", name: "文件名.png" }, undefined),
      block("image", {}, undefined),
    ]);
    expect(md).toBe(
      [
        "![图说](https://x/y.png)",
        "![文件名.png](https://x/z.png)",
        "![]()",
      ].join("\n\n"),
    );
  });

  it("表格 → GFM（首行表头 + 转义 | 与换行）", () => {
    const md = blocksToPlainMd([
      block(
        "table",
        {},
        {
          type: "tableContent",
          columnWidths: [200, 200],
          rows: [
            { cells: [text("列A"), text("列B")] },
            { cells: [text("a|b"), text("c\n换行")] },
          ],
        },
      ),
    ]);
    expect(md).toBe(["| 列A | 列B |", "| --- | --- |", "| a\\|b | c 换行 |"].join("\n"));
  });

  it("inline link → [文本](href)", () => {
    const md = blocksToPlainMd([
      block(
        "paragraph",
        {},
        [{ type: "text", text: "见", styles: {} }, { type: "link", href: "https://a.b", content: text("这里") }],
      ),
    ]);
    expect(md).toBe("见[这里](https://a.b)");
  });

  it("嵌套列表：每层缩进两空格", () => {
    const md = blocksToPlainMd([
      block("bulletListItem", {}, text("父"), [
        block("bulletListItem", {}, text("子"), [block("bulletListItem", {}, text("孙"))]),
      ]),
    ]);
    expect(md).toBe(["- 父", "  - 子", "    - 孙"].join("\n\n"));
  });
});

describe("blocksToPlainMd（容错）", () => {
  it("空数组 / 坏输入 → 空串且不抛错", () => {
    expect(blocksToPlainMd([])).toBe("");
    expect(blocksToPlainMd(null)).toBe("");
    expect(blocksToPlainMd(undefined)).toBe("");
    expect(blocksToPlainMd("[]")).toBe("");
    expect(blocksToPlainMd({})).toBe("");
    expect(blocksToPlainMd(42)).toBe("");
  });

  it("未知块跳过，但其 children 继续投影；本仓未启用块型不崩", () => {
    const md = blocksToPlainMd([
      block("mysteryBlock", {}, text("丢弃")),
      block("toggleListItem", {}, text("丢弃"), [block("paragraph", {}, text("折叠里的段"))]),
      block("audio", { url: "https://x/a.mp3" }, undefined),
      block("file", { url: "https://x/f.pdf" }, undefined),
      block("video", { url: "https://x/v.mp4" }, undefined),
    ]);
    expect(md).toBe("折叠里的段");
  });

  it("坏元素 / 缺 children / 缺 content / 坏表格 → 跳过不抛", () => {
    const md = blocksToPlainMd([
      null,
      "raw",
      17,
      block("paragraph", {}, undefined),
      block("paragraph", {}, "字符串 content"),
      { id: "no-type" },
      block("table", {}, { type: "tableContent", rows: "坏" }),
      block("table", {}, undefined),
      block("paragraph", {}, text("末尾正常")),
    ]);
    expect(md).toBe("末尾正常");
  });

  it("循环引用 / 超深嵌套 → 不抛错（深度上限截断）", () => {
    const cyclic: Record<string, unknown> = block("bulletListItem", {}, text("环"), []);
    (cyclic.children as unknown[]).push(cyclic);
    expect(() => blocksToPlainMd([cyclic])).not.toThrow();
    expect(blocksToPlainMd([cyclic])).toContain("环");

    let deep: Record<string, unknown> = block("bulletListItem", {}, text("底"));
    for (let i = 0; i < 500; i += 1) deep = block("bulletListItem", {}, text(`层${i}`), [deep]);
    expect(() => blocksToPlainMd([deep])).not.toThrow();
  });
});
