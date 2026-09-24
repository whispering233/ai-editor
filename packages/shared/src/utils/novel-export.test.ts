// 小说文档导出纯函数走查：条目路径拼接（卷内章 / 无可见章的卷空目录 / 直挂 root 章）、空卷名 / 空章名、
// 书名段 sanitize（含 `/` 与超长）、软删卷与软删章不出现、章正文组装、zip 下载文件名。
// 契约：`docs/api/10-api-project.md` §`GET /api/v1/project/export-novel`；编号来源 = `numberVisibleOutline`。
import { describe, expect, it } from "vitest";
import type { OutlineTree } from "../types/outline.js";
import { numberVisibleOutline } from "./outline-numbering.js";
import {
  buildNovelChapterMarkdown,
  buildNovelExportEntries,
  novelExportZipFileName,
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
