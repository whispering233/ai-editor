// antd 根 Provider（批次十七 0-2）：zhCN + 默认色板双算法主题
// Q5 决策 B：antd 默认色板起步（文学氛围 oklch tokens 退役，存量 Base UI/Tailwind 组件
// 迁移期仍走 index.css tokens，过渡期混存；antd 组件颜色一律 antd token，纪律见 layout.md §7）。
// 主题事实源 = html.dark class（index.html FOUC 内联脚本首帧已设；useTheme 各实例切换 class）——
// useThemeMode MutationObserver 跟随，无本地 state 复制，天然与 FOUC/既有切换入口一致。
import type { ReactNode } from "react";
import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useThemeMode } from "../hooks/use-theme-mode";

export function AntdProvider({ children }: { children: ReactNode }) {
  const mode = useThemeMode();
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        // cssVar 模式：tokens 注入 :root CSS 变量（--ant-*），index.css 语义变量映射之（3-0）
        cssVar: {},
        algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      {children}
    </ConfigProvider>
  );
}
