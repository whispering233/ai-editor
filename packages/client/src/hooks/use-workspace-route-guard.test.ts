// 工作区类型路由守卫（卡 8）：练习工作区只允许自己的页面（fail-closed 允许清单）。
//
// 口径来自编排裁决：practice 下**只允许** `#/`、`#/practice`（含子路径）、`#/preferences`，
// 其余 hash 一律重定向 `#/practice`；小说工作区不设守卫（其路由表全量可达）。
// 这是 **UX 守卫**——边界仍是服务端 `requireKind`（400 KIND_MISMATCH）。
import { describe, expect, it } from "vitest";
import { parseHashRoute } from "./use-route";
import {
  PRACTICE_ALLOWED_SEGMENTS,
  PRACTICE_REDIRECT_PATH,
  practiceRedirectPath,
} from "./use-workspace-route-guard";

const route = (hash: string) => parseHashRoute(hash);

describe("practiceRedirectPath（练习工作区的允许清单）", () => {
  it("允许：根首页 `#/`、`#/practice` 及其子路径、`#/preferences`", () => {
    for (const hash of ["", "#/", "#/practice", "#/practice/sample-1", "#/preferences"]) {
      expect(practiceRedirectPath("practice", route(hash)), hash).toBeNull();
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
      expect(practiceRedirectPath("practice", route(hash)), hash).toBe(PRACTICE_REDIRECT_PATH);
    }
  });

  it("未知 hash（已被路由回退成根路由）不算违规——不会与回退逻辑打架", () => {
    expect(route("#/nope").isFallback).toBe(true);
    expect(practiceRedirectPath("practice", route("#/nope"))).toBeNull();
  });

  it("小说工作区不设守卫（全量路由可达，避免顺带收窄小说侧）", () => {
    for (const hash of ["#/outline", "#/practice", "#/trash", "#/overview", "#/"]) {
      expect(practiceRedirectPath("novel", route(hash)), hash).toBeNull();
    }
  });

  it("允许清单是 fail-closed 白名单（新增小说路由默认被挡，不必逐个枚举）", () => {
    expect(PRACTICE_ALLOWED_SEGMENTS).toEqual(["practice", "preferences"]);
    // 一个目前不存在、将来新增的一级段：练习工作区下默认被挡（未知 hash 已由路由回退成 `#/`，
    // 故这里直接构造路由对象——测的是守卫本身，不是路由表的回退行为）
    expect(
      practiceRedirectPath("practice", {
        path: "/brand-new-section",
        segments: ["brand-new-section"],
        isFallback: false,
      }),
    ).toBe(PRACTICE_REDIRECT_PATH);
  });
});
