// 每日目标偏好的持久化（`localStorage` `ai-editor:writing-goal:{projectId}`，**按书隔离**）。
//
// 存储哲学同其他展示偏好 hook（use-setting-desc / use-outline-rail）：纯展示层偏好，
// 不进 data.db / 备份 / 导出 / 云端（口径 = docs/api/130-api-writing-stats.md「每日目标与连续天数」，
// key 清单 = docs/design/config.md §1）。
//
// 本 hook 只做「读写 + 归一」：解析与缺省回落、周序号归一、档位常量全部在 `lib/writing-goal.ts`，
// 有分支的逻辑不搬到这里（本仓无 jsdom，hooks 不做组件测试）。
import { useState } from "react";
import {
  defaultWritingGoalPreference,
  parseWritingGoalPreference,
  writingGoalStorageKey,
  type WritingGoalPreference,
} from "../lib/writing-goal";

interface GoalState {
  /** 该状态归属的项目 id（null = 未打开项目）；与入参不一致时在渲染期重读 */
  projectId: string | null;
  preference: WritingGoalPreference;
}

/** 安全读取（隐私模式 / SSR / 无项目 → 缺省）：读取本身也可能抛 */
function readStored(projectId: string | null): WritingGoalPreference {
  const key = writingGoalStorageKey(projectId);
  if (key === null) return defaultWritingGoalPreference();
  try {
    return parseWritingGoalPreference(window.localStorage.getItem(key));
  } catch {
    return defaultWritingGoalPreference();
  }
}

/** 写入（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeStored(projectId: string | null, preference: WritingGoalPreference): void {
  const key = writingGoalStorageKey(projectId);
  if (key === null) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(preference));
  } catch (error) {
    void error;
  }
}

export interface WritingGoalSession {
  preference: WritingGoalPreference;
  setGoal: (goal: number) => void;
  setEnabled: (enabled: boolean) => void;
  setWritingDays: (days: number[]) => void;
}

/** 偏好 state + 落盘：初值读 localStorage，任一项变更即归一后写回 */
export function useWritingGoal(projectId: string | null): WritingGoalSession {
  const [state, setState] = useState<GoalState>(() => ({
    projectId,
    preference: readStored(projectId),
  }));

  // 换书 = 换 key：渲染期重读（不用 effect，避免先渲染上一本书的偏好再纠正）
  if (state.projectId !== projectId) {
    setState({ projectId, preference: readStored(projectId) });
  }

  // 归一唯一入口仍是 parseWritingGoalPreference（写回与读回同一套规则）
  const update = (patch: Partial<WritingGoalPreference>): void => {
    const next = parseWritingGoalPreference(
      JSON.stringify({ ...state.preference, ...patch }),
    );
    setState({ projectId, preference: next });
    writeStored(projectId, next);
  };

  return {
    preference: state.preference,
    setGoal: (goal) => update({ goal }),
    setEnabled: (enabled) => update({ enabled }),
    setWritingDays: (writingDays) => update({ writingDays }),
  };
}
