// 主题切换 hook（layout.md §3.4：双主题浅/深 + 手动切换，localStorage 持久化，无自动时间段切换）
// 实现：document.documentElement.classList.toggle("dark", ...)（无 ThemeProvider 需求，轻量 hook）
// key `ai-editor:theme`，值 "light" | "dark"，默认 light
import { useEffect, useState } from "react";

const THEME_KEY = "ai-editor:theme";

export type Theme = "light" | "dark";

/**
 * 主题 hook：挂载时读 localStorage 应用主题；toggleTheme 写 localStorage + 切 .dark class。
 * 返回 { theme, toggleTheme }——theme 为当前主题（初始 light，挂载后为持久化值）。
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  // 挂载时恢复持久化主题（SSR 不适用，纯 CSR 直接读 localStorage）
  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const initial: Theme = stored === "dark" ? "dark" : "light";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  /** 切换主题：写 localStorage + 切 html.dark class（状态驱动 DOM；副作用在 updater 外，保证 updater 纯函数） */
  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
    setTheme(next);
  }

  return { theme, toggleTheme };
}
