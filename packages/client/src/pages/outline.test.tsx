// 大纲页树视图的推演节点徽标走查：仓内无 jsdom，用 react-dom/server 直渲染页面
// （同 pages/reference-list.test.tsx 惯例）。
// 覆盖：章行徽标文案 / title（含章号与 k / N）/ 位置（「阅读进度」左侧）/ 卷与场景行无徽标 /
// 页头「清除推演标记」按钮的可见性（有可见标记才渲染）。
// 右键菜单项活在 portal 里、关闭态不渲染 ⇒ 菜单文案由 lib/deduction.test.ts 的纯函数覆盖，
// 「点菜单项 → 徽标即时刷新」走浏览器人工核对（无 jsdom 无法派发右键事件）。
// `clearDeductionMarks` 碰 store action + 请求，同 `submitDeductionMarks` 不进单测。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  OutlineChapter,
  OutlineScene,
  OutlineTree,
  OutlineVolume,
  ProjectConfig,
} from "@whispering233/ai-editor-shared";
import Outline from "./Outline";
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

/** 卷1（ch-1（含场景 sc-1）、ch-2）+ 卷2（ch-3） */
const OUTLINE: OutlineTree = {
  id: "root",
  type: "root",
  schemaVersion: 1,
  children: [
    volume("vol-1", "第一卷", [
      chapter("ch-1", "雪夜出走", [{ id: "sc-1", type: "scene", title: "城外", updatedAt: "t" }]),
      chapter("ch-2", "旧盟友"),
    ]),
    volume("vol-2", "第二卷", [chapter("ch-3", "入城")]),
  ],
};

const CONFIG: ProjectConfig = {
  id: "p-1",
  name: "测试书",
  language: "zh",
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
function render(config: Partial<ProjectConfig> = {}): string {
  Object.assign(useProjectStore.getInitialState(), {
    config: { ...CONFIG, ...config },
    outline: OUTLINE,
    configLoading: false,
    outlineLoading: false,
    outlineWithMetadata: true,
  });
  return renderToString(<Outline />);
}

/** 取某行自身的 HTML（到下一个 data-node-id 为止——子节点渲染在父行之后） */
function rowHtml(html: string, nodeId: string): string {
  const start = html.indexOf(`data-node-id="${nodeId}"`);
  const end = html.indexOf("data-node-id=", start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

describe("大纲页树视图：推演节点徽标", () => {
  it("多标记：首位「推演起点」/ 末位「推演终点」，title = 文案（第N章）· 第 k / 共 N 个推演节点", () => {
    const html = render({ deductionNodes: ["ch-1", "ch-3"] });
    expect(rowHtml(html, "ch-1")).toContain('title="推演起点（第1章） · 第 1 / 共 2 个推演节点"');
    expect(rowHtml(html, "ch-3")).toContain('title="推演终点（第3章） · 第 2 / 共 2 个推演节点"');
    expect(rowHtml(html, "ch-1")).toContain(">推演起点<");
    expect(rowHtml(html, "ch-3")).toContain(">推演终点<");
  });

  it("单标记：文案 = 推演节点，不附 k / N；未标记的章行不渲染徽标", () => {
    const html = render({ deductionNodes: ["ch-2"] });
    expect(rowHtml(html, "ch-2")).toContain('title="推演节点（第2章）"');
    expect(html).not.toContain("推演起点");
    expect(rowHtml(html, "ch-1")).not.toContain("推演");
  });

  it("无标记：整页不出现推演徽标", () => {
    expect(render({ deductionNodes: [] })).not.toContain("推演");
  });

  // 页头一键清空入口（DESIGN.md「`推演节点` 徽标」）：可见性判据与徽标同源
  // （`deduction.marks.length > 0` ⇒ 无可见标记时按钮不渲染，不给「点了没反应」的入口）。
  it("有可见标记：页头渲染「清除推演标记」按钮", () => {
    expect(render({ deductionNodes: ["ch-1"] })).toContain("清除推演标记");
  });

  it("无可见标记：页头不渲染「清除推演标记」按钮", () => {
    expect(render({ deductionNodes: [] })).not.toContain("清除推演标记");
    // 盘上有 id 但全部失效（章被软删）⇒ 无可见标记，按钮同样不渲染
    expect(render({ deductionNodes: ["ghost"] })).not.toContain("清除推演标记");
  });

  it("卷行 / 场景行不给徽标（仅章行）", () => {
    const html = render({ deductionNodes: ["ch-1", "ch-3"] });
    expect(rowHtml(html, "vol-1")).not.toContain("推演");
    expect(rowHtml(html, "sc-1")).not.toContain("推演");
  });

  it("位置：徽标排在「阅读进度」左侧（阅读进度是单值固定标记、恒贴右）", () => {
    const row = rowHtml(render({ deductionNodes: ["ch-1"], currentPosition: "ch-1" }), "ch-1");
    const deduction = row.indexOf("推演节点");
    const current = row.indexOf("阅读进度");
    expect(deduction).toBeGreaterThan(-1);
    expect(current).toBeGreaterThan(-1);
    expect(deduction).toBeLessThan(current);
  });
});
