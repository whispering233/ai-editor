// 「设为当前位置」入口判据测试（卡片 1.1：章级收窄——仅章节点可承载写作进度）
// setCurrentPosition 本身只在调用点触发 store action + toast（无纯逻辑），
// 服务端契约由 packages/server/src/routes/project.test.ts 覆盖（非章 → 400 VALIDATION_ERROR）。
import { describe, expect, it } from "vitest";
import { isCurrentPositionHost } from "./current-position";

describe("isCurrentPositionHost（当前位置仅章）", () => {
  it("chapter → true", () => {
    expect(isCurrentPositionHost("chapter")).toBe(true);
  });

  it("volume / scene → false（卷太粗、场景太碎）", () => {
    expect(isCurrentPositionHost("volume")).toBe(false);
    expect(isCurrentPositionHost("scene")).toBe(false);
  });
});
