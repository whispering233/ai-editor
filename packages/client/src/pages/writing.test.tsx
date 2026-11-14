// 写作页（`#/writing` / `#/writing/:chapterId`）SSR 走查（仓内无 jsdom，同 pages/practice.test.tsx 惯例）。
// 契约 = docs/ui/DESIGN.md `writing-page` + §Layout「写作页的中栏内分栏」「页头常驻」。
//
// 本卡（writing-1）只落导航 / 路由 / 页面壳：断言外壳几何 + 无 id 空态 + 有 id 渲染章正文编辑面板。
// rail（卷章导航栏）/ 最近导航 / 宽度拖拽由后续卡接线，故这里还钉一条否定契约：页面**不渲染**空白 rail 占位。
// 有 id 的用例在 SSR 下不跑 effect ⇒ 只有编辑面板的加载骨架（不发请求）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  OutlineChapter,
  OutlineScene,
  OutlineTree,
  OutlineVolume,
  ProjectConfig,
} from "@whispering233/ai-editor-shared";
import Writing from "./Writing";
import { useProjectStore } from "../stores/project";

const chapter = (id: string, title: string, children?: OutlineScene[]): OutlineChapter => ({
  id,
  type: "chapter",
  title,
  updatedAt: "t",
  children,
});
const volume = (id: string, title: string, children: OutlineChapter[]): OutlineVolume => ({
  id,
  type: "volume",
  title,
  updatedAt: "t",
  children,
});

/** 卷1（ch-1、ch-2）+ 卷2（ch-3） */
const OUTLINE: OutlineTree = {
  id: "root",
  type: "root",
  schemaVersion: 1,
  children: [
    volume("vol-1", "第一卷", [chapter("ch-1", "雪夜出走"), chapter("ch-2", "旧盟友")]),
    volume("vol-2", "第二卷", [chapter("ch-3", "入城")]),
  ],
};

const CONFIG: ProjectConfig = {
  id: "p-1",
  name: "测试书",
  language: "zh",
  kind: "novel",
  authorId: null,
  schemaVersion: 1,
  currentPosition: null,
  deductionNodes: [],
  backupFrequencyMinutes: null,
  createdAt: "t",
  updatedAt: "t",
};

/**
 * SSR 预置 store：zustand 的服务端快照取 `getInitialState()`（不是 `getState()`）——`setState` 对
 * `renderToString` 无效，故本用例直接往初始 state 对象（`getInitialState()` 返回的就是它）上写。
 */
function render(props: { chapterId?: string } = {}): string {
  Object.assign(useProjectStore.getInitialState(), {
    config: CONFIG,
    outline: OUTLINE,
    configLoading: false,
    outlineLoading: false,
    outlineWithMetadata: true,
  });
  return renderToString(<Writing {...props} />).replace(/<!--[^>]*-->/g, "");
}

describe("写作页外壳（writing-1：导航 / 路由 / 页面壳）", () => {
  it("全高分栏外壳（抵消中栏 p-6）+ 正文列吸收全部宽度——本卡不渲染 rail 占位", () => {
    const html = render();
    expect(html).toContain("-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden");
    expect(html).toContain("flex min-h-0 min-w-0 flex-1 flex-col p-6");
    // rail 未建（writing-2）：页面不得先摆一个空白栏
    expect(html).not.toContain("卷章");
    expect(html).not.toContain("aria-label=\"调整卷章导航栏宽度\"");
  });

  it("无 id：page-title「写作」+ 空态文案 + 「去大纲」导航链接（不在此页新建）", () => {
    const html = render();
    expect(html).toContain(">写作</");
    expect(html).toContain("从大纲选择一章开始写作");
    expect(html).toContain('href="#/outline"');
    expect(html).toContain("去大纲");
    // 页头常驻模板：页头 + 内容进内层可滚容器
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
  });

  it("有 id：渲染章正文编辑面板（章标题 + 加载骨架 + 上/下一章），不落空态", () => {
    const html = render({ chapterId: "ch-2" });
    expect(html).toContain(">旧盟友</"); // 章标题取自大纲树
    expect(html).toContain("上一章");
    expect(html).toContain("下一章");
    expect(html).toContain("h-5"); // 正文加载骨架（SSR 不跑 effect，拿不到正文）
    expect(html).not.toContain("从大纲选择一章开始写作");
  });
});