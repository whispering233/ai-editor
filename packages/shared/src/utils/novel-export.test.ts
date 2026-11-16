// 小说导出纯函数走查（md zip + 整本 TXT）：条目路径拼接（卷内章 / 无可见章的卷空目录 / 直挂 root 章）、
// 空卷名 / 空章名、书名段 sanitize（含 `/` 与超长）、软删卷与软删章不出现、章正文组装、下载文件名；
// TXT 的两种排版、CRLF / 末尾换行、标题原始名。契约：`docs/api/10-api-project.md`
// §`GET /api/v1/project/export-novel` / §`GET /api/v1/project/export-novel-txt`；编号来源 = `numberVisibleOutline`。
import { describe, expect, it } from "vitest";
import type { OutlineTree } from "../types/outline.js";
import { numberVisibleOutline } from "./outline-numbering.js";
import {
  buildNovelChapterMarkdown,
  buildNovelExportEntries,
  buildNovelTxt,
  NOVEL_TXT_LAYOUTS,
  novelExportZipFileName,
  novelTxtFileName,
  type NovelTxtBlock,
} from "./novel-export.js";

const T = "2026-09-01T10:00:00Z";

/**
 * 用例树（书名「我的书」）：vol-1「第一卷」→ ch-1「起点」/ ch-2（**空章名**）；
 * vol-empty（**空卷名**、无章）；vol-soft（软删整卷，含 ch-s1）；vol-2「第二卷」→ ch-3 / ch-d1（软删章）；
 * ch-9（存量直挂 root）。
 */
function tree(): OutlineTree {
  return {
    id: "root",
    type: "root",
    schemaVersion: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updatedAt: T,
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "起点",
            updatedAt: T,
            children: [{ id: "sc-1", type: "scene", title: "场景一", updatedAt: T }],
          },
          { id: "ch-2", type: "chapter", title: "  ", updatedAt: T },
        ],
      },
      { id: "vol-empty", type: "volume", title: "  ", updatedAt: T },
      {
        id: "vol-soft",
        type: "volume",
        title: "软删卷",
        updatedAt: T,
        deleted: true,
        children: [{ id: "ch-s1", type: "chapter", title: "软删卷内章", updatedAt: T }],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updatedAt: T,
        children: [
          { id: "ch-3", type: "chapter", title: "第三章", updatedAt: T },
          { id: "ch-d1", type: "chapter", title: "软删章", updatedAt: T, deleted: true },
        ],
      },
      { id: "ch-9", type: "chapter", title: "直挂章", updatedAt: T },
    ],
  };
}

const entries = () => buildNovelExportEntries("我的书", numberVisibleOutline(tree()));

describe("buildNovelExportEntries（zip 条目：路径 + 顺序）", () => {
  it("顺序 = 卷序 → 卷内章序 → 直挂 root 章；无可见章的卷产空目录条目；软删卷/软删章不出现", () => {
    expect(entries()).toEqual([
      {
        kind: "chapter",
        path: "我的书/第1卷 第一卷/第1章 起点.md",
        chapterId: "ch-1",
        chapterLabel: "第1章",
        chapterTitle: "起点",
      },
      {
        kind: "chapter",
        path: "我的书/第1卷 第一卷/第2章.md",
        chapterId: "ch-2",
        chapterLabel: "第2章",
        chapterTitle: "  ",
      },
      { kind: "dir", path: "我的书/第2卷/" }, // 空卷名 → 只留标签；卷下无章 → 空目录条目
      {
        kind: "chapter",
        path: "我的书/第3卷 第二卷/第3章 第三章.md",
        chapterId: "ch-3",
        chapterLabel: "第3章",
        chapterTitle: "第三章",
      },
      {
        kind: "chapter",
        path: "我的书/第4章 直挂章.md", // 直挂 root 章：不进任何卷目录，章号照常连续
        chapterId: "ch-9",
        chapterLabel: "第4章",
        chapterTitle: "直挂章",
      },
    ]);
  });

  it("有可见章的卷不产目录条目（目录由条目名隐含）", () => {
    const dirs = entries().filter((entry) => entry.kind === "dir");
    expect(dirs).toHaveLength(1);
  });

  it("软删卷与软删章的名字不出现在任何条目（编号侧已过滤）", () => {
    const paths = entries().map((entry) => entry.path);
    expect(paths.some((path) => path.includes("软删卷") || path.includes("软删卷内章"))).toBe(false);
    expect(paths.some((path) => path.includes("软删章"))).toBe(false);
  });

  it("书名段经 sanitize：`/` → 空格、超长截断（每一段都不带路径分隔符）", () => {
    const numbering = numberVisibleOutline(tree());
    expect(buildNovelExportEntries("我的/书", numbering)[0].path).toBe(
      "我的 书/第1卷 第一卷/第1章 起点.md",
    );
    const long = buildNovelExportEntries(`超长${"名".repeat(150)}`, numbering)[0].path;
    expect(long.split("/")[0]).toHaveLength(100);
  });

  it("卷名 / 章名段经 sanitize（保留字符不逃逸目录）", () => {
    const dirty: OutlineTree = {
      id: "root",
      type: "root",
      schemaVersion: 1,
      children: [
        {
          id: "vol-1",
          type: "volume",
          title: "第一卷/上",
          updatedAt: T,
          children: [{ id: "ch-1", type: "chapter", title: "起点:1", updatedAt: T }],
        },
      ],
    };
    expect(buildNovelExportEntries("我的书", numberVisibleOutline(dirty))[0].path).toBe(
      "我的书/第1卷 第一卷 上/第1章 起点 1.md",
    );
  });

  it("无卷无章（空树）→ 空条目（服务端据可见章数另行 400）", () => {
    expect(buildNovelExportEntries("我的书", numberVisibleOutline(null))).toEqual([]);
  });
});

describe("buildNovelChapterMarkdown（章文件正文）", () => {
  it("标题行 + 一个空行 + 正文原样", () => {
    expect(buildNovelChapterMarkdown("第1章", "起点", "第一段\n\n第二段\n")).toBe(
      "# 第1章 起点\n\n第一段\n\n第二段\n",
    );
  });

  it("章名 trim 后为空 → `# 第M章`（不留尾随空格）", () => {
    expect(buildNovelChapterMarkdown("第2章", "  ", "正文")).toBe("# 第2章\n\n正文");
  });

  it("空正文 → 只留标题行，无尾随换行（空章仍产出文件）", () => {
    expect(buildNovelChapterMarkdown("第1章", "起点", "")).toBe("# 第1章 起点");
    expect(buildNovelChapterMarkdown("第1章", "起点", "\n\n")).toBe("# 第1章 起点");
  });

  it("标题用原始章名（trim 后，不走 sanitize——md 标题不是文件名）", () => {
    expect(buildNovelChapterMarkdown("第1章", " 起点/上 ", "")).toBe("# 第1章 起点/上");
  });
});

describe("novelExportZipFileName（下载文件名）", () => {
  it("`{sanitize(书名)}-小说文档.zip`", () => {
    expect(novelExportZipFileName("我的书")).toBe("我的书-小说文档.zip");
    expect(novelExportZipFileName("我的/书")).toBe("我的 书-小说文档.zip");
  });
});

// ============ 整本纯文本（TXT） ============
// 契约：`docs/api/10-api-project.md` §`GET /api/v1/project/export-novel-txt`。块由调用方按阅读序
// 排好（卷标题 / 章标题 + 正文），本模块只负责排版、CRLF 与末尾换行。

/** 阅读序块：卷 1 → 章 1（两段）/ 章 2（空章）→ 卷 2 → 章 3（存量直挂 root 的章） */
const txtBlocks: NovelTxtBlock[] = [
  { kind: "volume", label: "第1卷 风起" },
  { kind: "chapter", label: "第1章 初见", text: "第一段。\n\n第二段。" },
  { kind: "chapter", label: "第2章 空白", text: "" },
  { kind: "volume", label: "第2卷 云涌" },
  { kind: "chapter", label: "第3章 直挂", text: "直挂正文" },
];

describe("buildNovelTxt（整本 TXT：preserve）", () => {
  it("标题行不带 `#`；块与正文段落之间各一个空行；空章只留标题行", () => {
    expect(buildNovelTxt(txtBlocks, "preserve")).toBe(
      [
        "第1卷 风起",
        "",
        "第1章 初见",
        "",
        "第一段。",
        "",
        "第二段。",
        "",
        "第2章 空白",
        "",
        "第2卷 云涌",
        "",
        "第3章 直挂",
        "",
        "直挂正文",
      ].join("\r\n") + "\r\n",
    );
  });

  it("换行统一 CRLF（输入 `\\n` / `\\r\\n` / `\\r` 混合）且末尾只有一个换行", () => {
    const text = buildNovelTxt(
      [{ kind: "chapter", label: "第1章 起点", text: "一\r\n二\n三\r四" }],
      "preserve",
    );
    expect(text).toBe("第1章 起点\r\n\r\n一\r\n二\r\n三\r\n四\r\n");
    expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(text.endsWith("\r\n\r\n")).toBe(false);
  });

  it("正文原样（段间空行保留），只去掉正文末尾空白（不与下一块的空行叠加）", () => {
    const text = buildNovelTxt(
      [
        { kind: "chapter", label: "第1章 起点", text: "第一段\n\n\n第二段\n\n" },
        { kind: "chapter", label: "第2章 继续", text: "继续" },
      ],
      "preserve",
    );
    expect(text).toBe("第1章 起点\r\n\r\n第一段\r\n\r\n\r\n第二段\r\n\r\n第2章 继续\r\n\r\n继续\r\n");
  });

  it("标题用原始名：`:` / `/` 不 sanitize（sanitize 只用于文件名）", () => {
    const text = buildNovelTxt(
      [
        { kind: "volume", label: "第1卷 上/下:序" },
        { kind: "chapter", label: "第1章 起点/上:1", text: "正文" },
      ],
      "preserve",
    );
    expect(text).toContain("第1卷 上/下:序\r\n");
    expect(text).toContain("第1章 起点/上:1\r\n");
  });

  it("块顺序 = 阅读序（存量直挂 root 的章可以排在卷前，不重排）", () => {
    const text = buildNovelTxt(
      [
        { kind: "chapter", label: "第1章 直挂章", text: "直挂正文" },
        { kind: "volume", label: "第1卷 风起" },
        { kind: "chapter", label: "第2章 卷一章", text: "卷内正文" },
      ],
      "preserve",
    );
    expect(text.indexOf("第1章 直挂章")).toBe(0);
    expect(text.indexOf("第1卷 风起")).toBeLessThan(text.indexOf("第2章 卷一章"));
  });

  it("无块 → 空串（服务端另有「无可见章 → 400」，不产空文件）", () => {
    expect(buildNovelTxt([], "preserve")).toBe("");
  });
});

describe("buildNovelTxt（整本 TXT：webnovel）", () => {
  it("普通段落两个全角空格、连续段落不空行；非段落块原样且前后空行；代码围栏内不缩进", () => {
    const text = buildNovelTxt(
      [
        {
          kind: "chapter",
          label: "第1章 起点",
          text: [
            "第一段",
            "",
            "第二段",
            "",
            "- 列表一",
            "- 列表二",
            "",
            "```",
            "const a = 1;",
            "",
            "const b = 2;",
            "```",
            "",
            "引用前",
            "",
            "> 引用",
            "",
            "第三段",
          ].join("\n"),
        },
      ],
      "webnovel",
    );
    expect(text).toBe(
      [
        "第1章 起点",
        "",
        "　　第一段",
        "　　第二段",
        "",
        "- 列表一",
        "- 列表二",
        "",
        "```",
        "const a = 1;",
        "",
        "const b = 2;",
        "```",
        "",
        "　　引用前",
        "",
        "> 引用",
        "",
        "　　第三段",
      ].join("\r\n") + "\r\n",
    );
  });

  it("卷 / 章标题前后各一个空行、标题不缩进；空章只有标题行", () => {
    expect(buildNovelTxt(txtBlocks, "webnovel")).toBe(
      [
        "第1卷 风起",
        "",
        "第1章 初见",
        "",
        "　　第一段。",
        "　　第二段。",
        "",
        "第2章 空白",
        "",
        "第2卷 云涌",
        "",
        "第3章 直挂",
        "",
        "　　直挂正文",
      ].join("\r\n") + "\r\n",
    );
  });
});

describe("novelTxtFileName（TXT 下载文件名）", () => {
  it("`{sanitize(书名)}.txt` / `{sanitize(书名)}-网文.txt`", () => {
    expect(novelTxtFileName("我的书", "preserve")).toBe("我的书.txt");
    expect(novelTxtFileName("我的书", "webnovel")).toBe("我的书-网文.txt");
  });

  it("书名 sanitize（`/` → 空格）；空书名 / 纯空白 / 纯点 → 未命名", () => {
    expect(novelTxtFileName("我的/书", "preserve")).toBe("我的 书.txt");
    expect(novelTxtFileName("", "webnovel")).toBe("未命名-网文.txt");
    expect(novelTxtFileName("   ", "preserve")).toBe("未命名.txt");
    expect(novelTxtFileName("...", "preserve")).toBe("未命名.txt");
  });
});

describe("NOVEL_TXT_LAYOUTS", () => {
  it("两种排版（`preserve` 默认口径 / `webnovel` 网文），顺序即文案顺序", () => {
    expect(NOVEL_TXT_LAYOUTS).toEqual(["preserve", "webnovel"]);
  });
});
