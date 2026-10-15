// 工作区类型路由守卫（卡 8；卡 6 扩到练习五页）：两个 kind 下都只可达自己的页面（**两侧都 fail-closed**）。
//
// 口径：练习工作区下**只允许** `#/`、练习专属段（`PRACTICE_SEGMENTS` = author / works / style / practice / free，
// 含子路径）、`#/preferences`，其余 hash 一律重定向 `#/practice`；小说工作区**默认放行小说路由**，
// 练习专属段任一 → `#/`（它们没有小说语义的页面；反方向不挡就会出现「小说左栏 + 练习占位页」的错配）。
// 这是 **UX 守卫**——边界仍是服务端 `requireKind`（400 KIND_MISMATCH）。
//
// 判定时机（卡 8 收尾修复）：本函数是 `main.tsx` **渲染分支**的判据——返回非 null 时渲染 `RedirectTo`，
// **不挂载目标页面**（挂载后再补跳会先打出对面工作区的请求：400）。故这里既测落点，也测给出落点的
// 那组 hash（= 渲染分支的输入）。挂载断言本身由 `pages/dashboard-partitions.test.ts` 扫 `main.tsx`
// 源码钉住（client 无 jsdom，App 整树渲不出来）。
import { describe, expect, it } from "vitest";
import { parseHashRoute } from "../hooks/use-route";
import {
  NOVEL_REDIRECT_PATH,
  PRACTICE_ALLOWED_SEGMENTS,
  PRACTICE_REDIRECT_PATH,
  PRACTICE_SEGMENTS,
  workspaceRedirectPath,
} from "./workspace-route-guard";

const route = (hash: string) => parseHashRoute(hash);

describe("练习专属首段清单（单一定义，两侧共用）", () => {
  it("= 左栏五项顺序：author / works / style / practice / free", () => {
    expect(PRACTICE_SEGMENTS).toEqual(["author", "works", "style", "practice", "free"]);
  });

  it("允许清单 = 练习五段 + preferences（根路由 `#/` 由空 segments 单独允许）", () => {
    expect(PRACTICE_ALLOWED_SEGMENTS).toEqual([...PRACTICE_SEGMENTS, "preferences"]);
  });
});

describe("练习工作区的允许清单（kind = practice）", () => {
  it("允许：根首页 `#/`、练习五段（含子路径）、`#/preferences`", () => {
    for (const hash of [
      "",
      "#/",
      "#/author",
      "#/works",
      "#/style",
      "#/practice",
      "#/practice/sample-1",
      "#/free",
      "#/free/piece-1",
      "#/preferences",
    ]) {
      expect(workspaceRedirectPath("practice", route(hash)), hash).toBeNull();
    }
  });

  it("其余一律重定向 `#/practice`（小说语义页面在练习工作区不可达）", () => {
    for (const hash of [
      "#/overview",
      "#/outline",
      "#/outline/ch-1",
      "#/characters",
      "#/manuscript/ch-1",
      "#/trash",
      "#/references",
    ]) {
      expect(workspaceRedirectPath("practice", route(hash)), hash).toBe(PRACTICE_REDIRECT_PATH);
    }
  });

  it("未知 hash（已被路由回退成根路由）不算违规——不会与回退逻辑打架", () => {
    expect(route("#/nope").isFallback).toBe(true);
    expect(workspaceRedirectPath("practice", route("#/nope"))).toBeNull();
  });

  it("允许清单是 fail-closed 白名单（新增小说路由默认被挡，不必逐个枚举）", () => {
    // 一个目前不存在、将来新增的一级段：练习工作区下默认被挡（未知 hash 已由路由回退成 `#/`，
    // 故这里直接构造路由对象——测的是守卫本身，不是路由表的回退行为）
    expect(
      workspaceRedirectPath("practice", {
        path: "/brand-new-section",
        segments: ["brand-new-section"],
        isFallback: false,
      }),
    ).toBe(PRACTICE_REDIRECT_PATH);
  });
});

describe("小说工作区的反向守卫（kind = novel）", () => {
  it("练习专属五段（含子路径）都重定向 `#/`（根首页 = 工作区聚合入口，那里才有打开练习区的入口）", () => {
    for (const segment of PRACTICE_SEGMENTS) {
      for (const hash of [`#/${segment}`, `#/${segment}/id-1`]) {
        expect(workspaceRedirectPath("novel", route(hash)), hash).toBe(NOVEL_REDIRECT_PATH);
      }
    }
    expect(workspaceRedirectPath("novel", route("#/practice/x/y"))).toBe(NOVEL_REDIRECT_PATH);
  });

  it("小说路由与两个 kind 共有的路由都放行（不误伤：八项一级导航 + `#/`、`#/preferences`、`#/overview`）", () => {
    for (const hash of [
      "",
      "#/",
      "#/preferences",
      "#/overview",
      // 左栏小说态八项一级导航（components/nav/nav-items.tsx）+ 各详情段
      "#/outline",
      "#/outline/ch-1",
      "#/characters",
      "#/characters/char-1",
      "#/setting",
      "#/setting/set-1",
      "#/locations",
      "#/locations/loc-1",
      "#/hooks",
      "#/hooks/hook-1",
      "#/timeline",
      "#/timeline/ev-1",
      "#/relations",
      "#/references",
      "#/trash",
      "#/manuscript/ch-1",
    ]) {
      expect(workspaceRedirectPath("novel", route(hash)), hash).toBeNull();
    }
  });

  it("小说侧不是「枚举小说段」的白名单：将来新增的一级段默认可达（fail-closed 的反面）", () => {
    expect(
      workspaceRedirectPath("novel", {
        path: "/brand-new-section",
        segments: ["brand-new-section"],
        isFallback: false,
      }),
    ).toBeNull();
  });
});

describe("渲染前判定的输入（卡 8 收尾：被挡下的 hash 不挂载目标页面）", () => {
  it("练习态手输 `#/outline` / `#/characters` / `#/trash` / `#/overview` → 全部指向 `#/practice`", () => {
    for (const hash of ["#/outline", "#/characters", "#/trash", "#/overview"]) {
      expect(workspaceRedirectPath("practice", route(hash)), hash).toBe(PRACTICE_REDIRECT_PATH);
    }
  });

  it("小说态手输任一个练习段 → 全部指向 `#/`", () => {
    for (const segment of PRACTICE_SEGMENTS) {
      expect(workspaceRedirectPath("novel", route(`#/${segment}`)), segment).toBe(
        NOVEL_REDIRECT_PATH,
      );
    }
  });

  it("`kind = null`（config 未落地）不判定：这一帧照常渲染，落点交给 useEnterLastBook", () => {
    for (const hash of ["#/outline", "#/practice", "#/overview", "#/"]) {
      expect(workspaceRedirectPath(null, route(hash)), hash).toBeNull();
    }
  });
});
