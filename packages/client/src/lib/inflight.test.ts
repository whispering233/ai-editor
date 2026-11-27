import { describe, expect, it } from "vitest";
import { beginRead, endRead, getActiveReads, subscribeActiveReads } from "./inflight";

describe("在途读计数（GET in flight）", () => {
  it("begin / end 成对增减，且不会减到负数", () => {
    const base = getActiveReads();
    beginRead();
    expect(getActiveReads()).toBe(base + 1);
    beginRead();
    expect(getActiveReads()).toBe(base + 2);
    endRead();
    endRead();
    expect(getActiveReads()).toBe(base);
    // 多减一次（异常路径重复 finally）不得变成负数——否则刷新按钮会永久转圈
    endRead();
    expect(getActiveReads()).toBe(base);
  });

  it("订阅者在变化时被通知，注销后不再收到", () => {
    let calls = 0;
    const off = subscribeActiveReads(() => {
      calls += 1;
    });
    beginRead();
    expect(calls).toBe(1);
    endRead();
    expect(calls).toBe(2);
    off();
    beginRead();
    expect(calls).toBe(2);
    endRead();
  });
});