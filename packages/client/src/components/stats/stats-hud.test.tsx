// 当日码字悬浮面板 SSR 走查（`react-dom/server`，仓内无 jsdom）：
// 标题「码字统计 · 本次」+ 四项指标 + 千分位；练习工作区 / 专注模式不渲染。
// 契约 = DESIGN.md「当日码字悬浮面板」；数字口径 = lib/writing-session（本测试只验结构）。
// SSR 预置沿用 MainToolbar.test 的手法：zustand 的服务端快照取 getInitialState()
// （setState 对 renderToString 无效），故用 Object.assign 改初值。
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectConfig, WorkspaceKind } from "@whispering233/ai-editor-shared";
import { StatsHud } from "./stats-hud";
import { useProjectStore } from "../../stores/project";
import { useWritingSessionStore } from "../../stores/writing-session";

function makeConfig(kind: WorkspaceKind): ProjectConfig {
  return {
    id: `${kind}-1`,
    name: kind === "practice" ? "仿写练习区" : "青云记",
    language: "zh",
    kind,
    authorId: kind === "practice" ? "jiangnan" : null,
    schemaVersion: 1,
    currentPosition: null,
    deductionNodes: [],
    backupFrequencyMinutes: 10,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}

/** SSR 预置：可见面板 + 有累计（`typingMs` = 5 分钟，速率窗口已过） */
function render(kind: WorkspaceKind, options: { focusMode?: boolean; visible?: boolean } = {}): string {
  Object.assign(useProjectStore.getInitialState(), { config: makeConfig(kind) });
  Object.assign(useWritingSessionStore.getInitialState(), {
    projectId: `${kind}-1`,
    chars: 1_234,
    typingMs: 300_000,
    lastEditAt: Date.now() - 60_000, // 超阈值 ⇒ 空闲时间不吞掉累计
    visible: options.visible ?? true,
    dismissed: true,
    hasAutoOpened: true,
  });
  return renderToString(<StatsHud focusMode={options.focusMode ?? false} />).replace(
    /<!--[^>]*-->/g,
    "",
  );
}

afterEach(() => {
  Object.assign(useProjectStore.getInitialState(), { config: null });
  Object.assign(useWritingSessionStore.getInitialState(), {
    projectId: null,
    chars: 0,
    typingMs: 0,
    lastEditAt: null,
    visible: false,
    dismissed: false,
    hasAutoOpened: false,
  });
});

describe("码字悬浮面板 · 小说工作区", () => {
  it("标题用「本次」+ 四项指标标签", () => {
    const html = render("novel");
    expect(html).toContain("码字统计 · 本次");
    expect(html).toContain("本次码字");
    expect(html).toContain("码字速率（字/时）");
    expect(html).toContain("码字时间");
    expect(html).toContain("空闲时间");
  });

  it("千分位原数与 HH:MM:SS（速率/时长按会话口径派生）", () => {
    const html = render("novel");
    expect(html).toContain("1,234");
    expect(html).toContain("14,808"); // 1234 字 / 5 分钟 = 14,808 字/时
    expect(html).toContain("00:05:00"); // 码字时间 300000ms
  });

  it("面板是带语义的区域（role=region + aria-label）", () => {
    const html = render("novel");
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="码字统计"');
  });

  it("练习工作区不渲染（追踪器仍由外壳挂载）", () => {
    expect(render("practice")).toBe("");
  });

  it("专注模式不渲染", () => {
    expect(render("novel", { focusMode: true })).toBe("");
  });
});