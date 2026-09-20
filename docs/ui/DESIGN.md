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
  # 类型/分类徽标（描边式 chip；枚举值的唯一形态，见 §Components `type-badge`）：浅底 + 1px 红褐边框
  # 边框 #d94a4a 两态同值（vs 浅底 3.61:1 / vs 深底 3.34:1）；底与字随主题翻转（浅 10.59:1 / 深 8.96:1）
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
  proposal-card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
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

- **tint-sky / tint-sage / tint-yellow**（`#cce9fc` / `#d1e2c4` / `#ffd800`）：3 个浅色底，**只给用户标签 chip**（`data.tags` 元素：设定标签、事件标签、参考资料标签）。**枚举值（类型/分类/状态）一律不用 tint**——卷/章/场、实体类型、端点类型、关系类型、伏笔 `category`、回收站类型全部走**描边式** `type-badge`（§Components）。理由：类型是**枚举**不是用户数据，逐个发彩色只是给每列都上了装饰，读者反而失去「彩色 = 这是标签」的信号；且 hash 取模本来就会撞色，着色并不承载语义。**只做小面积底色，不做大面积背景**。
- **色相分布（要注意的观感事实）**：`sky`(H203) 淡蓝 / `sage`(H94) 浅黄绿 / `yellow`(H51) 亮黄——三档**靠色相拉开**而不是靠深浅：sky 底对白 1.26 与 sage 1.36 / yellow 1.39 本就同一明度档（这版色板走「浅色底」路线），三色彼此色相不接近，所以同屏仍可辨。**为什么不是 5 档**：原 5 档里 `ice`(`#dbeafe`) 与 `sky` 只差明度、`mint`(`#6fb98f`) 是唯一的中间绿（观感偏"墨绿"、与 sage 同色系），三色里真正能一眼分开的只有 3 组 ⇒ 收到 3 档，标签色与「类型描边」的区分度反而更高。
- **`type-badge`（`{colors.surface-muted}` 底 + 1px `type-badge-border` `#d94a4a` 边框 + `{colors.primary}` 字）**：类型/分类徽标的**描边式**强调。底与字**随主题翻转**（浅：`#f0eeec` 底 + 墨字 10.59:1；深：叠色底 `#2c2c2c` + 81% 白字 8.96:1）——不像上一版那样两态恒定，是因为**底色不再自己带色相**（带色相的不透明块才需要锁死字色）。边框色**两态同一值** `#d94a4a`（vs 浅底 3.61:1 / vs 深底 3.34:1，均不低于 3:1 非文本对比阈值）。
  - **为什么橙/浅红不能做边框**：实测彩色边框压在**灰底**上看不见——橙 `#ef8354` 对 `#f0eeec` 仅 1.43:1、浅红 `#ffb3b3` 仅 1.07:1（1px 线宽下等于没有）。浅色系只能做**面积**（tint 底），做**线**必须中深档。
  - **已知代价**：边框色与语义 `error`（`#e03131`）同色相。描边比实底轻，且徽标位置固定在行首/类型列；若日后混淆，改 `type-badge-border`。
- 营销站那套 bold 黄（`#f9e79f`）与深蓝 hero 带**不纳入**。
- **分配规则（唯一，不维护语义色表）**：按 chip 文案（标签名）做 FNV-1a 哈希后取模 3，选中 tint；**同名恒同色**（跨页一致，无随机、无按状态变色）。字色固定 `{colors.primary}`（3 个浅底上墨字对比 8.80–9.71:1，不需为每个 tint 配前景色）。
- **深色态**：3 色同色相以 20% 不透明度叠在深色面板上（保留色相、不刺眼），字色随 `{colors.primary}` 变 81% 白——**实测这套 3 色在深色态均达标**（叠 `#202020` 后的合成底与 81% 白字对比 5.96–6.18）。**浅/深两套色调只定义在 `index.css` 的 `--tag-*` 段**（与 `AntdProvider` 的 antd 色阶并列——tint 不是 antd token，无法从 seed 派生，也不写成硬编码色值散落各处）。

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

**显式覆盖的派生 alias（不是 seed，但同属「人为设定的值」，故登记）**：

| antd alias token | 浅色值 | 深色值 | 为什么必须覆盖 |
|---|---|---|---|
| `controlItemBgActive` | `#f0eeec` = `{colors.surface-muted}` | `#373737` | **选中面**。它由 `colorPrimary` 派生（`theme/util/alias.js`：`= colorPrimaryBg`）——主色 seed 是深墨 `#37352f`，派生的不是浅主色底而是中深灰 `#787771`，压 `colorText`（同为深墨）**对比度 2.26:1 不可读**。同一 token 被 `select` / `dropdown` / `menu` / `pagination` 的选中态与 `tree` / `table` / `cascader` 的行选中共用，故在全局一处对齐到已登记的选中面 |
| `controlItemBgActiveHover` | `#f0eeec` | `#373737` | **选中 + hover 面**。`= colorPrimaryBgHover`（实测 `#6b6a65`）——弹层打开时 antd 会把已选中项自动置为 active，命中 `select/style/dropdown.js` 的 `&-selected&-active { backgroundColor: controlItemBgActiveHover }`，于是 `Select.optionSelectedBg` 这类**组件级覆盖在真实交互路径上完全无效**（2026-09 用户实测「所有下拉选中条目看不清」）。取与选中面同一值：已选中项的面不随 hover 变化，选中信息优先；选中与悬浮仍可区分——antd `optionSelectedFontWeight` 默认 = `fontWeightStrong`（600），**选中项加粗** |

**不登记派生色**：hover/active/禁用底、`colorFill*` 系列、深浅算法派生的色阶一律不写进本文件——登记了就必然与 antd 实际派发值漂移。本文件只登记「人为设定的值」。（守卫：`src/components/antd-tokens.test.ts` 用 antd 自己的 `theme.getDesignToken` 算出**派生后**的 token，断言选中面家族（`controlItemBgActive` / `controlItemBgActiveHover` / `controlItemBgHover`——组件级选中面全由其派生：`select/style/token.js` 的 `optionSelectedBg: controlItemBgActive`、`menu` 的 `itemSelectedBg`、`tree` 的 `nodeSelectedBg`、`table` 的 `rowSelectedBg` / `rowSelectedHoverBg` 等）与 `colorText` 的对比度 ≥ 4.5:1，浅/深各一条（半透明面按该模式面板底色合成后再算，否则深色态会得到假值）；另含「裸深墨 seed 时确实 < 4.5」的自检。实测：去掉覆盖后浅色报 `controlItemBgActive=#787771 → 2.73:1`、深色同样变红，还原即绿。）

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

## Layout

- **三栏**：左栏 NavRail（可读区间 160-480px）、中栏内容（保底 320px、**吸收剩余宽度**）、右栏 ChatPanel（240-960px）；**无路由级 TabBar**——页面组织只有一级导航（左栏），页面内可有分区 tab（如设置页二级 tab），**不进 URL、不参与导航高亮**。
  - **默认宽度 = 按视口算 1:5:4**：左 = `clamp(视口×10%, 160, 480)`、右 = `clamp(视口×40%, 240, 960)`、中 = 剩余；两根 6px 拖拽手柄也从剩余里扣。**区间外由中栏吸收偏移**：`视口<1600` 左栏取下限 160（比 10% 宽 16-32px，中栏略窄于 50%）；`1600≤视口≤2400` 严格 1:5:4（右栏上限 960 = 2400 的 40%，故不漏进来咬比例）；`视口>2400` 右栏封顶 960、剩余给中栏——聊天列再宽无阅读收益，中栏变宽才是想要的。（拖拽/持久化值同样收敛到这两个区间。）
- **间距基**：4px；实用档 `{spacing.xxs}`(4) / `{spacing.xs}`(8) / `{spacing.sm}`(12) / `{spacing.md}`(16) / `{spacing.lg}`(24) / `{spacing.xl}`(32)。沿用 antd `sizeUnit` 与 Tailwind 4px 网格，**无自定义间距值**。
- **页面内侧**：内容区 padding 16px；区块之间 12-16px；行内元素 8px；图标与文字间距 8px。
- **控件高**：常规 32px（`--ant-control-height`），小号 24px，大号 40px；行高 32-36px 保证密集列表节奏一致。
- **响应式**：`<1024px` 折叠右栏为抽屉、隐藏拖拽手柄（见「布局」三栏段）；本设计语言不对移动端另立规则。
- **滚动**：各栏独立纵向滚动；分栏之间靠 1px hairline，不靠阴影或沟槽分隔线（旧 6px 灰分隔条已废）。
- **专注模式（2026-09，仅章正文页）**：隐藏左栏 / 右栏 / `info-bar` / 页头，正文独占视口宽度；**不另起悬浮条**——写作工具条本身即顶部常驻条，右端承载「字数 · 保存态」（与常规态页头同口径、**不两处同时显示**）与专注开关（同一按钮切换「专注模式 / 退出专注」）；`Esc` 退出（**开层守卫**：有可见浮层时该次 `Esc` 归浮层）；状态**不持久化**（不入 localStorage，刷新即回常规布局）；**路由离开即失效**（切章/前进后退不残留）。
  - **专注态下 AI 入口整体不可达（有意）**：中栏右下「问 AI」悬浮球在专注态**不渲染**——实测留着它只会弹一条「可直接在右栏提问」而右栏已被隐藏（指错方向 + 死角）。要问 AI 先退出专注（一次 `Esc`）。

### 中栏页头结构

自上而下：**标题行**（`page-title`，每页一个）→ **二级 tab 行**（可选：设置页二级 tab、人物页四 tab）→ **控件行**（可选：左侧搜索框恒最左 192px（`search-input`）、操作按钮靠右）→ **分割线** → **内容区块**。

- **分割线**：1px `{colors.hairline}`（结构描边档，与 `info-bar` 底线同档；不是 `hairline-soft` 的行分隔档），宽度与内容区块同宽——不穿透中栏内容区的内边距。
- **有 tab 时不再另画分割线**：antd line 型 `Tabs` 的横向导航条**自带** 1px `{colors.hairline}` 底线（`antd/es/tabs/style/index.js` 的 `&-nav-list::before { borderBottom }`），该底线即分割线；配套 `horizontalMargin: 0`（antd 默认 `0 0 16px 0` 会在 tab 与内容间留 16px 空档，压在分割线上就是双线）。
- **间距**：页头与内容区块之间 `{spacing.md}`（16px）；页头内部三段之间 `{spacing.sm}`（12px）。
- **覆盖范围 = 全部中栏页面**：列表/富页、概览、书架、回收站、设置，以及各详情页——详情页的页头 = 标题行 + 操作按钮 + 元信息行，分割线落在元信息行**之下**。加载态/空态/错误态同样保留（分割线属于页头，不随数据变）。
- **页头常驻（2026-09 口径）**：页头（标题行 + 操作 + 元信息 + 分割线）**固定在内容区上方，只有内容区滚动**——避免滚动后找不到标题与页面级操作（章正文页原先跟着正文滚走，与参考资料页不一致）。**实现 = 页面 `section` 用 `flex h-full min-h-0 flex-col`，内容（含各自的错误条之下的部分）放进内层 `flex min-h-0 flex-1 flex-col overflow-y-auto`**；`h-full` 让 section 恰好等于中栏滚动容器的内容区 ⇒ 外壳不滚、内层滚（参考资料详情 / 参考资料列表 / 人物工作台 / 时间轴 / **章正文页** / **拆解进度页** 采用）。
  - **写作面的高度链在内层滚动容器里续接**：章正文页 = section（`h-full`）→ 内层滚动容器（`flex min-h-0 flex-1 flex-col overflow-y-auto`）→ `.bn-container`（`flex: 1 1 auto`，blocknote.css）⇒ 写作面仍铺满剩余高度，工具条 `sticky` 贴的是**内层**滚动容器顶（页头之下）。
  - **尚未统一**：概览 / 大纲 / 实体列表 / 设置 / 回收站等仍走外壳滚动（页头随内容离开）——列入 `backlog.md`，逐页改造时按上面同一条实现口径。
- **实现唯一入口 = `components/ui/page-header.tsx`**（标题行 / tab 行 / 控件行 / 分割线一次给全）：页面不自画页头分割线（表格行、分组头等区块内部的 `border-b border-border` 不属此列）。

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
| info-bar（信息条） | 底部 1px `{colors.hairline}` | 无 |
| tabs（二级 tab 导航条） | 底部 1px `{colors.hairline}`（即页头分割线）+ 选中项 2px `{colors.primary}` 指示条 | 无 |
| page-header（页头分割线，无 tab 时） | 底部 1px `{colors.hairline}` | 无 |
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

### 写作面（工具条 / 专注模式）

**`writing-toolbar`** — 章正文与参考资料正文共用的一行常显工具条（**唯一实现 = `components/blocknote/editor-toolbar.tsx`**，随块编辑器组件内置，两页自动获得）：

- **几何**：高 40px（单行 = 4px 内边距 + 32px 档按钮，与库自带工具条同构）；底 = 正文底（跟纸张偏好走，避免纸上出现一条异色带）；底部 1px `{colors.hairline}`；**无阴影**；`sticky` 贴**内层滚动容器顶**（页头之下，见 §Layout「页头常驻」）。窄幅**折行增高**（`flex-wrap`，`min-height` 而非固定高）——**不做横向滚动**。
- **写作面高度 = 填满剩余视口（2026-09，两处书写面同口径）**：正文只有几行时，写作面**不得**缩水成一小块——`.bn-container` 与 `.bn-editor` 各自吸收剩余高度（`flex: 1 1 auto`）⇒ 空白处仍在可编辑区内，**点空白即把光标落到文末**（Notion 同款）。长文照旧由滚动条承接（`flex-grow` 不封顶）。**flex 链由各页自己接通，三处缺一不可**：章正文页 = 该页 `<section>`（`flex h-full min-h-0 flex-col`）+ **内层滚动容器**（`flex min-h-0 flex-1 flex-col overflow-y-auto`，见 §Layout「页头常驻」）；参考资料详情页 = 表单滚动容器（`flex min-h-0 flex-1 flex-col`）→ 正文本行（`flex-1 min-h-0`）→ 编辑器包裹层（`flex min-w-0 flex-1 flex-col`）——编辑器下方的操作行（取消 / 创建）仍留在编辑器之下。
- **不得让工具条成为自身滚动容器（2026-09 实测缺陷固化）**：`overflow` 必须为 `visible`。`position: sticky` 已使工具条成为后代绝对定位元素的**包含块**，若它同时是滚动容器（`overflow-x:auto` 会把 `overflow-y:visible` 的计算值变成 `auto`），库的 tooltip 与 ariakit 的 select / menu 就**被它自己裁掉**——实测：hover 的 `.bn-ak-tooltip` 落在 y 99–149 而工具条是 153–193（看不见），块类型下拉被压成 **18px** 高的一条缝（⇒ 「改块类型/颜色」实际不可用）。库自带浮动条同样有 `overflow:scroll` 却不受影响，是因为它**没有 position**（包含块在滚动容器之外）。窄幅因此用折行而非滚动。
- **`sticky` 的作用域 = 编辑器区块**：包含块是 `.bn-container`，故滚过章末时工具条随区块一起离开（不是「永远贴在中栏顶部」——那需要 `fixed` 定位，会与页头/专注模式耦合，不采纳）。
- **内容**：左侧 = 块类型下拉 + 粗/斜/下/删 + 颜色 + 对齐 + 缩进 + 链接（**全部复用库自带按钮组件** ⇒ 与编辑器同源表皮，激活态由库管理）；右侧 = 撤销 / 重做 / 保存（**章正文页与参考资料详情页（编辑态）各自注入**；新建参考资料草稿态不注入——那里是带跳转的「创建」动作）/ 写作设置（字体·字号·行高·纸张·纹理·段首缩进）/ 命令帮助 / 专注模式（仅章正文页由页面注入）/ 字数与保存态（**仅专注态由页面注入；常规态它在页头说明行，两处不同时显示**）。
  - **为什么手动「保存」放在工具条而不是页头（2026-09）**：正文是 1.5s 空闲自动保存（`AUTOSAVE_DELAY_MS`），手动按钮是**保底**入口（用户诉求原文：「加一个保存按钮就行」）。工具条随正文 `sticky`（与滚动位置无关）、页头不是 ⇒ 工具条是唯一「写着写着也点得到」的位置（两页都有，见 §Layout「页头常驻」）。点击恒发一次 `PUT`（**即使无待存内容也重发**）——保证「点击必有可见反应」（状态转 `保存中…` → `已保存 · HH:MM`），且不会引入冲突（保存成功后版本戳前移）。`saving` 期间禁用（防连点双发）。
- **失焦态**：库按钮无选中时回落到光标所在块，故常显可用；**不做禁用态**（库无 `canUndo`：撤销/重做保持可点、点空即无变化——宁可无反馈也不要假禁用）。
- **与浮动工具条并存**：选中文字时的浮动条保留（就近操作）；两者按钮集有意重叠；若日后观感重复，关浮动条 = `formattingToolbar={false}` 一处开关。

**`command-help`** — 工具条「命令帮助」打开的静态弹窗（复用 `components/ui/dialog.tsx`）：`/` 斜杠菜单、块手柄、快捷键。**快捷键文案一律从 `@blocknote/core/locales` 的 `zh` 字典插值**（`formatting_toolbar.*.secondary_tooltip` + `formatKeyboardShortcut`，Mac = `⌘` / 其他 = `Ctrl`；撤销/重做字典内没有 ⇒ 由库 keymap 核实后取字面量并存出处注释），**禁止手抄**。用途 = 「不让用户猜命令」的兜底文档；与工具条按钮集**同卡维护**（加按钮就补条目；**唯一例外 = 弹窗自身的入口**——自指条目无信息量）。**已知代价**：专注态下页头承载的操作（上一章 / 下一章 / 导入 / 导出）随之不可达，要动它们先退出专注（有意的取舍：专注 = 无干扰）。

**专注模式入口** = 工具条右端按钮；退出 = 同一按钮或 `Esc`（不新增全局快捷键占用）。

### 按钮与表单

**`button-primary`** — 墨底白字、矩形、无投影。用于页面主操作（新建/保存）。
**`button-default`** — 白底 + `{colors.hairline-strong}` 描边（**文字型操作按钮必须带边框**，这是仓库既有红线 H4）。
**`button-text`** — 无边框纯文字，只用于行内最弱操作；**不得用于页面级操作**。**antd v6 `Button` 的 `variant` 必须与 `color` 同时给**（`antd/es/button/Button.js`：`if (color && variant)`”——否则静默回落到 `['default','outlined']`，`variant="text"` 会变成**带边框**按钮（右侧图标按钮一半有边框一半没有的根因）；合法写法：`color="default" variant="text"`，或遗留 `type="text"`；`design-discipline.test.ts` 有 `button-variant-color` 守卫。
**`icon-button`（统一约定）** — 全站图标型操作按钮**只有一种实现**：antd `Button color="default" variant="text" size="small"` + 图标（**导航型也用它**：给 `Button` 传 `href`，antd 渲染成 `<a>`（`Button.js` 的 `linkButtonRestProps`）——同一个表皮、同一个 `icon-button` 几何，但保住链接语义与「本视图无操作按钮」这类否定契约；自绘图标型 `<a>` 仍禁）（⚠ `variant` 必须与 `color` 同时给，见下行 `button-text` 的坑）（图标尺寸随字号类：行内 14px = `text-sm`、工具条 16px = `text-base`），颜色继承 antd 的 text 变体（`{colors.primary}`），hover/disabled/loading 由 antd 派发；**不再并存自绘 `<button>` 图标按钮**（两套并存会让同一角色出现灰/墨/红三种观感）。**不可恢复操作**（彻底删除 purge、物理删关系）用 `danger`（`{colors.error}`）；**软删**（移入回收站）保持常规色——危险色的语义是「不可撤销」，不是「删除」。图标一律 `@ant-design/icons`；状态用 Filled、操作与导航用 Outlined。**面板收起/展开图标 = 同一族镜像对 `DoubleLeftOutlined`（`«`）/ `DoubleRightOutlined`（`»`）**：方向 = 面板往哪边收——收起 = 朝本侧边缘（左栏 `«`、右栏 `»`），展开 = 反向（左栏 `»`、右栏 `«`），两栏四钮完全对称。**禁用**：`BorderLeft/RightOutlined`（表格边框图标，与面板折叠无关）、`MenuFold/UnfoldOutlined`（仅面向左侧，右栏无同族镜像）、`VerticalLeft/RightOutlined`（名字与朝向不一致——`VerticalLeft` = `▶|`、`VerticalRight` = `|◀`，二者区别在竖条在哪侧而非箭头指向，左右两栏配不出对称）。
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

**`sidebar`** — 左栏底 `{colors.surface}`（比内容面板暗一档），右侧 1px `{colors.hairline}`；**顶部标识 = 「◈ 书架」（书架主页入口，`#/`）**、其下**书名按钮**（`#/overview` 项目概览入口）、八项一级导航、工具区（回收站）、底部四快捷入口（立即备份 / 同步云端 / 设置 / 主题）。**「概览」不再占一级导航位**（入口收敛到书名按钮，`#/overview` 时书名按钮用选中面；书架路由 `#/` 下左栏无选中面——书架自身就是当前页）。
**导航入口不受「文字按钮必须带边框」约束**：左栏导航项（Menu 八项 + 书名 / 设置 / 主题三个入口）与 Menu 项同级——无边框、选中态用 `{colors.surface-muted}` 灰面（Tailwind `bg-accent` = `colorFillTertiary`）、文字不变色，禁用 H4 只约束操作按钮（新建/重命名/重试/删除等）。**左栏底部区形态单一**：立即备份 / 同步云端 / 设置 / 主题四入口同为 `block` + `color="default" variant="text"` 的无边框文字按钮（**四行固定顺序**，「同步云端」在「立即备份」与「设置」之间）；「立即备份」「同步云端」是动作而非导航，形态随底部区（**H4 登记例外，仅此两处**）；禁用/加载态由 antd Button 派发（无项目 → 禁用；在途 → `loading` 防连点），失败经 `message` 提示。**`menu-item`** / **`menu-item-selected`** — 菜单项 32px 高、`{rounded.sm}`；**选中 = `{colors.surface-muted}` 灰面 + 文字不变色**（antd 默认的彩色选中项要显式覆盖：`itemSelectedBg` / `itemSelectedColor`）。**`info-bar`** — 中栏顶部 1px 底线；项目名（点击进 `#/overview` 项目概览）+ 阅读进度 + 语言 + 小屏聊天开关。字号 `{typography.caption}`。

**`tabs`（二级 tab）** — 页面内分区导航（设置页二级 tab / 人物页四 tab）：antd `Tabs` line 型（`items` 数组，`activeKey` 受控）。未选中 `{colors.secondary}`，选中与悬浮 `{colors.primary}`（`itemSelectedColor` / `itemHoverColor` / `inkBarColor` 的 antd 默认值就是 `colorPrimary`，**不重复覆盖**），选中指示条 2px `{colors.primary}`，底线 1px `{colors.hairline}` = 页头分割线（见 §Layout「中栏页头结构」）。**页内 tab 不进 URL、不参与左栏导航高亮**，选中态是页面 state（刷新回落默认 tab）。

**`sub-nav`（三级导航）** — 带子内容区块的页内分区导航（**两处**：设置页「AI 模型」= provider 列表；设置页「备份」= 固定的「自动备份 / 云端备份」两项）：竖向 antd `Menu` inline，宽 160px（= `sidebar` 登记的宽度档），**契约完全复用 `menu-item` / `menu-item-selected`**（32px 行高、`{rounded.sm}`、选中 = `{colors.surface-muted}` 灰面 + 文字不变色），不新增设计语言；项文案超宽截断（`title` 给全文）；项前置图标只在有图标语义的场景出现（AI 模型页的 `provider-icon`、导航下方「添加」项）——备份页两项不带图标。

**`sub-nav` 的「添加」弹窗（设置页 AI 模型，2026-09）** — 三级导航**只列已配置的家**（`authConfigured`：env / OAuth / auth.json 任一来源）+ 当前激活家 + 刚配置成功的家（**「配置了多少显示多少」**，40 家全列会让导航不可用）；导航下方 `button-default`（`size="small"` + `block`）「添加」→ **打开受控 `Dialog`**（复用 `components/ui/dialog.tsx`，不新造浮层）：
- **选择步**（标题「添加 provider」+ 一句说明）：搜索框（antd `Input` + `SearchOutlined` + `allowClear` + `autoFocus`，宽度随弹窗而非列表页 `search-input` 的 192px 档）+ 可滚动紧凑行列表（`provider-icon` + 名称，行高 28px、hover = `bg-muted`（`colorFillAlter` 档，与书架行同款）、整行可点）。
- **配置步**（选中一家后同窗切步）：标题行 = `provider-icon` + 家名；凭证状态行（`credential-label` 同款 caption）+ key `Input`（`autoFocus`）+ 内联错误；Footer = `[取消]` + 主操作 `[保存]`（`button-primary`，`loading` 防连点）。
- **关闭语义（四条路径等价）**：右上角 X（`DialogContent` 默认 `showCloseButton`）/ `Esc` / 遮罩点击 / `[取消]`——**关窗即不落任何状态**；该家只有**保存 key 成功后**才进入三级导航并被选中（失败留在窗内显示错误，不关窗）。
- 搜索无命中 / 已全部配置各给一行 `caption-text` 说明；当前无任何已配置家时，右栏给「点左侧 [添加] 选择要接入的 provider」空态。

**`provider-icon`** — 供应商品牌 logo（三级导航项 + 添加列表 + 聊天模型下拉的分组标签）：`public/provider-icons.svg` 精灵（`<symbol>` + `<use href="/provider-icons.svg#id">`，派生自 @lobehub/icons，MIT 许可头内嵌于该文件、不引包）按 pi provider id 取图，尺寸 16px；无对应 symbol 的自定义 provider 回退 `@ant-design/icons` 的 `ApiOutlined`。品牌 logo **自带品牌色**（DeepSeek 蓝、Google 四色等）——**这是「颜色只经 antd token」的登记例外**：第三方品牌资产，只在图标内部出现，不参与界面取色；无品牌色的 logo 用 `currentColor`（`{colors.tertiary}` 档 = `text-muted-foreground`）。


### 数据展示

**`data-row`** / **`data-row-hover`** — 列表/树/大纲行：无底色 + 底部 1px `{colors.hairline-soft}`；hover = `{colors.surface-soft}`。行级交互：双击进详情、单击标题行内编辑；**链式新建（Enter 建同级/子级）后新条目 = 选中 + 聚焦**（只聚焦不选中会让下一次 Enter 被「无选中」守卫静默吞掉；新建按钮同理）。**行尾状态徽标排在操作按钮左侧**（如大纲行的「阅读进度」徽标）：右侧 `icon-button` 恒贴行尾——徽标出现不得把它推离原位（否则同一列按钮在行间错位）。
**行级「新建子级」按钮（2026-09）**：大纲页与设定页的树行在行尾补一个 `icon-button`（`PlusOutlined`）新建子级入口，**位置 = 删除按钮左侧**（删除恒贴行尾；它左侧依次是「阅读进度」徽标 / 标签 chip / 手动排序 ↑↓）；`title` / `aria-label` 写全语义（新建章 / 新建场 / 新建子设定）。**无合法子层级的行不渲染该按钮**（大纲的场是叶子）。点击 = 在该行子级末尾打开就地输入行（与 Enter 建子级同一路径，成功后新条目选中 + 聚焦）。
**缩进列对齐（2026-09 修正与再扩写）**：缩进行的折叠箭头（`size="small"` icon-only，宽 24px）与**无子节点占位必须同几何**——占位写成 28px 会让「有子节点 / 无子节点」两类行的类型徽标、标题、摘要第二行、就地新建行各差 12px（大纲页曾是此状态）。**同一行块内的三处占位（折叠箭头 / 类型徽标 / 就地新建行）必须与该行自身的徽标同宽**：卷/章行是编号徽标 `min-w-14`、场行是 28px——任一处漏改即错位，改动行结构时三处一起看。
**大纲页页头主操作 = 「+ 新建卷」**：直建卷（`button-primary`）；就地输入行**不再提供卷/章切换**（章只在卷下建，层级契约见 `10-data-model.md` §2）。
**大纲页双视图（2026-09，含视图持久化）**：大纲页有「大纲树（默认）/ 章视图」两态——**视图选择持久化**（选章视图后跳走 / 刷新再回来仍是章视图：写作期会把章视图当常驻形态，每次跳转都要重选不符合持续写作的心智；**只记视图，不记「全部折叠」**——折叠态是一次性 session 态）。存储 = `localStorage` key `ai-editor:outline-view`（值 `tree` / `chapters`，坏值 / 读取异常回落 `tree`），唯一实现 = `hooks/use-outline-view.ts`（key 清单见 `config.md` / `10-data-model.md` §1）。**切换按钮 = 页头控件行最右组的第一个**（`ml-auto` 挂它，位于「全部折叠」左侧），文案 = **目标视图**（树视图下写「章视图」，章视图下写「大纲树」）——单按钮写「点它会去哪」比写「现在在哪」少一次解读；**章视图隐藏「全部折叠」**（平铺列表无折叠语义）。**章视图 = 平铺章列表**（顺序 = 阅读序：卷序 → 卷内章序）：行 = `第N卷` + `第N章` 两枚编号徽标 + 标题 + 摘要（muted，空不渲染）+ 伏笔标记 + 「阅读进度」徽标 + **正文字数**（`metadata.textLength > 0` 时才渲染，文案 `N 字` / `N.N 千字`，0 不占位——「没写」不需要一个「0 字」提醒）+ **「写正文」入口 = 行尾 `icon-button`**（`EditOutlined`，`title` / `aria-label` = 写正文，跳 `#/manuscript/:chapterId`；2026-09 由下划线文字链改为图标按钮——它是**导航**不是操作，实现 = antd `Button href` ⇒ 渲染 `<a>`，故不破「行内无操作按钮」这条收窄）；**改名输入行与树视图同款**（`input` small 档 = 24px 行高，唯一实现 = `components/outline/inline-input.tsx`）；**交互只有三项：单击标题就地改名、双击行进详情、点「写正文」进章正文页**——不做删除 / 新建 / 拖拽（结构编辑与排序的唯一入口仍是大纲树；在章视图里新建出的场景不显示，会造成「建了却看不见」）。有卷无章时给空态提示。
**`table-header`** — 表头**白底**（不是 antd 默认灰底）+ 1px `{colors.hairline}` 底线 + caption 字色 `{colors.secondary}`。
**`relations-view`（关联总览列表）** — 源 / 关系 / 目标三列**表头与单元格同宽同对齐**：一律**左对齐**（关系列也不居中——居中会让类型 chip 相对表头位移，看起来像列错位）。**源/目标单元格 = 端点类型徽标在前、名称在后**（名称单行 `truncate`）：徽标排在名称尾部时，其 x 随名称长度浮动，短名行与长名行两枚徽标落不到同一条竖线上（2026-09 修正；关系列与行尾删除按钮不受影响，`character-relations` / 实体详情页的 `A [关系] B` 内联读法是有意保留的，不随本口径翻转）。
**`tag`** — **用户标签 chip**（`data.tags` 数组元素：设定标签 / 事件标签 / 参考资料标签）：`{rounded.xs}` + **tint 三色底** + caption 字号 + `{colors.primary}` 字色（按名称 hash 稳定分配，见 §Colors 分配规则）。实现 = `components/ui/tag-chip.tsx` 的 `TagChip`（自绘 span + `bg-tag-*` token 类）——**不用** antd `Tag` 的预设色：`Tag` 的默认底色由组件 token 派发、自定义 tint 只能走 `Tag` 的 preset/内联色，与「禁硬编码色值」冲突。antd `Tag` 仅保留给**带交互的元信息 chip**（如 focus 小条的 closable 标签）。**标签不做按钮形态**。
**准入规则（收口，2026-09；参考资料分类一并纳入）**：**只有 `data.tags` 元素走 tint**。**参考资料 `data.type`（分类）也走 `type-badge`**——它是「分类」不是用户标签：列表页分类列与详情页头**同一枚 `TypeChip`**（此前列表是裸文字、详情是自绘 `border-border` 灰徽标，两处都与本规则脱钩，看着像「分类既不是标签、也不是类型」）；分类中文名映射（`material` → 素材摘抄等**存量回显**，新自定义分类原样显示）单一来源 = `lib/reference.ts` 的 `referenceTypeLabel()`（原在两个页面各手抄一份）。枚举值（卷/章/场、实体类型、端点类型、关系类型、伏笔 `category`、回收站类型）→ `type-badge`；字段值（人物 `role` 等）→ 纯文本 / 表单控件（不是 chip）；状态 → `status-badge` / 中性命中标记（如大纲行与节点详情页的「阅读进度」徽标）→ `TypeChip`。判据的代码形式 = 两个组件名：`TagChip`（tint）vs `TypeChip`（中性）——不许再给 `TagChip` 传枚举文案。
**`type-badge`** — **类型/分类徽标**（枚举值的唯一形态：大纲节点卷/章/场、实体类型、关联端点类型（源/目标）、关系类型、伏笔 `category`、回收站类型）：`{rounded.xs}` + `{colors.surface-muted}` 底 + **1px `type-badge-border` `#d94a4a` 边框** + caption 字号 + `{colors.primary}` 字色。实现 = `components/ui/tag-chip.tsx` 的 `TypeChip`。**类型徽标可承载层级序号（2026-09）**：大纲页卷/章行的徽标内容 = `第N卷` / `第N章`（形态不变，仍是 `TypeChip`；场景行仍为「场」）——自动编号本身已声明层级，再并排一枚纯枚举徽标就是「`第1卷` `卷`」说两遍。**编号口径 = 用户可见序**：卷序 = 顶层卷按文件位置序 1-based；章序 = 全书先序连续（跨卷累计，含存量直挂 root 的章），**只计可见（未软删）节点 ⇒ 删章后重排**；这与服务端「章序」（`10-data-model.md` §4 的 `deriveChapterOrder`，含软删章、保既有 Delta / 伏笔引用稳定）**不同源、各有用途**——UI 编号只作展示，不参与任何计算。**几何**：编号徽标 `min-w-14`（56px）+ `justify-center` + `tabular-nums`（`第9章` / `第10章` 标题左缘不抖，`第100章` 自动变宽不裁切）；场景行的「场」保持 28px 原宽（场景只在最深层，同层全是场景天然对齐，拉长反而像有编号）。**清单外的中性命中标记也用本组件**（2026-09 收口：大纲行与节点详情页的「阅读进度」徽标原是无边框灰面自绘 span，与同行的卷/章/场徽标不同形——现统一走 `TypeChip`，边框与底随之共用同一对 token）。**为什么是描边而不是实底**：实底彩色要么压不住读（`#ef8354` 上墨字仅 4.70:1、白字 2.61:1），要么让每行都摆出一块告警色；描边把一个色相拆成「轮廓」而不是「面积」——既与 tint 标签（面积式）在形态上彻底分开，又不会霸占背景。**为什么边框不能用浅色系**：1px 线在灰底上需 ≥3:1 才看得见（实测橙 1.43、浅红 1.07 = 等于没有）；`#d94a4a` 是少数两态都过线的红系（浅 3.61 / 深 3.34）。**为什么不用 tint**：① 类型是枚举不是用户数据，逐个发彩色等于给每列都上装饰，反而让「彩色 = 这是标签」的信号失效；② hash 取模只保证「同名恒同色」，不承载语义，同一概念的文案变了就变色；③ 类型与「标签」视觉同形时，用户无法区分「这行是分类」还是「这行是标签」——所以两形态用**两套形态语言**（描边 = 类型，实底 = 标签）。
**`status-badge`** — 状态胶囊（进行中/已确认/已失效等）：`{rounded.full}` + caption 字号 + **语义色**（success / warning / error；中性状态用 `{colors.surface-muted}` 灰面）——**不用 tint**（tint 只给用户标签，见上「准入规则」）；状态图标用 antd **Filled** 变体（`CheckCircleFilled`/`CloseCircleFilled`/`ExclamationCircleFilled`）。

**`character-workbench`（人物工作台，2026-09）** — 人物页（`#/characters` / `#/characters/:id`）是中栏内的 **master-detail**（无导航级变动，路由已是一级段）：

- **左栏**（固定 240px，右侧 1px `{colors.hairline}`）= 人物列表，**它就是列表本身**（不再有独立人物列表页）：行 = 姓名（`{colors.primary}`）+ 角色定位（`{typography.caption}` + **`{colors.character-role}`**——浅 `#b4551f` / 深 `#ef8354`，两态均 ≥4.6:1）、32px 行高、`{rounded.sm}`、选中 = `{colors.surface-muted}` 灰面 + 文字不变色（**完全复用 `menu-item` / `menu-item-selected` 语言**）；**行头两行**（240px 内物理上塞不下 192px 搜索框 + 下拉 + 按钮）：第一行 `search-input`（192px，独占一行）、第二行排序 `select`（内容宽 + `popupMatchSelectWidth={false}`）+ 主操作（「+ 新建」`button-primary`）。排序默认 `updated_at` 降序（后端列表默认），可切 `name` / `created_at`。
- **右栏** = 详情，内容区自上而下：**页头**（`page-header` 壳不变）→ **四 tab**（「人物档案」/「阅读进度」/「人物关系网」/「其他关联 · N」，走 `tabs` 契约）→ 各 tab 内容。**tab 文案 = 用户语言，不出数据分层词**：数据层的不可变性分层只服务变更记录白名单与 AI 提案边界，UI 不再分「基础信息 / 可变数据」两块（见 `10-data-model.md` §14）。
- **`人物档案` tab** = 一张 `card` 内的**档案式字段网格**（无区标题、不分块）：**单行字段**（姓名 / 角色定位 / 假名 / 性别 / 年龄 / 种族）走「label 左置（固定宽 64px、`{colors.secondary}`）+ 值」的两列网格（≥`md` 两列，行距 12px / 列距 16px），**长文本与列表字段**（描述 / 性格 / 动机）整行占满；网格之下依次是 `panel-tree`（自带标题行 + 1px hairline 上边线）与「自定义字段」（仅响应 `data` 已有该键时渲染）。
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
**`chat-bubble-assistant`** — assistant 消息：无底透明 + 正文排版（长文本可读性优先，不用气泡包）。
**`focus-strip`** — 「正在讨论：{类型} {名称}」小条：`{colors.surface-soft}` 底 + 1px 描边 + caption。
**`chat-session-item-menu`** — 会话列表项操作菜单（antd x `Conversations` 的 `menu`）：仅一项「删除会话」——**危险操作走 danger 样式 + `ConfirmDialog` 二次确认**（文案含「删除后无法恢复」），与回收站 purge 同款交互；流式生成中该项禁用（服务端以 409 `SESSION_BUSY` 兜底）。菜单浮层面复用 `dropdown-panel` 契约（canvas 面 + 1px hairline + 阴影）。**已知边界**：操作入口（ellipsis）由 x `Conversations` 内部渲染且**恒显不随 hover**——改它需覆盖 x 内部样式，代价大于收益（窄右栏多占 ~20px，已接受）。
**`usage-bar`** — 上下文占用条（输入框下方工具条右侧）：2px 高圆角条 + caption 百分比。**口径 = pi `getContextUsage()`**（`percent` = tokens / 模型 `contextWindow`，随 `turn_end` / `agent_end` 帧下发，见 `docs/design/20-context.md` §2）——旧「历史预算分母」口径随自建裁剪逻辑一并废弃（那时历史预算远小于窗口，用窗口做分母才是假指标；现在整窗由 pi 的压缩管理，占比是真实信号，压缩后回落）。填充色按占比经 antd token 取色（≥90% `colorError`、≥70% `colorWarning`、其余 `colorPrimary`），**禁硬编码色值**；`title` 显示 `tokens / contextWindow`。**切会话 / 新会话 / 切项目时清零**。
**`thinking-block`** — 思维链（assistant 消息内的 thinking 内容）：**默认折叠为一行摘要**（`思考过程 · N 字` + 左侧 chevron，`{colors.tertiary}` 字色、无底色、无描边）；展开后 `{colors.surface-soft}` 底 + 左侧 2px `{colors.hairline-strong}` 竖线 + caption 字号 + `{colors.secondary}` 字色 + `pre-wrap`（长文可滚动，限高约 200px；展开态正文字色以 `colorText` 80% 实现——Tailwind 主题未暴露 `colorTextSecondary` utility，属近似 secondary 的登记值，非新色）。**流式生成期间自动展开、本轮结束后自动折叠为摘要行**。历史回看：消息接口只回 `THINKING_PREVIEW_MAX_CHARS` 字预览（`docs/api/80-api-chat.md`），点「展开全文」按需拉取全文（带 loading 态）。同一消息同时持有本轮累积全量与服务端预览时**只渲染一个块**（渲染优先级：有流式累积文本则不渲染预览块）。实现优先用 `@ant-design/x` 的 `Thought` 组件；其外观不满足本契约时自绘，但**不得引入新色或新字号**。
**`proposal-card`** — 提案卡：1px 描边卡片 + 确认/拒绝按钮（确认按钮用 `button-primary`，禁用态由 antd 派发）。
**`toast`** — 全局提示走 antd `message`（`App.useApp()`），顶部居中；`success/error/info` 对应 store 的 `ToastKind`，时长由 store 的 3s 定时器决定（`duration: 3` 对齐）。**命令式反馈的上下文入口**：`AntdProvider` 在 `ConfigProvider` 内部包 `<App component={false}>`（`component={false}` 不渲染包裹 div，不插进三栏 flex 链）——`message`/`notification`/`modal` 需经 `App.useApp()` 取实例才能继承本 Provider 的主题与 locale，不要用静态方法。

### 设置页「通用」区（桌面版专属）

**`tab-general`（设置页二级 tab「通用」，2026-09）** — 设置页二级 tab 顺序 = **通用 → AI 模型 → 项目规则 → 备份 → 快捷键**；**「通用」仅在桌面版渲染**（client 能力检测：无 preload 桥则整个 tab 不出现，浏览器形态的 tab 集合与行为完全不变）。「快捷键」是纯说明页，恒在末位（浏览器与桌面版都渲染）——详见下节。

**`library-location`（通用 tab 首项，也是当前唯一项）** — 一张 `card`：`section-title`「书库位置」+ 当前路径只读文本（`caption-text` + 超宽 `truncate` + `title` 给全文）+ 行尾 `button-default`「更改…」；卡片底部一行 `caption-text` 说明（更改后应用会重启）。点击「更改…」→ 原生目录框（preload `pickDirectory`）→ 确认后写应用级配置并重启应用。**不新增视觉语言**（全部复用 `card` / `section-title` / `caption-text` / `button-default`）。

**`dashboard-open-path`（书架页「打开其他路径」行，2026-09）** — 原有手输路径 `input` 保留；在其右侧追加 `button-default`「浏览…」（**仅桌面版渲染**，同能力检测）→ 原生目录框 → 选中后直接以该路径打开项目。手输框与按钮同行：**输入框外包一个 `flex-1` 容器**（不给 antd `Input` 挂布局类——`antd-root-override` 守卫禁止在 antd 组件根元素上挂会被无层 CSS 压掉的类；按钮不挂类，自然尺寸）；浏览器形态只有输入框（现有布局不变）。

### 设置页「快捷键」区

**`tab-shortcuts`（设置页二级 tab「快捷键」，2026-09）** — tab 内容 = **纯说明页**：无可交互控件、不拉数据；选中态与其余二级 tab 同款（页内 state、不进 URL、刷新回落默认项）。自上而下 = 一张 `card`（`SectionCard`）：`section-title`「快捷键」+ 一行 `caption-text`（「以下快捷键在应用内任意页面生效」）+ 行列表（`data-row` 语言：左 = 组合键徽标 `TypeChip`，右 = 说明文字）。

**组合键文案按当前系统平台化**（Apple = `⌘ + S`，Windows / Linux = `Ctrl + S`），判定与展示的单一来源 = `lib/shortcuts.ts`（纯函数 + 清单常量），**不复用 `@blocknote/core` 的 `formatKeyboardShortcut`**（那会把整块编辑器库拖进设置页 chunk；两者口径一致：Apple → ⌘，其余 → Ctrl）。**清单里的键位引用真实绑定用的常量**（`save-shortcut.ts` 的 `SAVE_SHORTCUT_KEY`），不允许清单与绑定各写一份字面量。

**Ctrl/Cmd + S（全站「保存 + 本地存档」，2026-09）** — 任意页面按 Ctrl/Cmd + S = 先执行当前页面的保存动作（正文页 = 用最新内容立即 PUT，不等自动保存计时器；行内编辑态 = 先提交该行；本页无保存动作 = 直接进入下一步），**保存成功后再**生成一份手动备份（与设置页「立即备份」同管道，落 `.backups/`；开云端自动推送时随之推送）。四条边界：

- **节流**：距上次快捷键存档不足 `SHORTCUT_BACKUP_THROTTLE_MINUTES` 时只保存、不生成新备份——连按不会把保留窗口刷成同一分钟的快照、也不会连推云端。节流键是进程内时间戳（刷新即重置，不入 localStorage：存档是磁盘事实，不是用户偏好）。
- **保存失败不存档**：保存失败（网络错 / 409 `DOCUMENT_STALE` / 校验拦下）沿用该页既有错误 UI，不生成备份——页面保存动作以 **返回 `false`** 表示失败（各页失败分支的契约义务：它们自己 catch 后 promise 一律 resolve，快捷键流程拿不到 rejection）；**存档失败**才弹错误 toast「已保存，但生成存档失败：…」（保存成功与存档失败必须分开说，不得谎报「已存档」）。
- **无项目打开**：只保存、不存档、不提示（备份端点本就要求项目已打开）。
- **反馈**：存档成功 toast「已保存并生成存档」；被节流跳过 toast「已保存 · 距上次存档不足 N 分钟，未生成新存档」——**文案里的分钟数由常量插值**，不手抄数字。
- **浏览器原生「保存网页」被拦下**：全站 Ctrl/Cmd + S 一律 `preventDefault`（即使本页无保存动作——存档仍要跑），不再弹出浏览器保存对话框。

### 备份与云端存档（设置页「备份」+ 左栏底部）

**`backup-pane`（设置页 → 二级 tab「备份」）** — pane 内走 `sub-nav` 布局：左 160px 固定两项（「自动备份」/「云端备份」，缺省选中自动备份）+ 右侧面板；**选中态是 node state、不进 URL**（刷新回落默认项，与 AI 模型页同款）。两面板**各自一行 `caption-text` 说明**（自动备份沿用原句「跟随书籍：备份与频率均为本项目独立…」；云端面板有独立 intro：云端是备份的另一块磁盘、本地数据不依赖它）。

**`auto-backup-panel`（自动备份）** — 自上而下：一行操作区（频率 `select` + 备份标签 `input`（占位符「备份名称（可选）」）+ 主操作「立即备份」`button-primary`）；下方「历史备份」列表——行语言 = `data-row`（底部 1px `{colors.hairline-soft}`、hover `{colors.surface-soft}`），行 = 时间（`formatBackupTime`）+ 类型 `type-badge`（自动 / 手动）+ 用户标签（加粗）+ 行尾 `icon-button`（重命名，行内编辑态 = `input` + 确认/取消，现有实现不变）；**设备与统计作为 caption 行**：`苹果本 · 人物32 · 设定58 · 章120`（**恒有两项**（唯一命名格式保证）；**UI 不自行解析文件名**——字段来自 API 的 `device` / `stats`）。

**`sync-cloud-button`（左栏底部第二项）** — 与底部区其余三入口同形（无边框文字按钮 + 左对齐标签 + `@ant-design/icons` 图标，不新增形态）；**角标 = 状态提示**：状态为「有未推改动 / 云端有更新 / 冲突」时显示小圆点（antd `Badge dot`，颜色走语义 token、**不用预设色**，**两色口径**：`冲突` = error（`var(--ant-color-error)`）、`有未推改动`/`云端有更新` = warning（`var(--ant-color-warning)`）——这两种是「有事可做」而非「出错」，与 `unreachable` 不亮一起保证「红点 = 需要你裁决」唯一；圆点渲染在按钮行尾（`shrink-0`，标签 `flex-1` 把圆点推到最右，不随出现/消失挪动文字））；状态来自打开项目时那次检查 + 每次点击实时复查，**不做轮询**（宿主 = 应用外壳 `AppShell`：左栏收起时 `NavRail` 不挂载，检查与清理都不能只挂在那里；同一时刻的并发请求由 store 合并）（`/status` 每次 2–3 次 PROPFIND，云盘免费额度 600 次/30 分钟）。点击 = 一键状态机（`docs/design/40-cloud-sync.md` §3）：未配置 → 跳设置页并选中「备份 → 云端备份」（**跨页意图经 `stores/cloud.ts` 一次性下传**；设置页二级 tab 的选中态仍不进 URL、刷新回落默认项）；未打开项目 → 禁用；已同步 → toast 提示已是最新；有未推改动 → 直接推送（**但若 `local.backupStale`（有改动未进最新备份）→ 不直接推，改弹 `cloud-stale-backup-dialog`**——两个等权选项：`[立即手动备份并推送]` / `[上传旧备份]`）；**已同步 + `local.backupStale` → 同样弹该框**（`backupStale` 不随同步前移：推过旧包后状态就是「已同步」，此时说「已是最新」会撒谎）；云端更新且本机无改动 → 弹 `cloud-pull-confirm`；冲突 → 弹 `cloud-conflict-dialog`；云端不可达 → toast 错误文案（强调本地功能不受影响）。在途 `loading` 防连点。

**`cloud-backup-panel`（云端备份）** — 三段，每段一张 `card`（`section-title` 标题 + 说明行）（**自动推送说明行须写全触发口径**：每 2 小时且只在创作数据有变更时推一次 / 关闭项目与手动备份各触发一次（不受节流；**关闭项目那次在「有改动未进最新备份」时跳过**）/ 纯聊天不单独触发 / **自动备份频率关闭时按 2 小时排程、不会静默失效**；**`backupStale` 提示行**（恒在状态行下）：`local.backupStale` 为真时显示一行 `caption-text`——「本机有改动未进最新备份（最新备份：<备份文件名>）——云端只会上传旧份，先『立即备份』（或点左栏『同步云端』时选择处理方式）」（**不弹窗、不阻塞**；自动推送在该状态暂停，直到用户备份一次或选择上传旧份）。
自动路径最近一次失败以一行 `caption-text text-destructive` 显示（来自 `status.local.lastAutoPushError`，**任何一次推送成功**即消失，**不弹窗**；`CLOUD_CONFLICT` 时同一行补一句行动指引「用上方『推送到云端』手动裁决（冲突时可在裁决框选择用本机覆盖云端）」））：

1. **账号配置**：`url` / 用户名 / 应用密码 / 设备名四个 `input`（密码**从不回传** → 输入框恒为空，**占位符随状态变化**：未保存过「应用密码」、已保存「应用密码已保存（留空则不修改）」，并在其下给一行 `caption-text`「应用密码已保存（接口从不回传密码，所以这里不回显；要改就直接输入新密码，留空 = 保持不变）」——否则用户输完密码保存后看到空框会以为没存上；**设备名只在「配置里有值」时预填**（卡 (a)：没设过 → 输入框留空，说明行给出当前派生值「留空 = 用本机名 <生效值>」）——原先预填生效值（含派生值）的代价是「只点保存就把派生值显式写进 `cloud.json`，改机名后需手改」，现在这个坑没了；填了并保存 = 固定为它，清空保存 = 删掉配置值、重新跟随 hostname）+ `button-default`「测试连接」+ 主操作「保存」（`button-primary`，`loading` 防连点；未改动时禁用）。下方 `caption-text` 两句：凭据以明文保存在本机 `.ai-editor/cloud.json`（权限 600）；免费账户上传流量有限（如 1GB/月），自动推送会消耗配额。
2. **自动推送**：antd `Switch` + 一行说明（每 2 小时且只在创作数据有变更时推；关闭项目与手动备份会额外触发一次；纯聊天不单独触发）。
3. **同步状态**（2026-09 按反馈统一）：**三行同字段同顺序**——`云端最新份` / `本机最新份` 均为`时间 · 类型[ · 标签] · 设备 · 人物N · 设定N · 章N · 大小`（缺项**不省略**，标签可选；用户要能逐项对齐着看）；`上次同步` = 时间 + 该次同步的备份文件名（不再单列「本机已推份」那套另一格式，也不声明方向——服务端只记那份名）；**云端最新份行尾给相对判定徽标** `云端更新` / `本机更新` / `相同`（`compareBackupTime`，任一侧缺失则不显示）——解决「看不出哪份更新」；`本机份列表读取失败` 时本机那份显示「（读取失败——见下方提示）」而不是「无可用备份」；**状态行**（三态文案）；云端检查失败的 `errorCode`）+ **云端份列表（时间倒序 ≤ 5 行，行语言同 `data-row`，行尾标「云端最新」、行内 `button-default`「拉取」任一份）** + 动作 `button-default`「推送到云端」/「拉取云端最新」 + `cloud-pull-confirm` 确认框（**与左栏「同步云端」共用同一个实例**，宿主挂 `AppShell`——两处入口文案必须一致；复用 `ConfirmDialog`：云端那份元信息 + 两句后果声明；**确认按钮走 danger**——拉取会覆盖三文件，红色警示比主色更诚实，与本地 restore 的 `[加载]` 同口径）。失败态：**一行错误文案**（`statusFailed` 时「云端配置读取失败，请刷新页面重试」；`local.lastAutoPushError` 时自动推送失败行；**测试连接失败的完整文案也落在这一行**——`break-all` 可换行，因为服务端错误里会带上游响应片段，长度可达数百字符）。**toast 只给摘要**（超过约 80 字符截断加「…」，后接「（详见下方状态行）」）：antd `message` 单行会截断长文案，完整信息必须在面板里可见；未配置：一行引导文案（「填写地址与用户名/应用密码并保存后即可测试连接」）。**刻意不做**独立「重试」按钮与 `empty-state`（面板本身随每次操作刷新，重试入口冗余）。

**`cloud-pull-confirm`（拉取确认框）** — 复用 `components/ui/dialog.tsx`（受控）：展示云端那份的元信息（时间 / 类型 / 标签 / 设备 / 统计 / 大小）+ 两句后果声明（「本机当前状态将先自动快照到本地备份」「本机独有的对话与资料会保留（不会被覆盖）」）；Footer = `[取消]` + `[拉取]`（`button-primary`）。

**`cloud-stale-backup-dialog`（旧备份上传确认框）** — 同款对话框：一句说明（最新一份本地备份早于最新改动，云端若现在同步只会拿到旧内容）+ 两个等权 `button-default`：`[立即手动备份并推送]`（先 `POST /project/backup` 生成新格式备份、再推送）/ `[上传旧备份]`（照推当前最新那份；**本机没有任何备份时该按钮禁用**并提示先「立即备份」——服务端会 404）——**不用主色也不用 danger**：两者都是合法选择。
**`cloud-conflict-dialog`（冲突裁决框）** — 同款对话框（**单点宿主挂 `AppShell`**：左栏「同步云端」与面板共用同一实例，左栏收起时也弹得出来；推送撞冲突时由 store 直接打开它，面板不再走行内入口）；并排对比「云端那份」与「本机最新份」（时间 / 设备 / 统计 / 大小）+ 一句「两边都会各留一份备份」；Footer = `[保留云端（拉取覆盖本机）]` + `[用本机覆盖云端]` —— **两个选项等权，两个都用 `button-default`（不用主色、不用 danger）**：任何一方都不比另一方“正确”，主色按钮会诱导误点。**「保留云端（拉取覆盖本机）」必须带上对话框里展示的那一份（`fileName` 显式传入）**——不能只写「拉取云端 head」：对话框与点击之间云端可能又多了新份，界面承诺与实际动作必须一致。**本机没有任何备份时**「用本机覆盖云端」禁用并提示先「立即备份」（服务端会以 404 拒绝空推送）；**「本机最新份」读取失败与「真的没有备份」必须区分**——读取失败时该行显示读取失败并禁用依赖它的按钮，不得显示成「本机还没有备份」（那是把故障说成事实）；失败文案（含强推后仍冲突）就地显示在框内，**关闭框不清除状态**——角标会继续亮，可再次强推（force 不是一次性动作）。

**删除传播提示**：删除**会话**成功后的 toast 补一句「推送到云端后，另一台也会同步删除」（删除要推送才传播；正文/参考资料随 `data.db` 走覆盖，见设计文档 §4）。

> 本小节全部形态**不新增色值/字号/圆角**：沿用 `input` / `select` / `button-default` / `button-primary` / `data-row` / `type-badge` / `caption-text` / `empty-state` 与既有 token 档。新增 antd 组件仅 `Switch` 与 `Badge`（均走全局 seed token 派生，无组件级覆盖）。

### 拆解小说（书架入口 + 进度页，2026-09）

**入口** — 书架页「新建一本…」行内并列一个 `button-default`「拆解小说」（`dashboard-decompose`）；点击开**受控 Dialog**（三态：选文件 → 预览 → 填名开始），不新增一级导航、不改左栏。

- 选文件：`<input type="file" accept=".txt">`（浏览器/桌面同一路径，**不加 preload 能力**）。
- 预览：统计行（编码探测结果 / 总字数 / 章数 / 卷数 / 字数分布）+ 警告行（编号重启 / 疑似合并章 / 目录页丢弃 / 退化等分，用 `{colors.warning}` 文案）+ **可滚动章列表**（`data-row`，列 = 序号 / 标题 / 字数；数百行直接全量渲染，不引入虚拟滚动）+ 范围选择（起止章）+ 预估行（批次数 / 调用次数 / 粗估费用）+ 书名输入（默认取文件名，校验复用书名校验）。
- 确认 = `button-primary`「开始拆解」；失败/警告均框内文案，不另开提示。

**进度页 `#/decompose`** — 遵守§Layout「中栏页头结构」与**页头常驻**模板（section `h-full min-h-0 flex flex-col` + 内层滚动容器）：

- 页头：`page-title`「拆解小说」+ 元信息行（书名 · 范围 · 模型）+ 操作按钮（`button-default`「中止」/「续拆」，按状态显示其一）。
- 阶段条：5 段（解析 / 建档 / 逐章抽取 / 归并 / 报告）——当前段 = `{colors.primary}` 加粗，已完成段 = `{colors.success}` 圆点，未开始 = `{colors.tertiary}`。
- 进度条：antd `Progress`（描边走全局 `colorPrimary`，**无组件级 token 覆盖**）+ 右侧「已完成 N/M 批」文案（`caption-text`）。
- 批次列表：`data-row` 行，列 = 批序号 / 覆盖章范围 / 字数 / 状态徽标（`type-badge`，中性）/ 展开按钮 / 「重跑」按钮；展开区 = 该批抽取结果的**只读摘要**（人物 / 设定 / 地点 / 关系分组的文字列表，不倾倒原始 JSON）——展开是「核查后重跑」的前提，**不是可选装饰**。
- 失败批：行内 `{colors.error}` 文案 + 「重跑」（`done` 与 `failed` 行都有该按钮）；重跑 `done` 行需二次确认（受控 Dialog，文案写明「将重新生成该批抽取结果，并重建归并与报告」）。
- 完成态：本页变总结卡（`section-title`「拆解完成」+ 拆出 人物 / 设定 / 地点 / 关系 计数）+ 三个跳转（拆解报告 / 大纲 / 人物），**不自动跳转**。
- 状态文案：`已暂停 · 可续拆` / `上次拆解中断，可续拆`（服务端重启归一后）。

**概览页卡片** — `#/overview` 在有 job 时多一张 `card`：`section-title`「拆解任务」+ 一行状态（运行中 N/M 批 / 已暂停 / 已完成）+ 进入 `#/decompose` 的 `button-default`；无 job 不渲染。

**书架行徽标** — 仅**当前打开的书**那行显示「拆解中 N/M」（`type-badge`）；其他书不显示（`GET /project/list` 不含 job 状态，逐本开 `data.db` 不值得；且切书即暂停）。

> 本小节**不新增色值/字号/圆角**：沿用 `button-default` / `button-primary` / `card` / `data-row` / `type-badge` / `caption-text` / 受控 Dialog。新增 antd 组件仅 `Progress`（走全局 seed 派生，**不进组件覆盖表**）。

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
- tint 底色只给**用户标签** chip（`data.tags`）；枚举类型/分类徽标一律中性 `type-badge`（不给类型上彩色）
- 字号只用四档（20 / 16 / 14 / 12）；标题一律 `Typography.Title level={4|5}`
- 图标一律 `@ant-design/icons`；尺寸随字号类（14 `text-sm` / 16 `text-base` / 20 `text-xl` / 空态 24 `text-2xl`）；状态用 Filled、操作与导航用 Outlined；面板收起/展开 = `DoubleLeft/RightOutlined` 镜像对（禁 `Border*` / `MenuFold*` / `Vertical*`）。**唯一例外 = `provider-icon`**（供应商品牌 logo，走自持 svg 精灵 + 品牌自带色，见 §Components）
- 文字型**操作**按钮带边框（H4 红线）；操作按钮一律直接展示，不收进 `⋯` 菜单。导航入口（左栏 Navigation/Menu 项）不属此列
- 思维链默认折叠（流式期间临时展开），不占正文视线
- 中文排版靠系统字体栈；不引入 web 字体
- 写作面偏好只落 `localStorage` 的 `ai-editor:writing`（全局一份，两处书写面共用）；下传只经 `--writing-*` / `--paper-*` 变量，调用点不得写 `--bn-*`

### Don't

- 不用营销站那套：紫 CTA、深蓝 hero 带、马卡龙大面积功能卡、胶囊按钮、80px 展示字
- 不用衬线做界面 chrome 与标题（书封同）；**唯一例外 = 写作面的用户字体偏好**（宋/楷/仿宋/等宽，见 §Colors 写作面偏好）
- 不硬编码色值/色类（`text-blue-500`、`#1677ff`、`rgba(...)` 手写值）——**唯一例外**：`html.dark body` 的首帧 FOUC 兜底色（`index.html` 内联脚本，防深色模式闪白）
- 不用 `!` 前缀类压 antd 组件样式
- **不要用 Tailwind 类去覆盖 antd 组件根元素上 antd 自己声明的属性**（`width` / `height` / `padding` / `margin` / `font-size` / `color` / `background` / `border` / `border-radius` / `display`）：antd 样式是运行时注入的**无层 CSS**，而 Tailwind 工具类在 `@layer utilities`——按 CSS 级联规范**无层胜出**，此类覆盖会静默失效（历史上满仓 `!` 就是这么来的）。正确做法：宽度/伸缩用**外层容器**承载；具体尺寸用组件 `size`；状态面用组件 `variant`（如 `variant="filled"` = `colorFillTertiary` = `{colors.surface-muted}`）或组件 token
- **不要让 `:root` 的语义变量失去 `--ant-*` 来源**：`cssVar.key` 与 `index.html` 的 `<html class>` 必须同值（见 §Colors 踩坑段），否则全站语义色集体失效
- 不用阴影、渐变、彩色 focus 环、卡片 hover 抬升
- 不引入第二套组件系统（图标只有 `@ant-design/icons`、提示只有 antd `message`、按钮/输入只有 antd）；自绘只限 antd 无对应语义的浮层与业务组件
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

## Iteration Guide

1. 改视觉 → 先改本文件，再改 `AntdProvider.tsx`，最后改调用点；顺序反了必然产生「文档与实现两套事实」
2. 每次改完跑 `designmd lint docs/ui/DESIGN.md`（error 必须清零）。**两类稳定存在的 warning 属预期**：① `orphaned-tokens`——`{colors.hairline*}`、3 个 tint、2 个 paper 只出现在 prose（规范无 border 子 token）；② 深浅算法的派生值不登记（避免与实现漂移）
3. 新组件先加 `components:` 条目 + §Components 一行说明，再写代码
4. 需要新色/新字号 = 先问「现有档位为什么不够」，能复用就复用（四档字号、四档圆角是刻意收紧的）
5. 覆盖 antd 组件 token 必须登记进覆盖表；调用点 `!` 前缀类是禁止项
6. 深色模式任何改动都要在浅/深两态下各看一遍（算法派生值随 seed 变化）
7. **改完主题必看像素**：本次 P0 事故（`:root` 映射失效）就是「文档/类型/测试全绿但像素全错」——改 `AntdProvider` / `index.css` / `index.html` 后，至少跑一次浏览器实测（`pnpm start:test-project` 或 `packages/client` 的 headless 探针），确认 `--ant-color-primary` 在 `:root` 有值
