// 主题模式跟随 hook（决策 43 卡 11.5：markdown 编辑器暗色联动）
// 问题：useTheme 是多处独立实例（Sidebar 的 toggleTheme 只更新自身 state），外部组件
// （@uiw/react-md-editor 的 data-color-mode）需要跟随全局主题——html.dark class 是唯一事实源。
// 实现：MutationObserver 监听 documentElement class 变化，切换即时生效（无 Provider 依赖）。
import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

/** 跟随 html.dark class 的主题模式（编辑器等外部组件 data-color-mode 适配用） */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMode(document.documentElement.classList.contains("dark") ? "dark" : "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}
