// 关窗前落盘的成败判定（`lib/desktop-flush.ts`）：真值表 + reject 即失败。
import { describe, expect, it } from "vitest";
import { flushSucceeded } from "./desktop-flush";

describe("flushSucceeded", () => {
  it("本页无保存动作（null）→ 成功", async () => {
    expect(await flushSucceeded(null)).toBe(true);
  });

  it("undefined / true → 成功", async () => {
    expect(await flushSucceeded(Promise.resolve(undefined))).toBe(true);
    expect(await flushSucceeded(Promise.resolve(true))).toBe(true);
  });

  it("false → 失败（页面失败分支的返回值）", async () => {
    expect(await flushSucceeded(Promise.resolve(false))).toBe(false);
  });

  it("reject → 失败（不外抛）", async () => {
    await expect(flushSucceeded(Promise.reject(new Error("保存失败")))).resolves.toBe(false);
  });
});