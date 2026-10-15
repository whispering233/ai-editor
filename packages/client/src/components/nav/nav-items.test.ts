// 左栏项集常量表（kind → 形态）单测（卡 8）。
//
// 为什么测常量表：NavRail 的形态由当前工作区类型决定，而 SSR 快照下 store 的 config 为 null
//（渲不出练习形态）——判据必须落在**表本身**（项集/标识文案/是否渲染回收站与书名按钮），
// 并加一条源码守卫防止「表之外又手写一份项集」。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_KINDS } from "@whispering233/ai-editor-shared";
import { KNOWN_ROUTE_SEGMENTS } from "../../hooks/use-route";
import { PRACTICE_SEGMENTS } from "../../lib/workspace-route-guard";
import { NAV_RAIL_BY_KIND, TRASH_ITEM } from "./nav-items";

const navRail = readFileSync(new URL("./NavRail.tsx", import.meta.url), "utf8");

describe("NAV_RAIL_BY_KIND（kind → 左栏形态的唯一定义处）", () => {
  it("覆盖全部工作区类型（新增 kind 时表必须同步，类型记录已先行约束）", () => {
    expect(Object.keys(NAV_RAIL_BY_KIND).sort()).toEqual([...WORKSPACE_KINDS].sort());
  });

  it("小说：八项一级导航 + 回收站 + 书名按钮（与现状一致）", () => {
    const novel = NAV_RAIL_BY_KIND.novel;
    expect(novel.items.map((item) => item.key)).toEqual([
      "/outline",
      "/characters",
      "/setting",
      "/locations",
      "/hooks",
      "/timeline",
      "/relations",
      "/references",
    ]);
    // 「概览」不占一级导航位（入口 = 书名按钮）
    expect(novel.items.map((item) => item.key)).not.toContain("/overview");
    expect(novel.items.map((item) => item.key)).not.toContain("/trash");
    expect(novel.brandLabel).toBe("书架");
    expect(novel.trash).toBe(true);
    expect(novel.projectOverview).toBe(true);
  });

  it("练习：顶部标识「文风练习」+ 一级导航五项（三素材页 → 两种练习页）+ 无回收站 + 无书名按钮", () => {
    const practice = NAV_RAIL_BY_KIND.practice;
    expect(practice.brandLabel).toBe("文风练习");
    expect(practice.items.map((item) => item.key)).toEqual([
      "/author",
      "/works",
      "/style",
      "/practice",
      "/free",
    ]);
    expect(practice.items.map((item) => item.label)).toEqual([
      "作家介绍",
      "作品介绍",
      "作家风格说明",
      "文风练习",
      "自由练习",
    ]);
    expect(practice.trash).toBe(false);
    expect(practice.projectOverview).toBe(false);
  });

  it("练习五项的顺序与路由守卫的练习专属段清单同源（两份清单不得漂移）", () => {
    expect(NAV_RAIL_BY_KIND.practice.items.map((item) => item.key.slice(1))).toEqual([
      ...PRACTICE_SEGMENTS,
    ]);
  });

  it("导航 key 都是一级段且进已知路由表（否则点击后会被路由回退成根首页）", () => {
    const keys = [
      ...WORKSPACE_KINDS.flatMap((kind) => NAV_RAIL_BY_KIND[kind].items.map((i) => i.key)),
      TRASH_ITEM.key,
    ];
    for (const key of keys) {
      expect(key.startsWith("/"), key).toBe(true);
      const first = key.slice(1);
      expect(first, key).not.toContain("/");
      expect(KNOWN_ROUTE_SEGMENTS as readonly string[], key).toContain(first);
    }
  });

  it("工具区（回收站）项只有一份定义，不从项集里手抄", () => {
    expect(TRASH_ITEM.key).toBe("/trash");
    expect(NAV_RAIL_BY_KIND.novel.items).not.toContain(TRASH_ITEM);
    expect(NAV_RAIL_BY_KIND.practice.items).not.toContain(TRASH_ITEM);
  });
});

describe("NavRail 消费常量表（形态不在组件里手写第二份）", () => {
  it("项集 / 标识文案 / 回收站 / 书名按钮四者都取自 NAV_RAIL_BY_KIND", () => {
    expect(navRail).toContain("NAV_RAIL_BY_KIND[resolveWorkspaceKind(config?.kind)]");
    expect(navRail).toContain("{spec.brandLabel}");
    expect(navRail).toContain("spec.trash");
    expect(navRail).toContain("spec.projectOverview &&");
    expect(navRail).toContain("(item) => ({\n    ...item,");
  });

  it("导航高亮仍按路由首段 → `/` + key（练习的 `/practice` 因此能选中自己那项）", () => {
    expect(navRail).toContain("return `/${first}`");
  });

  it("旧形态不得回归：NavRail 里不再有写死的导航项数组与「书架」字面量", () => {
    expect(navRail).not.toContain("const NAV_ITEMS");
    expect(navRail).not.toMatch(/["'`]\/trash["'`]/);
    expect(navRail).not.toContain('label: "大纲"');
    expect(navRail).not.toContain("书架</span>");
  });
});
