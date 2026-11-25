// FeedbackHost 纯逻辑测试（U6 全局反馈组件）：仓库无 jsdom / @testing-library 环境，
// 组件渲染测试不可行（避免引入新依赖），故只测两个桥接纯函数：
// - `shouldNotifyToast`：同一 toast 快照（同 id）在重渲染 / StrictMode 双执行下只触发一次；
// - `toastMessageArgs`：store 快照 → antd `message.open` 参数（三分支合并 + key 同槽位升级，
//   契约 = DESIGN.md §Components「toast」同槽位升级）。
import { describe, expect, it } from "vitest";
import { TOAST_DURATION_MS, type Toast } from "../../stores/ui";
import { shouldNotifyToast, toastMessageArgs } from "./FeedbackHost";

const makeToast = (id: number, kind: Toast["kind"] = "success"): Toast => ({
  id,
  kind,
  text: "已保存",
});

describe("shouldNotifyToast（toast→antd message 桥接触发判定）", () => {
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

describe("toastMessageArgs（toast 快照 → message.open 参数）", () => {
  it("kind 透传为 type，时长由 store 的毫秒值换算成秒", () => {
    expect(toastMessageArgs({ id: 1, kind: "error", text: "失败了" })).toEqual({
      content: "失败了",
      type: "error",
      duration: TOAST_DURATION_MS / 1000,
    });
  });

  it("无 key 时不带 key 字段（既有提示照旧叠加，行为不变）", () => {
    expect("key" in toastMessageArgs({ id: 1, kind: "success", text: "已保存" })).toBe(false);
  });

  it("有 key 时透传（同 key 的提示替换而非叠加：一次手动保存只留一条）", () => {
    expect(toastMessageArgs({ id: 2, kind: "success", text: "已保存", key: "save" }).key).toBe(
      "save",
    );
  });
});
