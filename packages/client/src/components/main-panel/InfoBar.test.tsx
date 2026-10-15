// InfoBar 按工作区类型（`kind`）渲染（卡 8）：
//   小说工作区 = 项目名链接 `#/overview` + 阅读进度链接 `#/outline`（与改动前逐字一致）；
//   练习工作区 = 项目名**纯文本（无 href）** + **不渲染阅读进度**——`#/overview` / `#/outline` 都被路由守卫
//   挡回 `#/practice`，留着就是「点了没反应」的死链；品牌标记、语言、小屏聊天开关两种 kind 都保留。
// 渲染手法同 chat-panel.test / character-detail.test（仓内无 jsdom/@testing-library 纪律，用 react-dom/server）。
// SSR 预置 store：zustand 的服务端快照取 getInitialState()（setState 对 renderToString 无效），故用
// Object.assign 改初值；window 只 stub useMediaQuery 的 useState 初始化器要读的 matchMedia（SSR 不跑 effect）。
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig, WorkspaceKind } from "@whispering233/ai-editor-shared";
import { InfoBar } from "./InfoBar";
import { useProjectStore } from "../../stores/project";

function makeConfig(kind: WorkspaceKind): ProjectConfig {
  return {
    id: `${kind}-1`,
    name: kind === "practice" ? "仿写练习区" : "青云记",
    language: "zh",
    kind,
    authorId: kind === "practice" ? "jiangnan" : null, // 仅练习工作区有值
    schemaVersion: 1,
    currentPosition: kind === "practice" ? null : "ch-1",
    deductionNodes: [],
    backupFrequencyMinutes: 10,
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  };
}

/** SSR 预置：只改本文件内每个用例自己用到的键（config）；其余键保持 store 初值 */
function render(kind: WorkspaceKind): string {
  Object.assign(useProjectStore.getInitialState(), { config: makeConfig(kind) });
  return renderToString(<InfoBar chatOpen={false} onToggleChat={() => {}} />);
}

beforeEach(() => {
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(useProjectStore.getInitialState(), { config: null });
});

describe("InfoBar · 小说工作区（kind = novel）", () => {
  const html = () => render("novel");

  it("项目名是 `#/overview` 链接（书名与品牌标记都在里面）", () => {
    const out = html();
    expect(out).toContain('href="#/overview"');
    expect(out).toContain("青云记");
    expect(out).toContain("<svg"); // app-mark 品牌标记
  });

  it("渲染阅读进度（`#/outline` 链接 + 标题）", () => {
    const out = html();
    expect(out).toContain('href="#/outline"');
    expect(out).toContain("阅读进度:");
    // currentPosition = ch-1：outline 未加载 → 标题回落 id 占位（不是「未设置」）
    expect(out).toContain("ch-1");
    expect(out).not.toContain("未设置");
  });

  it("语言与小屏聊天开关的开关注入照旧（聊天开关由 useMediaQuery 决定，SSR 桩 = 桌面态不渲染）", () => {
    expect(html()).toContain("语言:");
  });
});

describe("InfoBar · 练习工作区（kind = practice）", () => {
  const html = () => render("practice");

  it("整条信息条无任何链接：项目名是纯文本（点它无 href 可跳 ⇒ 无 hash 变化、无小说端点请求）", () => {
    const out = html();
    expect(out).not.toContain("<a");
    expect(out).not.toContain('href="#/overview"');
    expect(out).not.toContain('href="#/outline"');
  });

  it("项目名仍是「标记 + 书名」纯文本壳（内容不因去链接而丢失）", () => {
    const out = html();
    expect(out).toContain("仿写练习区");
    expect(out).toContain("<svg"); // app-mark 品牌标记
    expect(out).toContain(
      'class="flex min-w-0 items-center gap-1.5 text-base font-medium text-foreground"',
    );
  });

  it("不渲染阅读进度（练习工作区没有 `current_position`，那一行是纯死链）", () => {
    const out = html();
    expect(out).not.toContain("阅读进度");
    expect(out).not.toContain("未设置");
  });

  it("语言保留（与 kind 无关的展示项）", () => {
    expect(html()).toContain("语言:");
  });
});
