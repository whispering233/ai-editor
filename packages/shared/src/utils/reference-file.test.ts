// 参考资料文件工具纯函数测试（决策 43，批次十一）
// 契约：doc/design/decisions.md 决策 43（frontmatter 自包含 / 文件名 sanitize 规则）
import { describe, expect, it } from "vitest";
import {
  parseReferenceFrontmatter,
  sanitizeReferenceFileName,
  serializeReferenceFile,
} from "./reference-file.js";

describe("parseReferenceFrontmatter", () => {
  it("解析完整 frontmatter（title/category/tags + 正文）", () => {
    const text = `---
title: 五行相生相克 摘抄
category: material
tags: [五行, 设定]
---
正文第一行

第二段。`;
    const r = parseReferenceFrontmatter(text);
    expect(r.title).toBe("五行相生相克 摘抄");
    expect(r.category).toBe("material");
    expect(r.tags).toEqual(["五行", "设定"]);
    expect(r.body).toBe("正文第一行\n\n第二段。");
  });

  it("无 frontmatter → 全文当正文，字段缺省", () => {
    const r = parseReferenceFrontmatter("纯 markdown 内容\n第二行");
    expect(r.title).toBeUndefined();
    expect(r.category).toBeUndefined();
    expect(r.tags).toEqual([]);
    expect(r.body).toBe("纯 markdown 内容\n第二行");
  });

  it("起始 --- 无闭合 → 容错全文当正文", () => {
    const text = `---
title: 未闭合
正文`;
    const r = parseReferenceFrontmatter(text);
    expect(r.title).toBeUndefined();
    expect(r.body).toBe(text);
  });

  it("引号值剥离 + 注释行跳过 + 未知字段保留", () => {
    const text = `---
# 备注注释
title: "带引号的标题"
category: 'theory'
tags: []
author: 张三
---
body`;
    const r = parseReferenceFrontmatter(text);
    expect(r.title).toBe("带引号的标题");
    expect(r.category).toBe("theory");
    expect(r.tags).toEqual([]);
    expect(r.body).toBe("body");
  });

  it("多行数组语法（每行一个元素）不做支持——按未知行保留", () => {
    const text = `---
tags:
  - a
  - b
---
body`;
    const r = parseReferenceFrontmatter(text);
    // 单行 key-value 解析器不识多行数组 → tags 空，行保留
    expect(r.tags).toEqual([]);
    expect(r.body).toBe("body");
  });
});

describe("serializeReferenceFile", () => {
  it("roundtrip：解析 → 序列化 → 再解析等价", () => {
    const text = `---
title: 标题
category: inspiration
tags: [a, b]
---
正文`;
    const first = parseReferenceFrontmatter(text);
    const serialized = serializeReferenceFile({
      title: first.title ?? "标题",
      category: first.category ?? "material",
      tags: first.tags,
      body: first.body,
    });
    const second = parseReferenceFrontmatter(serialized);
    expect(second.title).toBe("标题");
    expect(second.category).toBe("inspiration");
    expect(second.tags).toEqual(["a", "b"]);
    expect(second.body).toBe("正文");
  });

  it("正文空 → 不产生空行噪音；body 前导换行归一", () => {
    const s = serializeReferenceFile({ title: "t", category: "material", tags: [], body: "" });
    expect(s).toBe("---\ntitle: t\ncategory: material\ntags: []\n---\n");
    const s2 = serializeReferenceFile({
      title: "t",
      category: "material",
      tags: [],
      body: "\n\n正文",
    });
    expect(s2.endsWith("---\n\n正文\n")).toBe(true);
  });

  it("extraLines（未知字段）原样保留", () => {
    const s = serializeReferenceFile({
      title: "t",
      category: "material",
      tags: [],
      body: "b",
      extraLines: ["author: 张三"],
    });
    expect(s).toContain("author: 张三");
  });
});

describe("sanitizeReferenceFileName", () => {
  it("CJK/字母数字/空格保留", () => {
    expect(sanitizeReferenceFileName("五行相生 摘抄")).toBe("五行相生 摘抄");
    expect(sanitizeReferenceFileName("Chapter 1 Outline")).toBe("Chapter 1 Outline");
  });

  it("路径分隔符与保留字符替换", () => {
    expect(sanitizeReferenceFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
  });

  it("控制字符清理 + 连续空白折叠 + 首尾清理", () => {
    expect(sanitizeReferenceFileName("  a\u0000\u001fb   c  ")).toBe("a b c");
  });

  it("纯点/空 → 未命名", () => {
    expect(sanitizeReferenceFileName("...")).toBe("未命名");
    expect(sanitizeReferenceFileName("   ")).toBe("未命名");
    expect(sanitizeReferenceFileName("///")).toBe("未命名");
  });

  it("首尾点清理但保留内部点 + 长度截断 100", () => {
    expect(sanitizeReferenceFileName(".1.2 节.")).toBe("1.2 节");
    const long = "长".repeat(200);
    expect(sanitizeReferenceFileName(long)).toHaveLength(100);
  });
});
