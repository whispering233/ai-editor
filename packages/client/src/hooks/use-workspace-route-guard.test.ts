// 工作区类型路由守卫（卡 8）：两个 kind 下都只可达自己的页面（**两侧都 fail-closed**）。
//
// 口径来自编排裁决：练习工作区下**只允许** `#/`、`#/practice`（含子路径）、`#/preferences`，
// 其余 hash 一律重定向 `#/practice`；小说工作区**默认放行小说路由**，只有练习专属段 `practice`
// 重定向 `#/`（它没有小说语义的页面；反方向不挡就会出现「小说左栏 + 练习占位页」的错配）。
// 这是 **UX 守卫**——边界仍是服务端 `requireKind`（400 KIND_MISMATCH）。
import { describe, expect, it } from "vitest";
import { parseHashRoute } from "./use-route";
import {
  NOVEL_REDIRECT_PATH,
  PRACTICE_ALLOWED_SEGMENTS,
  PRACTICE_REDIRECT_PATH,
  workspaceRedirectPath,
} from "./use-workspace-route-guard";

const route = (hash: string) => parseHashRoute(hash);

describe("练习工作区的允许清单（kind = practice）", () => {
  it("允许：根首页 `#/`、`#/practice` 及其子路径、`#/preferences`", () => {
    for (const hash of ["", "#/", "#/practice", "#/practice/sample-1", "#/preferences"]) {
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
    expect(PRACTICE_ALLOWED_SEGMENTS).toEqual(["practice", "preferences"]);
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
  it("练习专属段（含子路径）重定向 `#/`（根首页 = 工作区聚合入口，那里才有打开练习区的入口）", () => {
    for (const hash of ["#/practice", "#/practice/sample-1", "#/practice/x/y"]) {
      expect(workspaceRedirectPath("novel", route(hash)), hash).toBe(NOVEL_REDIRECT_PATH);
    }
  });

  it("小说路由与两个 kind 共有的路由都放行（不误伤：`#/`、`#/preferences`、`#/overview` 等）", () => {
    for (const hash of [
      "",
      "#/",
      "#/preferences",
      "#/overview",
      "#/outline",
      "#/outline/ch-1",
      "#/characters",
      "#/trash",
      "#/references",
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
