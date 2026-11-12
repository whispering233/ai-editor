// 提案自动确认（YOLO）持久化：全局纯展示偏好，不进项目文件 / 备份 / 云同步。
// 默认关；只有字符串 "true" 视为开（坏值 / 隐私模式 / SSR 异常一律回落关）。
// 契约：docs/ui/DESIGN.md `session-status-bar`、docs/design/config.md（key 清单）。
import { useState } from "react";

const YOLO_STORAGE_KEY = "ai-editor:yolo";

/** 解析持久化值（纯函数，可单测） */
export function parseYoloPreference(value: string | null): boolean {
  return value === "true";
}

/** 安全读取：store 在 agent_end 时现读（不缓存，切开关立即生效） */
export function readYoloPreference(): boolean {
  try {
    return parseYoloPreference(window.localStorage.getItem(YOLO_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** 写入（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeYoloPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(YOLO_STORAGE_KEY, String(enabled));
  } catch (error) {
    // 隐私模式 / 配额失败：偏好丢失不影响功能
    void error;
  }
}

/** 开关 state + 落盘：初值读 localStorage，切换即写回 */
export function useYoloPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(readYoloPreference);
  return [
    enabled,
    (next) => {
      setEnabled(next);
      writeYoloPreference(next);
    },
  ];
}
