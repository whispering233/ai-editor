// 设定树「描述」显示开关的持久化。
// 为什么持久化：描述摘要行是阅读辅助，用户按屏幕/书写习惯长期开或关，刷新后不该回弹。
// 存储哲学同其他展示偏好 hook（use-theme / use-panels / use-writing-prefs）：纯展示偏好、不进项目文件 / 备份 / 云同步。
// 读写防御：坏值 / 隐私模式 / SSR 异常一律回落 `true`（默认显示，保持既有行为）。
// 契约：docs/ui/DESIGN.md §Components「data-row」、docs/design/config.md（key 清单）。
import { useState } from "react";

const SETTING_DESC_STORAGE_KEY = "ai-editor:setting-desc";

/** 解析持久化值（纯函数，可单测）：只有显式 `"false"` 是隐藏，其余回落显示 */
export function parseSettingDescVisible(value: string | null): boolean {
  return value !== "false";
}

/** 安全读取（隐私模式 / SSR → 默认显示）：读取本身也可能抛 */
function readStored(): boolean {
  try {
    return parseSettingDescVisible(window.localStorage.getItem(SETTING_DESC_STORAGE_KEY));
  } catch {
    return true;
  }
}

/** 写入（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeStored(visible: boolean): void {
  try {
    window.localStorage.setItem(SETTING_DESC_STORAGE_KEY, String(visible));
  } catch (error) {
    void error;
  }
}

/** 显示 state + 落盘：初值读 localStorage，切换即写回 */
export function useSettingDescVisible(): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState<boolean>(readStored);
  return [
    visible,
    (next) => {
      setVisible(next);
      writeStored(next);
    },
  ];
}
