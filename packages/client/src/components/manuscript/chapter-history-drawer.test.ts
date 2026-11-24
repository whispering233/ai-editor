// 章历史抽屉（C2）的守卫：叶子列表组件 SSR 走查（空态 / 行文案）+ 组件源码对恢复链路的关键断言。
// 为什么源码扫描：仓内无 jsdom / @testing-library（同 chapter-editor.test.ts 口径），抽屉的异步链路
//（confirm → flush → POST restore → 正文刷新 → 重拉列表）无法在 node 里点得动；
// 恢复链路的**真实端到端**证据由浏览态实测（见 tasks.md 卡 C2 判据 ①②③ 的汇报输出）承担，
// 这里守住「顺序不能颠倒」「失败必须可见」「预览必须只读」这些一改就静默失效的接线。
// 文件是 `.test.ts`（不进 typecheck）：需要读 node:fs 做源码扫描，又用 createElement 做 SSR
//（`.test.tsx` 在 typecheck 里没有 node 类型，见 AGENTS「*.test.ts 不进 pnpm typecheck」）。
// 契约：docs/api/110-api-manuscript.md「章级历史（快照 + 恢复）」、docs/ui/DESIGN.md §`writing-page`。
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chapterHistoryRows, HISTORY_EMPTY_TEXT } from "../../lib/chapter-history";
import { ChapterHistoryList } from "./chapter-history-drawer";

const drawerSource = readFileSync(
  new URL("./chapter-history-drawer.tsx", import.meta.url),
  "utf8",
);
const chapterEditorSource = readFileSync(
  new URL("./chapter-editor.tsx", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(new URL("../AppShell.tsx", import.meta.url), "utf8");

/** 组件内某个函数声明到其闭合行（同缩进的 `  }`）之间的源码 */
function functionSource(source: string, start: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", from);
  expect(end).toBeGreaterThan(-1);
  return source.slice(from, end);
}

function renderList(rows: Parameters<typeof ChapterHistoryList>[0]["rows"]): string {
  return renderToString(
    createElement(ChapterHistoryList, { rows, selectedSeq: null, onSelect: () => {} }),
  );
}

describe("空历史 → 抽屉空态（本卡选择：抽屉空态，入口不禁用）", () => {
  it("列表为空时渲染空态文案（说明历史从哪来）", () => {
    const html = renderList([]);
    expect(html).toContain(HISTORY_EMPTY_TEXT);
    expect(html).not.toContain("<ul");
  });

  it("抽屉不因空列表失败 / 报错：列表渲染只按 rows.length 分叉", () => {
    expect(drawerSource).toContain("if (rows.length === 0)");
    expect(drawerSource).toContain("{snapshots === null ? (");
  });
});

describe("列表行渲染（相对时间 + 绝对时间 + 字数 + 与当前字数之差）", () => {
  const now = new Date(2026, 10, 5, 14, 32).getTime();
  const rows = chapterHistoryRows(
    [
      { seq: 9, createdAt: new Date(2026, 10, 5, 14, 32).toISOString(), charCount: 500 },
      { seq: 8, createdAt: new Date(2026, 10, 5, 13, 0).toISOString(), charCount: 340 },
    ],
    500,
    now,
  );

  it("每行四段文案都在（相对时间 / 绝对时间 / 字数 / 差值）", () => {
    const html = renderList(rows);
    expect(html).toContain("刚刚");
    expect(html).toContain("2026-11-05 14:32");
    expect(html).toContain("500 字");
    expect(html).toContain("与当前字数相同");
    expect(html).toContain("1 小时前");
    expect(html).toContain("2026-11-05 13:00");
    expect(html).toContain("比当前少 160 字");
  });

  it("行是原生 <button>（键盘可达），不是无键盘语义的 div onClick", () => {
    const html = renderList(rows);
    expect(html.match(/<button type="button"/g)).toHaveLength(2);
    expect(drawerSource).not.toContain("<li onClick");
  });
});

describe("恢复链路（顺序不可颠倒）", () => {
  const restore = functionSource(drawerSource, "async function restore");

  it("先二次确认，再动手（不可恢复操作必须确认）", () => {
    expect(restore).toContain("useUiStore.getState().confirm({");
    expect(restore.indexOf("confirm({")).toBeLessThan(restore.indexOf("restoreChapterSnapshot("));
    expect(restore).toContain("if (!ok) return;");
  });

  it("恢复前先 flush 本地待存内容（否则它被覆盖且进不了历史）", () => {
    expect(restore).toContain("await flushPending();");
    expect(restore.indexOf("flushPending()")).toBeLessThan(
      restore.indexOf("restoreChapterSnapshot("),
    );
  });

  it("恢复成功 → 正文立即刷新（onRestored 交回编辑器）→ **重拉列表**（多出一项 = 恢复前那一版）", () => {
    expect(restore.indexOf("restoreChapterSnapshot(")).toBeLessThan(
      restore.indexOf("onRestored("),
    );
    expect(restore.indexOf("onRestored(")).toBeLessThan(restore.indexOf("await reload()"));
    expect(restore).toContain("showToast(");
  });

  it("恢复失败必须可见（错误文案进抽屉，不静默）；快照已被裁剪时同时刷新列表", () => {
    expect(restore).toContain("setError(restoreErrorText(err));");
    expect(restore).toContain('err instanceof ApiError && err.code === "SNAPSHOT_NOT_FOUND"');
    expect(drawerSource).toContain("{error !== null && (");
  });

  it("列表 / 预览读取失败同一条可见错误（historyErrorText），不吞错", () => {
    expect(functionSource(drawerSource, "const reload = useCallback")).toContain(
      "setError(historyErrorText(err));",
    );
    expect(functionSource(drawerSource, "async function selectSnapshot")).toContain(
      "setError(historyErrorText(err));",
    );
  });
});

describe("只读预览（BlockNote editable={false}，不另写 md 渲染）", () => {
  it("预览把正文交给 DocumentEditor 的 readOnly，且按 seq 换 key 重挂（BlockNote 非受控）", () => {
    expect(drawerSource).toContain("<DocumentEditor key={preview.seq}");
    expect(drawerSource).toContain("readOnly");
    expect(drawerSource).not.toMatch(/marked|markdown-it|react-markdown/);
  });

  it("预览内容来自单份快照端点（content 原样交块编辑器）", () => {
    expect(drawerSource).toContain("getChapterSnapshot(chapterId, seq)");
    expect(drawerSource).toContain("initialContent={preview.content}");
  });
});

describe("打开抽屉时右栏（AI 聊天）临时收起，关闭还原", () => {
  it("抽屉挂载即置瞬态标志，卸载（关闭 / 换章 / 离开）复位", () => {
    expect(drawerSource).toContain("setChatPanelSuppressed(true);");
    expect(drawerSource).toContain("useUiStore.getState().setChatPanelSuppressed(false);");
  });

  it("抽屉不遮罩正文（并存的侧栏，不是模态）：正文照着旧版对照时仍可见可点", () => {
    expect(drawerSource).toContain("mask={false}");
  });

  it("外壳按「用户偏好收起 ∪ 临时收起」决定右栏是否渲染——不改持久化偏好", () => {
    expect(appShellSource).toContain(
      "const chatVisible = !layout.collapsedChat && !chatSuppressed;",
    );
    expect(appShellSource).toContain("{(!isDesktop || chatVisible) && (");
    expect(appShellSource).toMatch(/isDesktop && chatVisible && \(\s*<ResizeHandle/);
    // 临时收起不得写回 localStorage（写点只有 usePanels 的 endResize / toggleCollapse）
    expect(appShellSource).not.toContain("writeStorage");
  });
});

describe("恢复后正文与版本戳在本地立即更新（不刷新页面）", () => {
  const apply = functionSource(chapterEditorSource, "function applyRestoredContent");

  it("前移版本戳 + 换 key 重挂编辑器 + 更新字数（不重新 GET 正文）", () => {
    expect(apply).toContain("baseRef.current = info.updatedAt;");
    expect(apply).toContain("setEditorEpoch(");
    expect(apply).toContain("setCharCount(info.charCount);");
    expect(apply).not.toMatch(/\bawait\b|getManuscript/);
  });

  it("丢弃待存内容（防旧内容被调度器回写）并把新版本戳补进大纲 store（rail 字数同步）", () => {
    expect(apply).toContain("autosave.reset();");
    expect(apply).toContain("onSaved?.({ charCount: info.charCount, updatedAt: info.updatedAt });");
  });

  it("抽屉接上编辑器的 autosave.flush（恢复前落盘）与 onRestored", () => {
    expect(chapterEditorSource).toContain("flushPending={() => autosave.flush()}");
    expect(chapterEditorSource).toContain("onRestored={applyRestoredContent}");
  });
});

describe("页头「历史」入口（24px 图标按钮，与导入导出 / 回填摘要同排）", () => {
  it("HistoryOutlined + aria-label / title「历史」+ size small（24px 图标几何）", () => {
    const label = chapterEditorSource.indexOf('aria-label="历史"');
    expect(label).toBeGreaterThan(-1);
    const from = chapterEditorSource.lastIndexOf("<Button", label);
    const end = chapterEditorSource.indexOf("/>", label);
    const button = chapterEditorSource.slice(from, end);
    expect(button).toContain("HistoryOutlined");
    expect(button).toContain('title="历史"');
    expect(button).toContain('size="small"');
    expect(button).toContain("onClick={() => setHistoryOpen(true)}");
  });

  it("排在「回填本章摘要」之后、面板开关槽位（headerActions）之前", () => {
    const summary = chapterEditorSource.indexOf('aria-label="回填本章摘要"');
    const history = chapterEditorSource.indexOf('aria-label="历史"');
    const headerActions = chapterEditorSource.indexOf("{headerActions}", history);
    expect(summary).toBeLessThan(history);
    expect(history).toBeLessThan(headerActions);
  });
});