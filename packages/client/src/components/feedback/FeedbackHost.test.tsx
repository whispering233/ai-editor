// FeedbackHost 纯逻辑测试（U6 全局反馈组件）：仓库无 jsdom / @testing-library 环境，
// 组件渲染测试不可行（避免引入新依赖），故只测桥接判定函数 shouldNotifyToast 的去重规则。
// 该函数是 toast→sonner 桥接的核心契约：同一 toast 快照（同 id）在重渲染 / StrictMode 双执行下只触发一次。
import { describe, expect, it } from "vitest";
import type { Toast } from "../../stores/ui";
import { shouldNotifyToast } from "./FeedbackHost";

const makeToast = (id: number, kind: Toast["kind"] = "success"): Toast => ({
  id,
  kind,
  text: "已保存",
});

describe("shouldNotifyToast（toast→sonner 桥接触发判定）", () => {
  it("无 toast（null）时不触发", () => {
    expect(shouldNotifyToast(null, null)).toBe(false);
  });

  it("首次出现的新 toast 触发", () => {
    expect(shouldNotifyToast(makeToast(1), null)).toBe(true);
  });

  it("同一 toast id 不重复触发（重渲染 / StrictMode 双执行兜底）", () => {
    expect(shouldNotifyToast(makeToast(1), 1)).toBe(false);
  });

  it("新 id 覆盖旧 id 后触发（toast 依次出现，id 严格递增）", () => {
    expect(shouldNotifyToast(makeToast(2), 1)).toBe(true);
  });

  it("toast 清空后无残留状态——新 id 仍触发（无需在 null 时重置上次 id）", () => {
    expect(shouldNotifyToast(makeToast(3), 2)).toBe(true);
  });
});
