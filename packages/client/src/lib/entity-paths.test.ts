// 实体路由一级化映射单测：段名唯一事实源 lib/entity-paths.ts
import { describe, expect, it } from "vitest";
import { entityDetailPath, entityListHost, entityListPath } from "./entity-paths";

describe("entity-paths 一级化映射", () => {
  it("列表路径：人物/设定/地点 → 各自一级段", () => {
    expect(entityListPath("character")).toBe("/characters");
    expect(entityListPath("setting")).toBe("/setting");
    expect(entityListPath("location")).toBe("/locations");
  });

  it("详情路径：各类型落宿主段（event→timeline、reference→references 为宿主详情页）", () => {
    expect(entityDetailPath("character", "char-1")).toBe("/characters/char-1");
    expect(entityDetailPath("setting", "set-1")).toBe("/setting/set-1");
    expect(entityDetailPath("location", "loc-1")).toBe("/locations/loc-1");
    expect(entityDetailPath("hook", "hook-1")).toBe("/hooks/hook-1");
    expect(entityDetailPath("event", "ev-1")).toBe("/timeline/ev-1");
    expect(entityDetailPath("timepoint", "tp-1")).toBe("/timepoints/tp-1");
    expect(entityDetailPath("reference", "ref-1")).toBe("/references/ref-1");
  });

  it("宿主返回路径：有列表 → 列表；无列表（hook/event/timepoint）→ 富页宿主", () => {
    expect(entityListHost("character")).toBe("/characters");
    expect(entityListHost("setting")).toBe("/setting");
    expect(entityListHost("location")).toBe("/locations");
    expect(entityListHost("hook")).toBe("/hooks");
    expect(entityListHost("event")).toBe("/timeline");
    expect(entityListHost("timepoint")).toBe("/timeline");
  });
});
