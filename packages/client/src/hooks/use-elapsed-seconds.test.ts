import { describe, expect, it } from "vitest";
import { LONG_TASK_ELAPSED_HINT_MS, longTaskElapsedLabel } from "./use-elapsed-seconds";

describe("longTaskElapsedLabel（长任务的已用时文案）", () => {
  it("阈值之前不显示任何东西", () => {
    expect(longTaskElapsedLabel(0)).toBeNull();
    expect(longTaskElapsedLabel(1)).toBeNull();
    expect(longTaskElapsedLabel(LONG_TASK_ELAPSED_HINT_MS / 1000 - 1)).toBeNull();
  });

  it("到达阈值起显示已用时（含阈值那一刻）", () => {
    expect(longTaskElapsedLabel(LONG_TASK_ELAPSED_HINT_MS / 1000)).toBe("已用时 3 秒");
    expect(longTaskElapsedLabel(12)).toBe("已用时 12 秒");
  });
});