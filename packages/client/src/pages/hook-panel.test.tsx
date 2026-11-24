// 伏笔页「已写未回收」形态守卫（仓内无 jsdom，同 pages/reference-list.test.tsx 惯例用 SSR）：
// ① 行标记 = 命中行带「已写未回收」+ `title` 给预计回收章（不是整页提示）
// ② 页头筛选控件常驻、初始未激活（组件态：不写 localStorage、不进 URL）
// 取数逻辑（命中索引 / 筛选）由 lib/hook-panel.test.ts 覆盖，这里只断言界面上有没有这块。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import HookPanel, { HookGroupSection } from "./HookPanel";
import { writtenUnresolvedByHookId } from "../lib/hook-panel";
import type { WrittenUnresolvedHookItem } from "../lib/api";

const hook = (id: string, name: string, status: string): EntitySummary => ({
  id,
  type: "hook",
  name,
  summary: { status },
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
});

const WRITTEN: WrittenUnresolvedHookItem[] = [
  {
    id: "hook-1",
    name: "断剑来历",
    status: "planted",
    expectedResolveNodeId: "ch-2",
    expectedResolveChapterNumber: 2,
    expectedResolveChapterTitle: "旧盟友",
  },
];

/** 分组卡片（行标记的唯一渲染点；回调一律空实现——本用例只看标记） */
function section(hooks: EntitySummary[], written: WrittenUnresolvedHookItem[]): string {
  return renderToString(
    <HookGroupSection
      title="活跃"
      icon={<span />}
      hooks={hooks}
      writtenUnresolvedById={writtenUnresolvedByHookId(written)}
      depEdges={[]}
      depEdgesFailed
      chains={{}}
      onToggleChain={() => {}}
      onDetail={() => {}}
      onLifecycle={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onRelationCreated={() => {}}
    />,
  );
}

describe("伏笔页 · 「已写未回收」行标记", () => {
  const items = [
    hook("hook-1", "断剑来历", "planted"),
    hook("hook-2", "旧盟友背叛", "progressing"),
  ];

  it("命中行带标记，`title` 给预计回收章（章号 + 章名）", () => {
    const html = section(items, WRITTEN);
    expect(html.match(/已写未回收/g)).toHaveLength(1);
    expect(html).toContain("预计回收：第2章 旧盟友");
  });

  it("无命中：两行都不带标记（整页不会多出一条噪声）", () => {
    expect(section(items, [])).not.toContain("已写未回收");
  });
});

describe("伏笔页 · 「只看已写未回收」筛选", () => {
  it("页头常驻筛选控件，初始未激活（组件态：刷新即清，不持久化）", () => {
    const html = renderToString(<HookPanel />);
    // 文案经常量插值（服务端渲染会在插值处插入注释分隔符），只断言文字本身
    expect(html).toContain("只看");
    expect(html).toContain("已写未回收</button>");
    expect(html).toContain('aria-pressed="false"');
  });
});
