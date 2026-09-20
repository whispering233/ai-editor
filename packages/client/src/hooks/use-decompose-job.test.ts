// use-decompose-job 的纯函数测试（卡 21.9）：轮询的终止条件与间隔常量。
//
// 为什么不测 hook 本体：hook 依赖 React 渲染与定时器（仓库无 jsdom，同 use-outline-view.test.ts /
// use-panels.test.ts 的口径）。轮询的「什么时候停」全部收在两个纯判定里，逐条可测：
// 终态（done / failed）与「没有 job」的两个错误码——这两类之外（网络抖动）必须继续轮询。
import { describe, expect, it } from "vitest";
import { isTerminalJobStatus } from "../lib/decompose";
import { DECOMPOSE_POLL_MS, stopsPollingForError } from "./use-decompose-job";

describe("DECOMPOSE_POLL_MS（轮询间隔，常量单一定义）", () => {
  it("落在 1–2s 档（更快压服务端、更慢看不出进度在动）", () => {
    expect(DECOMPOSE_POLL_MS).toBeGreaterThanOrEqual(1000);
    expect(DECOMPOSE_POLL_MS).toBeLessThanOrEqual(2000);
  });
});

describe("轮询终止条件", () => {
  it("job 进终态即停（done / failed 不再变；paused 可续拆，还要继续轮询）", () => {
    expect(isTerminalJobStatus("done")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("paused")).toBe(false);
    expect(isTerminalJobStatus("running")).toBe(false);
  });

  it("没有 job 即停：404 当前项目没有 job / 409 没有已打开的书", () => {
    expect(stopsPollingForError("DECOMPOSE_JOB_NOT_FOUND")).toBe(true);
    expect(stopsPollingForError("NO_PROJECT_OPEN")).toBe(true);
  });

  it("瞬态失败不停轮询（一次请求失败不等于「任务没了」；状态码放行照旧轮询）", () => {
    expect(stopsPollingForError(null)).toBe(false);
    expect(stopsPollingForError("CLIENT_NETWORK_ERROR")).toBe(false);
    expect(stopsPollingForError("DECOMPOSE_JOB_STATE")).toBe(false);
  });
});
