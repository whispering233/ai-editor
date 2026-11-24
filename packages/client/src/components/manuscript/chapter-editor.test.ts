// 写作页导出菜单守卫（单章 TXT）：仓内无 jsdom，走源码扫描断言菜单项与「TXT 不弹确认框」口径；
// 标题回退 / 两种排版 / 空内容 / 文件名的行为断言在 lib/document-io.test.ts。
// 契约：docs/api/110-api-manuscript.md「导入导出（无端点）」、docs/ui/DESIGN.md §`writing-page`。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chapterEditor = readFileSync(new URL("./chapter-editor.tsx", import.meta.url), "utf8");

/** 取组件内某个函数声明到其闭合行（同缩进的 `  }`）之间的源码 */
function functionSource(start: string): string {
  const from = chapterEditor.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const end = chapterEditor.indexOf("\n  }\n", from);
  expect(end).toBeGreaterThan(-1);
  return chapterEditor.slice(from, end);
}

describe("写作页导出菜单（四种产物）", () => {
  it("下拉含块 JSON / markdown / 两种纯文本", () => {
    expect(chapterEditor).toContain('label: "导出块 JSON（无损）"');
    expect(chapterEditor).toContain('label: "导出 markdown（有损）"');
    expect(chapterEditor).toContain('label: "导出纯文本（保真）"');
    expect(chapterEditor).toContain('label: "导出纯文本（网文排版）"');
  });

  it("两项纯文本按 shared 排版取值分派（preserve / webnovel）", () => {
    expect(chapterEditor).toMatch(/key === "txt-preserve"\)\s*exportPlainText\("preserve"\)/);
    expect(chapterEditor).toMatch(/key === "txt-webnovel"\)\s*exportPlainText\("webnovel"\)/);
  });
});

describe("单章 TXT 导出（exportPlainText）", () => {
  it("正文取编辑器最新块 JSON（latestRef，含未保存改动），不走请求", () => {
    const source = functionSource("function exportPlainText");
    expect(source).toContain("latestRef.current");
    expect(source).toContain("exportDocumentTxt(");
    expect(source).not.toMatch(/await\s|\bfetch\(|getManuscript/);
  });

  it("**不弹确认框**（有损已在菜单项名里写明）：直接下载 + 成功 toast 文件名", () => {
    const source = functionSource("function exportPlainText");
    expect(source).not.toContain("confirm(");
    expect(source).toContain("downloadTextFile(file)");
    expect(source).toContain("已导出 ${file.fileName}");
  });

  it("失败也要可见：toast error", () => {
    expect(functionSource("function exportPlainText")).toMatch(
      /showToast\([^)]*,\s*"error"\)/,
    );
  });

  it("章号取展示口径编号、文件名基名回落「正文」、标题行走 chapterTxtLabel", () => {
    expect(chapterEditor).toContain("numberOutline(outline).labels.get(chapterId)");
    expect(chapterEditor).toContain('chapterTitle?.trim() || "正文"');
    expect(chapterEditor).toContain("chapterTxtLabel(chapterLabel, chapterTitle)");
  });

  it("不改现有 JSON / md 的文件名基名（documentTitle 仍是 chapterTitle ?? \"正文\"）", () => {
    expect(functionSource("function documentTitle")).toContain('return chapterTitle ?? "正文";');
  });
});

describe("页头「回填本章摘要」（C2）", () => {
  it("发送 = 消息常量 + 本章 focus_node_id，并聚焦右栏输入框（不新增端点 / 通道）", () => {
    const source = functionSource("function requestChapterSummary");
    expect(source).toContain("sendMessage(CHAPTER_SUMMARY_MESSAGE, { focus_node_id: chapterId });");
    expect(source).toContain("requestFocusInput();");
  });

  it("按钮在页头动作组内（`ChapterEditor` 自己的 actions，不挂页面壳的 headerActions 槽位）", () => {
    const actions = chapterEditor.slice(chapterEditor.indexOf("actions={"));
    const button = actions.indexOf('aria-label="回填本章摘要"');
    expect(button).toBeGreaterThan(-1);
    expect(actions.indexOf("headerActions}")).toBeGreaterThan(button);
  });
});
