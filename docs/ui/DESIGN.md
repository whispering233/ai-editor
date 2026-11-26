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
  tint-sky: "#cce9fc"
  tint-sage: "#d1e2c4"
  tint-yellow: "#ffd800"
  paper-cream: "#fbf7ee"
  paper-warm: "#f2f0eb"
  type-badge-border: "#d94a4a"
  type-badge-border-soft: "#787671"
  character-role: "#b4551f"
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
  provider-icon:
    textColor: "{colors.tertiary}"
    size: 16px
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
  tabs:
    textColor: "{colors.secondary}"
    typography: "{typography.body-medium}"
  tabs-selected:
    textColor: "{colors.primary}"
    typography: "{typography.body-medium}"
  sidebar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    width: 160px
  main-toolbar:
    backgroundColor: "{colors.canvas}"
    height: 48px
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
  # 类型/分类徽标（描边式 chip；枚举值的唯一形态，见 §Components `type-badge`）：浅底 + 1px 红褐边框
  # 默认档边框 #d94a4a 两态同值（vs 浅底 3.61:1 / vs 深底 3.34:1）；底与字随主题翻转（浅 10.59:1 / 深 8.96:1）
  type-badge:
    backgroundColor: "{colors.surface-muted}"
    borderColor: "{colors.type-badge-border}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  # 标签 tint 三色（按名称 hash 稳定分配，见 §Components `tag`）：**只给用户标签 chip**（`data.tags` 元素），
  # 类型徽标不用 tint（走上面的描边式 `type-badge`）；三色均为浅色底 + 墨字（最低 8.80:1，sky 9.71）
  tag-sky:
    backgroundColor: "{colors.tint-sky}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 {spacing.xxs}"
  tag-sage:
    backgroundColor: "{colors.tint-sage}"
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
  # 实际视觉 = primary 5% 淡底 + 1px primary 25% 描边（alpha 不属 token 白名单，见 §Components `proposal-card`）
  proposal-card:
    rounded: "{rounded.md}"
    padding: "{spacing.xs}"
  dropdown-panel:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
  writing-toolbar:
    backgroundColor: "{colors.canvas}"
    padding: "{spacing.xxs}"
  command-help:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
    typography: "{typography.body}"
  toast:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    typography: "{typography.body}"
---

# ai-editor 设计语言

> 事实源：本文件是**视觉与布局唯一契约**（颜色/字体/圆角/间距/三栏布局与中栏页头结构/组件外观）。实现层 token 覆盖见本文 §Colors 的 antd 映射表与 §Components 的组件 token 覆盖表。改样式先改本文件，再改代码；改完跑 `designmd lint docs/ui/DESIGN.md`。

## Overview

**定位**：本地优先的写作助手工作台——三栏密集布局，长时间盯屏，结构化数据（大纲/人物/设定/地点/伏笔/时间轴/关联/参考资料）+ 章级正文 + 常驻 AI 会话栏。**正文在系统内书写（2026-09）**，但视觉主体仍是「创作资料台」：正文页 = **一行常显写作工具条** + 安静的单栏块编辑器（无侧边格式栏、无状态栏），可切「专注模式」把三栏外壳与页头一并收起；资料页维持高密度工作台形态。

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
- **Surface Muted (#f0eeec)**：选中态/次级面（菜单选中项、user 气泡、中性徽标 `type-badge` 底色）——**选中靠灰面而不是彩色**。

### 描边（hairline → hairline-strong）

- **Hairline Strong (#c8c4be)**：**交互描边**——输入框静止态、次级按钮边框（antd `colorBorder`：`input/style/variants.js` 与 `button/style/token.js` 的 `defaultBorderColor` 均取此值）——可点性信号比结构描边明确。
- **Hairline (#e5e3df)**：**结构描边**——卡片、表格外框（antd `colorBorderSecondary`）。
- **Hairline Soft (#ede9e4)**：**行分隔**——表格内线、列表行底线（antd `colorSplit`）。

### 交互与语义

- **Link (#0075de)**：正文链接专用，与 primary 分工明确——**链接是蓝的，按钮是墨的**，不混用。
- **Character Role (#b4551f 浅色 / #ef8354 深色)**：人物页左栏「角色定位」字色（`{typography.caption}` 小字）。**两态不同值**：原橙 `#ef8354` 当作文字压在白底上只有 2.61:1（12px 小字远低于 4.5:1），所以浅色态用同色相加深的 `#b4551f`（on 白 4.93:1 / on 选中灰面 4.60:1），深色态用原橙（on 深面板 6.24:1）。色相一致（H22 / H18），肉眼是同一个橙的深浅。
- **Success (#1aae39) / Warning (#dd5b00) / Error (#e03131)**：语义三色，只用于状态（成功提示、校验失败、危险操作确认）。

### 标签色（tint 系，Notion database property 的回声）

- **tint-sky / tint-sage / tint-yellow**（`#cce9fc` / `#d1e2c4` / `#ffd800`）：3 个浅色底，**只给用户标签 chip**（`data.tags` 元素：设定标签、事件标签、参考资料标签）。**枚举值（类型/分类/状态）一律不用 tint**——卷/章/场、实体类型、端点类型、关系类型、伏笔 `category`、回收站类型全部走**描边式** `type-badge`（§Components；大纲层级按卷/章·场取两档描边，见下）。理由：类型是**枚举**不是用户数据，逐个发彩色只是给每列都上了装饰，读者反而失去「彩色 = 这是标签」的信号；且 hash 取模本来就会撞色，着色并不承载语义。**只做小面积底色，不做大面积背景**。
- **色相分布（要注意的观感事实）**：`sky`(H203) 淡蓝 / `sage`(H94) 浅黄绿 / `yellow`(H51) 亮黄——三档**靠色相拉开**而不是靠深浅：sky 底对白 1.26 与 sage 1.36 / yellow 1.39 本就同一明度档（这版色板走「浅色底」路线），三色彼此色相不接近，所以同屏仍可辨。**为什么不是 5 档**：原 5 档里 `ice`(`#dbeafe`) 与 `sky` 只差明度、`mint`(`#6fb98f`) 是唯一的中间绿（观感偏"墨绿"、与 sage 同色系），三色里真正能一眼分开的只有 3 组 ⇒ 收到 3 档，标签色与「类型描边」的区分度反而更高。
- **`type-badge`（`{colors.surface-muted}` 底 + 1px `type-badge-border` `#d94a4a` 边框 + `{colors.primary}` 字）**：类型/分类徽标的**描边式**强调。底与字**随主题翻转**（浅：`#f0eeec` 底 + 墨字 10.59:1；深：叠色底 `#2c2c2c` + 81% 白字 8.96:1）——不像上一版那样两态恒定，是因为**底色不再自己带色相**（带色相的不透明块才需要锁死字色）。默认档（卷 / 其它枚举）边框色**两态同一值** `#d94a4a`（vs 浅底 3.61:1 / vs 深底 3.34:1，均不低于 3:1 非文本对比阈值）。
  - **大纲层级双档（2026-11）**：卷 = 现有红褐 `type-badge-border`；章 / 场 = 新增 `type-badge-border-soft`（浅 `#787671` / 深 `rgba(255,255,255,.51)`，vs 浅底 3.92:1 / vs 深底 4.84:1）。**软灰表达「下一级」，不是禁用**——「阅读进度」「推演节点」等状态徽标仍用红褐，其它枚举类型也不变。卷行少、承担分区标记，保留红褐；章行多，退到软灰后红褐只留在卷与状态上。
  - **为什么橙/浅红不能做边框**：实测彩色边框压在**灰底**上看不见——橙 `#ef8354` 对 `#f0eeec` 仅 1.43:1、浅红 `#ffb3b3` 仅 1.07:1（1px 线宽下等于没有）。浅色系只能做**面积**（tint 底），做**线**必须中深档。
  - **已知代价**：边框色与语义 `error`（`#e03131`）同色相。描边比实底轻，且徽标位置固定在行首/类型列；若日后混淆，改 `type-badge-border`。
- 营销站那套 bold 黄（`#f9e79f`）与深蓝 hero 带**不纳入**。
- **分配规则（唯一，不维护语义色表）**：按 chip 文案（标签名）做 FNV-1a 哈希后取模 3，选中 tint；**同名恒同色**（跨页一致，无随机、无按状态变色）。字色固定 `{colors.primary}`（3 个浅底上墨字对比 8.80–9.71:1，不需为每个 tint 配前景色）。
- **深色态**：3 色同色相以 20% 不透明度叠在深色面板上（保留色相、不刺眼），字色随 `{colors.primary}` 变 81% 白——**实测这套 3 色在深色态均达标**（叠 `#202020` 后的合成底与 81% 白字对比 5.96–6.18）。**浅/深两套色调只定义在 `index.css` 的 `--tag-*` 段**（与 `AntdProvider` 的 antd 色阶并列——tint 不是 antd token，无法从 seed 派生，也不写成硬编码色值散落各处）。

### 码字热力色（chart，GitHub 绿阶，2026-11）

- **浅色 `heat-1..4`**（`#9be9a8` / `#40c463` / `#30a14e` / `#216e39`）：GitHub 贡献图的浅 → 深绿阶；**深色 `heat-1..4`**（`#0e4429` / `#006d32` / `#26a641` / `#39d353`）：GitHub 深色贡献图（低档暗、高档亮，保证深底可辨）。0 档 = `{colors.surface-muted}`。
- **只用于码字热力图块**，不参与状态语义、文字与其他图表；值唯一定义在 `index.css` 的 `--heat-*` 段（同 tint 口径，不散落调用点）。

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
| `colorInfo` | `#37352f` | `rgba(255,255,255,.81)` | `{colors.primary}`（**与主色同值**：antd `Progress` 的默认描边取 `colorInfo` 而不是 `colorPrimary`（`antd/es/progress/style/index.js` 的 `defaultColor`）——不设该 seed 时进度条会渲染成 antd 蓝 `#1677ff`，与深墨设计语言冲突（2026-09 像素实测）） |
| `borderRadius` / `borderRadiusSM` / `borderRadiusLG` | `6px` / `4px` / `8px` | — | `{rounded.sm}` / `{rounded.xs}` / `{rounded.md}` |
| `controlOutlineWidth` | `0` | `0` | 聚焦环宽度 = 0（焦点只靠 1px 描边色变化，见 §Elevation；selector 型组件的环唯一开关） |

**显式覆盖的派生 alias（不是 seed，但同属「人为设定的值」，故登记）**：

| antd alias token | 浅色值 | 深色值 | 为什么必须覆盖 |
|---|---|---|---|
| `controlItemBgActive` | `#f0eeec` = `{colors.surface-muted}` | `#373737` | **选中面**。它由 `colorPrimary` 派生（`theme/util/alias.js`：`= colorPrimaryBg`）——主色 seed 是深墨 `#37352f`，派生的不是浅主色底而是中深灰 `#787771`，压 `colorText`（同为深墨）**对比度 2.26:1 不可读**。同一 token 被 `select` / `dropdown` / `menu` / `pagination` 的选中态与 `tree` / `table` / `cascader` 的行选中共用，故在全局一处对齐到已登记的选中面 |
| `controlItemBgActiveHover` | `#f0eeec` | `#373737` | **选中 + hover 面**。`= colorPrimaryBgHover`（实测 `#6b6a65`）——弹层打开时 antd 会把已选中项自动置为 active，命中 `select/style/dropdown.js` 的 `&-selected&-active { backgroundColor: controlItemBgActiveHover }`，于是 `Select.optionSelectedBg` 这类**组件级覆盖在真实交互路径上完全无效**（2026-09 用户实测「所有下拉选中条目看不清」）。取与选中面同一值：已选中项的面不随 hover 变化，选中信息优先；选中与悬浮仍可区分——antd `optionSelectedFontWeight` 默认 = `fontWeightStrong`（600），**选中项加粗** |
| `colorInfoBg` | `#f0eeec` = `{colors.surface-muted}` | 不覆盖（走算法派生） | **Alert `type="info"` 的面**（`alert/style/index.js` 的 `&-info`）。与选中面同源的坑：`colorInfo` 被设成主色（为 `Progress` 描边）后，antd 由它派生的 info 面是**中深灰**（浅色实测 `#787771`），压 12px 深墨说明文字 **2.7:1 不可读**（设置页「AI 模型」底部常驻说明，2026-09 用户实测）。面取次级面档——与 Tag 默认面同值。深色态不覆盖：那里派生值本就是深面板上的浅一档面 |
| `colorInfoBorder` | `#e5e3df` = `{colors.hairline}` | 不覆盖（走算法派生） | 同上（Alert info 的描边）。与 info 面同一条派生链（`genColorMapToken.js` 的 `infoColors[3]`），覆盖面不覆盖描边则边框仍为中灰 |

**不登记派生色**：hover/active/禁用底、`colorFill*` 系列、深浅算法派生的色阶一律不写进本文件——登记了就必然与 antd 实际派发值漂移。本文件只登记「人为设定的值」。（守卫：`src/components/antd-tokens.test.ts` 用 antd 自己的 `theme.getDesignToken` 算出**派生后**的 token，断言选中面家族（`controlItemBgActive` / `controlItemBgActiveHover` / `controlItemBgHover`——组件级选中面全由其派生：`select/style/token.js` 的 `optionSelectedBg: controlItemBgActive`、`menu` 的 `itemSelectedBg`、`tree` 的 `nodeSelectedBg`、`table` 的 `rowSelectedBg` / `rowSelectedHoverBg` 等）与 `colorText` 的对比度 ≥ 4.5:1，浅/深各一条（半透明面按该模式面板底色合成后再算，否则深色态会得到假值）；另含「裸深墨 seed 时确实 < 4.5」的自检；Alert info 面（`colorInfoBg`）同一条对比度断言。实测：去掉覆盖后浅色报 `controlItemBgActive=#787771 → 2.73:1`、深色同样变红，还原即绿。）

**深色值来源**：Notion 未公开深色 token（源分析文档 `Known Gaps` 明示）——上表深色列是**推断值**：中性面按 Notion 深色工作区观感（`#191919` / `#202020`），文字按 81%/65%/51%/34% 白的阶梯，其余交给 antd `darkAlgorithm`。若日后与实机对不上，只按观感调 `AntdProvider` 一处。

### 块编辑器（`--bn-*`），2026-09

章正文与参考资料正文用 `@blocknote/*`（ariakit 变体），它**不套 antd token**，而是由**唯一入口** `packages/client/src/components/blocknote/blocknote.css` 把 `--bn-*` 变量映射到本设计系统的色值/字体（等同 `AntdProvider.tsx` 之于 antd）：

| `--bn-*` 变量 | 本文件 token | 说明 |
| :--- | :--- | :--- |
| `--bn-colors-editor-text` | `{colors.primary}` | 正文文字 |
| `--bn-colors-editor-background` | `{colors.canvas}` | 正文底（**写作面纸张偏好**经 `--paper-bg` 间接覆盖，见下节） |
| `--bn-colors-menu-text` / `--bn-colors-tooltip-text` | `{colors.primary}` | 菜单/提示文字 |
| `--bn-colors-menu-background` / `--bn-colors-tooltip-background` | `{colors.canvas}` | 浮层底（深色态用 `{colors.canvas}` 深色值） |
| `--bn-colors-hovered-text` / `--bn-colors-selected-text` | `{colors.primary}` | 悬浮/选中文字 |
| `--bn-colors-hovered-background` / `--bn-colors-selected-background` | `{colors.surface-muted}` | 悬浮/选中面（与 antd 选中面同一 token，不另起色） |
| `--bn-colors-border` | `{colors.hairline}` | 结构描边 |
| `--bn-colors-side-menu` | `{colors.quaternary}` | 块手柄/加号 |
| `--bn-colors-highlights-*` | 不映射（编辑器自有） | 高亮/颜色选项保留库默认（md 导出本丢弃，见 `backlog.md`） |
| `--bn-font-family` | 本文件 `typography.body.fontFamily` | **界面 chrome 的字体**（工具条 / 浮层 / 菜单）：与全站同栈。**写作面字体不走这里**——库把基准字体写在挂在 `.bn-editor` 上的 `.bn-default-styles` 上，登记在 `.bn-root` 的它既到不了正文、又会把 chrome 一起改成衬线（见下节） |
| 字号/行高 | **吃库默认，不个性定制** | 跟排观感冲突再单独收（先吃默认，收敛策略同 antd 侧「先用默认档」） |

**硬约束**：① 块编辑器的改色**只能在 `blocknote.css`**（调用点不得写 `--bn-*` 覆盖、不得内联色值）；② 深浅两态**同源**——映射值全是随 antd 算法切换的变量（`--ant-*`），因此实现为「一段声明 + `.bn-root` 与 `.bn-root[data-color-scheme="dark"]` 两个选择器」（而不是浅/深两段硬值；库自带的深色默认段在构建产物中排在我们之后，必须用同特异性选择器并列才压得住，实测）；两态仍必须各看一遍像素；③ 新增/修订映射必须同步本表（顺序同 antd：先改本文件 → 再改 `blocknote.css`）；④ **用户偏好只能改「值的来源」，不能改映射目标**——写作面偏好（字体/字号/行高/纸张/纹理/段首缩进）由调用侧在容器上设 `--writing-*` / `--paper-*` 变量（`blocknote.css` 里写成 `var(--writing-font, var(--font-sans))` 形式的**间接引用**），**调用点仍不得写 `--bn-*`**，守卫 `design-discipline.test.ts` 不变；
  ⑤ **间接引用要落在「库自己也显式声明过」的那个元素上**，不能落在只是被继承的上游：字号/字体/行高都属此列（库把基准写死在 `.bn-default-styles`（挂在 `.bn-editor`）与 `.bn-block-outer` 上），所以本仓一律写成 `.bn-container .bn-editor { … }` / `.bn-container .bn-block-outer { … }`（0,2,0 压过库的单类 0,1,0）。**2026-09 实测教训**：字体当初按 `--bn-font-family`（登记在 `.bn-root`）做，结果正文 font-family 仍是库的 `Inter…`（被 `.bn-default-styles` 隔断）、而**工具条反而变成了宋体**——两头都错。

### 写作面偏好（字体 / 字号 / 行高 / 纸张 / 纹理 / 段首缩进），2026-09

章正文与参考资料共用的**用户自选书写偏好**（不是新组件表皮：一律经 `blocknote.css` 的间接引用生效）。**唯一存储** = `localStorage` key `ai-editor:writing`（与主题 / 三栏宽度同哲学：纯展示偏好，不进项目文件 / 备份 / 云同步；全站 key 清单见 `config.md`——**不要在文档里写序号**，「第 N 个 key」加一个就腐一个）；全局一份，两处书写面共用。**档位数值的单一定义 = `packages/client/src/hooks/use-writing-prefs.ts` 的常量**（本表是契约；测试锁定档位字面值 ⇒ 改值而不改本表会报红——避免「改值漏改档位」的老毛病）。

| 维度 | 档位（默认加粗） | 变量 | 说明 |
| :--- | :--- | :--- | :--- |
| 字体 | **无衬线** / 宋体 / 楷体 / 仿宋 / 等宽 | `--writing-font` | 全**系统字体栈**（不下载 web 字体）；宋/楷/仿宋按 `Songti SC`/`SimSun`、`Kaiti SC`/`KaiTi`、`FangSong` 顺序回落，最终落 `serif`；等宽落 `ui-monospace`/`Consolas`/`monospace`。**落点 = 正文元素**（`.bn-container .bn-editor`，不走 `--bn-font-family`——那是 chrome 的字体，见上节硬约束⑤）；代码块钉住等宽（库未给 `codeBlock` 设等宽，不钉会被写作面字体带着变衬线） |
| 字号 | 14 / **16** / 18 / 20 | `--writing-font-size` | 库默认正文基准是 16px；标题级别在库内是 em 基准（`3em`…`.8em`）⇒ 改基准字号标题同比缩放，安全 |
| 行高 | **1.5** / 1.8 / 2.0 | `--writing-line-height` | 覆盖库的 `.bn-block-outer{line-height}`（库默认 1.5） |
| 纸张 | **默认（`{colors.canvas}`）** / 米黄 `{colors.paper-cream}` / 暖灰 `{colors.paper-warm}` | `--paper-bg` | 深色态对应值（`#221f19` / `#262522`）同 `--tag-*` 口径写在 `index.css`；实测浅色态字色对比 11.47:1 / 10.77:1，深色态 11.10:1 / 10.54:1（默认底 12.26:1 / 11.10:1）。**默认档不给值**（`var(--paper-bg, …)` 兜回 `{colors.canvas}`）。**落点要写两处**：`.bn-container` **与** `.bn-container .bn-editor`——库给 `.bn-editor` 自己声明了不透明的 `background-color: var(--bn-colors-editor-background)`，只写容器会被它盖住（硬约束⑤ 的又一实例）；工具条底用**同一表达式**（DESIGN 的「纸上一色」） |
| 纹理 | **无** / 横线 / 网格 | `data-writing-paper` | 画在正文底元素上（`.bn-container .bn-editor`，理由同上）；间距 = 常量 `--writing-paper-step`（**唯一定义处 = `blocknote.css`**）；线色 = `{colors.hairline}`（经 `--ant-color-border-secondary`，不另造灰）；实测线 vs 纸底 1.13–1.23:1，**纯装饰**、间距固定、**不与文本行对齐**（有意：标题/列表/图片高度各异，相位必然错开；真对齐须锁死行高与段距、禁用标题类块，得不偿失） |
| 段首缩进 | **关** / 开 | `data-writing-indent` | 开 = 段落首行 `text-indent: 2em`（中文小说惯例）；只作用于段落块，标题/列表/引用不受影响 |

**为什么纸张不算「大面彩色」**：三档中两档是低饱和「纸感」中性色（明度差 ≤1.5:1），默认仍是 `{colors.canvas}`；且它作用面只有书写区，不参与列表/表单/徽标。（§Don't「不把彩色用于大面背景」的登记例外。）

**为什么字体是中国写作场景的例外**：界面 chrome 一律无衬线（§Typography），但正文书写面上「宋/楷/仿宋」是写作习惯而非装饰；实现不引入 web 字体、不新增字号档（四个字号档位仍受 §Typography 约束——写作面字号是**正文基准字号**，不是新的界面字号档）。

**纹理不再当「纸」卖**：横线/网格只做纸张质感，间距与线色都按装饰级调（默认关闭）——这是与「正文可读性优先」的取舍。

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

**无衬线 = 界面 chrome 的规则（唯一例外 = 正文书写面）**：标题、导航、按钮、表格、书封一律禁衬线——旧 `--font-serif` / `--font-heading` 与书封取色模块 `lib/book-cover.ts` 均已删除（T10）。**唯一例外 = 用户在写作面自选的字体**（宋/楷/仿宋/等宽，见 §Colors 写作面偏好）：那是「稿纸」而不是界面，且**默认仍是无衬线栈**；「不下载 web 字体」这条对例外同样成立。

**斜体 = 合成倾斜，不是独立字面（2026-09）**：系统栈里的中文没有真斜体，浏览器对 CJK 做合成倾斜（shear）——墨迹会**越出字宽**（16px 两字实测右 2px / 左 1px）。所以斜体标签**不得**挂 `truncate` / `overflow: hidden`（会把最后一字的右缘切掉，实例：§导航与外壳 的「书架」标签）；要防溢出用 `whitespace-nowrap`，确实需要截断的（动态长文本）则补 `pr-0.5` 把 padding 让出来。斜体只用于「占位/非正式」语义（左栏顶部标识、时间轴「未挂载」组标题），正文与按钮不用。

## Layout

- **三栏**：左栏 NavRail（可读区间 160-480px）、中栏内容（保底 320px、**吸收剩余宽度**）、右栏 ChatPanel（240-960px）；**无路由级 TabBar**——页面组织只有一级导航（左栏），页面内可有分区 tab（如设置页二级 tab），**不进 URL、不参与导航高亮**。
  - **整栏开关锚定视口顶带两角（2026-11 修订）**：左栏 / 右栏的收起展开**不在中栏工具栏、也不在任何会伸缩的列里**——两枚 `PanelToggleButton` 由外壳 `ShellPanelToggles` 常驻渲染，绝对定位于应用根（y 恒 12px；左钮 `left:16px`、右钮 `right:16px`，即右钮左缘 = 视口宽 − 40px）。**坐标只由视口决定**：拖拽栏宽、收起 / 展开都不移动、不卸载（焦点保留、连点不丢）。三段 48px 顶带按可见性为开关预留 48px 槽位（16 边距 + 24 钮 + 8 呼吸）（左栏展开 → `NavRail` 顶行；左栏收起 → 中栏工具栏左端；右栏同理镜像），使各栏自身内容的起点不随收起态跳动。窄屏（右栏是抽屉）与专注模式不渲染。桌面态另有键盘入口：`Ctrl/Cmd+B` 切左栏、`Ctrl/Cmd+Shift+B` 切右栏（与顶带开关同一动作；焦点在输入框 / 块编辑器内不抢键——块编辑器的 `Mod+B` 是加粗）。**面板内子栏的开关仍按外端锚定放在 `PanelHeader`**（见「工作台子栏页头」），两套口径不得互换。
  - **默认宽度 = 按视口算 1:5:4**：左 = `clamp(视口×10%, 160, 480)`、右 = `clamp(视口×40%, 240, 960)`、中 = 剩余；两根 6px 拖拽手柄也从剩余里扣。**区间外由中栏吸收偏移**：`视口<1600` 左栏取下限 160（比 10% 宽 16-32px，中栏略窄于 50%）；`1600≤视口≤2400` 严格 1:5:4（右栏上限 960 = 2400 的 40%，故不漏进来咬比例）；`视口>2400` 右栏封顶 960、剩余给中栏——聊天列再宽无阅读收益，中栏变宽才是想要的。（拖拽/持久化值同样收敛到这两个区间。）
- **间距基**：4px；实用档 `{spacing.xxs}`(4) / `{spacing.xs}`(8) / `{spacing.sm}`(12) / `{spacing.md}`(16) / `{spacing.lg}`(24) / `{spacing.xl}`(32)。沿用 antd `sizeUnit` 与 Tailwind 4px 网格，**无自定义间距值**。
- **页面内侧**：内容区 padding 16px；区块之间 12-16px；行内元素 8px；图标与文字间距 8px。
- **控件高**：常规 32px（`--ant-control-height`），小号 24px，大号 40px；行高 32-36px 保证密集列表节奏一致。
- **响应式**：`<1024px` 折叠右栏为抽屉、隐藏拖拽手柄（见「布局」三栏段）；本设计语言不对移动端另立规则。
- **滚动**：各栏独立纵向滚动；分栏之间靠 1px hairline，不靠阴影或沟槽分隔线（旧 6px 灰分隔条已废）。
- **分栏边线单所有权（2026-11）**：交界处那条 1px 线**由面板自己画**——左栏 = `NavRail` 的 `border-r`、右栏 = `ChatPanel` 的 `border-l`、写作页卷章栏 = 桌面展开态的 `border-r`；**6px `ResizeHandle` 不画常显中线**（只在 hover / 拖拽时整条染成半透明带）。理由：手柄仅在「桌面 + 该栏展开」时存在，右栏抽屉、窄屏两级、收起（0 宽）三种形态都没有手柄 ⇒ 只有面板边线能覆盖全部场景；两边各画一条会在交界处留下相距约 3px 的**双竖线**（2026-11 用户报）。面板边线随面板边缘移动，拖拽时线跟手，不需要手柄再补一条。
- **写作页（`#/writing`）的中栏内分栏（2026-11）**：中栏 = **卷章导航栏**（默认 240px、可拖拽 200–480px、可收起为 0px（正文列吸收宽度）；展开态由卷章栏自身 1px 右边线充当分栏线，收起态不渲染 rail、无分栏线；自身纵向滚动）+ **正文列**（吸收剩余宽度，承载页头与写作面）。两列都铺满中栏高度：页面外壳 `-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden` 抵消内容区 `p-6`（同人物工作台），正文列内补回同一内边距——**外层分栏只做宽度切分，不得用 `items-start` / `self-start` 截断交叉轴**（否则正文列的 `h-full` 拿不到高度，见 §写作面高度链）。宽度 <1024px 退化为两级互斥（见 `writing-page`）。
- **大纲页（`#/outline` / `#/outline/:nodeId`）的中栏内分栏（2026-11 改版）**：中栏 = **大纲树 rail**（默认 `max(320px, 中栏 1/3)`、拖拽 280–600px、可收起为 0px；展开态由 rail 自身 1px 右边线充当分栏线；自身纵向滚动）+ **详情列**（吸收剩余宽度，承载详情页头 + 单列详情）。两列铺满中栏高度：外壳与内边距抵消同写作页（`-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden`，详情列内补 `p-6`）。窄屏 <1024px 退化为两级互斥（见 `outline-page`）；宽度 / 收起态持久化 key `ai-editor:outline-rail`。
- **设定页（`#/setting` / `#/setting/:id`）的中栏内分栏（2026-11 改版）**：中栏 = **设定树 rail**（默认 `max(320px, 中栏 1/2)`、拖拽 280–720px、可收起为 0px（详情列吸收宽度）；展开态由 rail 自身 1px 右边线充当分栏线；自身纵向滚动）+ **详情列**（吸收剩余宽度，承载设定详情；右侧详情也可收起为不渲染，见 `setting-page`）。两列铺满中栏高度：外壳与内边距抵消同写作页（`-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden`，详情列内补 `p-6`）。窄屏 <1024px 退化为两级互斥（见 `setting-page`）；宽度 / 两档收起态持久化 key `ai-editor:setting-rail`。
- **专注模式（2026-09，仅写作页章正文）**：隐藏左栏 / 右栏 / `main-toolbar` / 页头 / **写作页卷章导航栏与窄屏返回条**，正文独占视口宽度；**不另起悬浮条**——写作工具条本身即顶部常驻条，右端承载「字数 · 保存态」（与常规态页头同口径、**不两处同时显示**）与专注开关（同一按钮切换「专注模式 / 退出专注」）；`Esc` 退出（**开层守卫**：有可见浮层时该次 `Esc` 归浮层）；状态**不持久化**（不入 localStorage，刷新即回常规布局）；**路由离开即失效**（切章/前进后退不残留）。
  - **专注态下 AI 入口整体不可达（有意）**：中栏右下「问 AI」悬浮球在专注态**不渲染**——实测留着它只会弹一条「可直接在右栏提问」而右栏已被隐藏（指错方向 + 死角）。要问 AI 先退出专注（一次 `Esc`）。
- **「问 AI」悬浮球（中栏右下）的页面语义**：无行级焦点时按页面注入——**大纲组页面**（`#/outline` / `#/outline/:nodeId`）在项目**存在可见推演节点**时注入**推演节点集合**（`title` = 「带着推演节点去问 AI」，focus 小条同步显示「推演节点 · N 个」）；其余情况维持现状（无焦点 → 普通进入聊天 + 中性提示）。注入内容由服务端现读项目配置展开（`20-context.md` §2）。

### 中栏页头结构

自上而下：**标题行**（`page-title`，每页一个）→ **二级 tab 行**（可选：设置页二级 tab、人物页四 tab）→ **控件行**（可选：左侧搜索框恒最左 192px（`search-input`）、操作按钮靠右）→ **分割线** → **内容区块**。

- **分割线**：1px `{colors.hairline}`（结构描边档，与 `main-toolbar` 底线同档；不是 `hairline-soft` 的行分隔档），宽度与内容区块同宽——不穿透中栏内容区的内边距。
- **有 tab 时不再另画分割线**：antd line 型 `Tabs` 的横向导航条**自带** 1px `{colors.hairline}` 底线（`antd/es/tabs/style/index.js` 的 `&-nav-list::before { borderBottom }`），该底线即分割线；配套 `horizontalMargin: 0`（antd 默认 `0 0 16px 0` 会在 tab 与内容间留 16px 空档，压在分割线上就是双线）。
- **间距**：页头与内容区块之间 `{spacing.md}`（16px）；页头内部三段之间 `{spacing.sm}`（12px）。
- **标题行窄于操作组时（带 `leading` 的页面，2026-11）**：标题行允许换行，操作组落到第二行；操作组自身空间不足时也换行（按钮不得被裁切）。标题不得被压成 0 宽；不传 `leading` 的页面保持单行。**例外 = `panel-header`（见下条「工作台子栏页头」）：固定 40px、不换行。**
- **覆盖范围 = 全部中栏页面**：列表/富页、概览、书架、回收站、设置，以及各详情页——详情页的页头 = 标题行 + 操作按钮 + 元信息行，分割线落在元信息行**之下**。加载态/空态/错误态同样保留（分割线属于页头，不随数据变）。
- **页头常驻（2026-09 口径）**：页头（标题行 + 操作 + 元信息 + 分割线）**固定在内容区上方，只有内容区滚动**——避免滚动后找不到标题与页面级操作（章正文原先跟着正文滚走，与参考资料页不一致）。**实现 = 页面 `section` 用 `flex h-full min-h-0 flex-col`，内容（含各自的错误条之下的部分）放进内层 `flex min-h-0 flex-1 flex-col overflow-y-auto`**；`h-full` 让 section 恰好等于中栏滚动容器的内容区 ⇒ 外壳不滚、内层滚（参考资料详情 / 参考资料列表 / 人物工作台 / 时间轴 / **写作页** / **大纲页（rail header 与详情页头分别常驻）** 采用）。
  - **写作面的高度链在内层滚动容器里续接**：写作页 = 正文列内的 section（`h-full`）→ 内层滚动容器（`flex min-h-0 flex-1 flex-col overflow-y-auto`）→ `.bn-container`（`flex: 1 1 auto`，blocknote.css）⇒ 写作面仍铺满剩余高度，工具条 `sticky` 贴的是**内层**滚动容器顶（页头之下）。
  - **尚未统一**：概览 / 实体列表 / 设置 / 回收站等仍走外壳滚动（页头随内容离开）——列入 `backlog.md`，逐页改造时按上面同一条实现口径。
- **实现唯一入口 = `components/ui/page-header.tsx`**（标题行 / tab 行 / 控件行 / 分割线一次给全）：页面不自画页头分割线（表格行、分组头等区块内部的 `border-b border-border` 不属此列）。

- **工作台子栏页头（`panel-header`，2026-11；仅写作 / 大纲 / 设定三页的中栏两列）**：master-detail 的两列各有一条页头，几何逐像素同构——**标题行 40px + 元信息行 24px（4 + 16 + 4）+ 1px 分割线**，两列分割线都落在内容顶下方 64px。标题 = `section-title`（16px / 600），单行截断、**不换行**（不适用上条「带 leading 允许换行」）；标题行左 `leading`（24px 图标；承载面板开关时 = 当前最左可见列的左钮）与右侧操作组（24px 图标按钮，`title` / `aria-label`）全部垂直居中。**元信息行两侧都预留**：rail 留 24px 空带（无占位符）；详情放单行元信息（空态 / 加载态也保留空带），**不折行**——日期只显示 `MM-DD`、完整时间进 `title`，右端入口（如「变更记录」）`shrink-0`，超宽尾部截断。分割线全幅：详情列桌面端 `pt-0`、页头 `-mx-6` 穿透列内边距（窄屏返回条与内边距保持原状）。内容起点：详情分割线后 16px；rail 行区 / 控件行紧随分割线（标题下多 24px 预留带）。**实现唯一入口 = `components/ui/panel-header.tsx`**；普通中栏页面继续用 `PageHeader`，两者不得互串（rail 的 40px 标题条也不再手写）。
- **panel-header 的面板开关口径（2026-11 修订）**：子栏开关按**外端锚定**，不贴两栏交界——左钮永远在最左可见列的页头 `leading`（左栏展开时 → 左栏页头标题左；左栏收起时 → 右列页头标题左），右钮永远在最右可见列的页头 `actions` 最右端（右列展开时 → 右列页头动作组末尾；右列收起时 → 左栏页头动作组末尾）。可见性只跟「点击是否有效」走：左钮仅在右列可见时渲染，右钮仅在左栏可见时渲染；两栏不会同时收起，所以任一时刻每个方向最多一枚。承载开关的 rail 页头改用 `px-6`（与详情页头同内距），同一钮在跨栏切换时 `x` 不变；无开关的 rail 页头仍 `px-3`。开关常显、不靠 hover；窄屏 / 专注模式不渲染。本条只管**面板内子栏**；外壳整栏开关不适用（它锚定视口顶带，见 §Layout「三栏」）。
- **panel-header 的操作口径（2026-11）**：详情页头操作一律 24px 图标（`icon-button`；保存是唯一主操作 = `type="primary" size="small"` 图标）；文字按钮不进 panel header（窄列会折行）。右钮追加在详情页头动作组末尾，不改变保存的唯一主操作地位。

### 详情页布局（2026-11）

- **单列上下，不左右分栏**：设定/地点详情（`EntityDetail`）、大纲节点详情（`OutlineDetail`）、时间轴事件详情（`TimelineDetail`）一律 `flex flex-col`：信息/表单在上，关联/层级在下。
- **为什么**：左右两栏共享一行高度（grid 默认 stretch），一侧展开会把另一侧拉出大片空白；窄中栏下两栏都显示不全。单列让每块拿到完整宽度，长度交给页面滚动。
- **不适用**：人物页是 master-detail 工作台（左栏列表 + 右栏详情），不是同一页内的左右分栏；参考资料详情本来就是单列；大纲页 / 设定页（2026-11 改版）同样是 rail + 详情的 master-detail，其详情内容仍是单列。

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

**Tailwind 圆角变量已钉到本表**：`index.css` 的 `--radius-sm/md/lg` = `4px/6px/8px`（与 antd `borderRadiusSM`/`borderRadius`/`borderRadiusLG` 同值），不再由 `calc(var(--radius) * k)` 派生（旧值 9.6/7.7/5.8 与文档不符）。xl 以上（12/16/24/32px）曾为**遗留 tail**（供未收敛到 antd 的自绘组件用），组件收敛后已无消费者，T10 已删除。

## Components

分层原则：**能用 antd 组件的地方不造第二套**（按钮/输入框/卡片/空态/提示全部用 antd），自绘只保留 antd 语义不匹配的浮层（右键菜单/受控 Dialog/轻量 Popover）与业务组件。

**描边与阴影的契约（prose 承载）**：DESIGN.md 规范的组件子 token 白名单只有 `backgroundColor/textColor/typography/rounded/padding/size/height/width`，`border`/`shadow` 写进 frontmatter 会被 lint 判为非法键——因此描边与阴影在这一节用文字定稿，也是实现时的唯一依据：

| 元素 | 描边 | 阴影 |
|---|---|---|
| sidebar（左栏） | 右侧 1px `{colors.hairline}` | 无 |
| main-toolbar（中栏工具栏） | 底部 1px `{colors.hairline}` | 无 |
| tabs（二级 tab 导航条） | 底部 1px `{colors.hairline}`（即页头分割线）+ 选中项 2px `{colors.primary}` 指示条 | 无 |
| page-header（页头分割线，无 tab 时） | 底部 1px `{colors.hairline}` | 无 |
| card / dropdown-panel / toast | 1px `{colors.hairline}` | 仅浮层（dropdown-panel / toast）：`0 8px 24px rgba(15, 15, 15, 0.10)`；card 无 |
| proposal-card | 1px `{colors.primary}` 25% | 无 |
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

### 写作面（工具条 / 专注模式）

**`writing-toolbar`** — 章正文与参考资料正文共用的一行常显工具条（**唯一实现 = `components/blocknote/editor-toolbar.tsx`**，随块编辑器组件内置，两页自动获得）：

- **几何**：高 40px（单行 = 4px 内边距 + 32px 档按钮，与库自带工具条同构）；底 = 正文底（跟纸张偏好走，避免纸上出现一条异色带）；底部 1px `{colors.hairline}`；**无阴影**；`sticky` 贴**内层滚动容器顶**（页头之下，见 §Layout「页头常驻」）。窄幅**折行增高**（`flex-wrap`，`min-height` 而非固定高）——**不做横向滚动**。
- **写作面高度 = 填满剩余视口（2026-09，两处书写面同口径）**：正文只有几行时，写作面**不得**缩水成一小块——`.bn-container` 与 `.bn-editor` 各自吸收剩余高度（`flex: 1 1 auto`）⇒ 空白处仍在可编辑区内，**点空白即把光标落到文末**（Notion 同款）。长文照旧由滚动条承接（`flex-grow` 不封顶）。**flex 链由各页自己接通，三处缺一不可**：写作页 = 中栏内分栏（`-m-6 … overflow-hidden`，见 §Layout）→ **正文列**（`min-w-0 flex-1`）→ 正文列内的 `<section>`（`flex h-full min-h-0 flex-col`）+ **内层滚动容器**（`flex min-h-0 flex-1 flex-col overflow-y-auto`，见 §Layout「页头常驻」）——外层分栏只切宽度，**不得**在中间用 `items-start` / `self-start` 截断交叉轴；参考资料详情页 = 表单滚动容器（`flex min-h-0 flex-1 flex-col`）→ 正文本行（`flex-1 min-h-0`）→ 编辑器包裹层（`flex min-w-0 flex-1 flex-col`）——编辑器下方的操作行（取消 / 创建）仍留在编辑器之下。
- **不得让工具条成为自身滚动容器（2026-09 实测缺陷固化）**：`overflow` 必须为 `visible`。`position: sticky` 已使工具条成为后代绝对定位元素的**包含块**，若它同时是滚动容器（`overflow-x:auto` 会把 `overflow-y:visible` 的计算值变成 `auto`），库的 tooltip 与 ariakit 的 select / menu 就**被它自己裁掉**——实测：hover 的 `.bn-ak-tooltip` 落在 y 99–149 而工具条是 153–193（看不见），块类型下拉被压成 **18px** 高的一条缝（⇒ 「改块类型/颜色」实际不可用）。库自带浮动条同样有 `overflow:scroll` 却不受影响，是因为它**没有 position**（包含块在滚动容器之外）。窄幅因此用折行而非滚动。
- **`sticky` 的作用域 = 编辑器区块**：包含块是 `.bn-container`，故滚过章末时工具条随区块一起离开（不是「永远贴在中栏顶部」——那需要 `fixed` 定位，会与页头/专注模式耦合，不采纳）。
- **内容**：左侧 = 块类型下拉 + 粗/斜/下/删 + 颜色 + 对齐 + 缩进 + 链接（**全部复用库自带按钮组件** ⇒ 与编辑器同源表皮，激活态由库管理）；右侧 = 撤销 / 重做 / 保存（**写作页与参考资料详情页（编辑态）各自注入**；新建参考资料草稿态不注入——那里是带跳转的「创建」动作）/ 写作设置（字体·字号·行高·纸张·纹理·段首缩进）/ 命令帮助 / 专注模式（仅写作页由页面注入）/ 字数与保存态（**仅专注态由页面注入；常规态它在页头说明行，两处不同时显示**）。
  - **为什么手动「保存」放在工具条而不是页头（2026-09）**：正文是 1.5s 空闲自动保存（`AUTOSAVE_DELAY_MS`），手动按钮是**保底**入口（用户诉求原文：「加一个保存按钮就行」）。工具条随正文 `sticky`（与滚动位置无关）、页头不是 ⇒ 工具条是唯一「写着写着也点得到」的位置（两页都有，见 §Layout「页头常驻」）。点击恒发一次 `PUT`（**即使无待存内容也重发**）——保证「点击必有可见反应」（**成功后 toast「已保存」** + 状态转 `保存中…` → `已保存 · HH:MM`；自动保存只改这行文字、**不弹 toast**），且不会引入冲突（保存成功后版本戳前移）。`saving` 期间禁用（防连点双发）。
- **失焦态**：库按钮无选中时回落到光标所在块，故常显可用；**不做禁用态**（库无 `canUndo`：撤销/重做保持可点、点空即无变化——宁可无反馈也不要假禁用）。
- **与浮动工具条并存**：选中文字时的浮动条保留（就近操作）；两者按钮集有意重叠；若日后观感重复，关浮动条 = `formattingToolbar={false}` 一处开关。

**`save-status`（保存态，2026-11）** — 章正文 / 参考资料 / 练习稿 / 自由练习四处共用的保存态文案，**唯一实现 = `components/ui/save-status.tsx`**（页面只提供状态与时刻，不各写一份 span）。四态：`idle` 不渲染、`pending`「编辑中…」、`saving`「保存中…」、`saved`「已保存 · HH:MM」（时刻 = 最近一次保存**完成**的本地时间，`formatSavedAt`）。**输入即 pending**——自动保存防抖期间不得继续显示上一次「已保存」（2026-11 修正：旧实现只在保存完成时置态，打字全程都在谎报已保存）；自动保存失败回落错误条（`idle` + 页内错误 UI + 重试），不静默。手动保存页（练习 / 自由练习）的 `pending` = 有改动未保存。字号 / 字色沿用 `text-xs text-muted-foreground`（不新增视觉语言）；位置不变：常规态在页头说明行（与字数同行）、专注态在工具条右端，**两处不同时显示**。

**`command-help`** — 工具条「命令帮助」打开的静态弹窗（复用 `components/ui/dialog.tsx`）：`/` 斜杠菜单、块手柄、快捷键。**快捷键文案一律从 `@blocknote/core/locales` 的 `zh` 字典插值**（`formatting_toolbar.*.secondary_tooltip` + `formatKeyboardShortcut`，Mac = `⌘` / 其他 = `Ctrl`；撤销/重做字典内没有 ⇒ 由库 keymap 核实后取字面量并存出处注释），**禁止手抄**。用途 = 「不让用户猜命令」的兜底文档；与工具条按钮集**同卡维护**（加按钮就补条目；**唯一例外 = 弹窗自身的入口**——自指条目无信息量）。**已知代价**：专注态下页头承载的操作（上一章 / 下一章 / 导入 / 导出）随之不可达，要动它们先退出专注（有意的取舍：专注 = 无干扰）。

**专注模式入口** = 工具条右端按钮；退出 = 同一按钮或 `Esc`（不新增全局快捷键占用）。

### 按钮与表单

**`button-primary`** — 墨底白字、矩形、无投影。用于页面主操作（新建/保存）。
**`button-default`** — 白底 + `{colors.hairline-strong}` 描边（**文字型操作按钮必须带边框**，这是仓库既有红线 H4）。
**`button-text`** — 无边框纯文字，只用于行内最弱操作；**不得用于页面级操作**。**antd v6 `Button` 的 `variant` 必须与 `color` 同时给**（`antd/es/button/Button.js`：`if (color && variant)`”——否则静默回落到 `['default','outlined']`，`variant="text"` 会变成**带边框**按钮（右侧图标按钮一半有边框一半没有的根因）；合法写法：`color="default" variant="text"`，或遗留 `type="text"`；`design-discipline.test.ts` 有 `button-variant-color` 守卫。
**`icon-button`（统一约定）** — 全站图标型操作按钮**只有一种实现**：antd `Button color="default" variant="text" size="small"` + 图标（**导航型也用它**：给 `Button` 传 `href`，antd 渲染成 `<a>`（`Button.js` 的 `linkButtonRestProps`）——同一个表皮、同一个 `icon-button` 几何，但保住链接语义与「本视图无操作按钮」这类否定契约；自绘图标型 `<a>` 仍禁）（⚠ `variant` 必须与 `color` 同时给，见下行 `button-text` 的坑）（图标尺寸随字号类：行内 14px = `text-sm`、工具条 16px = `text-base`；**`PanelToggleIcon` 是登记例外，固定 16px**），颜色继承 antd 的 text 变体（`{colors.primary}`），hover/disabled/loading 由 antd 派发；**不再并存自绘 `<button>` 图标按钮**（两套并存会让同一角色出现灰/墨/红三种观感）。**不可恢复操作**（彻底删除 purge、物理删关系、删书）用 **`color="danger" variant="text"`**（`{colors.error}`）——**不能写成 `color="default" variant="text" danger`：antd 6 的 `Button.js` 在 `color && variant` 同时给出时直接返回这对值，`danger` 糖被静默忽略**（实测：渲染出常规墨色；规则 7 `danger-color-variant` 已可执行断言）；**软删**（移入回收站）保持常规色——危险色的语义是「不可撤销」，不是「删除」。图标一律 `@ant-design/icons`（**唯一功能性自绘例外 = `PanelToggleIcon`**，见下；品牌标记 `app-mark` 见「导航与外壳」）；状态用 Filled、操作与导航用 Outlined。**整栏收起/展开 = 视口顶带两角的静态面板图标**（外壳常驻 `ShellPanelToggles`，坐标与栏宽解耦、不随收起态位移，见 §Layout「三栏」；图形来自 `components/ui/panel-toggle-icon.tsx` 的 `PanelToggleIcon`：圆角矩形 + 内侧竖线、`currentColor`、24 viewBox / 显示 16px；左栏竖线靠左、右栏靠右镜像）——图标**不随收起态换向**，状态由动态 `aria-label` / `title` / `aria-expanded` 表达；toggle 是瞬时动作，**不加常驻选中面**（不用 `variant="filled"`）。**面板内子栏（写作卷章栏 / 大纲树 / 设定树，以及三页右侧详情）= `PanelToggleButton`**（内部同一枚 `PanelToggleIcon`；`side` 由栏位决定，状态仍只走动态 `aria-label` / `title` / `aria-expanded`；普通 `icon-button` 表皮，**不是圆钮**；放置 = 最左可见列 `leading` / 最右可见列 `actions` 末尾，见 §Layout「工作台子栏页头」）。整栏与子栏**共用同一面板图形**（同形 = 同一语义「收 / 展一整栏」），靠位置区分控制哪一栏；树行折叠仍用单箭头，**面板图标不得用于树行 / accordion / 章节导航**。旧整栏双箭头 `DoubleLeft/RightOutlined` 不再承载收起语义。**禁用**：`BorderLeft/RightOutlined`（表格边框图标，与面板折叠无关）、`MenuFold/UnfoldOutlined`（仅面向左侧，右栏无同族镜像）、`VerticalLeft/RightOutlined`（名字与朝向不一致——`VerticalLeft` = `▶|`、`VerticalRight` = `|◀`，二者区别在竖条在哪侧而非箭头指向，左右两栏配不出对称）。**panel-header 例外（2026-11）**：写作 / 大纲 / 设定三页的两列页头操作一律 24px 图标；详情页头的「保存」是唯一主操作，用 `type="primary" size="small"` 图标按钮（其余仍是 text 变体）——见 §Layout「工作台子栏页头」。
**`input`** — 白底 + `{colors.hairline-strong}` 描边 + `{rounded.sm}` + 32px 高；聚焦 = 1px primary 描边（**无阴影、无彩环**）。行内编辑与表单用同一个 antd `Input`。
**`search-input`** — 列表/富页筛选栏的搜索框（全站**统一形态**）：antd `Input` + `prefix={<SearchOutlined />}` + 固定宽 `192px`（`w-48`）+ `allowClear`（筛选类，清空即回到未筛）；placeholder 统一「搜索{对象}…」。位置固定在页面控件行的**最左**（见「中栏页头结构」）。
**`drag-indicator`** — 拖拽插入线：**实线** `{colors.primary}` 3px + 两端 8px 圆点（`h-[3px]` + `size-2 rounded-full`），横跨被拖行所在层级的内容宽度；`pointer-events-none` 不拦拖拽事件。
**拖拽目标行与临时高亮（prose 承载，色值不登记）** — 「拖到行中段 = 成为其子级」的拖拽目标行、以及「新建即聚焦 / 定位到节点」的临时高亮，统一用 **primary 10% 淡染面 + 1px primary 30% 描边**（`bg-primary/10 ring-1 ring-primary/30 ring-inset`，与选中态同一语言，**不用** `{colors.surface-muted}`：近白面在白底上不可见）。被拖行本体用 `opacity-50`。**非法落点**（防环/跨层级非法）：不显插入线、不显高亮（无反馈即「不可放」）。
**`select`** — 与 `input` 同一语言：白底 + 1px `{colors.hairline-strong}` 描边 + `{rounded.sm}` + 32px 高（密集行 24px = antd `size="small"`）；聚焦同样 1px primary 描边、无彩环。下拉浮层走 `dropdown-panel`（1px `{colors.hairline}` + `{rounded.md}` + 浮层阴影），选中项 `{colors.surface-muted}` 灰面。全站下拉统一 antd `Select`（原生 `<select>` 已清零）。

**选择器空态两种写法（都有据）**：**筛选类**（“全部/不限”，可清除）用 `allowClear` + `placeholder`（并为空值时传 `undefined`）；**表单类**（必选项的“请选择…”）保留 `{ value: "", label: 原文案 }` 作为首项，不做 placeholder 改造。组选（`optgroup`）用 `options` 分组对象 `{ label, options }`，组级禁用下推到组内每个 option（antd 分组对象无 `disabled`），组 label 文案保留。

**输入框默认值上收到 Provider**：`autoComplete: "off"` 经 `ConfigProvider` 的 `input` / `textArea` 默认 props 下发（v6 `InputConfig.autoComplete`），调用点不重复声明——禁浏览器历史建议，输入提示全由 datalist 候选与业务逻辑控制。
**`select-option-selected`** — 选中项 = `{colors.surface-muted}` 灰面 + **加粗**（`optionSelectedFontWeight` 默认 600）+ 字色不变（`colorText`）；选中与悬浮靠「面同档、字重不同」区分。**面上不可读是全局坑，不能在调用点修**：antd 的选中面取全局 `controlItemBgActive` / `controlItemBgActiveHover`（由 `colorPrimary` 派生 → 深墨 seed 下派生中深灰 `#787771` / `#6b6a65`，压深墨字 ≈ 2.26:1），且**弹层打开时已选中项会被自动置为 active**——所以组件级 `optionSelectedBg` 在真实交互路径上无效。修法 = `AntdProvider` 覆盖这两个全局 token（见 §Colors），Select / Dropdown / Menu / Pagination / Tree / Table 的选中面一次到位。调用点只需保证两件事：**浮层宽度按内容**（`popupMatchSelectWidth={false}`——跟随触发器宽度会截断选项文案）；**会话列表用 x `Conversations`**（两行项语义），守卫 `dropdown-menu-selectable` 禁止在调用点另起一套选中语言。

**`select-free-input`（自由输入下拉，2026-09）** — 「既有选项 ∪ 自由新值」的**单值**输入（如关系类型）：antd `AutoComplete`（本质 = `Select` 的 combobox 模式，同一 token 管线）。外观同 `input`（白底 + 1px `{colors.hairline-strong}` + `{rounded.sm}` + 32px 高），**无 chevron**（combobox 不渲染 `suffixIcon`）；浮层同 `dropdown-panel`（1px `{colors.hairline}` + `{rounded.md}` + 浮层阴影），选项行同 `select-option-selected`。**无匹配时给一行「将新建『{输入}』」提示**（自由输入不做盲打）。两条必知实现事实（antd 6.6.2 源码）：combobox 模式 `filterOption` 默认 `false`——**必须显式传**，否则打字不筛；无匹配值时 `onChange` 可能给 `undefined`——受控 `value` 需 `?? ""` 兜底。值语法（长度/字符）由调用侧校验（关系类型见 `../api/40-api-relation.md`）。

### 导航与外壳

**`sidebar`** — 左栏底 `{colors.surface}`（比内容面板暗一档），右侧 1px `{colors.hairline}`；**顶部标识 = `app-mark` 品牌标记 + 「书架」（根首页入口，`#/`）**（固定两字、**不挂 `truncate`**——合成斜体（`italic` 无真斜体字面可用）的墨迹会越出字宽，`overflow: hidden` 会切掉「架」右缘）、其下**书名按钮**（`#/overview` 项目概览入口）、**十一项一级导航**（写作 / 大纲 / 大纲画布 / 人物 / 设定 / 地点 / 伏笔 / 时间轴 / 关联 / 参考资料 / 码字统计；`#/canvas` 见 `outline-canvas`）、工具区（回收站）、底部四快捷入口（立即备份 / 同步云端 / 设置 / 主题）。**「概览」不再占一级导航位**（入口收敛到书名按钮，`#/overview` 时书名按钮用选中面；书架路由 `#/` 下左栏无选中面——书架自身就是当前页）。
**左栏按工作区类型渲染（2026-10 改版）**：小说工作区（`kind = "novel"`）= 上方形态；**练习工作区（`kind = "practice"`）= 顶部标识文案改「文风练习」（仍回根首页 `#/`）+ 一级导航五项（顺序：作家介绍 `#/author` / 作品介绍 `#/works` / 作家风格说明 `#/style` / 文风练习 `#/practice` / 自由练习 `#/free`）+ 工具区不渲染（无回收站概念）+ 书名按钮不渲染**（它指向 `#/overview` 项目概览，练习工作区没有概览页——`#/overview` 在练习工作区被路由守卫挡回 `#/practice`，留着就是死按钮）+ **底部四入口中「立即备份 / 同步云端 / 设置 / 主题」保持不变**（备份与云端对两种工作区同样适用）。顶部标识保持**分区身份**（不是作家名）；**作家身份由各页内容表达（如作家介绍页的作家名）**。导航项集是 client 常量表（kind → 项集），**不是插件式注册表**。
**导航入口不受「文字按钮必须带边框」约束**：左栏导航项（Menu 十一项 + 书名 / 设置 / 主题三个入口）与 Menu 项同级——无边框、选中态用 `{colors.surface-muted}` 灰面（Tailwind `bg-accent` = `colorFillTertiary`）、文字不变色，禁用 H4 只约束操作按钮（新建/重命名/重试/删除等）。**左栏底部区形态单一**：立即备份 / 同步云端 / 设置 / 主题四入口同为 `block` + `color="default" variant="text"` 的无边框文字按钮（**四行固定顺序**，「同步云端」在「立即备份」与「设置」之间）；「立即备份」「同步云端」是动作而非导航，形态随底部区（**H4 登记例外，仅此两处**）；禁用/加载态由 antd Button 派发（无项目 → 禁用；在途 → `loading` 防连点），失败经 `message` 提示。**`menu-item`** / **`menu-item-selected`** — 菜单项 32px 高、`{rounded.sm}`；**选中 = `{colors.surface-muted}` 灰面 + 文字不变色**（antd 默认的彩色选中项要显式覆盖：`itemSelectedBg` / `itemSelectedColor`）。**`main-toolbar`（中栏工具栏）** — 中栏顶部 1px 底线；**只承载全局操作，不承载项目信息**——品牌标记 / 项目名 / 阅读进度 / 语言已删除（项目名见左栏书名按钮，阅读进度与语言见概览页 / 大纲页）。**不含整栏开关**（整栏收起/展开锚定视口顶带两角，见 §Layout「三栏」）——桌面态右端组 = 刷新（`ReloadOutlined`，`ml-auto` 起右对齐；全中栏统一数据刷新入口）；左 / 右栏收起时该端让出 48px 槽位（`pl-12` / `pr-12`）给顶带开关。窄屏右端组 = 刷新 + `MessageOutlined` 聊天开关（抽屉打开时 `variant="filled"`，其余 `text`）。**两种工作区类型（`novel` / `practice`）形态一致**：工具栏不读项目配置、不按 `kind` 分叉。图标静态，`aria-expanded` + 动态 `aria-label` / `title`（`收起左栏` / `展开左栏`、`收起右栏` / `展开右栏`），不加选中面。

**`tabs`（二级 tab）** — 页面内分区导航（设置页二级 tab / 人物页四 tab）：antd `Tabs` line 型（`items` 数组，`activeKey` 受控）。未选中 `{colors.secondary}`，选中与悬浮 `{colors.primary}`（`itemSelectedColor` / `itemHoverColor` / `inkBarColor` 的 antd 默认值就是 `colorPrimary`，**不重复覆盖**），选中指示条 2px `{colors.primary}`，底线 1px `{colors.hairline}` = 页头分割线（见 §Layout「中栏页头结构」）。**页内 tab 不进 URL、不参与左栏导航高亮**，选中态是页面 state（刷新回落默认 tab）。

**`sub-nav`（三级导航）** — 带子内容区块的页内分区导航（**两处**：设置页「AI 模型」= provider 列表；设置页「备份」= 固定的「自动备份 / 云端备份」两项）：竖向 antd `Menu` inline，宽 160px（= `sidebar` 登记的宽度档），**契约完全复用 `menu-item` / `menu-item-selected`**（32px 行高、`{rounded.sm}`、选中 = `{colors.surface-muted}` 灰面 + 文字不变色），不新增设计语言；项文案超宽截断（`title` 给全文）；项前置图标只在有图标语义的场景出现（AI 模型页的 `provider-icon`、导航下方「添加」项）——备份页两项不带图标。

**`sub-nav` 的「添加」弹窗（设置页 AI 模型，2026-09）** — 三级导航**只列已配置的家**（`authConfigured`：env / OAuth / auth.json 任一来源）+ 当前激活家 + 刚配置成功的家（**「配置了多少显示多少」**，pi 全量家数全列会让导航不可用）；导航下方 `button-default`（`size="small"` + `block`）「添加」→ **打开受控 `Dialog`**（复用 `components/ui/dialog.tsx`，不新造浮层）：
- **选择步**（标题「添加 provider」+ 一句说明）：搜索框（antd `Input` + `SearchOutlined` + `allowClear` + `autoFocus`，宽度随弹窗而非列表页 `search-input` 的 192px 档）+ 可滚动紧凑行列表（`provider-icon` + 名称，行高 28px、hover = `bg-muted`（`colorFillAlter` 档，与书架行同款）、整行可点）。
- **配置步**（选中一家后同窗切步）：标题行 = `provider-icon` + 家名；凭证状态行（`credential-label` 同款 caption）+ key `Input`（`autoFocus`）+ 内联错误；Footer = `[取消]` + 主操作 `[保存]`（`button-primary`，`loading` 防连点）。
- **关闭语义（四条路径等价）**：右上角 X（`DialogContent` 默认 `showCloseButton`）/ `Esc` / 遮罩点击 / `[取消]`——**关窗即不落任何状态**；该家只有**保存 key 成功后**才进入三级导航并被选中（失败留在窗内显示错误，不关窗）。
- 搜索无命中 / 已全部配置各给一行 `caption-text` 说明；当前无任何已配置家时，右栏给「点左侧 [添加] 选择要接入的 provider」空态。

**`app-mark`（品牌标记，2026-09 定稿）** — 产品品牌标记，**全站唯一的自持品牌矢量图形**（功能性自绘 `panel-toggle-icon` 见下条；其余图标一律 `@ant-design/icons`）：几何 = **书脊 + 三条递减条目线**（竖脊 = 书 / 主干，右侧三条左对齐、长度递减的圆头线 = 卷 / 章 / 场三层）——语义是「有层级结构的书稿」，即本产品与「聊天框式 AI 写作」的分界；**无外围容器**（左栏此前的 `◈` 只是一个历史遗留字符，无含义，已删）。**色 = `currentColor`**（浅色态即 `{colors.primary}`，深色态随 seed；本产品本来就品牌色与文本色同值）——**不新增色值、不给标记上彩色**。**尺寸随字号类**（当前落点 `text-base` = 16px；组件**不提供尺寸 API**，将来真落到 `text-sm` 行内时由调用点 className 覆盖，不给组件添参数），**不做 Filled 变体**（界面内只有描边态）。**落点一处**：左栏顶部标识（`[标记] 书架`，`#/` 入口）——**只换图形、不动文案**（那是导航入口，不是招牌）。**系统面形态 = 同一图形的负形版**（墨底 + 纸白挖空）：`public/brand-icon.svg` 一个文件同时承担 favicon 与桌面应用图标源，描边态与负形态是**同一图形的两档量感**、不是两个符号；打包口径见 `50-desktop.md` §5.3。
**`panel-toggle-icon`（面板开关，2026-11）** — 功能性自绘图标，用于视口顶带两角的整栏收起/展开（经 `ShellPanelToggles` 常驻渲染），以及写作 / 大纲 / 设定三页的子栏面板开关（经 `PanelToggleButton`）：`components/ui/panel-toggle-icon.tsx`，inline SVG、`currentColor`、圆角矩形 + 内侧竖线、左右两向；24 viewBox、约 1.8 stroke、显示 16px；**无尺寸/色值 API**（固定 16px，色随 `{colors.primary}`）。它不是品牌资产，也不参与 tint / 状态色——**只服务面板开关**，不得用于树行折叠 / 内容 accordion / 章节导航等其它图标角色（其余图标仍 `@ant-design/icons`）。
**`provider-icon`** — 供应商品牌 logo（三级导航项 + 添加列表 + 聊天模型下拉的分组标签）：`public/provider-icons.svg` 精灵（`<symbol>` + `<use href="/provider-icons.svg#id">`，派生自 @lobehub/icons，MIT 许可头内嵌于该文件、不引包）按 pi provider id 取图，尺寸 16px；无对应 symbol 的自定义 provider 回退 `@ant-design/icons` 的 `ApiOutlined`。品牌 logo **自带品牌色**（DeepSeek 蓝、Google 四色等）——**这是「颜色只经 antd token」的登记例外**：第三方品牌资产，只在图标内部出现，不参与界面取色；无品牌色的 logo 用 `currentColor`（`{colors.tertiary}` 档 = `text-muted-foreground`）。


### 数据展示

**`data-row`** / **`data-row-hover`** — 列表/树/大纲行：无底色 + 底部 1px `{colors.hairline-soft}`；hover = `{colors.surface-soft}`。**设定树描述摘要（2026-11）**：设定树行的描述摘要（`summary.description`）受控件行「描述」开关控制（`Switch size="small"`，默认开，`localStorage` `ai-editor:setting-desc`）；关闭时只隐藏摘要行，不隐藏标题/标签/操作，也不影响详情页的描述字段。行级交互（**大纲页 / 设定页 rail 同一口径，2026-11**）：**单击行体进详情、单击标题 / 摘要只就地编辑**（`stopPropagation`；见 `outline-page` / `setting-page`），**不再有「双击进详情」**；**链式新建（Enter 建同级/子级）后新条目 = 选中 + 聚焦**（只聚焦不选中会让下一次 Enter 被「无选中」守卫静默吞掉；新建按钮同理）。**行尾状态徽标排在操作按钮左侧**（如大纲 rail 的「阅读进度」图标徽标）：右侧 `icon-button` 恒贴行尾——徽标出现不得把它推离原位（否则同一列按钮在行间错位）。**章行的第三行（2026-11）**：大纲树章行可在摘要下方多一行剧情线标签预览——固定最多 2 个 + `+N`，**不按可用宽度量算**，完整标签名进 chip 的 `title`，完整列表进 `+N` 的 `title`；仅章、仅存在标签时渲染，不参与行尾操作列（形态见 `outline-page`「章行标签预览」）。
**行级「新建子级」按钮（2026-09）**：大纲页与设定页的树行在行尾补一个 `icon-button`（`PlusOutlined`）新建子级入口，**位置 = 删除按钮左侧**（删除恒贴行尾；它左侧依次是「阅读进度」徽标 / 标签 chip / 手动排序 ↑↓）；`title` / `aria-label` 写全语义（新建章 / 新建场 / 新建子设定）。**无合法子层级的行不渲染该按钮**（大纲的场是叶子）。点击 = 在该行子级末尾打开就地输入行（与 Enter 建子级同一路径，成功后新条目选中 + 聚焦）。
**缩进列对齐（2026-09 修正与再扩写）**：缩进行的折叠箭头（`size="small"` icon-only，宽 24px）与**无子节点占位必须同几何**——占位写成 28px 会让「有子节点 / 无子节点」两类行的类型徽标、标题、摘要第二行、就地新建行各差 12px（大纲页曾是此状态）。**同一行块内的占位（折叠箭头 / 类型徽标 / 就地新建行）必须与该行自身的徽标同宽**：卷/章行是编号徽标 `min-w-14`、场行是 28px——任一处漏改即错位，改动行结构时逐处一起看。**叶子行渲染同几何的空占位**（`<span aria-hidden>`，不画 `disabled` 折叠箭头：看着可点、点了却没反应）；**摘要第二行、大纲页标签第三行与就地新建行同样复用这条占位链，不写 `pl-*` 像素**——设定页曾用 `pl-5`，比标题列左偏 6px，因为列位是「24px 箭头盒 − `-ml-1` + 行内 gap」算出来的，抄数字必漂。
**折叠箭头方向（全站一条惯例）**：**折叠 = 横指（`▸`）、展开 = 下指（`▾`）**——实现恒为 `RightOutlined` + `!collapsed && "rotate-90"`（同上 `transition-transform`），四处自绘缩进行（大纲 / 设定 / 能力面板 / 时间轴分组）同一种写法；反向写（`collapsed && "-rotate-90"`）会得到「折叠指上、展开指右」（设定页曾是此状态，并与其文件头部注释的 `▾/▸` 自相矛盾）。
**大纲页主操作 = 「+ 新建卷」**：直建卷（rail header 主操作；空树时详情列也给「新建第一卷」CTA）；就地输入行**不再提供卷/章切换**（章只在卷下建，层级契约见 `10-data-model.md` §2）。

**`outline-page`（大纲页，2026-11 改版）** — 一级导航「大纲」的页面；路由 `#/outline` / `#/outline/:nodeId`。**中栏内 master-detail**：左 = **大纲树 rail**（结构编辑的唯一入口），右 = **卷 / 章 / 场详情**。**选中唯一来源 = URL**：`#/outline` 无选中（右侧空态），`#/outline/:nodeId` 选中并显示详情；刷新 / 深链 / 前进后退都按 URL 收敛，不另存组件选中态。写作入口独立成一级页 `#/writing`，本页不再承载「章视图」（原双视图、视图切换按钮与 `ai-editor:outline-view` 持久化已删除）。

- **rail header（`PanelHeader`，`px-3`；承载开关时 `px-6`；标题行 40px + 预留元信息行 24px + 1px 分割线，元信息行留空）**：`section-title`「大纲」；左端 `leading` = 左钮（`PanelToggleButton side="left"`；仅详情列可见时）；右端组 = `[筛选（状态 / 剧情线）] [清除推演标记（有可见标记时）] [全部折叠 / 全部展开] [+ 新建卷]`，一律 `icon-button` + `title` / `aria-label`（筛选 = `FilterOutlined`「筛选大纲」、清除 = `ClearOutlined`、折叠 = `MinusSquareOutlined` / `PlusSquareOutlined`、新建 = `PlusOutlined`）；**右详情收起时右钮改在本 header 右端组最右端**（`PanelToggleButton side="right"`；详情展开时在详情页头动作组末尾）。rail 行区 `p-2`、自身纵向滚动；行高 / 缩进 / 占位链与 `data-row` 同一套几何（32px、折叠箭头 24px 盒、编号徽标 `min-w-14`、摘要第二行 / 标签第三行同占位）。
- **树筛选（2026-11）**：rail 页头「筛选」按钮 + `Popover`（`w-56` 单列）——**状态**（`draft` / `revision` / `final`，缺省 = draft，与详情页同一口径）+ **剧情线标签**（多选，命中任一）。命中节点**连同祖先链**保留，未命中整枝**隐藏**（列表变短；与画布「淡化不重排」不同口径——树是导航器，画布是空间记忆）。**筛选是组件态**：不写 `localStorage`、不进 URL、切书即清。生效时：**整树强制展开**（命中章不能藏在收起卷里，折叠箭头换同几何占位）、**禁用拖拽**（落点在隐藏行上必然歧义）、**编号不变**（「第 N 章」恒按全树，不数可见）。判定单源 = `lib/outline-tree.ts` 的 `filterOutlineNodes`。
- **树行能力 = 原大纲树全量**：新建 / 改名 / 摘要编辑 / 删除 / 拖拽排序与跨父移动 / 右键菜单（注入上下文 / 建立关联 / 设为阅读进度 / 推演标记）/ 全部折叠 / 编号与伏笔徽标 / 跨页定位 / 3s 临时高亮。**只把容器变窄，不删能力。** 选中 = `bg-accent`（`surface-muted`）+ 文字不变色 + `aria-current="page"`（与左栏导航 / 写作页 rail 同一语言）；新建即聚焦 / 定位到节点仍用 primary 10% 淡染 + 1px primary 30% 描边（3s）。**行内状态徽标在 rail 内为图标态**：推演节点 = `BranchesOutlined`、阅读进度 = `AimOutlined`，`TypeChip` 只放图标、`title` / `aria-label` 给完整语义；**详情页保留文字徽标**（推演起点 / 推演节点 k / 推演终点、阅读进度）——320px rail 内文字态会把标题挤到不可读（行内固定元素约 196px + 状态徽标）。伏笔徽标仍是图标导航链（不变）。
- **章行标签预览（2026-11）**：章行在摘要下方多一行剧情线标签——`#标签` 走 `tagTintClass` 的 tinted 文本（与画布卡片第三行同一形态；密集行不套 `TagChip` 的 `py-0.5` 外壳），**最多 2 个 + `+N`**（固定条数，不按 rail 宽度量算），完整标签名进 chip 的 `title`，完整列表进 `+N` 的 `title`；仅章、仅 `data.tags` 非空时渲染；场景行不显示（场景标签 schema 预留但 UI 未开放）。标签只读：点标签 = 点行体（进详情），不新造交互，也不进行尾操作列。
- **行拖拽落点（2026-11）**：目标行上 / 下半 = 插到该行前 / 后（保持同级排序）；当目标行的父不合法、而**目标行自身**可承载拖拽类型时（空卷 / 折叠卷 / 空章，也含展开的非空卷 / 非空章——后备条件只看这两件：目标行父不合法 + 目标行自身可承载，与是否展开、是否已有子级无关），整行 = 追加为该行子级末尾：行体 primary 10% 淡染 + 1px primary 30% 描边，无插入线；**卷 → 卷仍是同级前后**，不因该后备落点改变。无合法落点不显示任何拖拽指示。
- **行手势（与设定页同一条，2026-11 定稿）**：**单击行体 = 选中并进详情**（`#/outline/:nodeId`；同 id 幂等、不重复 push）；**单击标题 / 摘要 = 只就地编辑，不切换选中 / 详情**（`stopPropagation`）；**双击不再承担「进详情」**（原「单击标题 + 双击详情」互斥取消；设定页 2026-11 同步为本条）。行内编辑提交后仍留在原节点；选中行变化 / 树刷新时展开其祖先链并 `scrollIntoView({ block: "nearest" })`。
- **编号 = 展示口径**（只计未软删节点 ⇒ 删后重排；**编号派生单源 = shared `outline-numbering.ts` 的 `numberVisibleOutline`**——卷号规则只活在那里，`lib/outline-tree.ts` 的 `numberOutline` 只做「节点 id → 徽标文案」适配（同时产出阅读序章行 `chapterRows`，供上一 / 下一章取序）），**不得**与服务端 `deriveChapterOrder`（含软删、保 Delta/伏笔引用稳定）混用或互为替代（先读 `10-data-model.md` §4）。卷 / 章行徽标 = `第N卷` / `第N章`（`TypeChip` + `min-w-14` + `tabular-nums`），场景行仍「场」。
- **详情列**：`PanelHeader`（标题 = 节点标题，16px 单行截断；操作 = 24px 图标按钮 `写正文`（仅章）/ `设为阅读进度` / `推演标记` / `保存`（主操作，`type="primary"` 图标）/ 右钮（`PanelToggleButton side="right"`，详情可见且左栏展开时排动作组末尾））+ 元信息行（类型徽标 + `更新于 MM-DD` + 字数 + 推演 / 阅读进度徽标；单行，完整时间进 `title`）+ 单列卡片（基础信息 / 结构化信息 / 变更记录（仅章）/ 伏笔占位 / 相关实体）。**章的结构化信息** = 状态（下拉：草稿 / 修正中 / 定稿，默认草稿）+ 剧情线标签（`TagsEditor`，≤5 个，候选来自当前树全部章 / 场景标签）+ 叙事功能（下拉：铺垫 / 推进 / 转折 / 收束 / 喘息）+ 张力度（下拉：低 / 中 / 高）+ 章末反转 + 章高潮场景；场景仍是麦基四项、卷仍是两项。**章的基础信息** = 标题 + 摘要 + **实际摘要**（`data.result_summary`，「本章实际发生了什么」，作者手填 / AI 读正文后提案回填；textarea，排在摘要下方、仅章渲染，空值 = 不写该键，大纲树行不展示）。页头常驻，内容独立滚动。**空态**（`#/outline` 无选中）：页头标题「详情」+「从左侧选择一个卷、章或场查看详情」；空树 → 「还没有大纲」+「新建第一卷」；未打开项目 → 回首页引导；坏 id / 已删节点 → 页头 + 「该节点不存在或已被删除」+ 返回大纲 / 去回收站。**加载 / 失败**：rail 给骨架 / 错误条 + 重试，详情列给骨架 / 错误条，不先挂编辑器。
- **数据与刷新**：大纲只拉一次（页面壳持有 `useOutlineLoader({ withMetadata: true })`；详情列由壳传入 `node`（`findNode` 派生）/ `nodeId` / `reload`，`OutlineDetail` 不自拉）；详情保存后由壳 `reload()` 收敛整树，详情表单按新节点重置；`useDataRefresh` 在壳内重拉树，详情内只重载关系 / 变更记录（**不得再触发第二棵树的 GET**）。**Ctrl/Cmd + S** 仍走注册栈：rail 行内编辑时保存行内字段，否则保存详情表单（后注册者优先，`useSaveShortcut` 的 `enabled` 重注册已满足）。
- **未保存守卫（2026-11 定稿）**：详情表单 dirty 时，**rail 切换（含新建 / 链式新建）/ 空白区清选中 / 窄屏「大纲树」返回条 / 详情页头「写正文」外链 / 收起右侧详情**先 `confirm`「当前节点的修改尚未保存，切换后将丢失」；确认才导航。**浏览器后退也拦**（哨兵历史条目）：dirty 期间挂一条**同 URL** 哨兵（`pushState`，后退落到它时 URL 与路由都不变），后退先落到它就弹同一句 `confirm`；取消 → 重新 push 一条复位（URL 全程未变），确认 → 真正 `history.back()`（自己那次后退不重复弹框；确认在途期间再来的后退不再叠框、也不再 `back()`——浏览器已真退一格）；dirty 复位时哨兵撤销（已离开哨兵则保留一条，由下一次后退消费）。机制单源 = `client/src/lib/back-guard.ts` + `hooks/use-back-guard.ts`；同 URL 的历史移动不触发 `hashchange`，`useHashRoute` 不受影响。保存成功 / 重载后 dirty 复位。
- **宽度与收起**：默认 `max(320px, 中栏 1/3)`（宽屏自然 1:2；1440 视口三栏默认下约 320px），拖拽 280–600px，可收起为 0px（详情列吸收宽度；宽度保留、展开恢复）。**首次拖拽后写入像素值**；宽度 / 收起态 / 右侧详情收起持久化 `localStorage` `ai-editor:outline-rail` 的 `{ width, collapsed, detailCollapsed }`（全局一份、不随书；拖拽期间只更新内存，`pointerup` 一次写入；收起 / 展开立即写）。**右侧详情收起**由外端右钮控制：详情列不渲染、rail 吸收全宽、不渲染拖拽手柄、不改存宽度、URL 选中保留；**不自动展开**；详情展开时右钮在详情页头动作组末尾，详情收起时右钮回到 rail 页头动作组末尾（同一 `x` 不跳）；rail 收起时右钮隐藏、详情列保留（两栏不会同时收起）。**左侧 rail 收起**同理：左钮在 rail 页头 / 详情页头之间换父，`x` 不变；右详情收起时左钮隐藏。桌面展开态由 rail 自身 1px `{colors.hairline}` 右边线充当分栏线（`ResizeHandle` 不画线，见 §Layout「分栏边线单所有权」）；窄屏 rail 全宽、`border-r-0`、无拖拽 / 收起。
- **窄屏（<1024px）= 两级互斥**（同写作页）：`#/outline` 显示 rail 全宽（rail header + 树；无详情、无拖拽 / 收起）；`#/outline/:id` 显示详情全宽 + 顶部 32px **「大纲树」返回条**（`ArrowLeftOutlined` + 文案，滚动区之外；点击走 dirty 守卫）；桌面两列的左钮仅在桌面渲染（窄屏无子栏开关）。**不自动选中**（`#/outline` 始终无选中；不复用 `current_position`，不选首个卷）。
- **跨页定位**：概览页「阅读进度」/ 关系面板等深链 `#/outline/:id` 直接按 URL 选中；`focusOutlineNodeId`（开场跳转）在树就绪后展开祖先、3s 高亮，并 `location.replace("#/outline/:id")`（replace 不入历史；目标不在可见树则清除 focus、留在 `#/outline`）。**删除当前节点 / 其祖先**后，若 URL 节点已不在树中 → `location.replace("#/outline")`（不留死详情）。
- **「全部折叠」**：按字面折叠全部；选中行可能被隐藏，右侧详情仍保留（树是导航、详情是检查器；不额外保留祖先链）。

**`outline-canvas`（大纲画布，2026-11）** — 一级导航「大纲画布」的页面（排在「大纲」之后，仅小说工作区）；路由 `#/canvas`（无深链、选中态不进 URL）。**画布是观察面，不是第二个大纲页**：结构与顺序的唯一编辑入口仍是大纲树（`outline-page`），本页拖拽卡片**只改坐标**，不改父子 / 章序 / 卷归属。

- **节点 = 章（唯一）**：卷与场景不上画布（卷号降级为卡上一条元信息，场景数写在卡上）。卡片 = **220×68 / 92**（高度随内容，见下）、三行：① `第N章`（`TypeChip` `tone="soft"`，**全量档画布上唯一徽标**；far 档见「缩放分级」的纯数字角标）+ 状态标记（**在读** = 左侧 2px `{colors.primary}` 内嵌条；**推演** = 4px `type-badge-border` 圆点 + `title` 说明）+ 伏笔徽标（复用 `hook-mark`，可点跳伏笔详情，右对齐）；② 章名（14px，单行 `truncate`，`title` = `卷·章 名称`）；③ 状态与剧情线标签（12px）：状态（`draft` / `revision` / `final`，**草稿 = 默认值不显示**——24 张卡全挂「草稿」是噪声；`revision` 显示「修正中」、`final` 显示「定稿」并带 `{colors.primary}` 圆点）+ 剧情线标签（`#标签`，最多 2 个，超出显示 `+N`，完整列表进 `title`；色相复用 `tagTintClass` 的三色轮转，不新增色值）；**状态与标签都为空 → 整行不渲染**。**元信息不再上卡面**：卷号与场数进卡片 `title`（`第1卷·第3章 名称 · 5 场`），字数与更新时间只留在大纲树行尾与详情页元信息行——画布是看结构关系的地方，不是统计面板。编号派生单源 = `numberVisibleOutline`（只计可见节点，不读服务端 `deriveChapterOrder`）；在读 / 推演 = `config.currentPosition` / `config.deductionNodes`（服务端二者均只接受章节点，直接按 id 命中，不做祖先映射）。 **卡片高度随内容**：状态与标签都没有 → **68px**（不预留空行），有 → 92px；行距 = 该行最高卡片 + 24（整行没人有元信息时行距从 116 收到 92）。
- **平铺卡片、无容器**：卷不画成列 / 框 / 泳道——**位置不表达结构**（层级由编号徽标承载），卡片可任意摆放。**布局 = 确定性网格**：缺失坐标的章按可见章序**每行 5 张**补位（常量与纯函数在 `lib/outline-canvas-layout.ts`；**行距按行计算** = 该行最高卡片 + 24，短卡行不占高卡行的空间）；**已有坐标的章不动**（手工摆位优先），新章落网格末尾。**首次进入（无任何坐标）**：fit 结果 ≥ `CANVAS_INITIAL_MIN_ZOOM`（0.85）→ 居中（`maxZoom: 1`：1–2 章的小书不放大到满屏）；装不下 → 视口**钳到 0.85 并定位到内容左上角 + 24px**（不再居中裁切——旧实现被 `minZoom` 卡在 0.5 后，居中会把首列卡片推到画布外）；有存量视口则用之。v1 不提供「重新布局」按钮（会抹掉手工摆位，登记 `backlog.md`）。
- **缩放分级（LOD）**：视口缩放不改字号（14px × 0.5 = 7px 不可读），按档切换卡面颗粒度；档位表单源 = `lib/outline-canvas-layout.ts` 的 `canvasLodLevel()`：`z ≥ 0.72` 全量；`z < 0.72` 切 far 档：26px 章名（居中、单行 `truncate`；章名才是识别 token）+ 左上角纯数字章号角标（`n`，14px `muted-foreground`，不显示「第/章」），隐藏章号徽标 / 第三行 / 伏笔徽标（这些信息仍进卡片 `title` 悬停提示），在读条保留，**未写章 = `{colors.surface-muted}` 底、已写章 = `{colors.canvas}` 底**（两档，不引新色）。实现 = 只在**跨档**时给画布容器加 `lod-full` / `lod-far` 类（比较后 setState，不每帧重渲染节点），显隐规则落 `canvas-theme.css`；边的文字标签同口径（`z < 0.72` 不画）。
- **坐标与视口 = 展示层偏好**：`localStorage` `ai-editor:canvas:{projectId}` = `{ version: 3, nodes: { [nodeId]: { x, y } }, viewport?: { x, y, zoom } }`（按书隔离；**v1 / v2 旧条目读侧整体丢弃一次**——卡片高度与行距已改，旧网格的行距不再匹配，重排比留着一地空洞更干净；已删章 id 写侧清理）；不进 `outline.json` / 备份 / 云端包（跨设备不同步是有意取舍，见 `../design/config.md`）。
- **连线 = `plot_edge`（章 → 章，唯一选项）**：拖出即连（源卡 handle → 目标卡；落空 / 自连静默取消；重复 → `409 RELATION_EXISTS` toast）；点击边开右侧抽屉编辑 `label`（短标签，`z ≥ 0.72` 时恒显示在线上；空则不画文字）与 `description`（长说明，只在抽屉与关联页展示，见 `relations-view`）；删除 = 选中边 + `Delete` / `Backspace` 键，或点边开抽屉后 footer 的「删除连线」→ `ConfirmDialog`（物理删、不可恢复；多选删除部分失败时也重拉，画布回到服务端真相）。**分类在画布上的体现 = 下拉只有 plot_edge**：人物 / 伏笔等预定义类型不出现（端点适用性单源见 `../db/schema.md`，组件不得手抄矩阵）；边带**方向箭头**（`ArrowClosed`，颜色取 `--xy-edge-stroke`），方向 = 源 → 目标。
- **选中与跳转**：卡片 hover = 1px `{colors.hairline-strong}` 描边；**选中 / 聚焦 = 1px `{colors.primary}` 描边（不填充、不加阴影）**；单击卡片 = 选中 + 聚焦其邻边（该章所有边保持、其余边降透明；点空白取消）；**双击卡片 = `#/outline/:id`**（本页不承载节点详情、无 rail）；选中是组件态、不入 URL。**输入框内按 `Delete` / `Backspace` 只编辑文本**（React Flow 的输入节点守卫），要删边先点空白或直接点边。
- **筛选（2026-11）**：左上常驻控件条 = 筛选项在上、缩放组（`Controls`）在下；筛选按钮（`FilterOutlined`，有激活条件时显示小圆点徽标 + `{colors.primary}` 描边）。Popover 内容 = 卷（当前树中出现过的卷，按阅读序）+ 状态三复选框（草稿 / 修正中 / 定稿）+ 当前树中出现过的标签（按使用次数降序）+「清除」；三个维度合在一个筛选对象里。**同维度 OR、跨维度 AND**；未命中卡片（含非本卷卡片）**保留位置、不删除、不重排**，整卡透明度降到 25%、端点被筛掉的连线不画（命中卡片之间的连线正常）。筛选是组件态：不写 `localStorage`、不进 URL，刷新即清；空结果时画布中央给「没有符合条件的章节」。**标签编辑不在画布**（入口 = 大纲树章详情面板，见 `outline-page`），画布只读。
- **辅助控件**：`Background`（dots，`gap 24` / `size 1`；颜色取 `--xy-background-pattern-dots-color-default` = `{colors.hairline}`，不加纸纹 / 渐变 / 暗角）+ `MiniMap`（**右上**——右下被全局「问 AI」浮钮占据；160×108，`{colors.canvas}` 底 + 1px `{colors.hairline}` + `{rounded.sm}`，节点色 `{colors.hairline}`（无描边）、视口遮罩 `{colors.surface}` 55%（外圈压淡、不遮死）+ 1px `{colors.hairline-strong}` 框）+ `Controls`（放大 / 缩小 / 适应视图，28px，`ariaLabelConfig` 中文标签），缩放 0.25–2；保留触控板双指平移；不做框选 / 多选 / 对齐吸附（`../design/backlog.md`）。
- **空态 / 加载 / 失败**：无章 → **画布区垂直居中**的「画布上还没有章节」+「去大纲新建第一卷」；加载 = 网格骨架占位；大纲失败 = 错误条 + 重试（画布不渲染）；**连线列表单独失败 = 画布顶部错误条 + 重试**（保留上一次的边，不静默降级为「无连线」）；未打开项目 → 回首页引导（沿用既有模式）。
- **窄屏（<1024px）**：画布全宽（无 master-detail、无返回条）；右栏仍是抽屉（全局规则）。
- **样式例外（唯一）**：只引 `@xyflow/react/dist/base.css`（结构样式，不含颜色）；`--xy-*` 变量的**唯一映射点** = `components/outline-canvas/canvas-theme.css`（与块编辑器 `--bn-*` 同构，映射到 antd token / `index.css` 变量），组件 className 里不写色值；antd 下拉 / 浮层的 `getPopupContainer` 指向画布容器（避免被画布 `overflow: hidden` 裁剪）；页面只传尺寸 / 位置 / 文案类 props（`MiniMap` 的 `width/height`、`ariaLabelConfig`），不传色值。

**`writing-page`（写作页，2026-11）** — 一级导航「写作」（排在「大纲」之前，仅小说工作区）的页面；路由 `#/writing` / `#/writing/:chapterId`。**中栏内 master-detail**（不是页内 tab、不改左栏高亮）：左 = **卷章导航栏**（默认 240px，可拖拽 200–480px，可收起为 0px（正文列吸收宽度）；展开态由卷章栏自身 1px 右边线充当分栏线、收起态不渲染 rail / 无分栏线；自身纵向滚动），右 = **正文列**（吸收剩余宽度，承载章正文的页头 + 写作面）。两列都铺满中栏高度（外壳与内边距的抵消见 §Layout「写作页的中栏内分栏」）。
- **卷章导航栏 = 只读结构导航，不是第二个大纲页**：顶部 = `PanelHeader`（`px-3`；承载开关时 `px-6`；标题行 40px + 预留元信息行 24px + 1px 分割线；`section-title`「卷章」，元信息行 = 今日目标一行（见本节「卷章导航栏 · 今日目标元信息行」）；见 §Layout「工作台子栏页头」），左端 `leading` = 左钮（`PanelToggleButton side="left"`；仅详情列可见时；两栏都开时它就在本 header，左栏收起时移到正文页头），右端组 = `[收起 / 展开右侧详情]`（`PanelToggleButton side="right"`；仅详情收起时；详情展开时右钮在正文页头动作组末尾）；行区容器 `p-2` = 8px 内边距，行内几何与人物工作台同密度：卷行 = 折叠箭头（`RightOutlined` + `!collapsed && "rotate-90"`，24px 盒；无子行时同几何空占位）+ `第N卷`（`TypeChip`，`min-w-14`）+ 卷名（`truncate`）+ 右侧 `N章`（caption、muted、`tabular-nums`）；章行 = 24px 缩进占位 + `第N章` + 章名（`truncate`）+ 右侧字数（`metadata.textLength > 0` 才渲染，`N 字` / `N.N 千字`，格式化单源 = `lib/manuscript.ts` 的 `formatTextLength`，muted、`tabular-nums`）。行高 32px、`{rounded.sm}`、无行底线；hover = `surface-soft`；**选中 = `bg-accent`（`surface-muted`）+ 文字不变色 + `aria-current="page"`**（与左栏导航同一选中语言）。**顺序 = 阅读序**（卷文件序 → 卷内章序）；**存量根级章在顶层就地显示、按原文件位置夹在卷组之间**（不造「未分卷」伪卷）。**0 章卷保留卷行**（`0章`、无子行、无箭头）。**默认全展开**；折叠状态是页面 state（**不写 localStorage**、刷新复位、切章不重置）。换章时选中行 `scrollIntoView({ block: "nearest" })`。
- **卷章导航栏 · 今日目标元信息行（2026-11）**：`PanelHeader` 预留的 24px 元信息行承载**每日目标的一行进度**（此前留空）。文案 = `今日 {已写} / {目标} 字 · 连续 {N} 天`（`caption-text` + `tabular-nums`，单行 `truncate`）；**达标态**改用主色 token 并在末尾加 `✓`（**不新增色值 / 字号**；**不弹 toast、不发系统通知**——达成反馈只有内联）。数据源 = `GET /writing-stats`（**本页是该端点的第二个消费点**：进页拉一次 + 保存成功后按节流窗口刷新，窗口常量单源；**不做**「服务端 today + 客户端本次增量」相加，避免双口径混算）。目标关闭 / 未打开项目 / 拉取失败 / 无数据 → **整行不渲染**（不留空占位；失败静默，不拿错误条盖住卷章导航，与本页「本章待回收」同一取舍）。练习工作区不渲染（本页仅小说工作区）。
- **点击章行直接进正文**（`#/writing/:chapterId`），**不再有「写正文」入口**；点击卷行只折叠 / 展开。**rail 无改名 / 新建 / 删除 / 结构拖拽 / 右键菜单**（宽度拖拽见下条；结构编辑唯一入口仍是大纲树；扩展旋钮见 `backlog.md`）。
- **「本章待回收 · N」块（2026-11）**：紧跟**当前章行之后**（不是 rail 尾部）、同一行区流内的一块可折叠小列表，数据源 = `GET /hook/expected?node_id=<当前章>`（`../api/30-api-entity.md`；字面相等 + 状态未回收，不做「已过期」派生）。折叠头 = 我们自己的 `<button aria-expanded>`（`RightOutlined` + `!collapsed && "rotate-90"`，与卷行同一 24px 箭头盒；文案 `本章待回收 · N` = caption 字号 muted，不套 `TypeChip`），条目 = 伏笔名（`truncate`，`title` 全文）+ 状态下标（`已埋设` / `推进中`，单源 `lib/entity-list.ts` 的 `HOOK_STATUS_LABEL`），点击跳 `#/hooks/:id`（路径经 `lib/entity-paths.ts` 的 `entityDetailPath` 派生后补 `#`）。**无命中整块不渲染**（不给一个点开是空的折叠头）；折叠态是页面 state（不写 localStorage）；拉取失败静默（rail 是附带信息块，不拿错误条盖住卷章导航）；当前无选中章时也不渲染。**「已写未回收 · N」行（2026-11）**：紧跟在上一块之后（同一位置：当前章行下的 rail 附加信息），**单行普通链接**（`<a href="#/hooks">`，无折叠、无子项、无折叠态 state），文案 `已写未回收 · N` = caption 字号 muted + 同一 24px 缩进占位链；数据源 = `GET /api/v1/hook/written-unresolved`（**全书口径**，不按章过滤，见 `../api/30-api-entity.md`）。**与「本章待回收」共用同一套防抖 / 守卫口径**（不另发明一套）：拉取在当前章下进行，seq 守卫丢弃切章迟到的旧响应，渲染侧经 `lib/writing.ts` 的 `loadedForCurrentChapter` 只认来源章 = 当前章 ⇒ **切章那一两帧不挂上一章的数据**；**无命中整行不渲染**、拉取失败静默、当前无选中章时也不渲染。
- **页头导入 / 导出（2026-11 补 TXT）**：页头操作区 = 四枚 24px 图标按钮（`icon-button` + `title` / `aria-label`）：`上一章` = `ArrowLeftOutlined`、`下一章` = `ArrowRightOutlined`、`导入` = `ImportOutlined`、`导出` = `ExportOutlined`（下拉）；导出下拉四项 = `导出块 JSON（无损）` / `导出 markdown（有损）` / `导出纯文本（保真）` / `导出纯文本（网文排版）`。TXT 两项不弹确认框，成功后 toast 文件名；正文取编辑器最新块 JSON（含未保存改动），与整本 TXT 共用同一 `buildNovelTxt`。导入仍只认 `.md` / `.json` / `.txt`（`.txt` 按 markdown 有损导入，不新增 TXT 导入格式）。
- **页头「回填本章摘要」（2026-11）**：动作组里「导出」之后、面板开关（`headerActions`）之前多一枚 24px 图标按钮（`icon-button` + `title` / `aria-label` = 「回填本章摘要」、`ThunderboltOutlined`——**不复用**悬浮「问 AI」的 `CommentOutlined`，那枚的语义是「打开对话」）；点击 = 发一条普通用户消息（文案单源 = `client/src/lib/writing-summary.ts` 的 `CHAPTER_SUMMARY_MESSAGE`，讲「读本章正文后提案更新实际摘要」）+ 本章 `focus_node_id`，再聚焦右栏输入框（照练习页「让 AI 点评」的既有姿势，**不新增端点、不新增通道**，摘要经 AI 提案工具确认后落库）。可点性单源 = 同文件的 `canRequestChapterSummary`：正文已落库且非空（AI 读的是库里的正文，空章没有可摘的内容）。**按钮挂在章正文页头动作组内（`ChapterEditor` 自己的 `actions`），不挂页面壳传给 `headerActions` 的槽位**（那个槽位只在 rail 可见时有值 ⇒ rail 收起时按钮会消失）；因此窄屏（`#/writing/:id` 全宽）与桌面同显，专注模式随页头一起不渲染。
- **页头「历史」抽屉（2026-11）**：动作组里「回填本章摘要」之后、面板开关（`headerActions`）之前一枚 24px 图标按钮（`icon-button` + `title` / `aria-label` = 「历史」、`HistoryOutlined`）；点击打开右贴边抽屉（`components/manuscript/chapter-history-drawer.tsx`：480px、`zIndex` 40、**无遮罩**——正文要留着对照旧版，与 `PlotEdgeDrawer` 的模态抽屉有意不同）。**打开期间右栏（AI 聊天）临时收起**：写 `ui` store 的瞬态标志 `chatPanelSuppressed`，外壳按「用户偏好收起 ∪ 临时收起」决定右栏是否渲染（**不写 `ai-editor:panels`**），关闭 / 换章 / 离开写作页即还原。列表行 = 相对时间 + 绝对时间 + 字数 + 「比当前少/多 N 字」（文案单源 = `client/src/lib/chapter-history.ts`）；点行 → 单份正文只读预览（块编辑器 `editable={false}`，不另写 markdown 渲染）→ 底部「恢复到此版本」→ 二次确认 → 本地待存内容先落盘 → `POST restore` → 换 key 重挂编辑器 + 前移版本戳（**正文与字数立即更新，不刷新页面**）→ 重拉列表（服务端在恢复前强压的那一版出现在列表顶部，可再退回）。**空历史 = 抽屉空态**（入口常显可点：禁用态要在每次开章时预取列表，且解释不了历史从哪来）。列表 / 预览 / 恢复失败一律在抽屉内可见（不静默）。
- **宽度与收起（2026-11 修订）**：默认 240px，拖拽区间 200–480px；右边界 = 6px `ResizeHandle`（`role="separator"` + `aria-label="调整卷章导航栏宽度"`，**不画线**、hover / 拖拽整条染成半透明带；分栏线由卷章栏自身 `border-r` 承担，见 §Layout「分栏边线单所有权」；拖拽期间页面禁文本选中）。**左钮 = 外端锚定**（`PanelToggleButton side="left"`；静态面板图标；`icon-button` 表皮，**不是圆钮**；`aria-label` / `title` = `收起卷章导航栏` / `展开卷章导航栏`，`aria-expanded`；**常显**，不靠 hover）：两栏都开时在 rail 页头标题左侧 `leading`；左栏收起后在正文页头标题左侧 `leading`（`ChapterEditor` 的 `headerLeading`，或骨架 / 坏章 / 无章页头的 `leading`）；右详情收起时隐藏（两栏不会同时全空）。**同一页只渲染一枚左钮**；**四种正文形态（骨架 / 显式坏章 / 正文 / 桌面无章）在左栏收起时都由正文页头渲染同一枚左钮；详情可见且左栏展开时也都由正文页头动作组末尾承载右钮，左栏收起时右钮隐藏**；窄屏（<1024）与专注模式不渲染。拖动过程只更新内存，`pointerup` 一次写入 `localStorage` `ai-editor:writing-rail` 的 `{ width, collapsed, detailCollapsed }`；收起 / 展开立即写。**右侧详情收起**由外端右钮控制：详情列整列不渲染、rail 吸收全宽（`w-full border-r-0`）、不渲染拖拽手柄、不改存宽度、URL 选中保留；**不自动展开**——点章只更新 `#/writing/:id`，用户再点展开按钮才看到正文；详情展开时右钮在正文页头动作组末尾，详情收起时右钮回到 rail 页头动作组末尾（同一 `x` 不跳）；左栏收起时右钮隐藏、正文列保留（两栏不会同时收起）。**收起 = 0px**（不渲染 rail、无窄条、无占位；正文列吸收宽度；展开恢复原宽）；收起态不渲染拖拽手柄；宽度 / 收起态全局一份（同 `ai-editor:panels`，不随书）；窄屏（<1024）rail 全宽、无拖拽 / 收起；专注模式 rail / 页头都不渲染。
- **最近导航（恢复上次写作，2026-11 修订）**：`#/writing` 无 id 且桌面端时，按 **最近打开 → 服务端最近编辑 → 空态** 解析目标章并 `window.location.replace("#/writing/" + id)`（**replace 不入历史**，避免「写作 ↔ 大纲」后退打转；`navigate()` 是 push，不能用）。
  - **最近打开** = `localStorage` `ai-editor:writing-last-opened` 的 per-book 映射 `{ [projectId]: chapterId }`（只存 id，不存正文；打开 `#/writing/:id` 且该章仍在可见大纲时写入，窄屏也写）。命中的 id 必须仍在当前书**可见大纲**（未软删）；已删 / 换书 / 脏值 → 忽略。
  - **回退** = 服务端 `max(metadata.documentUpdatedAt)` 的可见章（`document_records.updated_at` 派生，= 最近一次正文保存）；无已保存正文 → null。
  - 两者皆无 → 空态（不跳「第一章」）。**章存在但正文为空仍可打开**（不因无文档回退）；`current_position` 是阅读进度，绝不复用。窄屏不自动跳（先显示目录）。解析中给骨架，不闪空态。
- **数据与刷新**：大纲一次 `GET /outline?with_metadata=true`（页壳持有，**编辑器面板不自行拉大纲**）；章正文仍走 `GET/PUT /manuscript/:id`。**保存成功后只在 store 里不可变补丁该章的 `metadata.textLength` + `metadata.documentUpdatedAt`，不重拉大纲树**（否则字数徽标陈旧、切章闪烁）。
- **窄屏（<1024px）= 两级互斥**（同 `character-workbench`）：`#/writing` 显示 rail 全宽（无正文，无拖拽 / 收起）；`#/writing/:id` 显示正文全宽 + 顶部 32px **「章节目录」返回条**（`ArrowLeftOutlined` + 文案，仅窄屏渲染）；点章即进正文，返回条回目录。返回条在滚动区之外，不随正文滚走。
- **专注模式（写作页）**：隐藏左栏 / 右栏 / `main-toolbar` / 页头 / **rail / 窄屏返回条**，正文独占（`Esc` 退出、开层守卫、状态不持久化、路由离开即失效——沿用 §Layout 专注契约）。专注切换入口仍在写作工具条右端。
- **空态 / 加载 / 错误**：大纲加载中 rail 给骨架；章 id 已知但大纲未就绪时正文列给骨架、**不先挂编辑器**（避免坏 `chapterId` 先发 404）；无章行（只有 0 章卷也算）→ 正文列 `panel-header` 标题「写作」+ 空态「还没有章节」+ `去大纲新建第一卷`（导航链接，不在此页新建）；有章但无选中（桌面且无最近目标）→ 正文列 `panel-header` 标题「写作」+「从左侧选择一章开始写作」；大纲失败 → 正文列错误条 + 重试（rail 保持骨架；不挂编辑器）；显式 `#/writing/:chapterId` 不在可见大纲 → 正文列错误条「章节不存在或已删除」+ `返回章节目录`（不自动回退；最近打开失效已在解析阶段回退）；章的正文加载 / 保存错误沿用章正文的错误条与 `DOCUMENT_STALE` 处理（见 §写作面）。**窄屏目录页没有正文列** ⇒ 错误条 + 重试与「还没有章节」空态挂在 rail 内（`去大纲新建第一卷` CTA 仅在桌面正文列；窄屏走左栏「大纲」）；桌面 rail 仍保持骨架。
- **旧路由**：`#/manuscript/:id` → `#/writing/:id`、`#/manuscript` → `#/outline`，一律 `location.replace`；旧书签可用，历史里不多一层。
**`setting-page`（设定页，2026-11 改版）** — 一级导航「设定」的页面；路由 `#/setting` / `#/setting/:id`。**中栏内 master-detail**：左 = **设定树 rail**（设定结构 / 名字 / 描述 / 排序的唯一编辑入口），右 = **设定详情**（`EntityDetail`，内容仍是单列）。地点详情 `#/locations/:id` 继续整页呈现，不挂本页壳。**选中唯一来源 = URL**：`#/setting` 无选中（右侧空态），`#/setting/:id` 选中并显示详情；刷新 / 深链 / 前进后退按 URL 收敛，**不自动选中首个设定**（否则「清空选中」不成立）。
- **rail header（`PanelHeader`，`px-3`；承载开关时 `px-6`；标题行 40px + 预留元信息行 24px + 1px 分割线，元信息行留空）**：`section-title`「设定」；左端 `leading` = 左钮（`PanelToggleButton side="left"`；仅详情列可见时）；右端组 = `[全部折叠 / 全部展开] [+ 新建]`，一律 `icon-button` + `title` / `aria-label`（折叠 = `MinusSquareOutlined` / `PlusSquareOutlined`、新建 = `PlusOutlined`）；**右详情收起时右钮改在本 header 右端组最右端**（`PanelToggleButton side="right"`；详情展开时在详情页头动作组末尾；页内子栏统一用 `PanelToggleButton`，不落 `main-toolbar` 的整栏开关）。header 下常驻一行控件：搜索（`search-input`，`flex-1 min-w-40`）+ 标签 + 排序（三态）+ 描述开关（默认开，`localStorage` `ai-editor:setting-desc`），不随行区滚动。行区 `p-2`、自身纵向滚动；行高 / 缩进 / 占位链与 `data-row` 同一套几何（32px、折叠箭头 24px 盒、摘要第二行同占位）。**树外层不再有圆角卡边框**（rail 已是栏，再套一层卡会在分栏处留双线）。
- **宽度与两档收起**：默认 `max(320px, 中栏 1/2)`、拖拽 280–720px（`ResizeHandle`，`aria-label="调整设定树宽度"`，不画线）；**左侧 rail 收起**由外端左钮控制：两栏都开时在 rail 页头标题左侧，左栏收起后在详情列页头 `leading`（同一枚 `PanelToggleButton side="left"`，静态面板图标，`aria-label` / `title` = `收起设定树` / `展开设定树`；常显，不靠 hover；窄屏不渲染），收起 = 0px（不渲染 rail、不渲染手柄、详情列吸收宽度，保留原宽）。**右侧详情收起**由外端右钮控制：详情开时在详情页头动作组末尾，详情收起时回到 rail 页头最右端；详情列不渲染、rail 吸收全宽、不改存宽度、URL 选中保留；**不自动展开**——点行只更新 `#/setting/:id`，用户再点展开按钮才看到详情；两栏不会同时收起，右详情收起时左钮隐藏、左栏收起时右钮隐藏。宽度 / 两档收起态全局一份（`localStorage` `ai-editor:setting-rail` 的 `{ width, collapsed, detailCollapsed }`），不随书；窄屏（<1024px）不渲染拖拽 / 两档收起。
- **行手势（与 `outline-page` 同一条，2026-11 改版）**：**单击行体 = 选中并进详情**（`#/setting/:id`；同 id 幂等、不重复 push）；**单击标题 / 摘要 = 只就地编辑，不切换选中 / 详情**（`stopPropagation`）；**双击不再承担「进详情」**（旧「单击标题 + 双击进详情」互斥取消）。空白区单击 = 清选中（回 `#/setting`）；拖拽行到空白区 = 移到根级。
- **树行能力 = 原设定树全量**：新建（根 / 行尾子级 / Enter 链式）/ 改名 / 描述编辑 / 拖拽嵌套与手动同级排序 / 软删 / 右键菜单（注入上下文、建立关联）/ 全部折叠展开 / 搜索与标签过滤 / 排序三态 / 描述开关 / 标签 chip 与子设定计数 / 新建 3s 高亮。**只把容器变窄，不删能力。** 选中 = `bg-accent`（`surface-muted`）+ 文字不变色 + `aria-current="page"`；新建 = 选中 + 展开祖先链 + 3s 淡染 + 焦点落新行 + 打开右侧详情。
- **详情列**：`EntityDetail` 的紧凑页头变体（`PanelHeader`，标题 = 设定名、16px 单行截断；`compact` 仅本页启用——地点 / 伏笔 / 时间轴三页仍是 `PageHeader`）+ 单列（基础信息 / 自定义字段 / 标签 / 上级设定 / 关联）；操作 = 保存（`type="primary"` 24px 图标）/ 移入回收站（24px 图标，**常规色**——软删不是不可撤销操作）/ 右钮（`PanelToggleButton side="right"`，详情可见且左栏展开时排动作组末尾）；元信息 = `创建于 MM-DD · 更新于 MM-DD` + 「变更记录 N 条」入口（完整时间进 `title`，单行）。**空态**：`#/setting` → 页头「详情」+「从左侧选择一个设定查看详情」；空树 → 详情列仍给通用空态（rail 内已有「新建设定」按钮，不重复 CTA）；坏 id / 已删 → 「该实体不存在或已被删除」+ 返回设定 / 去回收站；未打开项目 → 回首页引导。
- **未保存守卫**：详情表单 dirty（`diffData` 非空）时，切行 / 空白区清选中 / 新建导航 / 窄屏返回条 / **收起右侧详情**都先 `confirm`「放弃未保存的修改？」；保存或节点重载后复位；**浏览器后退也拦**（同 `outline-page`，哨兵历史条目单源 = `lib/back-guard.ts` + `hooks/use-back-guard.ts`）。
- **窄屏（<1024px）= 两级互斥**（同 `outline-page`）：`#/setting` 树全宽（无详情列，无拖拽 / 两档收起）；`#/setting/:id` 详情全宽 + 顶部 32px **「设定树」返回条**（`ArrowLeftOutlined` + 文案，带未保存守卫）；返回条在滚动区之外。
- **数据与刷新**：rail 一次 `GET /entities` + `GET /relations`（`withTags: true`），详情仍走 `EntityDetail` 自己的 `GET /entities/:id`；`useDataRefresh` 在壳内重拉树，详情只重载自身。详情保存成功（`onSaved`）后壳触发 rail 重拉（名字 / 层级 / 关联收敛），**不整页刷新**。

**`table-header`** — 表头**白底**（不是 antd 默认灰底）+ 1px `{colors.hairline}` 底线 + caption 字色 `{colors.secondary}`。
**`relations-view`（关联总览列表）** — 源 / 关系 / 目标三列**表头与单元格同宽同对齐**：一律**左对齐**（关系列也不居中——居中会让类型 chip 相对表头位移，看起来像列错位）。**源/目标单元格 = 端点类型徽标在前、名称在后**（名称单行 `truncate`）：徽标排在名称尾部时，其 x 随名称长度浮动，短名行与长名行两枚徽标落不到同一条竖线上（2026-09 修正；关系列与行尾删除按钮不受影响，`character-relations` / 实体详情页的 `A [关系] B` 内联读法是有意保留的，不随本口径翻转）。**筛选行**（列表模式；`scope` 模式整行隐藏）= 搜索（最左，`search-input`）+ **源类型** + **目标类型** + 关系类型；两个端点类型下拉**各自独立、AND 叠加**（`""` = 不限，不再提供「任一端」OR 模式），并以 `Select` 的 `prefix` **常显「源」/「目标」**（选中值后仍能分辨是哪一端）；窄幅按控件行既有 `flex-wrap` 折行。
**`tag`** — **用户标签 chip**（`data.tags` 数组元素：设定标签 / 事件标签 / 参考资料标签 / 章剧情线标签）：`{rounded.xs}` + **tint 三色底** + caption 字号 + `{colors.primary}` 字色（按名称 hash 稳定分配，见 §Colors 分配规则）。实现 = `components/ui/tag-chip.tsx` 的 `TagChip`（自绘 span + `bg-tag-*` token 类）——**不用** antd `Tag` 的预设色：`Tag` 的默认底色由组件 token 派发、自定义 tint 只能走 `Tag` 的 preset/内联色，与「禁硬编码色值」冲突。antd `Tag` 仅保留给**带交互的元信息 chip**（如 focus 小条的 closable 标签）。**标签不做按钮形态**。**密集行变体（2026-11）**：画布卡片第三行与大纲树章行第三行用同一形态——`#标签` 的 tinted 文本（`tagTintClass` + `truncate`，不套 `TagChip` 的 `py-0.5` 外壳），固定最多 2 个 + `+N`，完整标签名 / 完整列表进 `title`；其余位置仍用 `TagChip`。
**准入规则（收口，2026-09；参考资料分类一并纳入）**：**只有 `data.tags` 元素走 tint**。**参考资料 `data.type`（分类）也走 `type-badge`**——它是「分类」不是用户标签：列表页分类列与详情页头**同一枚 `TypeChip`**（此前列表是裸文字、详情是自绘 `border-border` 灰徽标，两处都与本规则脱钩，看着像「分类既不是标签、也不是类型」）；分类中文名映射（`material` → 素材摘抄等**存量回显**，新自定义分类原样显示）单一来源 = `lib/reference.ts` 的 `referenceTypeLabel()`（原在两个页面各手抄一份）。枚举值（卷/章/场、实体类型、端点类型、关系类型、伏笔 `category`、回收站类型）→ `type-badge`；字段值（人物 `role` 等）→ 纯文本 / 表单控件（不是 chip）；状态 → `status-badge` / 中性命中标记（如大纲 rail 行（图标态）与节点详情页的「阅读进度」徽标）→ `TypeChip`。判据的代码形式 = 两个组件名：`TagChip`（tint）vs `TypeChip`（中性）——不许再给 `TagChip` 传枚举文案。
**`type-badge`** — **类型/分类徽标**（枚举值的唯一形态：大纲节点卷/章/场、实体类型、关联端点类型（源/目标）、关系类型、伏笔 `category`、回收站类型）：`{rounded.xs}` + `{colors.surface-muted}` 底 + **默认档 1px `type-badge-border` `#d94a4a` 边框**（大纲层级另见下方双档） + caption 字号 + `{colors.primary}` 字色。实现 = `components/ui/tag-chip.tsx` 的 `TypeChip`。**类型徽标可承载层级序号（2026-09）**：大纲页树视图与写作页卷章导航栏的卷/章徽标内容 = `第N卷` / `第N章`（形态不变，仍是 `TypeChip`；场景行仍为「场」）——自动编号本身已声明层级，再并排一枚纯枚举徽标就是「`第1卷` `卷`」说两遍。**编号口径 = 用户可见序**：卷序 = 顶层卷按文件位置序 1-based；章序 = 全书先序连续（跨卷累计，含存量直挂 root 的章），**只计可见（未软删）节点 ⇒ 删章后重排**；这与服务端「章序」（`10-data-model.md` §4 的 `deriveChapterOrder`，含软删章、保既有 Delta / 伏笔引用稳定）**不同源、各有用途**——UI 编号只作展示，不参与任何计算。**几何**：编号徽标 `min-w-14`（56px）+ `justify-center` + `tabular-nums`（`第9章` / `第10章` 标题左缘不抖，`第100章` 自动变宽不裁切）；场景行的「场」保持 28px 原宽（场景只在最深层，同层全是场景天然对齐，拉长反而像有编号）。**层级双档（2026-11）**：卷 = 默认红褐 `type-badge-border`；章 / 场 = `type-badge-border-soft`（浅 `#787671` / 深 `rgba(255,255,255,.51)`）。**只用于大纲层级徽标**（大纲树、写作页卷章栏、就地新建行、节点详情、回收站节点栏）；「阅读进度」「推演节点」等状态徽标与其它枚举类型仍用默认红褐。软灰表达「下一级」，不是禁用；1px 线在两种底色上分别 3.92:1 / 4.84:1。**清单外的中性命中标记也用本组件**（2026-09 收口：大纲 rail 行（图标态）与节点详情页的「阅读进度」徽标原是无边框灰面自绘 span，与同行的卷/章/场徽标不同形——现统一走 `TypeChip`，边框与底随之共用同一对 token）。**为什么是描边而不是实底**：实底彩色要么压不住读（`#ef8354` 上墨字仅 4.70:1、白字 2.61:1），要么让每行都摆出一块告警色；描边把一个色相拆成「轮廓」而不是「面积」——既与 tint 标签（面积式）在形态上彻底分开，又不会霸占背景。**为什么边框不能用浅色系**：1px 线在灰底上需 ≥3:1 才看得见（实测橙 1.43、浅红 1.07 = 等于没有）；`#d94a4a` 是少数两态都过线的红系（浅 3.61 / 深 3.34）。**为什么不用 tint**：① 类型是枚举不是用户数据，逐个发彩色等于给每列都上装饰，反而让「彩色 = 这是标签」的信号失效；② hash 取模只保证「同名恒同色」，不承载语义，同一概念的文案变了就变色；③ 类型与「标签」视觉同形时，用户无法区分「这行是分类」还是「这行是标签」——所以两形态用**两套形态语言**（描边 = 类型，实底 = 标签）。
**`status-badge`** — 状态胶囊（进行中/已确认/已失效等）：`{rounded.full}` + caption 字号 + **语义色**（success / warning / error；中性状态用 `{colors.surface-muted}` 灰面）——**不用 tint**（tint 只给用户标签，见上「准入规则」）；状态图标用 antd **Filled** 变体（`CheckCircleFilled`/`CloseCircleFilled`/`ExclamationCircleFilled`）。
**`推演节点` 徽标（2026-09）** — 大纲页 rail 行尾（图标态）与节点详情页元信息行（文字态）的中性标记，形态 = `TypeChip`（同「阅读进度」，不新增色相 / 字号 / 圆角）。**文案是派生物、数量驱动**：单标记 = `推演节点`（唯一锚点 ⇒ 开放式发散）；多标记 = 首位 `推演起点`、末位 `推演终点`、中间 `推演节点 k`（**k = 标记序号**，即树序下的第几个标记——不是章号）——库里只存 id（`10-data-model.md` §15），文案随数量与树序自动重算。**位置 = 行尾操作区、「阅读进度」徽标左侧**（rail 内为图标态；详情内为文字态；阅读进度是单值固定标记、恒贴右；推演标记可能多个，从左侧依次排开）。`title` = 完整语义（`推演起点（第3章）`；多标记再附「第 k / 共 N 个推演节点」）。**rail 里也是只读 chip（图标态）、不配操作按钮**（**行级**标记操作只在树视图右键菜单与节点详情页；**集合级**清空见下）。**一键清空入口（2026-09）**：大纲页 rail header 右端组的「清除推演标记」按钮（图标态，`title` / `aria-label`），仅在**有可见标记**时渲染（无标记时不给一个点了没反应的按钮），点击即清 + toast「已清除全部推演节点标记」，**无二次确认**（标记可随时重标，不是不可恢复操作）；写入 `deduction_nodes: []`（全量替换，顺带收敛盘上失效 id）。

**`hook-mark` 伏笔标记徽标（2026-09）** — 大纲页树视图行内的伏笔锚点标记：图标 + 原生 `title`（`plants` 埋设 / `advances` 推进 / `resolves` 回收，图标与中文映射单源 = `components/outline/node-hook-badge.tsx`，数据单源 = `lib/outline-hooks.ts` 的 `NodeHookMark`）。**徽标是导航链接、不是纯展示**：点一下跳该伏笔详情 `#/hooks/:id`（href 经 `lib/entity-paths.ts` 的 `entityDetailPath` 派生后补 `#`——hash 路由裸路径 href 会整页导航）；hover 由 `{colors.tertiary}` 转 `{colors.primary}` + 下划线（与端点链接同款可点信号）。**位置 = 标题右侧、行尾操作区左侧**（不参与行尾对齐）。**行级手势不受影响**：大纲树行的行点击守卫已排除 `a`，点徽标既不选中行也不进节点详情；徽标 `draggable={false}`（`a` 默认可拖，压掉才能从徽标处起拖整行）。

**`character-workbench`（人物工作台，2026-09）** — 人物页（`#/characters` / `#/characters/:id`）是中栏内的 **master-detail**（无导航级变动，路由已是一级段）：

- **左栏**（固定 240px，右侧 1px `{colors.hairline}`）= 人物列表，**它就是列表本身**（不再有独立人物列表页）：行 = 姓名（`{colors.primary}`）+ 角色定位（`{typography.caption}` + **`{colors.character-role}`**——浅 `#b4551f` / 深 `#ef8354`，两态均 ≥4.6:1）、32px 行高、`{rounded.sm}`、选中 = `{colors.surface-muted}` 灰面 + 文字不变色（**完全复用 `menu-item` / `menu-item-selected` 语言**）；**行头两行**（240px 内物理上塞不下 192px 搜索框 + 下拉 + 按钮）：第一行 `search-input`（192px，独占一行）、第二行排序 `select`（内容宽 + `popupMatchSelectWidth={false}`）+ 主操作（「+ 新建」`button-primary`）。排序默认**角色优先级**（档位升序、未分级沉底、同级按最近更新降序），可切「最近更新」/ `name` / `created_at`。
- **右栏** = 详情，内容区自上而下：**页头**（`page-header` 壳不变）→ **四 tab**（「人物档案」/「阅读进度」/「人物关系网」/「其他关联 · N」，走 `tabs` 契约）→ 各 tab 内容。**tab 文案 = 用户语言，不出数据分层词**：数据层的不可变性分层只服务变更记录白名单与 AI 提案边界，UI 不再分「基础信息 / 可变数据」两块（见 `10-data-model.md` §14）。
- **`人物档案` tab** = 一张 `card` 内的**档案式字段网格**（无区标题、不分块）：**单行字段**（姓名 / 角色定位 / **优先级**（枚举下拉，缺省「未分级」、可清回未分级）/ 假名 / 性别 / 年龄 / 种族）走「label 左置（固定宽 64px、`{colors.secondary}`）+ 值」的两列网格（≥`md` 两列，行距 12px / 列距 16px），**长文本与列表字段**（描述 / 性格 / 动机）整行占满；网格之下依次是 `panel-tree`（自带标题行 + 1px hairline 上边线）与「自定义字段」（仅响应 `data` 已有该键时渲染）。
- **层级语义**：四个 tab 平级，各自承载一个数据集——初始值字段（`人物档案`）、按阅读进度累积的值（`阅读进度`）、人↔人关系（`人物关系网`）、其他关联（`其他关联 · N`）。**关系不参与 `computeState`**，与两个字段 tab 正交：拆成平级 tab 是因为它们本就是不同的数据集，而不是「关系会随进度变」。**`其他关联` tab 标签常显条数**——它涵盖 `appears_in` / `belongs_to` 等 AI 分析数据源，条数可见即「不可藏」。
- **只读语义**：`阅读进度` tab 的字段值 = `computeState(at_node = current_position)` 的累积结果，**画纯文本值列**（空值 `—`、`{colors.quaternary}`），label 与网格位与 `人物档案` 逐一致（对比无位移）；`panel-tree` 在同 tab 走只读形态，tab 首行给 `caption-text`「由变更记录累积，只读」。**编辑只发生在 `人物档案` 视图**——要改当前状态就必须建变更记录（`10-data-model.md` §14 不变式 3）。
- **默认 tab**：有有效阅读进度 → `阅读进度`；未设置 / 已失效 → `人物档案`（失效时在 tab 行上方给提示 + 「去大纲重设」入口）；四个 tab 的选中态是页面 state、**不进 URL**（刷新回落默认 tab）。
- **进度节点选择器只列章**（`chapterNodeOptions`，与 `HookPanel` 的章节点选择器同一 helper）：状态按**章序前缀**累积，非章节点只是某章的**别名**（场景 → 所属章、卷 → 该卷最后一个未软删章、root → 章序 0 = 初始值），列出来只会让下拉变长并造成"粒度更细"的错觉。**选择器带搜索**（`showSearch` + `optionFilterProp="label"`——antd `Select` 无 `optionFilterProp` 时按 `value` 过滤，而本选择器 value = 节点 id，不显式指定则搜标题搜不到）。**通用 compute 探针**（设定/地点/伏笔/时间点详情页的 `compute-preview`）同样只列章。契约层不变：`POST /delta/compute` 与工具 `compute_state` 的 `at_node_id` **仍不限层级**（非章入口只存 API/工具层）。
- **窄屏（<1024px）**：退化为两级——左栏列表全宽 → 点进详情全宽（详情页头左侧给返回入口）；与「本设计语言不对移动端另立规则」一致。
- **全高双滚动布局（实现约定）**：工作台自带「左栏/右栏各自纵向滚动」的全高布局，**需抵消中栏内容区的 `p-6`（24px）内边距**（实现为 `-m-6 h-[calc(100%+3rem)]`）——改中栏内边距时必须同步此处（否则错位）。
- **空列表**：右栏 `empty-state` + 主操作「新建第一个角色」；`#/characters` 无 id 时自动选中第一个角色（有角色则重定向到 `#/characters/<id>`），避免"左栏有内容、右栏悬空"。**自动选首个只在桌面态生效**（窄屏两级下会自动弹回详情、使「返回列表」失效）；窄屏两级：列表全宽 ↔ 详情全宽 + 返回入口。

**`character-relations`（人物关系网 tab）** — tab 内容 = 一张 `card`：**一行操作区**（右对齐 `button-default`「+ 添加人物关系」）+ 分组行列表；**不另画区标题/不放折叠壳**（tab 标签已是区名）。行语言 = `data-row`（底部 1px `{colors.hairline-soft}`、hover `{colors.surface-soft}`）：按 `relationType` **分组**（组头 = `section-title` 字号档中的 caption 行 + 条数，**条数 = 去重后行数**），行 = 对方姓名（可点击切选中该角色）+ 方向箭头（`→` / `←`，双向边标「双向」徽标）+ `metadata` 备注副行（`caption-text`）+ `icon-button` 删除；添加入口的关系类型控件 = **`select-free-input`**（选项 = **调用方子集**（人↔人 5 类：`ally`/`rival`/`mentor`/`family`/`kills`）∪ 「本项目已用的**自定义**类型」（不在预定义表里的，带条数）——子集之外的预定义类型不因「被用过」而回填。**展示/取值口径**（combobox 输入框显示 option 的 `value`，与 `Select` 不同）：预定义类型以**中文标签**为 value（选中即显示「盟友」而不是内部 key `ally`），自定义类型以**原名**为 value（列表 label 带 ` · N`，输入框不带），提交前反解回 `relation_records.relation_type` 的真实取值；语法校验仍在反解之后跑），**目标端类型锁定 `character`**（只读卡片，无下拉）。**对称关系显示去重**（`ally`/`rival`/`family` 同时存在两条边时合并一行 + 「双向」），但**不自动建反边**（显示层去重，不做双写）；**合并行删除只删方向边（out）那一条**，确认文案需声明只删其中一条。仅展示以本角色为一端的关系（其余 = 其他关联）。

**其他关联（tab）** — tab 标签 = 「其他关联 · N」（N = 行数）；tab 内容 = 一行操作区（右对齐 `button-default`「+ 添加关联」，通用对话框）+ 行列表（**同样不画区标题**）。行语言同 `character-relations`（不分类型组，按类型序）；涵盖 `appears_in` / `belongs_to` / `owns` / `masters` 等——它们是 AI 分析的数据源（如孤儿诊断依赖 `appears_in`），因此**条数常显于 tab 标签、不可藏**。空态给一行居中 `caption-text`（不带 `empty-state` 虚线框——两个关系 tab 的空态都只是一句引导）。

**`character-create-dialog`（新建人物弹窗，2026-09）** — 复用 `components/ui/dialog.tsx`（受控，**不新造浮层**）：**单窗两段，不做多步向导**。

- **必填段**（三项，仅前端校验）：姓名 / 角色定位 / 描述——缺失时字段旁内联错误 + 阻止提交（`button-primary` 保持可点、点击后报错；不用 disabled 静默）。
- **可选段**：假名 / 性别 / 年龄 / 种族 / 动机 / 性格（留空**不写 `data` 键**，不产生空串字段）。
- **能力面板段**：三选（`select`）——**空白 / 内置模板（≥2 套）/ 从已有角色复制**；复制 = **结构快照深拷贝**（值作默认值），候选 = 全部未软删角色、源无面板时给一行 caption 提示（不阻断）。
- **重名软提示**：一行 `caption-text`（「已有同名角色：X（仍可创建）」），**不阻断**提交；口径 = `trim` + 小写归一，已软删同名不提示。
- **提交**：成功 → 关窗 + toast + 左栏插入并**选中新角色**（路由跳 `#/characters/<id>`）；失败 → 窗内内联错误不关窗；在途 `loading` 防连点。**
- **入口形态**：左栏行头第二行「+ 新建」= `button-primary`；**空态主操作**——左栏空态用 `button-default`（避免与行头主按钮抢焦点）、右栏空态用 `button-primary`「新建第一个角色」。

**`panel-tree`（能力面板树）** — 自绘缩进行（**不用 antd `Tree`**：其开箱能力覆盖不了就地编辑/自定义拖拽语义/行尾控件，迁移是视图层重写——完整评估与触发条件见 `backlog.md`「有意保留」；项目已有大纲/设定两处自绘缩进行先例）：缩进按层；**分支行** = 展开箭头 + 名称 + 行尾 `icon-button`（**新增同级 / 新增子级 / 改名 / 删除**——四项，操作集完整性优先）；**叶子行** = 名称 + 值输入框（`input` 的 `size="small"` 24px 档，宽度按内容列定档），**空值 = 空输入框**（不给 `—` 占位符——占位符会被误读为已有值）。拖拽走 `drag-indicator`（同级插入线）+ 拖到行中段 = 成为子级（primary 10% 淡染目标行，同 §拖拽目标行）；**`阅读进度` tab 走只读形态**：同缩进的「名称 + 值文本」行（**空值不渲染占位符**——与可编辑形态「空值 = 空输入框」同口径；`—` 只留给字段网格的只读值，见本文件 `character-workbench`），不渲染输入框、工具条与行操作。值自动判定类型（纯数字 → number，否则 string）。**结构与值分离**：结构编辑走页面的显式保存（`PUT partial`，**不产生 Delta**）；仅已有叶子值可被变更记录改（叶子路径进「+ 新建变更」字段下拉，前缀由 shared helper 拼）。**内联提示（不静默改写数据）**：名字含 `.`（不可被变更记录寻址）/ 同层重名 → 行内警告（`panelWarningMap`）；**空名**不属行内警告（shared 解析会把空名节点丢弃、渲染树里不可能存在）——由**改名输入态**的行内提示拦下（「名字不能为空」，提交被拒且不落库）。

> 以上三个人物页专有形态**不新增色值/字号/圆角**——全部落在既有 token 档内（选中面 `{colors.surface-muted}`、次级字 `{colors.tertiary}`、行 hover `{colors.surface-soft}`、拖拽线 `{colors.primary}`、描边 `{colors.hairline}` / `{colors.hairline-soft}`）。

### 会话（右栏）

**`chat-bubble-user`** — user 消息：`{colors.surface-muted}` 灰底（`colorFillTertiary`）+ `{rounded.md}` + `{colors.primary}` 字色。**禁止用 `colorPrimaryBg`**：主色 seed 是深墨（`#37352f`），antd 派生的 `colorPrimaryBg` 实测为 `#787771`（中灰）——灰底上压墨字，对比度 ~1.9:1，不可读（历史 bug）。
**`chat-bubble-assistant`** — assistant 消息：无底透明 + 正文排版（长文本可读性优先，不用气泡包）。正文 markdown = `@ant-design/x-markdown`，流式口径 = `streaming={{ hasNextChunk: 尾条流式中, incompleteMarkdown: 'complete' }}`（单一来源 = `ChatPanel` 的 `MARKDOWN_STREAMING` / `MARKDOWN_DONE`）：流**结束才一次性定稿**，未闭合的强调 / 行内代码 / 链接文字按已写完显示（不扣住不说）。**不用 `streaming={true}` 布尔预设**：它连开 `incremental`（只在顶格标题处切段，散文无切分点）与 `typewriter`（与 delta 到达叠加成双动画）；也**不开 `tail` 光标**（不新增视觉语言）。
**`chat-message-stream`（消息流顺序与滚动跟随，2026-09）** — 一条 assistant 消息内部的顺序 = **思维链 → 工具调用行（按调用顺序）→ 正文**；**流式期与重载后同序**（运行时不得另起一份「消息之后的工具行」列表——两份渲染会出现「答案在工具行上方」的错序与同 id 重复行）。运行态与落库后同一份数据：`tool_execution_start` 把内部形状 `{id, tool, args}` 并入流式消息的 `toolCalls`（按 id 防重），`message_end` 按 id **合并**（不是覆盖）。两种形状由 `asToolCall` 归一——**服务端投影形状** `{id, name, arguments}`（SSE `message_end` 帧与历史接口的**同一份**投影：pi 原生 toolCall 块 `{type:"toolCall",id,name,arguments}` 只去掉 `type`）与**运行态内部形状** `{id, tool, args}`；**新增工具行来源一律走这个归一入口**，否则展开态摘要拿不到 args（只显动词短语，2026-09 oracle 实测）。
- **贴底跟随**：内容增长只在「用户当前贴底」时把滚动条带到末尾（阈值 = `STICK_BOTTOM_THRESHOLD_PX`，单一来源在 `ChatPanel.tsx`，此处不复述数字）；用户上滚即脱离跟随、停在原地读完，滚回底部自动恢复；发送新一轮 / 切换会话与历史加载时**强制恢复跟随**。**不设「回到底部」按钮**（滚到底即恢复，有意不加）。
- **为什么不是「工具行放思维链上方」**：真实时序是 思考→工具→思考→工具→正文，倒置只把尾巴换成思维链，抖动根因（无条件贴底 + 逐次调用折/展思维链）仍在。
**`tool-row`（工具调用行，2026-11）** — 一条 assistant 消息的**全部工具调用由一条 `@ant-design/x` `ThoughtChain` 承载**（`items` 顺序 = 调用顺序，链线把本轮调用串起来）：
- **状态轴只给「进行中 / 失败」**：`loading` / `error`（x 会把该行文字染成 `colorPrimary` / `colorError`），**成功不传 `status`**——成功是常态，传 `success` 会把一整轮每行都染绿，在 40% 宽右栏里变成视觉噪音。不传 `status` 时 gutter 回落**序号**（1、2、3…），本身即「第几次调用」（`colorFillContent` 底的小圆，跟本轮调用数走）。
- **折叠头是我们自己的 `<button aria-expanded>`**（`工具图标 + 调用了 {tool} + 箭头`），**不用 x 的 `collapsible`**：它的折叠头是 `<div onClick>`，无 `role`/`tabIndex`/`aria-expanded`（键盘不可操作）。因此展开态由消息组件持有（`openKeys`）+ 条件 `content` 承担，**让掉 x 的折叠动画**。x 的标题容器是**内容宽**而非整行宽 ⇒ 箭头**跟文字就地**对齐（不再像 antd `Collapse` 那样顶到面板最右），已实测接受。
- **展开区 = 参数摘要**：**挂载即解析**（展开才请求 id → 名称，收起即卸载重置）；未知工具 / 解析失败 → 原始 JSON 兜底（不丢信息）；限高 + 内滚。
- **`footer` = 来源卡片**（`chat-source-cards`）——该槽位**恒显**，正好满足「无需展开即可见」；无卡片时**不传 `footer`**（空槽位会白占一行高度）。
- 标题容器由 x 给 `font-weight: 500`：字重压回常规走**内联 `style`**，**不覆盖 x 内部类**（同 §已知边界）。
**`chat-source-cards`（联网来源卡片，2026-10）** — `web_search` / `fetch_content` 的工具行在折叠头**之下**直接渲染来源卡片（**无需展开**；原始 JSON 仍在展开态可查）——实现 = `ThoughtChain` 的 `footer` 槽位（恒显，无卡片时不传，见 `tool-row`）：
- 搜索卡：标题（最多两行）→ 摘要或片段一行（有则显示）→ `域名 · 日期`；每条命中一张，顺序与工具返回一致。限行用 `line-clamp-*`，**不得与 `block` 同用**（`block` 在产出 CSS 里靠后排，会盖掉 `-webkit-box` 使限行整段失效，2026-10 实测）。
- 抓取卡：`已读取：{标题}` → `域名 · 字数`。
- 字段口径：**域名 = URL 的 host**（去 `www.`），不额外请求、不用 favicon、不用上游 `site_name`；**不显示权威性分数**（无图例的数字是噪音，仍留给模型判断）；日期有则显示 `YYYY-MM-DD`。
- 点击 = 整卡 `<a>` 新窗口；桌面版由主进程交系统浏览器（非 http(s) 丢弃，见 `docs/design/50-desktop.md`）。
- **数据源 = 工具结果 `content`**（AUTO 工具的 `details` 不下发）：解析失败（被截断成非法 JSON / 形状不符）→ 卡片不渲染、回退普通工具行；**卡片不新增状态、不新增请求**，随消息历史自然保留。
**`focus-strip`** — 「正在讨论：{类型} {名称}」小条：`{colors.surface-soft}` 底 + 1px 描边 + caption。**推演形态（2026-09）**：注入的是标记**集合**而非单条对象（无名称可解析）⇒ 文案 = 「正在讨论：推演节点 · N 个」（N = 当前项目的**可见推演节点数**——软删 / 失效标记不计，与徽标、服务端注入同口径）。
**`chat-session-item-menu`** — 会话列表项操作菜单（antd x `Conversations` 的 `menu`）：仅一项「删除会话」——**危险操作走 danger 样式 + `ConfirmDialog` 二次确认**（文案含「删除后无法恢复」），与回收站 purge 同款交互；流式生成中该项禁用（服务端以 409 `SESSION_BUSY` 兜底）。菜单浮层面复用 `dropdown-panel` 契约（canvas 面 + 1px hairline + 阴影）。**已知边界**：操作入口（ellipsis）由 x `Conversations` 内部渲染且**恒显不随 hover**——改它需覆盖 x 内部样式，代价大于收益（窄右栏多占 ~20px，已接受）。
**`session-status-bar`** — 会话状态栏（输入区最底另起一行：`Sender` → 配置行 → 状态行；**配置行回归纯配置**，留模型、思考强度两个下拉 + 自动确认开关）。**自动确认开关（YOLO，2026-11）**：配置行最右端 `Switch size="small"` +「自动确认」；开启后本轮正常结束（`agent_end` 且无 `stopReason`）自动确认全部 pending 提案（含删除类），错误/中止不触发；默认关闭，状态记 `localStorage` `ai-editor:yolo`，`title` 明示风险。**只读观测层**：数字全部由服务端算好下发（占用 = pi `getContextUsage()`；累计用量 / 缓存 / 成本 = `sessionUsage()` 产出的 `usage` 字段；速度 = `createSpeedMeter()` 产出的 `speed` 字段），UI **不自己累加、不自己测时序**（口径见 `docs/design/20-context.md` §2.1）。行内顺序 = 占用段 → 费用 → 速度 → 缓存 → 累计 tokens；某段无数据即隐藏，**整行无任何数据 → 整行不渲染**（不常态白占消息区高度）。

- **占用段三态**：① `percent` + `tokens` 有值 → 2px 圆角条 + `42% · 1M`；② 只有 `contextWindow`（压缩后 / 历史会话，`tokens` 为 `null`）→ `? · 1M` 且**不画条**；③ 连窗口都没有（无模型 / 设置未加载 / 服务端省略该键）→ 整段隐藏。条填充色按占比经 antd token 取色（`CONTEXT_ERROR_PERCENT` 以上 `colorError`、`CONTEXT_WARN_PERCENT` 以上 `colorWarning`、其余 `colorPrimary`），**禁硬编码色值**。
- **视觉**：一行 `caption-text` 字号 + `tabular-nums`，无底色 / 无描边 / 无图标，**不新增视觉语言**；compact 数值格式（k / M / 美元 / tok·s⁻¹）由 `lib/session-status.ts` 单一实现，**行内只放 compact 值**，精确账目走 hover。
- **hover 走原生 `title`**（多行；与 `node-hook-badge` 同口径，**不引 antd Tooltip**）：上下文 tokens / 窗口、输入 · 输出 · 缓存读 · 缓存写 · 合计、命中率分母说明、成本小数位（订阅制标「订阅 · 估算」）、速度样本（tokens / 秒）。
- **窄栏自适应 = 容器查询声明式隐藏**（`@container` + 两级阈值常量），**不折行、不 JS 测宽**：宽度不足时先隐累计 tokens、再隐缓存段；交互控件（配置行两个下拉）永不被隐藏。
- **速度只对进行中的会话有效**：历史会话加载后无速度样本（时序不落盘）→ 该项隐藏。
- **生命周期**：切会话 / 新会话 / 切项目清零（与占用条同一清零点）；新一轮流开始**不清零**（旧值留到新值到达，避免闪烁）。
**`thinking-block`** — 思维链（assistant 消息内的 thinking 内容）：**默认折叠为一行摘要**（`思考过程 · N 字` + 左侧 chevron，`{colors.tertiary}` 字色、无底色、无描边）；展开后 `{colors.surface-soft}` 底 + 左侧 2px `{colors.hairline-strong}` 竖线 + caption 字号 + `{colors.secondary}` 字色 + `pre-wrap`（长文可滚动，限高约 200px；展开态正文字色以 `colorText` 80% 实现——Tailwind 主题未暴露 `colorTextSecondary` utility，属近似 secondary 的登记值，非新色）。**流式期间（本轮首次 `thinking_start` 起，至 `agent_end` / 中断帧）自动展开，本轮结束后折叠为摘要行**——中途的工具调用与后续 LLM 调用**不触发折叠**（每次调用折/展 = 消息上方高度反复跳变，2026-09 用户报「工具调用把思考块往上推 + 抖动」），且**用户手动折叠在流式期间不被覆盖**（流式标记是轮级的布尔量，不是「每次调用」的脉冲）。历史回看：消息接口只回 `THINKING_PREVIEW_MAX_CHARS` 字预览（`docs/api/80-api-chat.md`），点「展开全文」按需拉取全文（带 loading 态）。同一消息同时持有本轮累积全量与服务端预览时**只渲染一个块**（渲染优先级：有流式累积文本则不渲染预览块）。**实现 = 自绘（2026-11 复核结论）**：`@ant-design/x` 的 `Think`（2.9.0 / 2.10.0 组件源码一致）不满足本契约，四条硬伤——折叠箭头在**右**、折叠行**左侧图标不可移除**（`icon={false}` 回落默认图标）、展开区**无底色**且竖线取 `colorBorder` 而非 `hairline-strong`、折叠入口是 `<div onClick>`（无 `role`/`tabIndex`/`aria-expanded`，键盘不可操作）。对齐只能覆盖 x 内部类，属 §已知边界「x 组件内部面不可 token 化」那一类代价；`ThoughtChain` 是多节点链（状态色 + 连接线 + 缩进），不用于单段思考文本。自绘实现**不得引入新色或新字号**。
**`proposal-card`（提案组卡，2026-11）** — 一轮的全部提案合并为一张组卡（单条也同形态）：头部 = 灯泡图标 + `本轮提案 · N 条（M 待处理）` + 右侧「全部确认 / 全部拒绝」（仅有 pending 时可用）；行 = 图标 + 类型中文名 + 摘要首行（truncate）+ 状态 + 行尾逐条「确认 / 拒绝」；点行展开该提案的完整预览。组卡沿用现有 1px `{colors.primary}` 25% 描边 + primary 5% 淡底；确认按钮 `button-primary`，拒绝 `button-default`。批量执行 = 客户端串行调用现有 confirm/reject 端点（无服务端批量端点），逐条记账、失败继续、成功只刷新一次数据、结束一条汇总 toast。YOLO 自动确认走同一条批量路径。

**历史提案卡（2026-11）** — 每条 assistant 消息的正文之后，若该消息的 `toolCalls` 含 `propose_*`，渲染一张只读历史卡：头部 = 灯泡 + `历史提案 · N 条（只读）`；行 = 类型中文名 + 摘要首行（truncate），点行展开参数摘要；**不显示确认/拒绝状态、不提供按钮、不做名称解析**（参数里的 id 原样展示）。历史卡只从会话消息的 `toolCalls` 重建，不新增持久化；live 组卡按 `toolCallId` 去重（live 提案对应的历史行不渲染），不按消息位置猜测。消息内顺序扩展为 思考 → 工具行 → 正文 → 历史提案卡；历史卡沿用组卡的描边/淡底，不再引入新色。
**`toast`** — 全局提示走 antd `message`（`App.useApp()`），顶部居中；`success/error/info` 对应 store 的 `ToastKind`，时长由 store 的 3s 定时器决定（`duration: 3` 对齐）。**命令式反馈的上下文入口**：`AntdProvider` 在 `ConfigProvider` 内部包 `<App component={false}>`（`component={false}` 不渲染包裹 div，不插进三栏 flex 链）——`message`/`notification`/`modal` 需经 `App.useApp()` 取实例才能继承本 Provider 的主题与 locale，不要用静态方法。**同槽位升级（2026-11）**：`showToast(text, kind?, key?)` 的 `key` 透传 `message.open({ key, type, content, duration })`——同 key 的提示**替换**而非叠加；唯一使用方 = 手动保存（保存入口弹「已保存」，存档阶段用同一 `key` 把它升级为「已保存并生成存档」/ 节流文案 / 存档错误 ⇒ 一次 `Ctrl/Cmd+S` 只有一条提示）。**自动保存不弹 toast**（1.5s 一次的噪音），它的反馈由 `save-status` 的文字承担。

### 设置页「通用」区（桌面版专属）

**`tab-general`（设置页二级 tab「通用」，2026-09）** — 设置页二级 tab 顺序 = **通用 → AI 模型 → 高级 → 项目规则 → 备份 → 快捷键**；**「通用」仅在桌面版渲染**（client 能力检测：无 preload 桥则整个 tab 不出现，浏览器形态的 tab 集合与行为完全不变）。「高级」与「快捷键」两形态恒在（前者是本机级配置，后者是纯说明页），「快捷键」恒在末位——详见下节。

**`library-location`（通用 tab 首项，也是当前唯一项）** — 一张 `card`：`section-title`「书库位置」+ 当前路径只读文本（`caption-text` + 超宽 `truncate` + `title` 给全文）+ 行尾 `button-default`「更改…」；卡片底部一行 `caption-text` 说明（更改后应用会重启）。点击「更改…」→ 原生目录框（preload `pickDirectory`）→ 确认后写应用级配置并重启应用。**不新增视觉语言**（全部复用 `card` / `section-title` / `caption-text` / `button-default`）。

**`dashboard-open-path`（书架页「打开其他路径」行，2026-09）** — 原有手输路径 `input` 保留；在其右侧追加 `button-default`「浏览…」（**仅桌面版渲染**，同能力检测）→ 原生目录框 → 选中后直接以该路径打开项目。手输框与按钮同行：**输入框外包一个 `flex-1` 容器**（不给 antd `Input` 挂布局类——`antd-root-override` 守卫禁止在 antd 组件根元素上挂会被无层 CSS 压掉的类；按钮不挂类，自然尺寸）；浏览器形态只有输入框（现有布局不变）。

### 设置页「高级」区（本机级配置，两形态恒在）

**`tab-advanced`** — 内容 = 五张 `card`，顺序固定：

1. `pi-dir`：`section-title`「pi 配置目录」+ 单行 `input`（当前生效目录，可编辑）+ 行内 `button-default`「浏览…」（**仅桌面形态**：`desktopBridge()` 非空，走 preload `pickDirectory()`，与书架「打开其他路径」同款；浏览器形态整钮不渲染）+ 标题行右侧 `button-primary`「保存」（唯一 primary）+ 次行 `button-default`「恢复默认」+ `caption-text`（默认目录值 + 与 pi CLI 隔离）+ 卡片底部一句说明（换目录立即生效、目录不存在会自动创建）。失败（409 在途对话 / 400 非绝对路径）走 `toast` 呈现服务端文案。
2. `search-key`（联网搜索，2026-11）：`section-title`「联网搜索」+ 标题行右侧 `button-primary`「保存」（唯一 primary，有改动才可点）+ `Input.Password`（**回显当前 key**、眼睛切换明文；空串 = 未配置；弹性宽度挂外层 `div`——antd `Input` 会注入 `min-width: 0`，见 §已知边界）+ `caption-text`（key 只存本机 `~/.ai-editor/search.json`；搜索按次计费、与对话 key 是两份独立配置；未配置时 `web_search` / `fetch_content` 报错并指回这里）。写入 = `PUT /settings/config-file/search.json`（服务端 strict `{ apiKey }` 校验；空串 = 清空），成功 toast「已保存，立即生效」。失败态（读取失败 / 解析失败：坏 JSON、顶层非对象、`apiKey` 非字符串）时输入与保存禁用，并给一个 `button-default`「重新读取」（`config-file-editor` 保存后没有跨面板刷新信号，缺这个入口只能刷新整页）；提示指向下方 JSON 编辑器修复。**表单保存只写回 `apiKey`**：文件里若另有未知键会被丢弃（strict 契约本就不接受未知键），要保留手写内容就用下方 JSON 编辑器。**不做「测试连接」**（真检测要发真请求且按次计费）。`search.json` 仍保留在下方 `config-file-editor` 的四项里作兜底。
3. `models-providers`（自定义模型，2026-11）：`section-title`「自定义模型」+ 标题行右侧 `button-primary`「添加」→ 受控 `Dialog`（复用 `components/ui/dialog.tsx`）；卡片主体 = `models.json` 里**自定义 provider** 的行列表（`名称` + provider id（`font-mono`）+ `N 个模型`，行尾 `icon-button` 编辑 / 删除；删除走 `ConfirmDialog` 二次确认并说明会连带模型列表；空列表 = `empty-state` + 「还没有自定义模型服务」）。弹窗字段 = provider 级 `id`（新建必填、之后不可改，改名 = 删旧建新）/ `name` / `baseUrl` / `api` / `authHeader` / `apiKey`（字面量 / `$ENV` / `!命令` 三种写法都按字符串原样存）+ 模型行表格（每行 `id` / `name` / `contextWindow` / `maxTokens` / `reasoning`，可加行 / 删行；必填与约束以 pi `schemas/models.schema.json` 为准，不靠记忆）。**只改这几项**：顶层与 provider 级未知键原样透传（`{...parsed, providers: {...}}`）；`compat` / `cost` / `samplingParams*` / `inputLimits` 等一律留给 JSON。保存 = 组装整份文本走 `PUT /settings/config-file/models.json`；**文件里有 `//` 注释或尾逗号时，保存前弹确认「将丢失 N 处注释 / 尾逗号，原文会备份为 models.json.bak」**（计数单源 = shared `utils/jsonc.ts`，与 pi 的读口径同一套语义）；失败行内展示服务端文案、**不清空弹窗**。`models.json` 的 JSON 兜底仍在最后一张卡「本机配置文件 → 自定义模型」分页——两个入口写同一份文件，卡片文案写明「先保存 JSON 再回来用表单」；标题行除「添加」外再给一枚 `icon-button`「重新读取」（JSON 分页保存后没有跨面板刷新信号，同一口径见 `search-key`）。
4. `runtime-params`（运行参数，2026-11）：`section-title`「运行参数」+ 标题行右侧 `button-primary`「保存」（唯一 primary，`dirty && !saving` 才可点）+ 标题行 `icon-button`「重新读取」；三个控件 = **重试启用** / **压缩启用** 两个 `Select`（选项「默认（跟随 pi）」/「启用」/「关闭」；**「默认」= 删除该键**，不是写 `true`/`false`——客户端不知道 pi 的缺省值，两态 `Switch` 会把「未设置」伪装成「关闭」）+ **出站空闲超时** `InputNumber`（单位 ms，空 = 删键；**下界 = 0 且 0 的含义是「关闭超时」**（pi schema `minimum: 0`），提示里的数字由 schema 常量插值；**表单只表达整数毫秒**——pi getter 对小数 `Math.floor`，小数虽属 schema 合法但本表单不表达（读到小数 / 字符串 `"disabled"` 即判解析失败并指路下方 JSON，不静默取整或改写成 `0`））+ `caption-text`（只覆盖这三个键；压缩阈值 / 思考预算 / 代理 / 可见模型留在下方 JSON；保存后立即生效）。写入 = `parse → 只改这三项 → stringify` 走 `PUT /settings/config-file/settings.json`；**嵌套对象必须浅合并**（`retry` / `compaction` 的其它字段如 `maxRetries` 与顶层未知键原样保留）；`settings.json` 是严格 JSON ⇒ 不做注释确认、不留 `.bak`，解析失败（被手写进注释 / 尾逗号）→ 控件禁用 + 指路下方 JSON 页。
5. `config-file-editor`：`section-title`「本机配置文件」+ `Segmented`（**四项且恒定四项**：凭据 / 自定义模型 / 运行参数 / 搜索凭据；顺序 = shared `CONFIG_FILE_NAMES`，展示登记单源 = `lib/config-files.ts`，有测试同序守卫）+ 一行 `caption-text`（当前项用途）+ 文件名行（含「文件不存在，保存即创建」与「未保存」两个状态词，`font-mono`）+ 等宽 `TextArea`（`rows=14`、`font-mono text-xs`、关拼写检查）+ 底部 `caption-text`（明文只在本机回传）。保存是唯一 `primary`；校验失败的服务端文案内联展示且**不清空输入**（草稿状态机 = `lib/config-file-draft.ts`）。

### 设置页「快捷键」区

**`tab-shortcuts`（设置页二级 tab「快捷键」，2026-09）** — tab 内容 = **纯说明页**：无可交互控件、不拉数据；选中态与其余二级 tab 同款（页内 state、不进 URL、刷新回落默认项）。自上而下 = 一张 `card`（`SectionCard`）：`section-title`「快捷键」+ 一行 `caption-text`（「以下快捷键在应用内任意页面生效」）+ 行列表（`data-row` 语言：左 = 组合键徽标 `TypeChip`，右 = 说明文字）。

**组合键文案按当前系统平台化**（Apple = `⌘ + S`，Windows / Linux = `Ctrl + S`），判定与展示的单一来源 = `lib/shortcuts.ts`（纯函数 + 清单常量），**不复用 `@blocknote/core` 的 `formatKeyboardShortcut`**（那会把整块编辑器库拖进设置页 chunk；两者口径一致：Apple → ⌘，其余 → Ctrl）。**清单里的键位引用真实绑定用的常量**（`save-shortcut.ts` 的 `SAVE_SHORTCUT_KEY`、`panel-shortcuts.ts` 的 `PANEL_SHORTCUT_KEY`），不允许清单与绑定各写一份字面量；带 Shift 的条目（右栏 `Ctrl + Shift + B`）由 `ShortcutEntry.shift` 表达。

**界面缩放（仅桌面形态，2026-11）** — 清单追加三条：`Ctrl + =` 放大界面 / `Ctrl + -` 缩小界面 / `Ctrl + 0` 恢复 100%。条目带 `desktopOnly` 标记，渲染时按 `desktopBridge()` 非空过滤——浏览器形态不出现（免得用户以为键坏了），与「通用」tab 只在桌面形态出现的口径一致。**键位判定不在渲染层**（主进程 `before-input-event`，不挂菜单 accelerator）；档位阶梯、持久化与窄屏翻档口径见 `../design/50-desktop.md` §4.1，本文件只管清单文案与可见性。

**Ctrl/Cmd + S（全站「保存 + 本地存档」，2026-09）** — 任意页面按 Ctrl/Cmd + S = 先执行当前页面的保存动作（正文页 = 用最新内容立即 PUT，不等自动保存计时器；行内编辑态 = 先提交该行；本页无保存动作 = 直接进入下一步），**保存成功后再**生成一份手动备份（与设置页「立即备份」同管道，落 `.backups/`；开云端自动推送时随之推送）。四条边界：

- **节流**：距上次快捷键存档不足 `SHORTCUT_BACKUP_THROTTLE_MINUTES` 时只保存、不生成新备份——连按不会把保留窗口刷成同一分钟的快照、也不会连推云端。节流键是进程内时间戳（刷新即重置，不入 localStorage：存档是磁盘事实，不是用户偏好）。
- **保存失败不存档**：保存失败（网络错 / 409 `DOCUMENT_STALE` / 校验拦下）沿用该页既有错误 UI，不生成备份——页面保存动作以 **返回 `false`** 表示失败（各页失败分支的契约义务：它们自己 catch 后 promise 一律 resolve，快捷键流程拿不到 rejection）；**存档失败**才弹错误 toast「已保存，但生成存档失败：…」（保存成功与存档失败必须分开说，不得谎报「已存档」）。
- **无项目打开**：只保存、不存档、不提示（备份端点本就要求项目已打开）。
- **反馈**：存档成功 toast「已保存并生成存档」；被节流跳过 toast「已保存 · 距上次存档不足 N 分钟，未生成新存档」——**文案里的分钟数由常量插值**，不手抄数字。
- **浏览器原生「保存网页」被拦下**：全站 Ctrl/Cmd + S 一律 `preventDefault`（即使本页无保存动作——存档仍要跑），不再弹出浏览器保存对话框。

### 备份与云端存档（设置页「备份」+ 左栏底部）

**`backup-pane`（设置页 → 二级 tab「备份」）** — pane 内走 `sub-nav` 布局：左 160px 固定两项（「自动备份」/「云端备份」，缺省选中自动备份）+ 右侧面板；**选中态是 node state、不进 URL**（刷新回落默认项，与 AI 模型页同款）。两面板**各自一行 `caption-text` 说明**（自动备份沿用原句「跟随当前工作区：备份与频率均为当前工作区独立…」；云端面板有独立 intro：云端是备份的另一块磁盘、本地数据不依赖它）。

**`auto-backup-panel`（自动备份）** — 自上而下：一行操作区（频率 `select` + 备份标签 `input`（占位符「备份名称（可选）」）+ 主操作「立即备份」`button-primary`）；下方「历史备份」列表——行语言 = `data-row`（底部 1px `{colors.hairline-soft}`、hover `{colors.surface-soft}`），行 = 时间（`formatBackupTime`）+ 类型 `type-badge`（自动 / 手动）+ 用户标签（加粗）+ 行尾 `icon-button`（重命名，行内编辑态 = `input` + 确认/取消，现有实现不变）；**设备与统计作为 caption 行**：小说 `苹果本 · 人物32 · 设定58 · 章120`、练习区只有 `苹果本`（**设备恒有；统计仅小说工作区**——练习区无人物/设定/章；**UI 不自行解析文件名**——字段来自 API 的 `device` / `stats?`，存量旧名即使带统计段也不展示）。

**`sync-cloud-button`（左栏底部第二项）** — 与底部区其余三入口同形（无边框文字按钮 + 左对齐标签 + `@ant-design/icons` 图标，不新增形态）；**角标 = 需要用户动手**：`冲突` 与 `云端有更新` 时显示小圆点；`有未推改动` **仅在自动推送关闭时**显示（开启时它会被自动处理，不需要动手）。antd `Badge dot`，颜色走语义 token、**不用预设色**，**两色口径**：`冲突` = error（`var(--ant-color-error)`）、其余 = warning（`var(--ant-color-warning)`）——warning 是「有事可做」而非「出错」，与 `unreachable` 不亮一起保证「红点 = 需要你裁决」唯一；圆点渲染在按钮行尾（`shrink-0`，标签 `flex-1` 把圆点推到最右，不随出现/消失挪动文字））；状态来自打开项目时那次检查 + 每次点击实时复查，**不做轮询**（宿主 = 应用外壳 `AppShell`：左栏收起时 `NavRail` 不挂载，检查与清理都不能只挂在那里；同一时刻的并发请求由 store 合并）（`/status` 每次 2–3 次 PROPFIND，云盘免费额度 600 次/30 分钟）。点击 = 一键状态机（`docs/design/40-cloud-sync.md` §3）：未配置 → 跳设置页并选中「备份 → 云端备份」（**跨页意图经 `stores/cloud.ts` 一次性下传**；设置页二级 tab 的选中态仍不进 URL、刷新回落默认项）；未打开项目 → 禁用；已同步 → toast 提示已是最新；有未推改动 → 直接推送（**但若 `local.backupStale`（有改动未进最新备份）→ 不直接推，改弹 `cloud-stale-backup-dialog`**——两个等权选项：`[立即手动备份并推送]` / `[上传旧备份]`）；**已同步 + `local.backupStale` → 同样弹该框**（`backupStale` 不随同步前移：推过旧包后状态就是「已同步」，此时说「已是最新」会撒谎）；云端更新且本机无改动 → 弹 `cloud-pull-confirm`；冲突 → 弹 `cloud-conflict-dialog`；云端不可达 → toast 错误文案（强调本地功能不受影响）。在途 `loading` 防连点。

**`cloud-backup-panel`（云端备份）** — 三段，每段一张 `card`（`section-title` 标题 + 说明行）（**自动推送说明行须写全触发口径**：**随自动备份频率触发**（创作数据有变更 × 最新备份已涵盖）/ 两次自动推送至少间隔 2 小时（节流，不是排程）/ 关闭项目与手动备份各触发一次（不受节流；**关闭项目那次在「有改动未进最新备份」时跳过**）/ **创作数据 = 正文、参考资料、大纲、项目设置 + 项目规则（`AGENTS.md`）**；**聊天记录不进包、不会上云** / **自动备份频率关闭时不排程自动推送**（推的只能是已存在的本地备份，频率关闭就不会有新档，见 `docs/design/40-cloud-sync.md` §5）；**开着自动推送但频率为「关闭」时，开关下显示一行 `caption-text` 条件提示**：「当前自动备份频率为「关闭」→ 自动推送不会触发（至少选一个备份频率）」；**`backupStale` 提示行**（恒在状态行下）：`local.backupStale` 为真时显示一行 `caption-text`——「本机有改动未进最新备份（最新备份：<备份文件名>）——云端只会上传旧份，先『立即备份』（或点左栏『同步云端』时选择处理方式）」（**不弹窗、不阻塞**；自动推送在该状态暂停，直到用户备份一次或选择上传旧份）。
自动路径最近一次失败以一行 `caption-text text-destructive` 显示（来自 `status.local.lastAutoPushError`，**任何一次推送成功**即消失，**不弹窗**；`CLOUD_CONFLICT` 时同一行补一句行动指引「用上方『推送到云端』手动裁决（冲突时可在裁决框选择用本机覆盖云端）」））：

1. **账号配置**：`url` / 用户名 / 应用密码 / 设备名四个 `input`（密码**从不回传** → 输入框恒为空，**占位符随状态变化**：未保存过「应用密码」、已保存「应用密码已保存（留空则不修改）」，并在其下给一行 `caption-text`「应用密码已保存（接口从不回传密码，所以这里不回显；要改就直接输入新密码，留空 = 保持不变）」——否则用户输完密码保存后看到空框会以为没存上；**设备名只在「配置里有值」时预填**（没设过 → 输入框留空，说明行给出当前派生值「留空 = 用本机名 <生效值>」）——原先预填生效值（含派生值）的代价是「只点保存就把派生值显式写进 `cloud.json`，改机名后需手改」，现在这个坑没了；填了并保存 = 固定为它，清空保存 = 删掉配置值、重新跟随 hostname）+ `button-default`「测试连接」+ 主操作「保存」（`button-primary`，`loading` 防连点；未改动时禁用）。下方 `caption-text` 两句：凭据以明文保存在本机 `.ai-editor/cloud.json`（权限 600）；免费账户上传流量有限（如 1GB/月），自动推送会消耗配额。
2. **自动推送**：antd `Switch` + 一行说明（**随自动备份频率触发**、创作数据（正文、参考资料、大纲、项目设置 + 项目规则）有变更且最新备份已涵盖时才推、两次自动推送至少间隔 2 小时；关闭项目与手动备份会额外触发一次；聊天记录不进包、不会上云；**频率关闭时不会自动推送**）；`autoPush === true` 且 `config.backupFrequencyMinutes === null` 时，开关下另给一行 `caption-text` 条件提示（文案见上一段，不弹窗、不禁用开关）。
3. **同步状态**（2026-09 按反馈统一）：**三行同字段同顺序**——`云端最新份` / `本机最新份` 均为`时间 · 类型[ · 标签] · 设备[ · 人物N · 设定N · 章N] · 大小`（统计段仅小说工作区；同一工作区内缺项**不省略**，标签可选；用户要能逐项对齐着看）；`上次同步` = 时间 + 该次同步的备份文件名（不再单列「本机已推份」那套另一格式，也不声明方向——服务端只记那份名）；**云端最新份行尾给相对判定徽标** `云端更新` / `本机更新` / `相同`（`compareBackupTime`，任一侧缺失则不显示）——解决「看不出哪份更新」；`本机份列表读取失败` 时本机那份显示「（读取失败——见下方提示）」而不是「无可用备份」；**状态行**（三态文案）；云端检查失败的 `errorCode`）+ **云端份列表（时间倒序 ≤ 5 行，行语言同 `data-row`，行尾标「云端最新」、行内 `button-default`「拉取」任一份）** + 动作 `button-default`「推送到云端」/「拉取云端最新」 + `cloud-pull-confirm` 确认框（**与左栏「同步云端」共用同一个实例**，宿主挂 `AppShell`——两处入口文案必须一致；复用 `ConfirmDialog`：云端那份元信息 + 两句后果声明；**确认按钮走 danger**——拉取会覆盖三文件与项目规则，红色警示比主色更诚实，与本地 restore 的 `[加载]` 同口径）。失败态：**一行错误文案**（`statusFailed` 时「云端配置读取失败，请刷新页面重试」；`local.lastAutoPushError` 时自动推送失败行；**测试连接失败的完整文案也落在这一行**——`break-all` 可换行，因为服务端错误里会带上游响应片段，长度可达数百字符）。**toast 只给摘要**（超过约 80 字符截断加「…」，后接「（详见下方状态行）」）：antd `message` 单行会截断长文案，完整信息必须在面板里可见；未配置：一行引导文案（「填写地址与用户名/应用密码并保存后即可测试连接」）。**刻意不做**独立「重试」按钮与 `empty-state`（面板本身随每次操作刷新，重试入口冗余）。

**`cloud-pull-confirm`（拉取确认框）** — 复用 `components/ui/dialog.tsx`（受控）：展示云端那份的元信息（时间 / 类型 / 标签 / 设备 / [统计（仅小说）] / 大小）+ 两句后果声明（「本机当前状态将先自动快照到本地备份」「正文/参考资料/项目规则会随覆盖被云端那份替换（包内没有规则时本机规则会被清除）；本机对话历史不受影响——会话不进云端」）；Footer = `[取消]` + `[拉取]`（**danger**：拉取会覆盖三文件与项目规则，与本地 restore 的 `[加载]` 同口径）。

**`cloud-stale-backup-dialog`（旧备份上传确认框）** — 同款对话框：一句说明（最新一份本地备份早于最新改动，云端若现在同步只会拿到旧内容）+ 两个等权 `button-default`：`[立即手动备份并推送]`（先 `POST /project/backup` 生成新格式备份、再推送）/ `[上传旧备份]`（照推当前最新那份；**本机没有任何备份时该按钮禁用**并提示先「立即备份」——服务端会 404）——**不用主色也不用 danger**：两者都是合法选择。
**`cloud-conflict-dialog`（冲突裁决框）** — 同款对话框（**单点宿主挂 `AppShell`**：左栏「同步云端」与面板共用同一实例，左栏收起时也弹得出来；推送撞冲突时由 store 直接打开它，面板不再走行内入口）；并排对比「云端那份」与「本机最新份」（时间 / 设备 / [统计（仅小说）] / 大小）+ 一句「两边都会各留一份备份」；Footer = `[保留云端（拉取覆盖本机）]` + `[用本机覆盖云端]` —— **两个选项等权，两个都用 `button-default`（不用主色、不用 danger）**：任何一方都不比另一方“正确”，主色按钮会诱导误点。**「保留云端（拉取覆盖本机）」必须带上对话框里展示的那一份（`fileName` 显式传入）**——不能只写「拉取云端 head」：对话框与点击之间云端可能又多了新份，界面承诺与实际动作必须一致。**本机没有任何备份时**「用本机覆盖云端」禁用并提示先「立即备份」（服务端会以 404 拒绝空推送）；**「本机最新份」读取失败与「真的没有备份」必须区分**——读取失败时该行显示读取失败并禁用依赖它的按钮，不得显示成「本机还没有备份」（那是把故障说成事实）；失败文案（含强推后仍冲突）就地显示在框内，**关闭框不清除状态**——角标会继续亮，可再次强推（force 不是一次性动作）。

**删除传播提示（已废）**：会话不再进云端同步（纯本地目录），“推送到云端后另一台也会同步删除”这条提示随之取消；删书传播走 `POST /project/delete`（见设计文档 §4）。

> 本小节全部形态**不新增色值/字号/圆角**：沿用 `input` / `select` / `button-default` / `button-primary` / `data-row` / `type-badge` / `caption-text` / `empty-state` 与既有 token 档。新增 antd 组件仅 `Switch` 与 `Badge`（均走全局 seed token 派生，无组件级覆盖）。

### 根首页（`#/`）：工作区分区（2026-10）

**根首页 = 工作区聚合入口**，按 `kind` 分区渲染（同一页，不是两个页）：

| 分区 | 内容 |
| :--- | :--- |
| **小说** | 原「书架主页」形态（下方内容不变），标题行 + 行列表 |
| **文风练习** | **预置作家卡列表**（作家名 `section-title` + 一行作家介绍摘录 `caption-text` + 状态行：未开始 / `N 篇范文 · 最近更新 …`）。点已有数据卡 = 打开（落 `#/practice`）；点未开始卡 = **懒创建**（`practice/<作家名>/` 三文件 + `author_id`）再打开——**该目录已存在（用户曾手建）时直接打开它**，不报错（未识别 `author_id` 的目录不在本分区列出，报错等于死路）；**书库未到时卡片禁点**（不是点了没反应）。**无「新建练习区」入口**（作家为产品预置，不可新建、不可改名；工作区显示名可在当前工作区条重命名，`author_id` 不变，卡片标题仍是作家名）。**`author_id` 缺失 / 未知的存量练习工作区不列出**（目录留盘、备份包与云端份不受影响）。排序：已有数据的在前（`updatedAt` 倒序），未开始的按预置清单顺序垫后 |

两个分区各带一行 `section-title`；某分区为空时给一行 `caption-text` 引导文案（不渲染空卡片）。**当前打开的工作区高亮仍按项目 id 判定**（`GET /project/list` 回传 `id` 与 `kind`）。

### 书架主页（`#/` 小说分区，2026-09）

**当前态按项目 id 判定**（不是书名）：当前打开那行仍走 `bg-primary/10 ring-1 ring-primary/30 ring-inset` 淡染面 + 「已打开」徽标（`GET /project/list` 已回传 `id`）；行尾徽标区依次是相对时间。

**行内行动作（不得嵌套在整行按钮里）**：行容器由整行 `<button>` 改为 `div`——**内层「打开」区**（书名 + 徽标 + 时间，可点 = 打开 / 继续创作）+ **行尾 `icon-button` 垃圾桶**（`title` / `aria-label` = 删除书籍，恒贴行尾，同其余列表行）；当前书条（导出 / 重命名那行）并列第三个 `button-default`「删除」。**为什么必须拆**：HTML 不允许按钮嵌按钮，整行按钮 + 行尾图标按钮是无效结构（点击冒泡成「打开」）。

**`book-delete-dialog`（删书确认框）** — 复用受控 Dialog：书名 + 三行后果（本地目录与 `.backups/` 一并删除、不可恢复；已启用云备份时会先把当前状态推送到云端）+ **默认不勾选的复选项「同时删除云端备份」**；Footer = `[取消]` + `[删除]`（**danger**）。云前置推送失败 → 框内错误文案 + Footer 换成 `[取消]` + `[仍要删除]`（danger，`force` 路径；文案写明「最新改动不会上传云端」）。删除成功后回书架，并刷新书架 / 项目配置 / 云端状态。

**`cloud-remote-books-dialog`（从云端恢复，新机器路径）** — 书架「导入备份」旁并列 `button-default`「从云端恢复…」（打开即拉 `GET /cloud/remote-books`；未配置云盘由服务端 409 引导去设置页云端面板，复用跨页意图）：可滚动行列表（`data-row`）= 书名（解析不出回退目录名）+ `caption-text` 元信息（最近备份时间 · 份数 · 大小）+ 行尾状态——「本机已有」置灰（`type-badge`）/ 该目录无备份置灰 / 可导入行给 `button-default`「导入」；导入成功关框 + toast + 刷新书架（**不自动打开**，与导入备份一致）。

**`export-book-dialog`（导出类型，2026-09；2026-11 加纯文本）** — 当前工作区条「导出」不再直接下载，先弹受控 Dialog：标题 `导出《书名》` + **竖排单选项**（antd `Radio.Group`，默认选中第一项）+ Footer `[取消]` + `[导出]`（primary；在途 disabled + loading，沿用导出防连点）。

| 选项 | caption（`caption-text`） | 产物 |
| :--- | :--- | :--- |
| `项目压缩文件`（默认） | `{书名}.zip · 三文件 + 项目规则（若有）· 可再导入（无损）` | `GET /project/export` |
| `小说文档` | `{书名}-小说文档.zip · 卷/章 markdown 目录树 · 有损` | `GET /project/export-novel` |
| `纯文本` | `{书名}.txt · 整本单文件 · UTF-8 · 有损` | `GET /project/export-novel-txt` |

**「纯文本」的排版勾选（2026-11）**：选中第三项后，在单选组下方（`Radio.Group` 之外）显示 antd `Checkbox`「网文排版（段首缩进、段间不空行；文件名加 -网文）」，默认不勾选、不记忆、在途随导出禁用；勾选只影响该次导出。`exportBookOptions(workspaceKind)` 的可选集口径不变：练习工作区仍只有 `项目压缩文件`，小说工作区三项。

**落盘 = 默认下载目录**（三条都走同一 `<a download>` 管道，**框内无目录选择控件**；桌面版直写目录树属未排期项，见 `../design/backlog.md`）。有损提示写在第二、三项的 caption 里，**不另弹二次确认**（选项本身就是用户的选择；单章页头「导出 markdown」那次确认是另一条路径）。无可见章时服务端 400，框内 toast 报错（「本书还没有章节」）。

**可选导出项按工作区类型收窄（2026-10）**：`小说文档` / `纯文本` 是小说语义（服务端 `export-novel` / `export-novel-txt` 对练习工作区 400 `KIND_MISMATCH`）⇒ **练习工作区只给 `项目压缩文件` 一项**（唯一实现 = `exportBookOptions(workspaceKind)`，调用点不另写过滤）；小说工作区三项。

> 本小节**不新增色值 / 字号 / 圆角**：沿用 `button-default` / `button-primary` / `card` / `data-row` / `icon-button` / `type-badge` / `caption-text` / `section-title` / 受控 Dialog（复选项与单选组都沿用 antd `Checkbox` / `Radio` 走全局 seed 派生；导出类型框不引 Tooltip、不写死样式）。

### 作家文风练习区（练习工作区，2026-10）

**设计契约见 `../design/60-practice.md`；本节只定视觉与几何，不新增色值 / 字号 / 圆角。**

| 面 | 形态 |
| :--- | :--- |
| **作家介绍（`#/author`）** | 页头常驻模板（`section: h-full min-h-0 flex flex-col` + 内容进内层 `flex min-h-0 flex-1 flex-col overflow-y-auto`）；`card` 面 markdown 渲染（`@ant-design/x-markdown`，**只读**） |
| **作品介绍（`#/works`）** | 同上骨架；每部作品一个 `card`（作品名 `section-title` + 介绍 markdown）；**无编辑入口、无「新建作品」** |
| **作家风格说明（`#/style`）** | 同上骨架；默认渲染态 = `card` 面 markdown（`x-markdown`）；页头右端组 = `[编辑]` `[导入 .md]` `[恢复预置]`；编辑态 = `Input.TextArea`（md 源码，上限取常量）+ `[保存]`（primary）+ `[取消]`；有用户覆盖时给一行 `caption-text`「当前为自定义版本」。**导入与恢复预置都会丢弃当前生效内容 ⇒ 先过受控确认框（`[取消]` + `[确认]`，按钮 danger）**；恢复预置后按钮组只留 `[编辑]` `[导入 .md]` |
| **文风练习列表（`#/practice`）** | 页头常驻模板；**按作品分组**——组标题 = 作品名（`section-title`）+ `caption-text`「N 篇范文」；分组顺序 = 预置作品清单顺序 + 末尾「其他」组（**无样本的组不渲染**），组内按 `updatedAt` 倒序；样本行（`data-row`）= 片段说明（`truncate`；**空着不占文本**）+ `type-badge` 状态（未写稿 / 待点评 / 已点评）+ 相对时间；组内 `[+ 新建样本]`（预选该组作品）；页头右端组 `[+ 新建样本]`（默认「其他」）——**两处在作家未解析（配置未到 / 不在预置清单）时都禁点**（服务端同样按 400 拒） |
| **新建样本弹窗** | 受控 Dialog（复用 `components/ui/dialog.tsx`）：`select` 关联作品（预置作品 + 「其他」；**必选，默认「其他」**；`popupMatchSelectWidth={false}`）+ `input` 片段说明（可空；**导入文件时用文件名预填——仅在该字段还为空的时候，不覆盖用户已输入的说明**）+ 范文 `Input.TextArea` + 「导入文本文件」按钮（`.txt` / `.md`；**编码先试 UTF-8 再回落 GB18030**；超上限 → 框内错误提示且保留原输入）+ 一行 `caption-text` 字数上限（数字由常量插值） |
| **练习详情（`#/practice/:sampleId`）** | 页头 title = 片段说明（空则回作品名，`truncateTitle`），description = 作品名 + 作家名；三段纵向：**范文（只读）** → **我的稿（可编辑）** → **点评卡**；页头右端 `action` = 删除入口（`icon-button`，`color="danger" variant="text"`，`title` / `aria-label` = 删除这篇范文样本；详情未加载时不渲染）——物理删不可恢复 ⇒ 受控确认框（danger）先过，成功后回 `#/practice` 列表 |
| **自由练习列表（`#/free`）** | 页头常驻模板；平铺 `data-row`（题目 `truncate`；空题显示「（待出题）」）+ `type-badge` 四态（待出题 / 待写稿 / 待点评 / 已点评）+ 相对时间；页头右端组 `[+ 新建题目]` `[让 AI 出题]` |
| **新建题目弹窗** | 受控 Dialog：题目（必填 `input`）+ 写作要求（可空 `Input.TextArea`；上限取常量） |
| **自由练习详情（`#/free/:pieceId`）** | 页头 title = 题目（空则不挂标题，页头写「待出题」）；三段 = **题目卡**（题目 + 写作要求；空题态给 `[让 AI 出题]` 按钮 + 一行 `caption-text` 引导）→ **我的稿** → **点评卡**；页头右端 `action` = 删除入口（`icon-button`，`color="danger" variant="text"`，`title` / `aria-label` = 删除这篇自由练习；详情未加载时不渲染）——「不满意 AI 出的题」的唯一恢复路径 ⇒ 受控确认框（danger）先过，成功后回 `#/free` 列表 |
| **范文块 / 题目卡** | `card` 面 + 只读文本（`whitespace-pre-wrap`，不渲染 markdown）；不给编辑入口 |
| **我的稿** | 纯文本 `TextArea`（**不引块编辑器**）；字体 / 字号 / 行高**间接引用 `--writing-*` 变量**（与写作面一致，**不引 `--paper-bg`**）；页内「保存」按钮（`button-primary`）+ 全站 `Ctrl/Cmd+S`（接入既有保存注册栈，失败 `return false` 阻断存档）；字数 + 已保存时刻 |
| **「让 AI 点评」** | 页内 `button-default`（**有已保存且非空的稿件才可点**）→ 发一条普通用户消息 + 聚焦右栏聊天（流式可见；留痕在会话历史） |
| **「让 AI 出题」** | 空题篇的 `button-default` → 发一条普通用户消息 + 聚焦右栏聊天；AI 经工具写题目与写作要求，客户端收到写库帧后重拉详情 |
| **点评卡** | `card` 面：`summary`（`caption-text`）+ 每个维度一组——维度名（`section-title` 级）+ 四行（**仿写 = 「范文特征」/ 自由练习 = 「风格特征」** / 你的写法 / 引用 / 建议）；引用以引号列成行内文本（`{colors.secondary}`），**不做原文高亮定位**；无卡片时给一行 `caption-text` 空态（「还没点评」） |
| **不做** | 引用高亮定位、卡片导出、评分、维度历史对比、多稿切换、作品增删改、作家介绍 / 作品介绍编辑、双栏 markdown 预览 |

**文案口径**：用户侧只用「范文 / 我的稿 / 点评 / 作品 / 风格说明 / 题目 / 写作要求」——**不出现「画像」「维度校验」「scope」这类设计侧词**。

### 码字统计页（小说工作区，`#/stats`，2026-11）

**视觉契约**：页头沿用常驻模板（`section: h-full min-h-0 flex flex-col` + 内层 `flex min-h-0 flex-1 flex-col overflow-y-auto`）；**不新增色值 / 字号 / 圆角 / 阴影**，两态都只读 token；图表不引第三方库。

| 区 | 形态 |
| :--- | :--- |
| **导航** | 一级导航第十一项「码字统计」（`BAR_CHART` 图标，`#/stats`），放在「参考资料」之后；练习工作区不渲染（路由守卫同样挡回练习首页） |
| **页头** | `PageHeader` title `码字统计`，description 一行 `caption-text`：`按天累计新增正文字数 · 删除不扣减`；右端不放置换/导入按钮 |
| **摘要** | 四张 `card` 面指标（无阴影）：`今日` / `本月` / `累计` / `码字天数`；值 `text-xl`（20px）+ `tabular-nums`，标签 `caption-text`；窄中栏 2×2，宽中栏 4 列。**「今日」读服务端 `today` 日键的当日值**；**「本月」固定指当前月**，与月历详情「当月」不是同一量（后者跟随翻月）。 |
| **今日目标** | 独立 `card` 面，**全宽放在摘要之后、码字日历之前**：标题行 = `section-title`「今日目标」+ 右端开关（`Switch`）；**关闭态整卡只留标题 + 一行 `caption-text`「每日目标已关闭」，开关必须仍在**（它是唯一重开入口）。主体 = 自绘 CSS 进度条（宽度百分比 + `bg-primary`，**不首次引入 antd `Progress`**）+ 一行 `tabular-nums`：`{今日字数} / {目标} 字` + `连续 {N} 天`；**达标态** = 条与数字改主色 + 尾部 `✓`（不新增色值。控件两行 = 档位 `Segmented`（取值单源 = 目标档位常量，**不得手写数字**）+ 写作日 `Checkbox.Group`（周一…周日，`caption-text` 说明「未勾的日子不计入连续天数」）。今日 0 字照常渲染 0 进度，不打 `EmptyState`；**达成不弹任何浮层**（不 toast、不系统通知） |
| **码字日历（月历）** | `card` 面；**标题行 = `section-title`「码字日历」+「今天」`button-default`（只放这两项，避免 320px 卡内被月份控件挤压成竖排）**；**下一行 = 翻月导航（`icon-button` 左右贴边 + 当前月份文本居中）**；7 列星期头（`caption-text`）；每格 = 日号 + **仅正字数时显示**当日字数（`tabular-nums`）；格高固定，月历总宽约 320px。**固定按 6 周（42 格）渲染，不足补空位**：月历卡高度恒为 443px（含 1px 边框；4/5/6 周原为 355/399/443，每少一行矮 44px），避免翻月时下方年度热力上下跳。点击格子选中日期（选中面 `bg-accent` + 1px 主色描边），下方详情行显示：选中日字数 / 当月累计 / 当月活跃天数。**没有独立日期输入框、不引 antd Calendar / DatePicker / dayjs 直接依赖** |
| **码字趋势** | `card` 面；标题 + `Segmented`（`近7天` / `近15天` / `近30天` / `按月`）；自绘柱状图（CSS 高度百分比或 SVG 矩形，柱色 `bg-primary`，轴/hairline 用 token）；每柱原生 `title` 给「日期 · N 字」；图下三行汇总 = 合计 / 日均 / 最高（`caption-text` + 数字）。`按月` = 近 12 个月合计柱 |
| **年度热力** | `card` 面，**全宽放在最后**；标题「码字热力 · 近 365 天」；53 周 × 7 行，周一起始；格子色阶 = `WRITING_HEAT_LEVELS`（0 + 4 正档，单一定义在客户端纯函数，**不得在组件里手写阈值**）：0 用 `surface-muted`，正档用 **GitHub 绿阶 `heat-1..4`**（浅 → 深，深色态用 GitHub 深色阶；见 §Colors「码字热力色」）；点击格子 = 选中该日并跳到对应月；底部图例 `少 → 多` + 活跃天数（窄中栏活跃天数不右对齐，避免被右下角悬浮球遮挡；宽中栏 `ml-auto`）。**宽中栏周列随可用宽度放大、格子保持正方形**；**窄中栏格子保底 10px（`min-w-2.5`）后横向滚动**，不压缩到不可读 |
| **布局** | 宽中栏（内容宽度 ≥ 常量 `STATS_TWO_COLUMN_MIN_WIDTH`）：摘要 4 列 → 第二行「月历 320px + 趋势 flex」→ 年度热力全宽；窄中栏：全部单列堆叠。**用容器查询，不按 viewport 断点** |
| **状态** | 加载 = `Skeleton`（摘要 + 两块卡骨架）；错误 = `Alert` + 页内重试（不整页白屏）；无数据 = 摘要显示 0 + 两个 `EmptyState`（「还没有码字记录」/「保存章正文后开始统计」），**不渲染空轴图** |
| **不做** | 本次会话卡（悬浮面板负责）、周报 / 月报、最长连续、徽章 / 成就、达成弹窗与系统通知、跨书聚合、设备合并、稿费/云存储、`DatePicker`、图表库、antd `Statistic`/`Tooltip`/`Progress`、统计人工编辑 |

**数据口径**：页面只消费 `GET /api/v1/writing-stats` 的 `days` / `today` / `totalChars` / `totalDays`；月/年聚合与热力档位全部客户端派生（纯函数可测）；目标进度与连续天数同属客户端派生（口径见 `../api/130-api-writing-stats.md`）；**不另建月表、不发第二个统计请求**。文案用「字数 / 天 / 本月 / 累计」——不出现「正增量」「UTF-16」这类设计侧词；「删除不扣减」只放在页头 description 作为口径说明。

### 当日码字悬浮面板（`stats-hud`，2026-11）

**形态**：应用级 HUD，宿主 = `components/main-panel/MainPanel.tsx` 的 `<main>`（**必须是绝对定位直接子元素，不能放进 `overflow-y-auto` 内容区**）。只在「小说工作区 + 已打开项目 + 非专注模式」渲染；练习工作区、无项目（未打开 / 已关闭）、专注模式全部不渲染（专注期间追踪器继续，退出专注回来数字仍连续）；书架 / 概览等**仍在已打开项目内**的页面照常显示（应用级，不随页面切换隐藏）。

| 项 | 契约 |
| :--- | :--- |
| **入口** | 「码字统计」`FloatButton`（统计图标）固定在中栏右下、**「问 AI」正上方**：`insetInlineEnd:16`、`bottom:64`（AI 按钮高 40 + 16 底距 + 8 间距）；`zIndex:20`（低于 AI 的 30，不挡入口）；面板打开时入口隐藏，点 X 关闭后入口回来 |
| **面板** | 宽 240；初始占同一槽位（`right:16` / `bottom:64`）；`card` 面 + **浮层阴影（本文件唯一登记值）**；标题行 = `码字统计 · 本次`（`section-title`）+ 一行 `caption-text`「拖动面板移动」+ X（`icon-button`）；2×2 指标：**本次码字**（千分位原数）/ **码字速率（字/时）** / **码字时间** / **空闲时间**；值 20px `tabular-nums`，标签 `caption-text`；无按钮、无目标、无历史 |
| **拖动 / 持久化** | 整个面板可拖（pointer capture，`isDragging` 时全局 `select-none`）；位置 clamp 在中栏矩形内（左/上/右 8px 边距；**底部预留「问 AI」槽位**，拖到右下极限也不被 AI 覆盖），窗口/中栏尺寸变化后重新 clamp；位置写 `localStorage` `ai-editor:stats-panel`（**只存位置，不存数字**），坏值/越界回落默认槽位 |
| **出现 / 关闭** | 首次章正文**正向变化**自动打开一次；用户点 X 后**本次运行不再自动弹**，但追踪继续，可按入口重开；换书 = 新会话，重新允许自动弹。用户主动关闭不写持久化（刷新后恢复默认自动行为） |
| **会话范围** | 同一本书内**跨页 / 跨章保留到应用退出**；**切换小说项目归零**（Q2）；**不做 30 分钟无输入切会话**（与 WonderPen 的差异是有意的）；刷新 / 退出即清零。「本次码字」只加正向文本增量（删除不扣）；文件导入走覆盖保存、不经编辑器变更 ⇒ 面板不计（当日统计照常计）；粘贴经编辑器变更 ⇒ 计入 |
| **指标计算** | 码字时间 = 相邻变更间隔 ≤ `TYPING_ACTIVE_GAP_MS` 的累计（阈值常量单源，客户端纯函数）；空闲时间 = 当前时刻 − 最后变更时刻（秒级刷新，显示 `HH:MM:SS`）；码字速率 = 本次码字 ÷（码字时间/1 小时），窗口过短（< `MIN_RATE_WINDOW_MS`）显示 `—`；三者都只依赖客户端内存态 |
| **不落库** | 会话数字**不进 `data.db`**、不进备份 / 云端 / 导出；不新增服务端端点；页面「今日」与面板「本次」是两个口径（前者含本次启动前当天字数），标题必须区分 |

**文案**：标题用「本次」而不是「今日」；指标名与用户给出的「本次码字 / 码字速率 / 码字时间 / 空闲时间」一致；不出现「会话」「typing window」等设计侧词。

### antd 组件 token 覆盖（全部覆盖项就这些）

**浅/深两态各自给值**：`theme.token` 的显式值在算法派生之后覆盖（不被算法再加工），同一个浅色值写死会在深色态生效——因此 `AntdProvider` 按模式分写 `LIGHT_SEED`/`DARK_SEED` 与两套组件覆盖（下表「深色」列）。

| 组件 | token | 浅色 | 深色（推断） |
|---|---|---|---|
| Button | `primaryShadow` / `defaultShadow` / `dangerShadow` | `"none"` | `"none"` |
| Card | `bodyPadding` | `16` | `16` |
| Menu | `itemBorderRadius` / `itemHeight` / `itemMarginInline` | `6` / `32` / `4` | 同浅色 |
| Menu | `itemBg` / `activeBarBorderWidth` | `"transparent"` / `0` | 同浅色 |
| Table | `headerBg` / `borderColor` | `{colors.canvas}` / `{colors.hairline}` | `#202020` / `#2f2f2f` |
| Table | `cellPaddingBlock` | `8` | 同浅色 |
| Input | `activeShadow` | `"none"` | `"none"` |
| Typography | `titleMarginBottom` | `0` | `0` |
| Tabs | `horizontalMargin` / `itemColor` | `0` / `{colors.secondary}` | `0` / `rgba(255,255,255,.65)` |
| Tag | `defaultBg` | `{colors.surface-muted}` | `#373737` |

**选中面回归全局 token（本表不列）**：Menu 选中项（`itemSelectedBg` / `itemSelectedColor`）与 Select 选中项（`optionSelectedBg`）的默认值就分别是 `controlItemBgActive` / `colorPrimary` / `controlItemBgActive`——§Colors 覆盖全局 token 后三者自动到位，**组件级不再重复覆盖**（重复覆盖正是历史上「登记了灰面、像素却是深灰」的来源：Dropdown 那条交互路径根本不吃组件 token）。

**聚焦环走 seed 而不是组件 token**：selector 型组件（Select/Cascader/DatePicker/Table 筛选）的聚焦环由 `boxShadow: 0 0 0 {controlOutlineWidth} {activeOutlineColor}` 绘制（`antd/es/select/style/select-input.js`），Select **没有** `activeShadow` 组件 token——统一用 seed `controlOutlineWidth: 0` 关闭（见 §Colors 映射表）。Input 的 `activeShadow: "none"` 是各自独立的阴影，二者都要。

**菜单透明底**：antd Menu 默认把 `itemBg`（= `colorBgContainer` 白）打在菜单根元素上，会在左栏 `{colors.surface}` 灰底里切出一块白——故 `itemBg: "transparent"` 让菜单继承左栏底色；`activeBarBorderWidth: 0` 去掉 inline 模式的右侧分界线（分栏由 sidebar 的 1px `{colors.hairline}` 表达）。（不要改用 `!border-none !bg-transparent` 类覆盖：antd 样式是无层 CSS，Tailwind 类压不住。）

**深色面值说明**：深色列的面值（`#373737` / `#202020` / `#2f2f2f`）复用 §Colors 映射表深色列已登记的中性值（行分隔档/面板档/结构描边档），**未发明新色**；它们语义上是「暗色下的选中/表头面」。若日后要独立调深色选中面，先在本表登记新值再改代码。

**新增覆盖需先写进本表**（禁止在调用点用 `!` 前缀类硬压 antd 样式——antd 注入的是无层 CSS，`!` 类只会掩盖「压不住」的事实）。

## Do's and Don'ts

### Do

- 颜色只经 antd token / 本文件登记的值；改色只改 `AntdProvider` 一处
- 用 1px 描边和底色档表达层级；浮层才允许唯一那一条阴影
- 选中态用 `{colors.surface-muted}` 灰面，不用彩色底
- tint 底色只给**用户标签** chip（`data.tags`）；枚举类型/分类徽标一律描边式 `type-badge`（不给类型上 tint；大纲层级按卷/章·场取两档描边，见 §Colors）
- 字号只用四档（20 / 16 / 14 / 12）；标题一律 `Typography.Title level={4|5}`
- 图标一律 `@ant-design/icons`；尺寸随字号类（14 `text-sm` / 16 `text-base` / 20 `text-xl` / 空态 24 `text-2xl`）；状态用 Filled、操作与导航用 Outlined；**整栏收起/展开 = 视口顶带两角的静态 `PanelToggleIcon`（`ShellPanelToggles`，不随栏宽位移）**；**面板内子栏 = `PanelToggleButton`**（同一面板图标，按**外端锚定**放在 `PanelHeader` `leading` / `actions` 最外端；不随态换向；动态 `aria-label` / `aria-expanded`）；树行折叠仍用单箭头；不用 `DoubleLeft/RightOutlined` 表示整栏；禁 `Border*` / `MenuFold*` / `Vertical*`（见 §Components `icon-button`）。**自持图形三处 = `provider-icon` / `app-mark` / `panel-toggle-icon`**（供应商品牌 logo 走自持 svg 精灵 + 品牌自带色；品牌标记与三栏开关走自持内联 SVG + `currentColor`，无形色语汇、不新增色值——均见 §Components）
- 文字型**操作**按钮带边框（H4 红线）；操作按钮一律直接展示，不收进 `⋯` 菜单。导航入口（左栏 Navigation/Menu 项）不属此列
- 思维链默认折叠（流式期间临时展开），不占正文视线
- 中文排版靠系统字体栈；不引入 web 字体
- 写作面偏好只落 `localStorage` 的 `ai-editor:writing`（全局一份，两处书写面共用）；下传只经 `--writing-*` / `--paper-*` 变量，调用点不得写 `--bn-*`

### Don't

- 不用营销站那套：紫 CTA、深蓝 hero 带、马卡龙大面积功能卡、胶囊按钮、80px 展示字
- 不用衬线做界面 chrome 与标题（书封同）；**唯一例外 = 写作面的用户字体偏好**（宋/楷/仿宋/等宽，见 §Colors 写作面偏好）
- 不硬编码色值/色类（`text-blue-500`、`#1677ff`、`rgba(...)` 手写值）——**例外两处**：`html.dark body` 的首帧 FOUC 兜底色（`index.html` 内联脚本，防深色模式闪白）；品牌资产静态文件（`public/brand-icon.svg`——字面色值即 `{colors.primary}` 的浅色值，不经运行时取色，也不被源码扫描替身）
- 不用 `!` 前缀类压 antd 组件样式
- **不要用 Tailwind 类去覆盖 antd 组件根元素上 antd 自己声明的属性**（`width` / `height` / `padding` / `margin` / `font-size` / `color` / `background` / `border` / `border-radius` / `display`）：antd 样式是运行时注入的**无层 CSS**，而 Tailwind 工具类在 `@layer utilities`——按 CSS 级联规范**无层胜出**，此类覆盖会静默失效（历史上满仓 `!` 就是这么来的）。正确做法：宽度/伸缩用**外层容器**承载；具体尺寸用组件 `size`；状态面用组件 `variant`（如 `variant="filled"` = `colorFillTertiary` = `{colors.surface-muted}`）或组件 token
- **不要让 `:root` 的语义变量失去 `--ant-*` 来源**：`cssVar.key` 与 `index.html` 的 `<html class>` 必须同值（见 §Colors 踩坑段），否则全站语义色集体失效
- 不用阴影、渐变、彩色 focus 环、卡片 hover 抬升
- 不引入第二套组件系统（图标只有 `@ant-design/icons`、提示只有 antd `message`、按钮/输入只有 antd）；自绘只限 antd 无对应语义的浮层、业务组件与 `app-mark` / `panel-toggle-icon`（品牌标记与面板开关图标；后者只服务面板开关，不扩散到树行 / accordion / 章节导航）
- 不用胶囊形按钮；不把彩色用于大面背景或正文（**唯一例外 = 用户自选的写作面纸张**：2 档低饱和纸色，默认仍为 `{colors.canvas}`）

## Known Gaps

- **深色 token 未公开**：源分析文档明示未提取 Notion 深色值，上表深色列是推断值，只保证 antd 派生一致，未与实机逐项比对。
- **标签 tint 分配规则**：已实现（§Colors 标签色 —— 名称 hash 取模 3，同名恒同色）；**准入已收口（2026-09）：tint 只给 `data.tags` 元素，枚举类型走描边式 `type-badge`**。新增标签体系时先看现有档位为什么不够，不要另起色表。
- **tint 深色值未与实机比对**：深色态用「同色相 20% 叠色」推断（Notion 未公开深色 token），若日后观感不对，只改 `index.css` 的 `--tag-*` 深色段。（2026-09 换色板时已验算：叠色合成底 + 81% 白字 5.96–6.18 全部达标。）
- **antd 派生色未登记**：hover/active/禁用底、`colorFill*`、浅色色阶由算法派生，本文件不复制（避免漂移）。
- **块编辑器是受控的第二套表皮（2026-09，取代旧「MD 编辑器是独立表皮」）**：块编辑器自带一套排版与配色，不纳入 antd 组件体系；但**改色入口是唯一的**（`blocknote.css` 映射表，见上节），且深浅两态必须各看一遍像素。（早先的 markdown 源码编辑器已整体移除，无第二套编辑器表皮。）
- **插件/第三方浮层未覆盖**：x-markdown 渲染出的表格/引用块样式由库自带，未做 token 映射。
- **x 组件的内部面不可 token 化（已知边界）**：`Conversations` 的会话项选中/悬浮面取 antd 全局 `colorBgTextHover`（浅色 `rgba(0,0,0,0.06)`），该组件只开放 `creation*` 四个 token，无选中面 token——要把它换成精确的 `{colors.surface-muted}` 只能改全局 `colorBgTextHover`（连带 Menu 悬浮面、text 按钮悬浮面），代价大于收益（两值在白底上目测无差）。其他 x 组件（`Sender`/`Bubble`/`ThoughtChain`）同理：内部色由 x 自己派发。
- **写作面的已知代价（`.bn-container` 改 flex）**：工具条是 `BlockNoteView` 的 children（DOM 序在 contentEditable **之后**），靠 `order:-1` 提到视觉最前 ⇒ **视觉序 ≠ DOM/焦点序**（Tab 仍先入正文）；且 `.bn-container{display:flex}` 是**无层 CSS**——将来不要给 `BlockNoteView` 的 `className` 挂 Tailwind `display` 工具类（无层胜出会静默失效）。
- **响应式未细化**：只定义 `<1024px` 的抽屉回退，触屏尺寸与最小点击区未定义。
- **写作面纸张纹理不与文本对齐（有意）**：纹理是装饰级纸张感（间距固定、线色 1.13–1.23:1、默认关闭）。真对齐需锁死行高与段距并放弃标题类块，未做。
- **写作面字体在缺字族的系统上会退化**：Linux 常见发行版无宋/楷/仿宋族，回落 `serif` 通用族（观感不保证）；「不下载 web 字体」优先于字体一致性。
- **纸张深色值未与实机比对**：`#221f19` / `#262522` 按「暖色深色纸」推得（与字色对比 11.10 / 10.54:1 已验算），同 tint 口径——观感不对只改 `index.css` 一处。
- **界面缩放会让 1024px 断点翻档（桌面版，有意）**：`Ctrl/Cmd + =` 走 Chromium layout zoom，125% 起 1280 窗口的 CSS 宽度已到 1024 边缘，150% 起三栏翻成窄屏抽屉形态——与浏览器里按 `Ctrl+=` 同语义。不接受为「布局不变」把上限压到 125%（低视力需要 200%）。口径见 `../design/50-desktop.md` §4.1。

## Iteration Guide

1. 改视觉 → 先改本文件，再改 `AntdProvider.tsx`，最后改调用点；顺序反了必然产生「文档与实现两套事实」
2. 每次改完跑 `designmd lint docs/ui/DESIGN.md`（error 必须清零）。**两类稳定存在的 warning 属预期**：① `orphaned-tokens`——`{colors.hairline*}`、3 个 tint、2 个 paper 只出现在 prose（规范无 border 子 token）；② 深浅算法的派生值不登记（避免与实现漂移）
3. 新组件先加 `components:` 条目 + §Components 一行说明，再写代码
4. 需要新色/新字号 = 先问「现有档位为什么不够」，能复用就复用（四档字号、四档圆角是刻意收紧的）
5. 覆盖 antd 组件 token 必须登记进覆盖表；调用点 `!` 前缀类是禁止项
6. 深色模式任何改动都要在浅/深两态下各看一遍（算法派生值随 seed 变化）
7. **改完主题必看像素**：本次 P0 事故（`:root` 映射失效）就是「文档/类型/测试全绿但像素全错」——改 `AntdProvider` / `index.css` / `index.html` 后，至少跑一次浏览器实测（`pnpm start:test-project` 或 `packages/client` 的 headless 探针），确认 `--ant-color-primary` 在 `:root` 有值
