# UI 布局与导航（MVP 功能原型）

> 依据：`doc/design/architecture.md`（页面清单与前端技术栈）、`doc/design/decisions.md`（交互约束）、`doc/api/endpoints.md`（字段契约）
> 定位：MVP 功能原型 —— 定义布局、信息层级、交互状态；视觉实现（色彩/动效/装饰）落地于主题 tokens 与组件实现
> 配套：`doc/ui/pages/*.md` 为各页面细案；本文件定义应用外壳、路由、主题系统、全局约定
> 2026-08 修订：**三栏工作台布局（1:5:4）**，借鉴 inkos 的文学氛围工作台范式；会话归属项目模型；`#/chat` 独立页移除

---

## 0. 布局总览（三栏工作台）

```
┌───────────────┬──────────────────────────────────────────────┬──────────────────────┐
│ 左栏 (10%)     │ 中栏 (50%)                                    │ 右栏 (40%)            │
│               │ ┌────────────────────────────────────────────┐ │                      │
│ ◈ 产品标识      │ │ 信息条：项目名 | 当前位置 | 语言            │ │ 会话标题（可下拉切换） │
│               │ ├────────────────────────────────────────────┤ │  ──────────────────  │
│ 书架           │ │ TabBar：概览|大纲|画布|实体关系|伏笔|回收站    │ │                      │
│  ▸ 我的小说     │ ├────────────────────────────────────────────┤ │  消息流               │
│   ▸ 会话 1     │ │                                            │ │  （user 气泡 /        │
│   ▸ 会话 2     │ │             页面内容区（按 tab 渲染）          │ │   assistant 排版）     │
│  ▸ 修仙：问天    │ │                                            │ │                      │
│               │ │                                            │ │  ┌──────────────────┐ │
│  ───────────  │ │                                            │ │  │ 工具调用折叠记录     │ │
│  设置          │ │                                            │ │  │ 提案卡片（确认/拒绝） │ │
│  主题切换      │ └────────────────────────────────────────────┘ │  └──────────────────┘ │
│               │                                                │ ┌────────────────────┐ │
│               │                                                │ │ focus 小条（可关闭）  │ │
│               │                                                │ │ 输入区      [发送]   │ │
└───────────────┴──────────────────────────────────────────────┴──────────────────────┘
```

### 宽度与缩放

- **严格 1:5:4 百分比**：左栏 10%、中栏 50%、右栏 40%（`flex: 1 5 4` 或显式百分比），**左右栏固定不可拖拽**。
- **小屏折叠**：`<1024px` 时右栏折叠为抽屉（fixed 定位 + 遮罩 + 开关按钮，参考 inkos BookSidebar 移动端抽屉）。

### 三栏职责

| 栏 | 组件 | 内容 |
|----|------|------|
| 左栏 | `Sidebar` | 产品标识（点击回 `#/`）、书架（项目→会话二级树）、底部设置入口 + 主题切换 |
| 中栏 | `MainPanel` | 信息条 + tab 导航 + 页面内容区（按路由渲染） |
| 右栏 | `ChatPanel` | AI 聊天常驻；**会话归属项目**（见 §2.4）；无项目打开时禁用 |

---

## 1. 路由结构（hash 路由）

前端用自制 `useHashRoute`（不引入 React Router，见 architecture.md）。路由表：

| hash | 页面 | 归属 |
|------|------|------|
| `#/` | Overview 概览（默认落地；无项目时为引导页） | 中栏 tab「概览」 |
| `#/outline` | Outline 大纲树 | 中栏 tab「大纲」 |
| `#/canvas` | Canvas 画布 | 中栏 tab「画布」 |
| `#/entities/:type?` | EntityList 实体列表 | 中栏 tab「实体关系」 |
| `#/entities/:type/:id` | EntityDetail 实体详情 | 中栏 tab「实体关系」 |
| `#/hooks` | HookPanel 伏笔面板 | 中栏 tab「伏笔」 |
| `#/trash` | Trash 回收站 | 中栏 tab「回收站」 |
| `#/settings` | Settings 设置 | 左栏底部 |

说明：

- **tab 与路由一一对应**：当前 tab 高亮由路由首段决定；「实体关系」tab 在实体列表/详情路由下均保持高亮。
- 路由解析按段数区分：`#/entities/character`（2 段）→ 列表页；`#/entities/character/char-abc`（3 段）→ 详情页。
- 未知 hash 回退 `#/`。
- **`#/chat` 已移除（2026-08 修订）**：聊天常驻右栏，不再有独立页面；原「带上下文进聊天」改为直接注入右栏当前会话（见 §4.2）。
- 导航跳转统一走 `<a href="#/...">` 或封装 `router.push()`，保证 hash 变更触发重渲染。

---

## 2. 应用外壳（AppShell）

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Sidebar        │ MainPanel                                          │ ChatPanel │
```

AppShell 拆为三个顶级组件（见 §5 组件结构），职责如下。

### 2.1 中栏信息条

数据来源 `GET /api/v1/project/config`：

| 展示 | API 字段 | 行为 |
|------|---------|------|
| 项目名 | `name` | 点击回 `#/`；**无项目打开（书架形态）时显示「书架」** |
| 当前位置 | `currentPosition`（大纲节点 id） | 显示节点标题（从本地 outline 树映射 id→title）；点击跳 `#/outline` 并定位该节点；为 null 显示「未设置」 |
| 语言 | `language` | 纯展示 |

### 2.2 中栏 TabBar

- 六个 tab：**概览 / 大纲 / 画布 / 实体关系 / 伏笔 / 回收站**（对应 §1 路由表）。
- 形态：药丸分段控件（参考 inkos：`bg-secondary/30 rounded-lg p-1` 容器 + 激活项 `bg-card shadow-sm`）；每项带 lucide 图标 + 中文标签。
- 当前 tab 由路由首段驱动；点击即跳对应 hash。

### 2.3 左栏 Sidebar

- **产品标识**：顶部（衬线斜体产品名 + 图标），点击回 `#/`。
- **书架（项目→会话二级树）**：
  - 一级：项目列表（`GET /api/v1/project/list` → 创作根 `books/` 子目录）；行显示书名 + 更新时间；点击打开项目（`openProjectAt`）。
  - 二级：**会话列表归属项目**（2026-08 修订，借鉴 inkos 书→会话树）——项目行可 chevron 展开显示其会话（`GET /api/v1/chat/sessions`）；点击会话 → 右栏切换到该会话并恢复历史；hover 出现「⋯」菜单（新建会话 / 重命名 / 删除，重命名/删除为未来扩展，见 backlog）。
  - 底部操作：[+ 新建项目]（与引导页表单等效）。
- **底部区**：设置入口（`#/settings`）+ **主题切换按钮**（Sun/Moon，见 §3.4）。

### 2.4 右栏 ChatPanel（常驻 AI 聊天）

- **会话归属项目**：会话不是全局的——每个项目有自己的会话列表；当前会话 = chat store 的 `currentSessionId`（+ 所在项目）。切项目时会话上下文随之切换。
- **会话切换**：右栏顶部显示当前会话标题，点击可下拉切换同项目会话；「+ 新会话」按钮新建。
- **无项目打开**：右栏整体禁用（灰显 + 提示「打开项目后可用」）。
- 面板结构（自上而下）：会话标题行 → 消息流 → 工具调用折叠记录 → 提案卡片 → focus 小条 → 输入区。细案见 `pages/chat.md`。

---

## 3. 主题系统（shadcn CSS tokens）

> 依据：shadcn 官方 theming 文档（oklch + `@theme inline` + `@custom-variant dark`，Tailwind 4 CSS-first）；2026-08 修订引入。

### 3.1 组织方式

全局 tokens 集中在 `client/src/index.css`（单一文件，勿散落）：

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));   /* 深色 = .dark 祖先类 */
@theme inline { /* 变量名 → Tailwind 色板映射 */ }
:root { /* 浅色变量值（oklch） */ }
.dark { /* 深色变量值（oklch） */ }
@layer base { /* border-border、body bg/text */ }
```

- 变量值一律 **oklch 字符串**（不用 hsl/hex）；`@theme inline` 让工具类直接引用 `var(--xxx)`，`:root`/`.dark` 覆盖即时生效。
- **语义配对**：每个 surface token 配 `-foreground` 文本 token（`--primary` ↔ `--primary-foreground`），修改色板时必须成对维护，保证对比度。

### 3.2 色板（文学氛围风，借鉴 inkos）

| 变量 | 浅色（暖羊皮纸 + 牛血红） | 深色（蓝黑曜石 + 琥珀烛光） |
|------|--------------------------|---------------------------|
| `--background` | `oklch(0.985 0.005 80)` 暖羊皮纸 | `oklch(0.12 0.01 250)` 蓝黑曜石 |
| `--foreground` | `oklch(0.13 0.02 60)` | `oklch(0.92 0.01 250)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.17 0.01 250)` |
| `--primary` | `oklch(0.45 0.12 25)` 深牛血红 | `oklch(0.78 0.14 85)` 琥珀烛光 |
| `--primary-foreground` | `oklch(0.98 0.006 76)` | `oklch(0.2 0.05 60)` |
| `--secondary` | `oklch(0.94 0.01 76)` | `oklch(0.2 0.01 250)` |
| `--accent` | `oklch(0.92 0.02 85)` 金箔 | `oklch(0.25 0.03 85)` |
| `--border` | `oklch(0.84 0.01 76)` | `oklch(0.3 0.02 250)` |
| `--ring` | 同 `--primary` | 同 `--primary` |

（其余 token：`muted`/`popover`/`destructive`/`chart-1..5`/`sidebar-*` 按 shadcn 默认结构补齐，色相与上表一致。）

### 3.3 字体与圆角

- 字体（**系统字体栈，不下载 web 字体**——本地优先离线可用）：
  - 标题：衬线 `"Songti SC", "SimSun", "Noto Serif CJK SC", serif`，可用 `italic` 模拟 inkos 斜体标题感
  - 正文：系统无衬线栈（`system-ui, sans-serif`）
  - 聊天正文：宋体栈（同标题衬线栈，inkos 同款「聊天用宋体」习惯）
- 圆角：`--radius: 0.6rem`（inkos 同款）；控件 `rounded-lg` / 卡片 `rounded-xl` / 大卡 `rounded-2xl`。

### 3.4 主题切换

- 双主题（浅/深）+ **手动切换**（Sun/Moon 按钮，左栏底部）；localStorage 持久化（如 `ai-editor:theme`），无自动时间段切换。
- 实现：`document.documentElement.classList.toggle("dark", ...)`（无 ThemeProvider 需求，直接轻量 hook）。

---

## 4. 全局状态与通用交互约定

### 4.1 状态管理（Zustand）

| store | 内容 | 说明 |
|-------|------|------|
| `stores/project.ts` | `config`（GET /project/config）、outline 树 | 信息条标题映射、多页共用；`currentPosition` 变更后同步刷新 |
| `stores/chat.ts` | **会话归属项目**：`currentProjectId` + `currentSessionId`、会话列表、SSE 运行态、提案卡片队列、focus context | 跨 tab 跳转保留；切项目重置会话 |
| `stores/ui.ts` | 全局错误横幅、toast、确认对话框、**主题态** | 通用交互 |

### 4.2 跨页跳转约定（2026-08 修订）

- **带上下文进聊天（不再跳页）**：任一页「问 AI」→ 直接注入右栏当前会话：chat store 写入 `focusContext`（`focus_entity_type` / `focus_entity_id` / `focus_node_id`，对应 POST /api/v1/chat 请求体 `context` 字段），右栏输入框上方显示 focus 小条。
- **详情页 404**：EntityDetail 显示「去回收站」链接（`#/trash`）。
- **软删成功**：跳回列表/大纲页 + toast「已移入回收站，可随时还原」。

### 4.3 统一组件约定

- **加载态**：区块级骨架或「加载中…」文案，各页自行定义。
- **错误横幅**：`code + message`，按错误码给出引导文案（各页定义映射）。
- **确认对话框**：危险操作（软删、purge、删关系）必须二次确认，并说明影响范围。
- **空态**：一句说明 + 一个主操作按钮，各页定义。
- **toast**：轻提示（保存成功、已移入回收站等），用 shadcn sonner。

---

## 5. 组件结构（共用组件抽分）

```
client/src/components/
  ui/            # shadcn CLI 生成基础组件（button/input/dialog/dropdown-menu/tabs/
                 #   sonner(或toast)/separator/tooltip/scroll-area…），不再自研
  sidebar/       # Sidebar：产品标识、书架树（项目→会话）、设置入口、主题切换
  chat/          # ChatPanel：会话标题/下拉、消息流、输入区、提案卡、focus 小条、工具折叠记录
  main-panel/    # MainPanel：信息条、TabBar
  overview/      # 概览 tab 内容（原 Dashboard 概览形态）
  outline/       # 大纲树页面组件
  entity/        # 实体列表/详情组件
  canvas/        # 画布（拖拽/连线）
  hook/          # 伏笔面板
  trash/         # 回收站
```

约定：跨页复用的纯展示组件一律上提到 `components/` 对应子目录；页面级组件留在 `pages/`，只做数据编排与状态绑定，不堆砌布局细节。

---

## 6. 页面归属速查

| 页面 | 路由 | 核心 API | 细案 |
|------|------|---------|------|
| Overview（概览/引导） | `#/` | project/config、project/list、entity/:type ×4、outline、chat/sessions | pages/dashboard.md |
| Outline | `#/outline` | outline CRUD、project/config（设当前位置） | pages/outline.md |
| Canvas | `#/canvas` | outline、relation（plot_edge）、localStorage 布局 | pages/canvas.md |
| EntityList | `#/entities/:type` | entity/:type（列表） | pages/entity-list.md |
| EntityDetail | `#/entities/:type/:id` | entity/:type/:id、relation | pages/entity-detail.md |
| ChatPanel（右栏常驻） | —（无独立路由） | chat（SSE）、chat/sessions、proposal | pages/chat.md |
| HookPanel | `#/hooks` | entity/hook、outline、relation、delta | pages/hook-panel.md |
| Trash | `#/trash` | trash/* | pages/trash.md |
| Settings | `#/settings` | settings/llm | pages/settings.md |
