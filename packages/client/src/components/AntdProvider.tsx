// antd 根 Provider（建立；T1 起承载「Notion 工作区暖灰 token 覆盖」）
// token 值来源 = docs/ui/DESIGN.md §Colors「antd 实现映射（seed token）」表 +
// §Components「antd 组件 token 覆盖」表——本文件是改色的唯一入口（视觉契约事实源）。
// 主题事实源 = html.dark class（index.html FOUC 内联脚本首帧已设；useTheme 各实例切换 class）——
// useThemeMode MutationObserver 跟随，无本地 state 复制，天然与 FOUC/既有切换入口一致。
//
// ⚠ 分模式写 token 的原因：theme.token 的显式值由 antd 在算法派生之后覆盖（不是被算法再加工），
// 所以同一个浅色值写死会在深色态生效——两态各自给 seed 才正确（值取自 DESIGN.md 映射表的浅/深两列）。
// ⚠ cssVar 的 `--ant-*` 由 antd 注入在**组件级 class 作用域**，从不在 :root——见下方 CSS_VAR_KEY 段。
import type { ReactNode } from "react";
import { App, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useThemeMode } from "../hooks/use-theme-mode";

/** 模式无关 seed（几何/非颜色类）。controlOutlineWidth = 聚焦环宽度：0 → 聚焦只改描边色（无彩环），
 * 与 DESIGN.md §Elevation「focred 用 1px 描边、无环」一致；Select/Cascader/DatePicker 等 selector 型组件的环
 * 由 `boxShadow: 0 0 controlOutlineWidth activeOutlineColor` 绘制（select/style/select-input.js），只能从这里关。*/
const BASE_SEED = { controlOutlineWidth: 0 };

/** cssVar 作用域类名（= antd `theme.cssVar.key`）——必须与 index.html 的 `<html class>` 一致：
 * antd v6 把 `--ant-*` 注入到「组件级 class 作用域」，不注入 `:root`；只有把同一个 class 加在 <html> 上，
 * index.css 的 `:root { --primary: var(--ant-color-primary) }` 映射才解析得到值（否则全站语义色为空）。
 * 守卫测试 design-discipline.test.ts 断言两处字面量一致。*/
export const CSS_VAR_KEY = "ai-editor-theme";

/** 浅色 seed（DESIGN.md §Colors 映射表「浅色值」列逐行对应） */
const LIGHT_SEED = {
  ...BASE_SEED,
  colorPrimary: "#37352f",
  colorText: "#37352f",
  colorTextSecondary: "#5d5b54",
  colorTextTertiary: "#787671",
  colorTextQuaternary: "#a4a097",
  colorBgLayout: "#f6f5f4",
  colorBgContainer: "#ffffff",
  colorBgElevated: "#ffffff",
  // 描边三层（hairline-strong / hairline / hairline-soft）：
  // colorBorder = 交互描边（Input 静止态、Button default）；colorBorderSecondary = 结构描边（Card/Table）；
  // colorSplit = 行分隔（Table 内线）
  colorBorder: "#c8c4be",
  colorBorderSecondary: "#e5e3df",
  colorSplit: "#ede9e4",
  // surface-muted（选中面/次级面）——Menu/Select/Tag 的选中底与 Tailwind `bg-accent` 都取它
  colorFillTertiary: "#f0eeec",
  colorLink: "#0075de",
  colorSuccess: "#1aae39",
  colorWarning: "#dd5b00",
  colorError: "#e03131",
};

/** 深色 seed（DESIGN.md 映射表「深色值（推断）」列；Notion 未公开深色 token，按观感推断） */
const DARK_SEED = {
  ...BASE_SEED,
  colorPrimary: "rgba(255,255,255,0.81)",
  colorText: "rgba(255,255,255,0.81)",
  colorTextSecondary: "rgba(255,255,255,0.65)",
  colorTextTertiary: "rgba(255,255,255,0.51)",
  colorTextQuaternary: "rgba(255,255,255,0.34)",
  colorBgLayout: "#191919",
  colorBgContainer: "#202020",
  colorBgElevated: "#252525",
  colorBorder: "#4a4a4a",
  colorBorderSecondary: "#2f2f2f",
  colorSplit: "#373737",
  colorFillTertiary: "rgba(255,255,255,0.055)",
  colorLink: "#529cca",
  colorSuccess: "#1aae39",
  colorWarning: "#dd5b00",
  colorError: "#e03131",
};

/** 模式无关的组件覆盖（几何/结构类）：
 * - Button 三 shadow → 扁平（无投影）
 * - Input.activeShadow → 聚焦无阴影（聚焦环统一由 seed.controlOutlineWidth 关）
 * - Typography.titleMarginBottom → 标题下边距归零（页面级标题薄壳 PageTitle 依赖；间距由父容器给）
 * - Card.bodyPadding → 16（区块卡 SectionCard 的 16px 内边距，antd 默认 24） */
const COMPONENT_TOKENS_BASE = {
  Button: { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none" },
  Card: { bodyPadding: 16 },
  Input: { activeShadow: "none" },
  Typography: { titleMarginBottom: 0 },
};

/** 几何/背景类组件 token（与颜色无关，两态同一套）：
 * - itemBg: transparent —— 菜单根背景默认 colorBgContainer（白色），会把左栏灰底切出一块白
 *   （antd `menu/style/theme.js` 把 `background: itemBg` 打在菜单根上）
 * - activeBarBorderWidth: 0 —— inline 模式的右侧分界线宽度（`menu/style/theme.js`）
 * —— 这两项取代了 NavRail 原先的 `!border-none !bg-transparent` 类覆盖 */
const MENU_GEOMETRY = {
  itemBorderRadius: 6,
  itemHeight: 32,
  itemMarginInline: 4,
  itemBg: "transparent",
  activeBarBorderWidth: 0,
};
const TABLE_GEOMETRY = { cellPaddingBlock: 8 };

/** 输入框组件默认（T6：`components/ui/input.tsx` 删除后，其 `autoComplete="off"` 默认值上收至此）——
 * 禁浏览器表单历史建议（输入提示完全由 datalist 候选/代码控制，避免 Chrome 历史值幽灵提示）；
 * InputConfig / TextAreaConfig 均含 autoComplete（antd/es/config-provider/context.d.ts:206/209），
 * 显式传 autoComplete 的调用点仍可覆盖（antd/es/input/Input.js：`autoComplete: contextAutoComplete, ...rest`） */
const INPUT_AUTOCOMPLETE = { autoComplete: "off" };

/** 浅色组件覆盖（DESIGN.md §Components 覆盖表：面值取 {colors.surface-muted} / {colors.canvas} / {colors.hairline}） */
const COMPONENT_TOKENS_LIGHT = {
  ...COMPONENT_TOKENS_BASE,
  Menu: { ...MENU_GEOMETRY, itemSelectedBg: "#f0eeec", itemSelectedColor: "#37352f" },
  Table: { ...TABLE_GEOMETRY, headerBg: "#ffffff", borderColor: "#e5e3df" },
  Select: { optionSelectedBg: "#f0eeec" },
  Tag: { defaultBg: "#f0eeec" },
};

/**
 * 深色组件覆盖：DESIGN.md 只登记了浅色面值（`{colors.surface-muted}` 等），深色面值未登记——
 * 故不发明新色，面值一律复用映射表深色列已登记的两个中性值（`#373737` = 行分隔档、`#202020` = 面板档），
 * 语义上等同「暗色下的选中/表头面」。若后续 DESIGN.md 补登记深色 surface-muted，改指向登记值即可。
 */
const DARK_SELECTED_SURFACE = "#373737";
const COMPONENT_TOKENS_DARK = {
  ...COMPONENT_TOKENS_BASE,
  Menu: {
    ...MENU_GEOMETRY,
    itemSelectedBg: DARK_SELECTED_SURFACE,
    itemSelectedColor: "rgba(255,255,255,0.81)",
  },
  Table: { ...TABLE_GEOMETRY, headerBg: "#202020", borderColor: "#2f2f2f" },
  Select: { optionSelectedBg: DARK_SELECTED_SURFACE },
  Tag: { defaultBg: DARK_SELECTED_SURFACE },
};

export function AntdProvider({ children }: { children: ReactNode }) {
  const mode = useThemeMode();
  const dark = mode === "dark";
  return (
    <ConfigProvider
      locale={zhCN}
      input={INPUT_AUTOCOMPLETE}
      textArea={INPUT_AUTOCOMPLETE}
      theme={{
        // cssVar 模式：--ant-* 注入「组件级 class 作用域」（不是 :root）——靠 key 类同时挂在 <html>
        // 上，index.css 的 :root 语义变量映射才解析得到值（见文件头 CSS_VAR_KEY 说明）
        cssVar: { key: CSS_VAR_KEY },
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: dark ? DARK_SEED : LIGHT_SEED,
        components: dark ? COMPONENT_TOKENS_DARK : COMPONENT_TOKENS_LIGHT,
      }}
    >
      {/* antd App 上下文：反馈层经 `App.useApp().message` 拿命令式 message 实例（继承本 Provider 的主题与 locale）。
          component={false}：App 默认渲染一个 div 包裹层，会插进 AppShell 的三栏 flex 布局链，故渲染成 Fragment
          （依据 antd/es/app/App.d.ts `component?: CustomComponent<P> | false`；app/App.js 默认值 'div'）。*/}
      <App component={false}>{children}</App>
    </ConfigProvider>
  );
}
