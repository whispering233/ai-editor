// 书架「拆解小说」入口守卫（卡 21.8）：入口是否还在，就是这张卡的判据本身。
//
// 为什么是源码扫描而不是 SSR 断言：`Dashboard` 的书架数据来自 zustand store，而 zustand 的
// `useSyncExternalStore` 在 SSR 走 **getServerSnapshot = 初始 state**——测试里 `setState` 预置的书架
// 在 `renderToString` 里不可见（实测踩坑：预置后仍渲染空书架分支），故渲染断言拿不到「有书形态」那一行。
// 于是照 `design-discipline.test.ts` 的口径扫源码：断言入口按钮的标签与对话框挂载两处都在。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");

describe("书架入口（卡 21.8）", () => {
  it("「新建一本…」行内并列一个「拆解小说」按钮（dashboard-decompose）", () => {
    // 行内并列：按钮与「新建一本…」折叠钮在同一个 flex 行里
    expect(dashboard).toContain("新建一本…");
    expect(dashboard).toMatch(/<Button[^<]*?>\s*拆解小说\s*<\/Button>/);
  });

  it("对话框挂在书架页（受控：open 由 decomposeOpen 驱动）", () => {
    expect(dashboard).toContain("<DecomposeDialog");
    expect(dashboard).toMatch(/<DecomposeDialog[^>]*open=\{decomposeOpen\}/);
  });
});

// 概览卡片 + 书架徽标（卡 21.9）：同一份 job 投影的两处入口。
// 断言「有 job 才渲染」与「徽标只服务当前书」两个易丢的收窄——源码扫描理由同上（zustand SSR 快照）。
describe("拆解任务卡片与书架徽标（卡 21.9）", () => {
  it("概览态增「拆解任务」卡，且有 job 才渲染（无 job 不渲染）+ 进 #/decompose 的按钮", () => {
    expect(dashboard).toContain('title="拆解任务"');
    expect(dashboard).toMatch(/\{decomposeJob !== null && \(/);
    expect(dashboard).toContain('href="#/decompose"');
  });

  it("卡片状态行与进度页同源（describeJobStatus，不另写一份文案）", () => {
    expect(dashboard).toContain("describeJobStatus(decomposeJob)");
  });

  it("书架当前书行徽标：isCurrent + 非终态 + formatShelfBadge", () => {
    expect(dashboard).toMatch(/isCurrent && decomposeJob !== null && !isTerminalJobStatus\(decomposeJob\.status\)/);
    expect(dashboard).toContain("formatShelfBadge(decomposeJob.progress)");
  });

  it("骨架：轮询参数 = 项目 id（未打开书不发请求、切书立即重拉）", () => {
    expect(dashboard).toContain("useDecomposeJob(config?.id ?? null)");
  });
});
