# UI 布局与样式设计（当前实现）

> 定位：**当前 UI 布局样式设计**——以代码实现为准（`packages/client/src/`），描述三栏工作台外壳、路由、主题系统与样式细节规范；视觉落地于 `client/src/index.css` 主题 tokens 与各组件 Tailwind 类。
> 配套：`doc/ui/pages/*.md` 为各页面细案；本文件定义应用外壳、路由、主题系统、全局样式约定。
> 2026-08 修订：文档由「MVP 功能原型」更新为「当前实现样式设计」；三栏布局（1:5:4）、会话归属项目、`#/chat` 独立页移除均已落地。

---

## 0. 布局总览（三栏工作台）

```
┌───────────────┬──────────────────────────────────────────────┬──────────────────────┐
│ 左栏 (10%)     │ 中栏 (50%)                                    │ 右栏 (40%)            │
│               │ ┌────────────────────────────────────────────┐ │                      │
│ ◈ 我的小说      │ │ 信息条：项目名 | 当前位置 | 语言 | (聊天开关) │ │ 会话标题（下拉切换）    │
│ (衬线斜体标识)  │ ├────────────────────────────────────────────┤ │  [+ 新会话]          │
│               │ │ TabBar：概览|大纲|画布|实体关系|伏笔|回收站     │ │ ───────────────────  │
│ 书架           │ ├────────────────────────────────────────────┤ │ [⚠ 上次会话已取消]     │
│  ▸ 项目行       │ │                                            │ │ 消息流               │
│    ▸ 会话行     │ │             页面内容区（按路由渲染）          │ │  （user 气泡 /        │
│  [+ 新建项目]   │ │             （p-6，纵向滚动）                │ │   assistant 宋体排版） │
│               │ │                                            │ │  [🔧 工具折叠行]       │
│  ───────────  │ │                                            │ │  [提案卡]             │
│  设置          │ │                                            │ │ ───────────────────  │
│  主题切换      │ └────────────────────────────────────────────┘ │ 正在讨论：…（focus）   │
│               │                                                │ 输入区        [发送]  │
└───────────────┴──────────────────────────────────────────────┴──────────────────────┘
```

### 宽度实现（严格 1:5:4，flex-basis 百分比）

`AppShell` 根容器为 `flex h-screen overflow-hidden`，三栏均为 `min-w-0` 的 flex 子项（防溢出）：

| 栏 | 组件 | flex 类 | 背景 / 分隔 |
|----|------|---------|-------------|
| 左栏 | `Sidebar` | `flex-[1_1_10%]` | `bg-sidebar` + `border-r border-border` |
| 中栏 | `MainPanel` | `flex-[5_1_50%]` | 继承 body `bg-background`（无独立背景类） |
| 右栏 | `ChatPanel` | `flex-[4_1_40%]` | `bg-background` + `border-l border-border` |

- **背景统一**：三栏视觉背景一致——左栏 `bg-sidebar` 的 token 值（`--sidebar`）与 `--background` 相同（见 §3.2），中栏/右栏为 `bg-background`；栏间仅以 1px `border-border` 分隔，不做色块对比。
- **固定不可拖拽**：左右栏无 resize 能力，比例恒定。
- **<1024px 右栏折叠为抽屉**（`useMediaQuery("(min-width: 1024px)")`）：
  - 抽屉开关状态 `chatOpen` 由 `AppShell` 持有（`useState`），开关按钮在**信息条右侧**（`InfoBar` 渲染，仅小屏出现）；桌面态开关不渲染、状态不生效。
  - 抽屉渲染于 `ChatPanel` 外壳：`fixed inset-0 z-50` 容器 + 遮罩 `absolute inset-0 bg-foreground/40 animate-in fade-in`（点击关闭）+ 抽屉 `absolute inset-y-0 right-0 w-[85vw] max-w-md border-l border-border bg-background shadow-xl animate-in slide-in-from-right duration-300`；抽屉标题行右侧额外渲染 X 关闭按钮。关闭时不渲染（`if (!open) return null`）。

### 三栏职责

| 栏 | 组件 | 内容 |
|----|------|------|
| 左栏 | `Sidebar` | 产品标识（点击回 `#/`）、书架（项目→会话二级树 + 新建项目）、底部设置入口 + 主题切换 |
| 中栏 | `MainPanel` | 信息条 + TabBar + 页面内容区（按路由渲染 children） |
| 右栏 | `ChatPanel` | AI 聊天常驻；**会话归属项目**（见 §2.4）；无项目打开时禁用 |

---

## 1. 路由结构（hash 路由）

前端用自制 `useHashRoute`（`hooks/use-route.ts`，不引入 React Router）。路由表（**8 路由**）：

| hash | 页面 | 归属 |
|------|------|------|
| `#/` | Dashboard 概览（默认落地；无项目时为引导形态） | 中栏 tab「概览」 |
| `#/outline` | Outline 大纲树 | 中栏 tab「大纲」 |
| `#/canvas` | Canvas 画布 | 中栏 tab「画布」 |
| `#/entities/:type?` | EntityList 实体列表 | 中栏 tab「实体关系」 |
| `#/entities/:type/:id` | EntityDetail 实体详情 | 中栏 tab「实体关系」 |
| `#/hooks` | HookPanel 伏笔面板 | 中栏 tab「伏笔」 |
| `#/trash` | Trash 回收站 | 中栏 tab「回收站」 |
| `#/settings` | Settings 设置 | 左栏底部 |

说明：

- **tab 与路由一一对应**：`KNOWN_ROUTE_SEGMENTS = [outline, entities, canvas, hooks, trash, settings]`；TabBar 高亮由路由首段驱动（根路由 `#/` 用 `null` 表达），「实体关系」tab 在实体列表/详情路由下均保持高亮。
- 路由解析按段数区分：`#/entities/character`（2 段）→ 列表页；`#/entities/character/char-abc`（3 段）→ 详情页；type 缺省回退 `character`。
- 未知首段 hash 回退 `#/`（`window.location.replace` 拉回 URL，不污染历史）。
- **`#/chat` 已移除**：聊天常驻右栏，无独立页；原「带上下文进聊天」改为注入右栏当前会话 focus 小条（见 §4.2）。
- 导航跳转统一走 `<a href="#/...">` 或 `navigate(path)` 辅助函数，保证 hash 变更触发重渲染。

---

## 2. 应用外壳与三栏样式

`AppShell` 拆为三个顶级组件（见 §5 组件结构）。

### 2.1 中栏信息条 `InfoBar`（h-12）

`flex h-12 shrink-0 items-center gap-3 border-b border-border px-4`，数据源 `stores/project.ts`（`GET /api/v1/project/config`，失败静默不阻塞）：

| 展示 | 样式 | 行为 |
|------|------|------|
| 项目名 | 衬线中等：`font-serif text-base font-medium`，前缀 `◈` 装饰符 `text-primary`，`hover:text-primary` | 点击回 `#/`；加载中显示「加载中…」；无项目/失败显示「书架」 |
| 当前位置 | `text-sm`，前缀「当前位置:」`text-muted-foreground`，标题 `truncate text-foreground`（outline 树 id→title 映射，未加载显示 id 原文）；null → 「未设置」 | 点击跳 `#/outline` 并定位该节点（ui store transient `focusOutlineNodeId`，方案 A） |
| 语言 | `ml-auto shrink-0 text-sm text-muted-foreground`「语言: {language}」 | 纯展示 |
| 聊天开关（仅 <1024px） | `Button ghost icon-sm`；打开时 `bg-secondary text-foreground`，关闭时 `text-muted-foreground`，MessageSquare `size-4` | 切换右栏抽屉 |

### 2.2 中栏 TabBar（药丸分段控件）

- 外壳：`flex items-center gap-1 rounded-lg bg-secondary/30 p-1`（外包一层 `shrink-0 px-3 py-2`）。
- 六个 tab：概览（LayoutGrid）/ 大纲（ListTree）/ 画布（Shapes）/ 实体关系（Network）/ 伏笔（Puzzle）/ 回收站（Trash2），lucide 图标 `size-4` + 中文标签。
- 每项：`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground`；激活项 `bg-card text-foreground shadow-sm`（+ `aria-current="page"`）。
- 当前 tab 由路由首段驱动；点击即跳对应 hash。

### 2.3 左栏 `Sidebar`

- **产品标识**：`flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3 font-serif text-base italic text-foreground hover:text-primary`——衬线**斜体**产品名「我的小说」+ `◈` 标记 `text-primary`；点击回 `#/`。
- **书架区**（`min-h-0 flex-1 overflow-y-auto px-2 py-2`，挂载即拉取，无项目也展示）：
  - 头部行：标签「书架」`text-xs font-medium text-muted-foreground` + 右侧 `[+]` 新建项目（`Button ghost icon-xs`，Dialog 表单，`sm:max-w-sm`，书名禁路径分隔符）。
  - **项目行**：`flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-left text-sm transition-colors`；当前项目 `bg-muted font-medium text-foreground`，其余 `text-muted-foreground hover:bg-muted hover:text-foreground`；BookOpen 图标 `size-3.5`（当前项目 `text-primary`）；行尾紧凑日期 `text-[10px] text-muted-foreground/60`（当年 MM-DD、跨年 YY-MM-DD，title 悬浮完整时间）。
  - **chevron 展开按钮**（行右侧 `w-6 h-8 rounded-lg`）：ChevronRight `size-4`，展开时 `rotate-90`，`transition-transform duration-200`；**单展开**（同一时刻只展开一本）。
  - **会话子列表**（展开的项目行下方，归属项目，决策 22）：`ml-3 border-l border-border py-0.5 pl-1.5`——左边缘线形成树状缩进；行 `flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors`，当前会话 `bg-accent font-medium text-accent-foreground`，其余 `text-muted-foreground hover:bg-muted hover:text-foreground`；MessageSquare `size-3 opacity-70` + 首条消息截断 + 相对时间 `text-[10px]`。展开时按需加载（未尝试过才请求）；未展开/失败/空态：`ml-3 border-l border-border py-1 pl-2 text-xs text-muted-foreground/60`（「会话加载中…」「暂无会话」「打开项目后查看会话」+ 失败时 [重试]）。
  - **状态呈现**：首载骨架 3 条 `h-8 animate-pulse rounded-lg bg-muted`；空书架「还没有书，先创建一本」`text-xs text-muted-foreground/70`；加载失败「无法连接服务/书架加载失败」+ [重试]。
- **底部区**（`shrink-0 flex flex-col gap-1 border-t border-border p-2`）：
  - 设置入口：`flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground`，Settings `size-4`，指向 `#/settings`。
  - 主题切换：`Button ghost sm justify-start text-muted-foreground`，当前深色显示 Sun「浅色模式」、浅色显示 Moon「深色模式」（见 §3.4）。

### 2.4 右栏 `ChatPanel`（常驻 AI 聊天）

- **会话归属项目**：会话列表与当前会话（chat store `currentSessionId`）随项目切换（`clearSessions` + 自动重载）；**无项目打开时整体禁用**——消息区居中灰显（MessageSquare `size-8 text-muted-foreground/40` + 「打开项目后可用」`text-sm text-muted-foreground/70`），标题下拉/输入区 `disabled`，不请求会话数据。
- 面板结构（自上而下，`flex h-full min-h-0 flex-col`）：

**① 会话标题行**（`h-12 shrink-0 border-b border-border px-2.5`）：MessageSquare `size-4 text-muted-foreground` + 下拉切换（`Button ghost sm max-w-44 justify-start`，标题 `truncate text-sm font-medium` + ChevronDown `size-3.5`；菜单 `w-64`，label「会话（本项目）」+ 分隔线，项为 lastMessage + `text-xs text-muted-foreground`「{n} 条 · {相对时间}」，当前项 `bg-accent text-accent-foreground`；无历史显示「暂无历史会话」）+ `[+]` 新会话（`ghost icon-sm`）+ 小屏抽屉时右侧 X 关闭。

**② 断连横幅 / 错误条**（无项目时隐藏）：`flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive`——断连横幅 TriangleAlert「上次会话已取消」+ [重新发送]（`outline xs`，重发清理断连残留半截消息）+ 关闭 X；错误条 CircleAlert + 错误文案 + 关闭 X。

**③ 消息流**（`min-h-0 flex-1 overflow-y-auto px-3 py-3`，内容 `flex flex-col gap-3`；新消息/加载完成自动滚底）：
- **user 气泡**：右对齐 `flex justify-end` + 气泡 `max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground`。
- **assistant 纯排版**：无气泡；正文 `whitespace-pre-wrap font-serif text-[17px] leading-[1.72] text-foreground`（**宋体排版**，§3.3 字体约定）；toolCalls 渲染为折叠工具记录。
- **工具调用折叠行**（历史 `toolCalls` 与运行时 `streamTools` 共用）：`rounded-md border border-border/70 bg-muted/40 px-2 py-1`；折叠态「调用了 {toolName}」`text-xs text-muted-foreground`（Wrench `size-3` + ChevronRight 展开 `rotate-90`）；结果标记：成功 ✓ `text-primary` / 失败 ✗ `text-destructive`；展开显示 args JSON 摘要（`pre` `mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs`）。
- **提案卡**（SSE proposal 事件，瞬态）：`rounded-lg border border-primary/25 bg-primary/5 p-2.5`；标题行 `text-sm font-medium` + Sparkles `size-3.5 text-primary`「提案：{type 中文}」（新建实体/更新实体/新增关系/新建大纲节点）；状态徽记：✓ 已确认 `text-primary` / 已拒绝 `text-muted-foreground` / ⚠ 数据已变化，此提案已失效 `text-destructive`；preview JSON 摘要 `pre mt-1 max-h-32`；底部 `mt-2 flex gap-1.5` [确认]（默认）/ [拒绝]（`outline`）——**当前为锁定态（disabled），S7 接入确认/拒绝 API 后启用**。

**④ focus 小条**（输入区上方，无 focusContext 不渲染）：`flex shrink-0 items-center gap-1.5 border-t border-border bg-accent/40 px-3 py-1.5 text-xs`；Sparkles `size-3.5 text-primary` + 「正在讨论：{类型} {id}」`text-muted-foreground truncate`（MVP 简化：不查实体名，显示 id 原文）+ 关闭 X。

**⑤ 输入区**（`shrink-0 border-t border-border p-3`，`flex items-end gap-2`）：
- textarea：`max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground`；聚焦态 `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`；streaming 时禁用（`disabled:opacity-50`）占位「AI 思考中…」。
- 交互：**Enter 发送 / Shift+Enter 换行**（组合输入法 isComposing 不触发）；发送按钮 streaming 时 Loader2 `animate-spin` +「思考中」并禁用。

**⑥ 状态呈现**：历史恢复骨架 2 条 `animate-pulse rounded-lg bg-muted/60`（40px 高，宽 90%/70%）；空态居中引导（MessageSquare `size-7 text-muted-foreground/40` + 「试试问：这个设定有没有漏洞？／第 4 章剧情往哪走合理？」两行 `text-sm text-muted-foreground`）。

### 2.5 概览页 `Dashboard`（中栏内容区代表性样式）

- **引导形态**（无项目）：居中卡 `mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center`——标题 `font-serif text-lg`「还没有书，先创建一本」+ 说明 `text-xs text-muted-foreground` + 新建表单（Input + [新建]）+ 折叠的「打开其他路径…」（`border-t border-border pt-3` 次级操作）。
- **概览形态**（项目已打开）：页标题 `font-serif text-xl font-medium`「项目概览」；区块网格 `grid gap-4 lg:grid-cols-2`；区块卡 `rounded-xl border border-border bg-card p-4`，区块标题 `font-serif text-base`；大纲概览/最近会话两区块 `lg:col-span-2`。
- 创作要素四卡：`grid grid-cols-2 gap-2`，卡 `rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-muted`，计数 `font-serif text-2xl font-semibold`。
- 最近会话列表：`divide-y divide-border rounded-lg border border-border`，行 `px-3 py-2 hover:bg-muted`，当前会话 `bg-accent/40`。
- 区块骨架 `animate-pulse bg-muted`（高度按内容）；区块失败「{文案} [重试]」（`outline xs`）不阻塞其他区块。

---

## 3. 主题系统（shadcn CSS tokens）

> 依据：shadcn 官方 theming 文档（oklch + `@theme inline` + `@custom-variant dark`，Tailwind 4 CSS-first）；本节约定为 U1 契约，**值已在 `client/src/index.css` 落地**，修改时须成对维护。

### 3.1 组织方式

全局 tokens 集中在 `client/src/index.css`（单一文件，勿散落）：

```css
@import "tailwindcss";
@import "tw-animate-css";            /* 动画工具类（animate-in / slide-in-from-right 等） */
@import "shadcn/tailwind.css";       /* shadcn 基础样式 */
@custom-variant dark (&:is(.dark *)); /* 深色 = .dark 祖先类 */
@theme inline { /* 变量名 → Tailwind 色板映射（含 --color-sidebar-* / --font-serif / --radius-* 派生） */ }
:root { /* 浅色变量值（oklch） */ }
.dark { /* 深色变量值（oklch） */ }
@layer base { /* body bg/text、* border-border、html font-sans */ }
```

- 变量值一律 **oklch 字符串**（不用 hsl/hex）；`@theme inline` 让工具类直接引用 `var(--xxx)`，`:root`/`.dark` 覆盖即时生效。
- **语义配对**：每个 surface token 配 `-foreground` 文本 token（`--primary` ↔ `--primary-foreground`），修改色板时必须成对维护，保证对比度。

### 3.2 色板（文学氛围风，实际值）

| 变量 | 浅色（暖羊皮纸 + 牛血红） | 深色（蓝黑曜石 + 琥珀烛光） |
|------|--------------------------|---------------------------|
| `--background` | `oklch(0.985 0.005 80)` 暖羊皮纸 | `oklch(0.12 0.01 250)` 蓝黑曜石 |
| `--foreground` | `oklch(0.13 0.02 60)` | `oklch(0.92 0.01 250)` |
| `--card` / `--popover` | `oklch(1 0 0)` | `oklch(0.17 0.01 250)` |
| `--primary` / `--ring` | `oklch(0.45 0.12 25)` 深牛血红 | `oklch(0.78 0.14 85)` 琥珀烛光 |
| `--primary-foreground` | `oklch(0.98 0.006 76)` | `oklch(0.2 0.05 60)` |
| `--secondary` = `--muted` | `oklch(0.94 0.01 76)` | `oklch(0.2 0.01 250)` |
| `--muted-foreground` | `oklch(0.45 0.01 60)` | `oklch(0.6 0.02 250)` |
| `--accent` | `oklch(0.92 0.02 85)` 金箔 | `oklch(0.25 0.03 85)` |
| `--accent-foreground` | `oklch(0.2 0.05 60)` | `oklch(0.95 0.01 250)` |
| `--border` = `--input` | `oklch(0.84 0.01 76)` | `oklch(0.3 0.02 250)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |

- **同值关系（实现约定）**：`--muted` 与 `--secondary` 同值、`--input` 与 `--border` 同值、`--ring` 与 `--primary` 同值；`--sidebar-*` 系列（sidebar/sidebar-foreground/sidebar-primary/sidebar-accent/sidebar-border/sidebar-ring）与主系列**同值**（左栏 `bg-sidebar` 因此与 `bg-background` 视觉一致，见 §0）。`chart-1..5` 按 shadcn 默认结构补齐，色相与上表一致。

### 3.3 字体与圆角（实际值）

- 字体（**系统字体栈，不下载 web 字体**——本地优先离线可用，`@theme inline` 中定义）：
  - `--font-sans`（正文）：`system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
  - `--font-serif`（标题/聊天）：`"Songti SC", "SimSun", "Noto Serif CJK SC", serif`；`--font-heading: var(--font-serif)`
  - 应用约定：**标题**（产品标识、页面 h1/h2、区块卡标题、项目名、计数）一律 `font-serif`，产品标识与概览标题用 `italic` 斜体；**聊天正文**（assistant 消息）`font-serif text-[17px] leading-[1.72]`（宋体排版习惯）；其余正文/控件用默认 `font-sans`。
- 圆角：`--radius: 0.6rem` 基值，Tailwind 派生刻度（`@theme inline` 计算）：`rounded-sm` 0.36rem / `rounded-md` 0.48rem / `rounded-lg` 0.6rem / `rounded-xl` 0.84rem / `rounded-2xl` 1.08rem。应用约定：行级控件/输入/气泡 `rounded-lg`、区块卡 `rounded-xl`、引导大卡 `rounded-2xl`、TabBar 激活项/会话行 `rounded-md`。

### 3.4 主题切换

- 双主题（浅/深）+ **手动切换**：左栏底部按钮（当前深色显示 Sun「浅色模式」，浅色显示 Moon「深色模式」）。
- 实现：`hooks/use-theme.ts` 轻量 hook——挂载时读 `localStorage`（key `ai-editor:theme`，值 `"light" | "dark"`，默认 light）并 `document.documentElement.classList.toggle("dark", ...)`；`toggleTheme` 写回 localStorage + 切 class（无 ThemeProvider）。无自动时间段切换。

---

## 4. 全局状态与通用交互约定

### 4.1 状态管理（Zustand）

| store / hook | 内容 | 说明 |
|-------|------|------|
| `stores/project.ts` | `config`（GET /project/config）、outline 树、bookshelf 书架 | 信息条标题映射、多页共用；`currentPosition` 变更后同步刷新 |
| `stores/chat.ts` | **会话归属项目**：`currentProjectId`（订阅联动）+ `currentSessionId`、会话列表、消息流（messages/loadMessages）、SSE 运行态（streaming/streamError/disconnected + resendLast）、focus context、瞬态渲染数据（proposals/streamTools） | 跨 tab 跳转保留；切项目清空并重载（订阅 project store 的 config.id） |
| `stores/ui.ts` | 错误横幅（error/showError，渲染组件 `ErrorBanner` 挂 AppShell）、toast（`showToast` 3s 自动消失，sonner `<Toaster>` 桥接渲染）、确认对话框（confirm/resolveConfirm，ConfirmDialog 实现于 `components/outline/dialogs.tsx`）、大纲定位 transient `focusOutlineNodeId` | 通用交互 |
| `hooks/use-theme.ts` | 主题态（localStorage 持久化） | 见 §3.4（主题态独立于 ui store） |

### 4.2 跨页跳转约定

- **带上下文进聊天（不跳页）**：任一页「问 AI」→ 注入右栏当前会话：chat store 写入 `focusContext`（`focus_entity_type` / `focus_entity_id` / `focus_node_id`，对应 POST /api/v1/chat 请求体 `context` 字段），右栏输入框上方显示 focus 小条（§2.4 ④）。
- **当前位置定位**：InfoBar / 概览页点击「当前位置」→ ui store 设置 `focusOutlineNodeId`（transient）→ 跳 `#/outline`；Outline 页消费（展开祖先 + 滚动 + 临时高亮）后清除。
- **软删成功**：跳回列表/大纲页 + toast「已移入回收站，可随时还原」。

### 4.3 样式细节规范（统一约定）

- **骨架（加载态）**：区块级 `animate-pulse bg-muted`（高度按内容自定，如 h-8/h-20）；聊天消息区骨架 `bg-muted/60`。不出现闪跳「加载失败」文案（用 attempted 标记防首帧误报）。
- **错误态**：区块内 `text-xs/text-sm` 文案 + [重试]（`outline xs`），单区块失败不阻塞其他区块；全局/流错误用红色横幅（`bg-destructive/10 border-destructive/30 text-destructive`）；错误文案按错误码映射（`lib/error-messages.ts` / `describeStreamError`）。
- **空态**：一句说明 + 一个主操作按钮；可配图标（`size-7/8 text-muted-foreground/40`）。
- **toast**：轻提示（保存成功、已移入回收站等），`showToast` 3s 自动消失；渲染 = sonner `<Toaster>`（`components/ui/sonner.tsx`，主题随 useTheme 适配），`components/feedback/` 内订阅 ui store 桥接（U6 起实现）。
- **确认对话框**：危险操作（软删、purge、删关系）必须二次确认并说明影响范围（`confirm()`，ConfirmDialog 渲染组件后续切片实现）。
- **焦点可见性**：全局 `* { outline-ring/50 }`；输入控件聚焦 `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`。
- **动画**：仅三处高影响动效——抽屉滑入（`animate-in fade-in` / `slide-in-from-right duration-300`，tw-animate-css）、chevron 展开旋转（`transition-transform duration-200` + `rotate-90`）、骨架脉冲（`animate-pulse`）/流式加载旋转（`animate-spin`）；行级 hover 一律 `transition-colors`。其余保持克制，不叠加装饰动画。
- **阴影**：`shadow-sm`（TabBar 激活项）、`shadow-xl`（抽屉）；卡片默认**无阴影**，以 `border-border` 分隔层级（`bg-card` 用于浮起的面）。

---

## 5. 组件结构（按代码实际）

```
client/src/
  components/
    ui/            # shadcn 基础组件（button/input/dialog/dropdown-menu/scroll-area/
                   #   separator/sonner/tabs/tooltip），不再自研
    sidebar/       # Sidebar：产品标识、书架树（项目→会话）、设置入口、主题切换
    main-panel/    # MainPanel（信息条 + TabBar + 内容区装配）、InfoBar、TabBar
    chat/          # ChatPanel：会话标题/下拉、断连横幅/错误条、消息流、工具折叠行、
                   #   提案卡、focus 小条、输入区
    outline/       # 大纲树相关对话框（dialogs.tsx，含 ConfirmDialog）
    page-nav/      # Breadcrumb 面包屑（tab 化分段，跨页复用）
    feedback/      # 全局反馈宿主：Toaster 挂载 + ui store toast→sonner 桥接 + ErrorBanner 错误横幅
  pages/           # 页面级组件（只做数据编排与状态绑定）：Dashboard / Outline / Canvas /
                   #   EntityList / EntityDetail / HookPanel / Trash / Settings
  hooks/           # use-route（hash 路由）、use-theme、use-media-query、use-sse（SSE 解析）、use-api
  stores/          # project / chat / ui（Zustand）
  lib/             # api（fetch 封装）、utils（cn）、error-messages、book-cover、
                   #   entity-list / entity-detail / outline-tree（页面数据整理）
```

约定：跨页复用的纯展示组件上提到 `components/` 对应子目录；页面级组件留在 `pages/`，只做数据编排与状态绑定，不堆砌布局细节。

---

## 6. 页面归属速查

| 页面 | 路由 | 核心 API | 细案 |
|------|------|---------|------|
| Dashboard（概览/引导） | `#/` | project/config、project/list、entity/:type ×4、outline、chat/sessions | pages/dashboard.md |
| Outline | `#/outline` | outline CRUD、project/config（设当前位置） | pages/outline.md |
| Canvas | `#/canvas` | outline、relation（plot_edge）、localStorage 布局 | pages/canvas.md |
| EntityList | `#/entities/:type`、`#/entities/relations`（关联 tab） | entity/:type（列表）、relation（depth=1） | pages/entity-list.md |
| EntityDetail | `#/entities/:type/:id` | entity/:type/:id、relation | pages/entity-detail.md |
| ChatPanel（右栏常驻） | —（无独立路由） | chat（SSE）、chat/sessions、proposal | pages/chat.md |
| HookPanel | `#/hooks` | entity/hook、outline、relation、delta | pages/hook-panel.md |
| Trash | `#/trash` | trash/* | pages/trash.md |
| Settings | `#/settings` | settings/llm | pages/settings.md |

后续 S 系列切片接入方式：S4 回收站页、S9 伏笔面板、S10 画布页均作为**中栏内容区页面**（`pages/` 下新组件 + 路由表新增首段 + TabBar 已有对应 tab），外壳样式（区块卡 `rounded-xl border bg-card p-4`、骨架/空态/错误态、标题 `font-serif`）沿用 §2.5 概览页规范。
