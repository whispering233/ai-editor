---
version: alpha
name: ai-editor 设计语言（Notion 工作区 × antd v6）
description: 本地优先的写作助手工作台。视觉取自 Notion 工作区（非其营销站）：暖灰纸感中性色、hairline 描边分栏、无阴影、彩色只用于状态与标签；实现基座是 antd v6 的 token 派发（AntdProvider 只覆盖少量 seed 与组件 token），故视觉规则与 antd 语义一一对应、不并存第二套组件系统。
colors:
  primary: "#37352f"
  on-primary: "#ffffff"
  secondary: "#5d5b54"
  tertiary: "#787671"
  quaternary: "#a4a097"
  canvas: "#ffffff"
  surface: "#f6f5f4"
  surface-soft: "#fafaf9"
  surface-muted: "#f0eeec"
  hairline: "#e5e3df"
  hairline-soft: "#ede9e4"
  hairline-strong: "#c8c4be"
  link: "#0075de"
  success: "#1aae39"
  warning: "#dd5b00"
  error: "#e03131"
  tint-peach: "#ffe8d4"
  tint-rose: "#fde0ec"
  tint-mint: "#d9f3e1"
  tint-lavender: "#e6e0f5"
  tint-sky: "#dcecfa"
  tint-yellow: "#fef7d6"
typography:
  page-title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
  section-title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.57
  body-medium:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.57
  caption:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.67
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
# ⚠ 组件子 token 白名单（规范硬约束，lint 会校验）：
# backgroundColor / textColor / typography / rounded / padding / size / height / width。
# 描边与阴影（border / shadow）不在白名单内——它们只能写在 §Components 的 prose 里，
# 因此 {colors.hairline*} 与 tint 色会稳定产生 orphaned-tokens 警告：属预期，见 §Iteration Guide。
components:
  page-title:
    textColor: "{colors.primary}"
    typography: "{typography.page-title}"
  section-title:
    textColor: "{colors.primary}"
    typography: "{typography.section-title}"
  body-text:
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  caption-text:
    textColor: "{colors.tertiary}"
    typography: "{typography.caption}"
  placeholder-text:
    textColor: "{colors.quaternary}"
    typography: "{typography.body}"
  link-text:
    textColor: "{colors.link}"
    typography: "{typography.body}"
  success-text:
    textColor: "{colors.success}"
    typography: "{typography.body}"
  warning-text:
    textColor: "{colors.warning}"
    typography: "{typography.body}"
  error-text:
    textColor: "{colors.error}"
    typography: "{typography.body}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
    height: 32px
  button-default:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
    height: 32px
  button-text:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
  icon-button:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.tertiary}"
    rounded: "{rounded.sm}"
    size: 28px
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: 32px
  select:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: 32px
  select-option-selected:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.primary}"
  menu-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: 32px
  menu-item-selected:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.primary}"
  sidebar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    width: 220px
  info-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.secondary}"
    typography: "{typography.caption}"
    height: 44px
  card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  empty-state:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.tertiary}"
    rounded: "{rounded.md}"
    typography: "{typography.body}"
  data-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    padding: "{spacing.xs} {spacing.sm}"
  data-row-hover:
    backgroundColor: "{colors.surface-soft}"
  table-header:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.secondary}"
    typography: "{typography.caption}"
  tag:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  # 标签 tint 六色（按名称 hash 稳定分配，见 §Components `tag`）：分类/标签 chip 与类型徽标的唯一底色来源
  tag-peach:
    backgroundColor: "{colors.tint-peach}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  tag-rose:
    backgroundColor: "{colors.tint-rose}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  tag-mint:
    backgroundColor: "{colors.tint-mint}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  tag-lavender:
    backgroundColor: "{colors.tint-lavender}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  tag-sky:
    backgroundColor: "{colors.tint-sky}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  tag-yellow:
    backgroundColor: "{colors.tint-yellow}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  drag-indicator:
    backgroundColor: "{colors.primary}"
    size: 3px
  search-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: 32px
    width: 192px
  status-badge:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "{spacing.xxs} {spacing.xs}"
  chat-bubble-user:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
  chat-bubble-assistant:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  focus-strip:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    typography: "{typography.caption}"
  proposal-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  dropdown-panel:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
  toast:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    typography: "{typography.body}"
---

# ai-editor 设计语言

> 事实源：本文件是**视觉唯一契约**（颜色/字体/圆角/间距/组件外观）。布局与交互结构见 `layout.md`；实现层 token 覆盖见本文 §Colors 的 antd 映射表与 §Components 的组件 token 覆盖表。改样式先改本文件，再改代码；改完跑 `designmd lint docs/ui/DESIGN.md`。

## Overview

**定位**：本地优先的写作助手工作台——三栏密集布局，长时间盯屏，结构化数据（大纲/人物/设定/地点/伏笔/时间轴/关联/参考资料）+ 常驻 AI 会话栏。**产品不编辑正文**，所以视觉不是「编辑器」，而是「创作资料台」。

**风格来源**：Notion **工作区**（不是 notion.com 营销站）。工作区与营销站是两套语言——营销站的紫色 CTA、深蓝 hero 带、马卡龙功能卡、80px 标题一律不采用；采用其工作区那一半：

- **暖灰纸感**：底色/描边/文字都带一丝暖（`#f6f5f4` / `#e5e3df` / `#37352f`），不是冷灰也不纯黑，长时间阅读更静
- **hairline 分栏**：结构靠 1px 描边，不靠阴影与色块
- **扁平**：零阴影（浮层除外），无渐变
- **安静**：彩色只服务状态与标签；界面本体是灰阶
- **密集**：正文 14px、行高 1.57、控件高 32px——信息密度优先于展示性留白
- **全站无衬线**：中文靠系统字体栈（`PingFang SC` / `Microsoft YaHei`），不下载 web 字体（离线可用）；**无例外（含书封）**——`font-serif` 与书封取色模块已删除（见 §Typography）

**情绪目标**：像一张干净的纸和一支安静的笔——不是仪表盘，也不是玩具。

## Colors

### 文字阶梯（primary → quaternary）

- **Primary (#37352f)**：Notion 的招牌暖炭墨。主文本、主按钮底色、选中态文字——**同时是品牌色与文本色**（antd `colorPrimary` 与 `colorText` 同值）。它不是纯黑，暖度来自 #37 的红分量。
- **Secondary (#5d5b54)**：次要说明、表头、徽标文字、次级按钮文字。
- **Tertiary (#787671)**：metadata、占位说明、图标默认色。
- **Quaternary (#a4a097)**：placeholder、禁用态、最弱的装饰文字。

### 表面（canvas → surface-muted）

- **Canvas (#ffffff)**：内容面板底色（中栏内容、卡片、浮层、下拉面板）。
- **Surface (#f6f5f4)**：外壳底色（左栏、窗口留白区）——比 canvas 暗一档，让面板「浮」出来，但不用阴影。
- **Surface Soft (#fafaf9)**：行 hover、focus 小条等最弱反馈面。
- **Surface Muted (#f0eeec)**：选中态/次级面（菜单选中项、user 气泡、Tag 底色）——**选中靠灰面而不是彩色**。

### 描边（hairline → hairline-strong）

- **Hairline Strong (#c8c4be)**：**交互描边**——输入框静止态、次级按钮边框（antd `colorBorder`：`input/style/variants.js` 与 `button/style/token.js` 的 `defaultBorderColor` 均取此值）——可点性信号比结构描边明确。
- **Hairline (#e5e3df)**：**结构描边**——卡片、表格外框（antd `colorBorderSecondary`）。
- **Hairline Soft (#ede9e4)**：**行分隔**——表格内线、列表行底线（antd `colorSplit`）。

### 交互与语义

- **Link (#0075de)**：正文链接专用，与 primary 分工明确——**链接是蓝的，按钮是墨的**，不混用。
- **Success (#1aae39) / Warning (#dd5b00) / Error (#e03131)**：语义三色，只用于状态（成功提示、校验失败、危险操作确认）。

### 标签色（tint 系，Notion database property 的回声）

- **tint-peach / tint-rose / tint-mint / tint-lavender / tint-sky / tint-yellow**：6 个马卡龙实底，专供标签/分类 chip（`data.tags`）与类型徽标（人物/设定/地点/伏笔/事件/时间点/参考资料/关系类型/回收站类型）等信息色块。**只做小面积底色，不做大面积背景**。
- 营销站那套 bold 黄（`#f9e79f`）与深蓝 hero 带**不纳入**。
- **分配规则（唯一，不维护语义色表）**：按 chip 文案（标签名 / 类型中文名 / 分类名）做 FNV-1a 哈希后取模 6，选中 tint；**同名恒同色**（跨页一致，无随机、无按状态变色）。字色固定 `{colors.primary}`（6 个 pastel 底上对比度均 ≥ 10:1，不需为每个 tint 配前景色）。
- **深色态**：6 色同色相以 20% 不透明度叠在深色面板上（保留色相、不刺眼），字色随 `{colors.primary}` 变 81% 白。**浅/深两套色调只定义在 `index.css` 的 `--tag-*` 段**（与 `AntdProvider` 的 antd 色阶并列——tint 不是 antd token，无法从 seed 派生，也不写成硬编码色值散落各处）。

### 交互与语义

### antd 实现映射（seed token，唯一改色入口）

改色只改 `packages/client/src/components/AntdProvider.tsx` 的 theme 对象；其余色阶由 light/dark 算法派生。

**⚠ cssVar 作用域（踩坑记录，改主题必读）**：antd v6 的 `cssVar` **从不把 `--ant-*` 注入 `:root`**——变量挂在**组件级 class 作用域**上（key 默认由 `useId` 生成，形如 `.css-var-_r_0_`，每个 antd 组件元素带该类；见 `antd/es/config-provider/hooks/useTheme.js` 的 cssVarKey 与 `useToken.js` 的 key 归属）。所以 `index.css` 里 `:root { --primary: var(--ant-color-primary) }` 这类映射会**整体解析为空**——全站 Tailwind 语义色（`bg-card` / `border-border` / `text-muted-foreground` / `bg-primary` / hover 面 / chip 底色 / 拖拽指示线）静默失效：不报错、只有看像素才发现。

**约定（不许改回去）**：`AntdProvider` 的 `cssVar: { key: CSS_VAR_KEY }`（`CSS_VAR_KEY = "ai-editor-theme"`）**必须**与 `packages/client/index.html` 的 `<html class="ai-editor-theme">` 一致——该 class 的定义体只含自定义属性（无视觉声明），把它同时加在 `<html>` 上即等价于 `:root` 作用域，映射才成立。`design-discipline.test.ts` 有守卫断言两处字面量一致。

| antd seed | 浅色值 | 深色值（推断） | 本文件 token |
|---|---|---|---|
| `colorPrimary` / `colorText` | `#37352f` | `rgba(255,255,255,.81)` | `{colors.primary}` |
| `colorTextSecondary` | `#5d5b54` | `rgba(255,255,255,.65)` | `{colors.secondary}` |
| `colorTextTertiary` | `#787671` | `rgba(255,255,255,.51)` | `{colors.tertiary}` |
| `colorTextQuaternary` | `#a4a097` | `rgba(255,255,255,.34)` | `{colors.quaternary}` |
| `colorBgContainer` / `colorBgElevated` | `#ffffff` | `#202020` / `#252525` | `{colors.canvas}` |
| `colorBgLayout` | `#f6f5f4` | `#191919` | `{colors.surface}` |
| `colorBorder` | `#c8c4be` | `#4a4a4a` | `{colors.hairline-strong}`（交互描边：Input 静止态 / Button default） |
| `colorBorderSecondary` | `#e5e3df` | `#2f2f2f` | `{colors.hairline}`（结构描边：Card / Table 外框；Tailwind `--border` 转发的就是它） |
| `colorFillTertiary` | `#f0eeec` | `rgba(255,255,255,.055)` | `{colors.surface-muted}`（选中面/次级面；Menu 选中底、Tailwind `--accent` 均取它） |
| `colorSplit` | `#ede9e4` | `#373737` | `{colors.hairline-soft}`（行分隔：Table 内线 / data-row 底线） |
| `colorLink` | `#0075de` | `#529cca` | `{colors.link}` |
| `colorSuccess` / `colorWarning` / `colorError` | `#1aae39` / `#dd5b00` / `#e03131` | 同 | 语义三色 |
| `borderRadius` / `borderRadiusSM` / `borderRadiusLG` | `6px` / `4px` / `8px` | — | `{rounded.sm}` / `{rounded.xs}` / `{rounded.md}` |
| `controlOutlineWidth` | `0` | `0` | 聚焦环宽度 = 0（焦点只靠 1px 描边色变化，见 §Elevation；selector 型组件的环唯一开关） |

**不登记派生色**：hover/active/禁用底、`colorFill*` 系列、深浅算法派生的色阶一律不写进本文件——登记了就必然与 antd 实际派发值漂移。本文件只登记「人为设定的值」。

**深色值来源**：Notion 未公开深色 token（源分析文档 `Known Gaps` 明示）——上表深色列是**推断值**：中性面按 Notion 深色工作区观感（`#191919` / `#202020`），文字按 81%/65%/51%/34% 白的阶梯，其余交给 antd `darkAlgorithm`。若日后与实机对不上，只按观感调 `AntdProvider` 一处。

## Typography

**族**：全站单一无衬线系统栈（`system-ui` → `PingFang SC` → `Microsoft YaHei`）。**不下载 web 字体**（本地优先、离线可用、首帧零 FOIT）。

**四档制（唯一字号集合）**：

| 档 | 字号 / 字重 | 用途 | antd 实现 |
|---|---|---|---|
| `{typography.page-title}` | 20px / 600 | 页面标题（每页一个） | `Typography.Title level={4}` |
| `{typography.section-title}` | 16px / 600 | 区块/卡片标题 | `Typography.Title level={5}` |
| `{typography.body}` | 14px / 400 | 正文、表单、列表行 | `--ant-font-size`（14） |
| `{typography.body-medium}` | 14px / 500 | 按钮文字、强调 | 按钮/`strong` |
| `{typography.caption}` | 12px / 400 | metadata、徽标、表头、提示 | `--ant-font-size-sm`（12） |

**删掉的档**：10px、11px、13px、`0.8rem`、18px 不作为独立档存在（旧手写 `text-[10px]`/`text-[11px]`/`text-[0.8rem]` 全部并入 12px）。需要「更小」时是信息层级没设计好，不是字号不够用。

**行高**：正文 1.57（antd 22px/14px），标题 1.4，caption 1.67（antd 20px/12px）。

**无衬线、无例外**：界面 chrome 与书封一律禁衬线——旧 `--font-serif` / `--font-heading` 与书封取色模块 `lib/book-cover.ts` 均已删除（批次十九 T10）。

## Layout

- **三栏**：左栏 NavRail（160-480px，默认 220）、中栏内容（保底 320px）、右栏 ChatPanel（240-720px，默认 380）；**无 TabBar**，页面组织只有一级导航。
- **间距基**：4px；实用档 `{spacing.xxs}`(4) / `{spacing.xs}`(8) / `{spacing.sm}`(12) / `{spacing.md}`(16) / `{spacing.lg}`(24) / `{spacing.xl}`(32)。沿用 antd `sizeUnit` 与 Tailwind 4px 网格，**无自定义间距值**。
- **页面内侧**：内容区 padding 16px；区块之间 12-16px；行内元素 8px；图标与文字间距 8px。
- **控件高**：常规 32px（`--ant-control-height`），小号 24px，大号 40px；行高 32-36px 保证密集列表节奏一致。
- **响应式**：`<1024px` 折叠右栏为抽屉、隐藏拖拽手柄（见 `layout.md`）；本设计语言不对移动端另立规则。
- **滚动**：各栏独立纵向滚动；分栏之间靠 1px hairline，不靠阴影或沟槽分隔线（旧 6px 灰分隔条已废）。

## Elevation & Depth

**默认零阴影。** 层级关系由「底色档 + 1px 描边」表达：`surface`（外壳）→ `canvas`（面板）→ `surface-muted`（选中/次级面）。

唯一例外是**浮层**（下拉、Popover、右键菜单、Tooltip）：

| 层级 | 处理 | 用途 |
|---|---|---|
| 0 平面 | 无阴影，1px `{colors.hairline}` | 卡片、行、面板——默认 |
| 1 浮层 | `0 8px 24px rgba(15, 15, 15, 0.10)` | 下拉/菜单/Popover/右键菜单/Toast |

**明令禁止**：antd 默认的按钮投影（`primaryShadow`/`defaultShadow`/`dangerShadow` 全部置 `none`）、彩色 focus 环（`Input`/`Select` 的 `activeShadow` 置 `none`，聚焦改为 1px 描边 + primary 色边框）、卡片 hover 抬升。

## Shapes

| token | 值 | 用途 | antd token |
|---|---|---|---|
| `{rounded.xs}` | 4px | Tag、状态徽标内衬、小内衬块 | `borderRadiusSM` |
| `{rounded.sm}` | 6px | 按钮、输入框、菜单项、focus 小条 | `borderRadius` |
| `{rounded.md}` | 8px | 卡片、浮层、气泡 | `borderRadiusLG` |
| `{rounded.full}` | 9999px | 状态圆点/胶囊徽标（**不用于普通按钮**） | — |

**与 Notion 原值的偏差（有意）**：Notion 卡片是 12px，我们取 8px——antd 的 `borderRadiusLG` 同时管 Modal/Drawer/Table 等大面，改成 12 会连带全站变圆。若日后要更圆，先评估 Modal/Drawer 的观感再改 seed。**按钮一律矩形，不用胶囊形**（Notion 的 sober-editorial 几何）。

**Tailwind 圆角变量已钉到本表**：`index.css` 的 `--radius-sm/md/lg` = `4px/6px/8px`（与 antd `borderRadiusSM`/`borderRadius`/`borderRadiusLG` 同值），不再由 `calc(var(--radius) * k)` 派生（旧值 9.6/7.7/5.8 与文档不符）。xl 以上（12/16/24/32px）曾为**遗留 tail**（供未收敛到 antd 的自绘组件用），组件收敛后已无消费者，批次十九 T10 已删除。

## Components

分层原则：**能用 antd 组件的地方不造第二套**（按钮/输入框/卡片/空态/提示全部用 antd），自绘只保留 antd 语义不匹配的浮层（右键菜单/受控 Dialog/轻量 Popover）与业务组件。

**描边与阴影的契约（prose 承载）**：DESIGN.md 规范的组件子 token 白名单只有 `backgroundColor/textColor/typography/rounded/padding/size/height/width`，`border`/`shadow` 写进 frontmatter 会被 lint 判为非法键——因此描边与阴影在这一节用文字定稿，也是实现时的唯一依据：

| 元素 | 描边 | 阴影 |
|---|---|---|
| sidebar（左栏） | 右侧 1px `{colors.hairline}` | 无 |
| info-bar（信息条） | 底部 1px `{colors.hairline}` | 无 |
| card / proposal-card / dropdown-panel / toast | 1px `{colors.hairline}` | 仅浮层（dropdown-panel / toast）：`0 8px 24px rgba(15, 15, 15, 0.10)`；card 无 |
| input / select / button-default / search-input | 1px `{colors.hairline-strong}` | 无 |
| 拖拽插入线（drag-indicator） | 无 | 无（实线 `{colors.primary}` 3px + 两端 8px 圆点） |
| empty-state | 1px 虚线 `{colors.hairline}` | 无 |
| data-row / table-header | 底部 1px `{colors.hairline-soft}` / `{colors.hairline}` | 无 |
| focus-strip | 1px `{colors.hairline}` | 无 |

聚焦态（input/select）统一：1px `{colors.primary}` 描边，**无阴影、无彩环**。

### 排版与容器

**`page-title`** — 每个页面一个主标题，`Typography.Title level={4}`（20px/600，`{colors.primary}`）。页面标题不再手写 `<h1 className="text-xl font-semibold">`。
**`section-title`** — 区块标题，`level={5}`（16px/600）。区块容器用 `card`：1px `{colors.hairline}` + `{rounded.md}` + `{spacing.md}` 内边距，**不带表头底色**（antd Card 默认行为，不用 `headerBg`）。
**`caption-text`** — metadata/表头/说明，`Typography.Text type="secondary"`（12px `{colors.tertiary}`）。
**`empty-state`** — 空态：虚线 `{colors.hairline}` 描边 + `{rounded.md}` + 居中 `{colors.tertiary}` 说明 + 可选主操作。antd `Empty` 的插图与外层组件统一（不再各页自画虚线框）。

### 按钮与表单

**`button-primary`** — 墨底白字、矩形、无投影。用于页面主操作（新建/保存）。
**`button-default`** — 白底 + `{colors.hairline-strong}` 描边（**文字型操作按钮必须带边框**，这是仓库既有红线 H4）。
**`button-text`** — 无边框纯文字，只用于行内最弱操作；**不得用于页面级操作**。**antd v6 `Button` 的 `variant` 必须与 `color` 同时给**（`antd/es/button/Button.js`：`if (color && variant)`”——否则静默回落到 `['default','outlined']`，`variant="text"` 会变成**带边框**按钮（右侧图标按钮一半有边框一半没有的根因）；合法写法：`color="default" variant="text"`，或遗留 `type="text"`；`design-discipline.test.ts` 有 `button-variant-color` 守卫。
**`icon-button`（统一约定）** — 全站图标型操作按钮**只有一种实现**：antd `Button variant="text" size="small"` + 图标（图标尺寸随字号类：行内 14px = `text-sm`、工具条 16px = `text-base`），颜色继承 antd 的 text 变体（`{colors.primary}`），hover/disabled/loading 由 antd 派发；**不再并存自绘 `<button>` 图标按钮**（历史上两者混用导致灰色/墨色/红色三套并存）。**不可恢复操作**（彻底删除 purge、物理删关系）用 `danger`（`{colors.error}`）；**软删**（移入回收站）保持常规色——危险色的语义是「不可撤销」，不是「删除」。图标一律 `@ant-design/icons`；状态用 Filled、操作与导航用 Outlined。
**`input`** — 白底 + `{colors.hairline-strong}` 描边 + `{rounded.sm}` + 32px 高；聚焦 = 1px primary 描边（**无阴影、无彩环**）。行内编辑与表单用同一个 antd `Input`。
**`search-input`** — 列表/富页筛选栏的搜索框（全站**统一形态**）：antd `Input` + `prefix={<SearchOutlined />}` + 固定宽 `192px`（`w-48`）+ `allowClear`（筛选类，清空即回到未筛）；placeholder 统一「搜索{对象}…」。位置固定在页面控件行的**最左**（见 `layout.md` §3）。
**`drag-indicator`** — 拖拽插入线：**实线** `{colors.primary}` 3px + 两端 8px 圆点（`h-[3px]` + `size-2 rounded-full`），横跨被拖行所在层级的内容宽度；`pointer-events-none` 不拦拖拽事件。
**拖拽目标行与临时高亮（prose 承载，色值不登记）** — 「拖到行中段 = 成为其子级」的拖拽目标行、以及「新建即聚焦 / 定位到节点」的临时高亮，统一用 **primary 10% 淡染面 + 1px primary 30% 描边**（`bg-primary/10 ring-1 ring-primary/30 ring-inset`，与选中态同一语言，**不用** `{colors.surface-muted}`：近白面在白底上不可见）。被拖行本体用 `opacity-50`。**非法落点**（防环/跨层级非法）：不显插入线、不显高亮（无反馈即「不可放」）。
**`select`** — 与 `input` 同一语言：白底 + 1px `{colors.hairline-strong}` 描边 + `{rounded.sm}` + 32px 高（密集行 24px = antd `size="small"`）；聚焦同样 1px primary 描边、无彩环。下拉浮层走 `dropdown-panel`（1px `{colors.hairline}` + `{rounded.md}` + 浮层阴影），选中项 `{colors.surface-muted}` 灰面。全站下拉统一 antd `Select`（原生 `<select>` 已清零）。

**选择器空态两种写法（都有据）**：**筛选类**（“全部/不限”，可清除）用 `allowClear` + `placeholder`（并为空值时传 `undefined`）；**表单类**（必选项的“请选择…”）保留 `{ value: "", label: 原文案 }` 作为首项，不做 placeholder 改造。组选（`optgroup`）用 `options` 分组对象 `{ label, options }`，组级禁用下推到组内每个 option（antd 分组对象无 `disabled`），组 label 文案保留。

**输入框默认值上收到 Provider**：`autoComplete: "off"` 经 `ConfigProvider` 的 `input` / `textArea` 默认 props 下发（v6 `InputConfig.autoComplete`），调用点不重复声明——禁浏览器历史建议，输入提示全由 datalist 候选与业务逻辑控制。
**`select-option-selected`** — 选中项 = `{colors.surface-muted}` 灰面，不变蓝。

### 导航与外壳

**`sidebar`** — 左栏底 `{colors.surface}`（比内容面板暗一档），右侧 1px `{colors.hairline}`；产品标识、回到书架、九项一级导航、工具区（回收站）、底部设置与主题。
**导航入口不受「文字按钮必须带边框」约束**：左栏导航项（Menu 九项 + 回到书架 / 设置 / 主题三个入口）与 Menu 项同级——无边框、选中态用 `{colors.surface-muted}` 灰面（Tailwind `bg-accent` = `colorFillTertiary`）、文字不变色，禁用 H4 只约束操作按钮（新建/重命名/重试/删除等）。**`menu-item`** / **`menu-item-selected`** — 菜单项 32px 高、`{rounded.sm}`；**选中 = `{colors.surface-muted}` 灰面 + 文字不变色**（antd 默认的彩色选中项要显式覆盖：`itemSelectedBg` / `itemSelectedColor`）。**`info-bar`** — 中栏顶部 1px 底线；项目名 + 当前位置 + 语言 + 小屏聊天开关。字号 `{typography.caption}`。

### 数据展示

**`data-row`** / **`data-row-hover`** — 列表/树/大纲行：无底色 + 底部 1px `{colors.hairline-soft}`；hover = `{colors.surface-soft}`。双击进详情、单击标题行内编辑（交互规则见 `layout.md` §7）。
**`table-header`** — 表头**白底**（不是 antd 默认灰底）+ 1px `{colors.hairline}` 底线 + caption 字色 `{colors.secondary}`。
**`tag`** — 分类/标签 chip（`data.tags`）与类型徽标：`{rounded.xs}` + **tint 六色底** + caption 字号 + `{colors.primary}` 字色（按名称 hash 稳定分配，见 §Colors 分配规则）。实现 = `components/ui/tag-chip.tsx`（自绘 span + `bg-tag-*` token 类）——**不用** antd `Tag` 的预设色：`Tag` 的默认底色由组件 token 派发、自定义 tint 只能走 `Tag` 的 preset/内联色，与「禁硬编码色值」冲突。antd `Tag` 仅保留给**带交互的元信息 chip**（如 focus 小条的 closable 标签）。**标签不做按钮形态**；灰色 `{colors.surface-muted}` 底仅用于无标签语义的占位 chip。
**`status-badge`** — 状态胶囊（进行中/已确认/已失效等）：`{rounded.full}` + caption 字号 + 语义色或 tint 底色；状态图标用 antd **Filled** 变体（`CheckCircleFilled`/`CloseCircleFilled`/`ExclamationCircleFilled`）。

### 会话（右栏）

**`chat-bubble-user`** — user 消息：`{colors.surface-muted}` 灰底（`colorFillTertiary`）+ `{rounded.md}` + `{colors.primary}` 字色。**禁止用 `colorPrimaryBg`**：主色 seed 是深墨（`#37352f`），antd 派生的 `colorPrimaryBg` 实测为 `#787771`（中灰）——灰底上压墨字，对比度 ~1.9:1，不可读（历史 bug）。
**`chat-bubble-assistant`** — assistant 消息：无底透明 + 正文排版（长文本可读性优先，不用气泡包）。
**`focus-strip`** — 「正在讨论：{类型} {名称}」小条：`{colors.surface-soft}` 底 + 1px 描边 + caption。
**`proposal-card`** — 提案卡：1px 描边卡片 + 确认/拒绝按钮（确认按钮用 `button-primary`，禁用态由 antd 派发）。
**`toast`** — 全局提示走 antd `message`（`App.useApp()`），顶部居中；`success/error/info` 对应 store 的 `ToastKind`，时长由 store 的 3s 定时器决定（`duration: 3` 对齐）。**命令式反馈的上下文入口**：`AntdProvider` 在 `ConfigProvider` 内部包 `<App component={false}>`（`component={false}` 不渲染包裹 div，不插进三栏 flex 链）——`message`/`notification`/`modal` 需经 `App.useApp()` 取实例才能继承本 Provider 的主题与 locale，不要用静态方法。

### antd 组件 token 覆盖（全部覆盖项就这些）

**浅/深两态各自给值**：`theme.token` 的显式值在算法派生之后覆盖（不被算法再加工），同一个浅色值写死会在深色态生效——因此 `AntdProvider` 按模式分写 `LIGHT_SEED`/`DARK_SEED` 与两套组件覆盖（下表「深色」列）。

| 组件 | token | 浅色 | 深色（推断） |
|---|---|---|---|
| Button | `primaryShadow` / `defaultShadow` / `dangerShadow` | `"none"` | `"none"` |
| Card | `bodyPadding` | `16` | `16` |
| Menu | `itemSelectedBg` / `itemSelectedColor` | `{colors.surface-muted}` / `{colors.primary}` | `#373737` / 81% 白 |
| Menu | `itemBorderRadius` / `itemHeight` / `itemMarginInline` | `6` / `32` / `4` | 同浅色 |
| Menu | `itemBg` / `activeBarBorderWidth` | `"transparent"` / `0` | 同浅色 |
| Table | `headerBg` / `borderColor` | `{colors.canvas}` / `{colors.hairline}` | `#202020` / `#2f2f2f` |
| Table | `cellPaddingBlock` | `8` | 同浅色 |
| Input | `activeShadow` | `"none"` | `"none"` |
| Typography | `titleMarginBottom` | `0` | `0` |
| Select | `optionSelectedBg` | `{colors.surface-muted}` | `#373737` |
| Tag | `defaultBg` | `{colors.surface-muted}` | `#373737` |

**聚焦环走 seed 而不是组件 token**：selector 型组件（Select/Cascader/DatePicker/Table 筛选）的聚焦环由 `boxShadow: 0 0 0 {controlOutlineWidth} {activeOutlineColor}` 绘制（`antd/es/select/style/select-input.js`），Select **没有** `activeShadow` 组件 token——统一用 seed `controlOutlineWidth: 0` 关闭（见 §Colors 映射表）。Input 的 `activeShadow: "none"` 是各自独立的阴影，二者都要。

**菜单透明底**：antd Menu 默认把 `itemBg`（= `colorBgContainer` 白）打在菜单根元素上，会在左栏 `{colors.surface}` 灰底里切出一块白——故 `itemBg: "transparent"` 让菜单继承左栏底色；`activeBarBorderWidth: 0` 去掉 inline 模式的右侧分界线（分栏由 sidebar 的 1px `{colors.hairline}` 表达）。这两项取代了旧代码里 `!border-none !bg-transparent` 的类覆盖。

**深色面值说明**：深色列的面值（`#373737` / `#202020` / `#2f2f2f`）复用 §Colors 映射表深色列已登记的中性值（行分隔档/面板档/结构描边档），**未发明新色**；它们语义上是「暗色下的选中/表头面」。若日后要独立调深色选中面，先在本表登记新值再改代码。

**新增覆盖需先写进本表**（禁止在调用点用 `!` 前缀类硬压 antd 样式——旧代码里 43 处 `!mb-`/`!mt-`/`!text-*` 随组件收敛一并清除）。

## Do's and Don'ts

### Do

- 颜色只经 antd token / 本文件登记的值；改色只改 `AntdProvider` 一处
- 用 1px 描边和底色档表达层级；浮层才允许唯一那一条阴影
- 选中态用 `{colors.surface-muted}` 灰面，不用彩色底
- 字号只用四档（20 / 16 / 14 / 12）；标题一律 `Typography.Title level={4|5}`
- 图标一律 `@ant-design/icons`；尺寸随字号类（14 `text-sm` / 16 `text-base` / 20 `text-xl` / 空态 24 `text-2xl`）；状态用 Filled、操作与导航用 Outlined
- 文字型**操作**按钮带边框（H4 红线）；操作按钮一律直接展示，不收进 `⋯` 菜单。导航入口（左栏 Navigation/Menu 项）不属此列
- 中文排版靠系统字体栈；不引入 web 字体

### Don't

- 不用营销站那套：紫 CTA、深蓝 hero 带、马卡龙大面积功能卡、胶囊按钮、80px 展示字
- 不用 `font-serif` / 宋体做标题（**无例外**：书封与界面一致）
- 不硬编码色值/色类（`text-blue-500`、`#1677ff`、`rgba(...)` 手写值）
- 不用 `!` 前缀类压 antd 组件样式
- **不要用 Tailwind 类去覆盖 antd 组件根元素上 antd 自己声明的属性**（`width` / `height` / `padding` / `margin` / `font-size` / `color` / `background` / `border` / `border-radius` / `display`）：antd 样式是运行时注入的**无层 CSS**，而 Tailwind 工具类在 `@layer utilities`——按 CSS 级联规范**无层胜出**，此类覆盖会静默失效（历史上满仓 `!` 就是这么来的）。正确做法：宽度/伸缩用**外层容器**承载；具体尺寸用组件 `size`；状态面用组件 `variant`（如 `variant="filled"` = `colorFillTertiary` = `{colors.surface-muted}`）或组件 token
- **不要让 `:root` 的语义变量失去 `--ant-*` 来源**：`cssVar.key` 与 `index.html` 的 `<html class>` 必须同值（见 §Colors 踩坑段），否则全站语义色集体失效
- 不用阴影、渐变、彩色 focus 环、卡片 hover 抬升
- 不引入第二套组件系统（lucide 图标 / sonner 提示 / cva 按钮已退役）；自绘只限 antd 无对应语义的浮层与业务组件
- 不用胶囊形按钮；不把彩色用于大面背景或正文

## Known Gaps

- **深色 token 未公开**：源分析文档明示未提取 Notion 深色值，上表深色列是推断值，只保证 antd 派生一致，未与实机逐项比对。
- **标签 tint 分配规则**：已实现（§Colors 标签色 —— 名称 hash 取模 6，同名恒同色）；新增标签体系时先看现有档位为什么不狗，不要另起色表。
- **tint 深色值未与实机比对**：深色态用「同色相 20% 叠色」推断（Notion 未公开深色 token），若日后观感不对，只改 `index.css` 的 `--tag-*` 深色段。
- **antd 派生色未登记**：hover/active/禁用底、`colorFill*`、浅色色阶由算法派生，本文件不复制（避免漂移）。
- **MD 编辑器是独立表皮**：参考资料页的 `@uiw/react-md-editor` 自带一套排版与配色，未纳入本设计系统（编辑器内部不套 chrome token）；若观感冲突，再单独收。
- **插件/第三方浮层未覆盖**：x-markdown 渲染出的表格/引用块样式由库自带，未做 token 映射。
- **响应式未细化**：只定义 `<1024px` 的抽屉回退，触屏尺寸与最小点击区未定义。

## Iteration Guide

1. 改视觉 → 先改本文件，再改 `AntdProvider.tsx`，最后改调用点；顺序反了必然产生「文档与实现两套事实」
2. 每次改完跑 `designmd lint docs/ui/DESIGN.md`（error 必须清零）。**两类稳定存在的 warning 属预期**：① `orphaned-tokens`——`{colors.hairline*}`、6 个 tint 只出现在 prose（规范无 border 子 token）；② 深浅算法的派生值不登记（避免与实现漂移）
3. 新组件先加 `components:` 条目 + §Components 一行说明，再写代码
4. 需要新色/新字号 = 先问「现有档位为什么不够」，能复用就复用（四档字号、四档圆角是刻意收紧的）
5. 覆盖 antd 组件 token 必须登记进覆盖表；调用点 `!` 前缀类是禁止项
6. 深色模式任何改动都要在浅/深两态下各看一遍（算法派生值随 seed 变化）
7. **改完主题必看像素**：本次 P0 事故（`:root` 映射失效）就是「文档/类型/测试全绿但像素全错」——改 `AntdProvider` / `index.css` / `index.html` 后，至少跑一次浏览器实测（`pnpm start:test-project` 或 `packages/client` 的 headless 探针），确认 `--ant-color-primary` 在 `:root` 有值
