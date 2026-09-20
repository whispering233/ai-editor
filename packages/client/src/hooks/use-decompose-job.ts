// 拆解 job 轮询 hook（卡 21.9）：进度页 `#/decompose` 与概览卡片 / 书架徽标共用同一份 job 状态。
//
// 契约：docs/api/120-api-decompose.md §job（响应字段）+ docs/ui/DESIGN.md §拆解小说（进度页）。五条口径：
// - **按项目为参数**（`projectId`）：job 属于项目，未打开书（null）时**完全不发请求**；切书（id 变）时
//   清空旧值并立即重拉——上一本书的状态不得留在界面上（新项目可能根本没有 job）；
// - **间隔 = `DECOMPOSE_POLL_MS`**（1–2s 档，常量只此一处——页面文案与测试不复述数字）；
// - **终态即停**（`isTerminalJobStatus`：done / failed 不再变，轮询没有意义）；
// - **没有 job 不轮询**（404 `DECOMPOSE_JOB_NOT_FOUND`；无已打开项目 409 `NO_PROJECT_OPEN` 同理）——
//   否则整页会在「没有拆解任务」上空转；
// - **瞬态失败继续轮询**（网络抖动 / 服务重启中）：旧 job 留在界面上，不把一次请求失败说成「任务没了」。
import { useCallback, useEffect, useState } from "react";
import type { DecomposeJobRes } from "@whispering233/ai-editor-shared";
import { ApiError, CLIENT_NETWORK_ERROR, getDecomposeJob } from "../lib/api";
import { isTerminalJobStatus } from "../lib/decompose";

/** 轮询间隔（1–2s 档；常量单一定义） */
export const DECOMPOSE_POLL_MS = 1500;

/** 该错误码是否意味着「没有可轮询的 job」（停止轮询）：404 无 job / 409 无已打开项目 */
export function stopsPollingForError(errorCode: string | null): boolean {
  return errorCode === "DECOMPOSE_JOB_NOT_FOUND" || errorCode === "NO_PROJECT_OPEN";
}

export interface DecomposeJobState {
  /** 当前项目的 job（null = 尚未取到 / 当前项目没有 job） */
  job: DecomposeJobRes | null;
  /** 最近一次拉取的错误码（null = 正常）；404/409 由页面呈现「没有拆解任务」 */
  errorCode: string | null;
  /** 立即重拉并重启轮询（pause / resume / rerun 成功后调用；也用于错误态的重试） */
  refresh: () => void;
}

export function useDecomposeJob(projectId: string | null): DecomposeJobState {
  const [job, setJob] = useState<DecomposeJobRes | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /** 手动刷新信号：+1 重启下面这个 effect（既立即重拉，也把停掉的轮询接回来） */
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  // 切书 / 关书：清空旧项目的 job（新项目的状态由下面的轮询补上）
  useEffect(() => {
    setJob(null);
    setErrorCode(null);
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    function schedule() {
      if (cancelled) return;
      timer = setTimeout(() => void load(), DECOMPOSE_POLL_MS);
    }

    async function load() {
      try {
        const next = await getDecomposeJob(controller.signal);
        if (cancelled) return;
        setJob(next);
        setErrorCode(null);
        if (!isTerminalJobStatus(next.status)) schedule();
      } catch (err) {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
        setErrorCode(code);
        if (stopsPollingForError(code)) {
          // 没有 job：清空旧值（可能是上一本书留下的）并停止轮询
          setJob(null);
          return;
        }
        schedule();
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, tick]);

  return { job, errorCode, refresh };
}
