# UI 布局与导航（MVP 功能原型）

> 依据：`doc/design/architecture.md`（页面清单与前端技术栈）、`doc/design/decisions.md`（交互约束）、`doc/api/endpoints.md`（字段契约）
> 定位：MVP 功能原型 —— 只定义布局、信息层级、交互状态，不做视觉美化（色彩/动效/装饰留到实现期）
> 配套：`doc/ui/pages/*.md` 为各页面细案；本文件定义应用外壳、路由、全局约定

---

## 1. 路由结构（hash 路由）

前端用自制 `useHashRoute`（不引入 React Router，见 architecture.md）。路由表：

| hash | 页面 | 侧栏归属 |
|------|------|---------|
| `#/` | Dashboard 首页 | 无（默认落地页） |
| `#/outline` | Outline 大纲树 | 大纲 |
| `#/entities/:type?` | EntityList 实体列表 | 实体 |
| `#/entities/:type/:id` | EntityDetail 实体详情 | 实体 |
| `#/canvas` | Canvas 画布 | 画布 |
| `#/chat` | Chat 聊天 | 聊天 |
| `#/hooks` | HookPanel 伏笔面板 | 伏笔 |
| `#/trash` | Trash 回收站 | 回收站 |
| `#/settings` | Settings 设置 | 设置 |

说明：

- 路由解析按段数区分：`#/entities/character`（2 段）→ 列表页；`#/entities/character/char-abc`（3 段）→ 详情页。
- 未知 hash 回退 `#/`。
- 导航跳转统一走 `<a href="#/...">` 或封装 `router.push()`，保证 hash 变更触发重渲染。

## 2. 应用外壳（AppShell）

```
┌─────────────────────────────────────────────────────────────────────┐
│ 顶栏（约 56px）                                                        │
│  [◈ 我的小说]        当前位置: 第3章·灵根测试失败 ▸    语言: 中文       │
├──────────┬──────────────────────────────────────────────────────────┤
│ 侧栏      │                                                            │
│ 大纲      │                                                           │
│ 实体      │                    页面内容区（按路由渲染）                   │
│ 画布      │                                                           │
│ 聊天      │                                                           │
│ 伏笔      │                                                           │
│ ───────  │                                                           │
│ 回收站    │                                                           │
│ 设置      │                                                           │
└──────────┴──────────────────────────────────────────────────────────┘
```

### 2.1 顶栏：项目信息

数据来源 `GET /api/v1/project/config`：

| 展示 | API 字段 | 行为 |
|------|---------|------|
| 项目名 | `name` | 点击回 `#/` |
| 当前位置 | `currentPosition`（大纲节点 id） | 显示节点标题（从本地 outline 树映射 id→title）；点击跳 `#/outline` 并定位该节点；为 null 显示「未设置」 |
| 语言 | `language` | 纯展示 |

### 2.2 侧栏导航

- 主区：大纲 / 实体 / 画布 / 聊天 / 伏笔；分隔线下方：回收站 / 设置。
- 当前路由对应项高亮（实体列表与详情共用「实体」高亮）。
- 可选增强（MVP 可不做）：伏笔项带健康角标（stale + overdue 计数），数据来自伏笔列表 `_health`。

## 3. 全局状态与通用交互约定

### 3.1 状态管理（Zustand，建议划分）

| store | 内容 | 说明 |
|-------|------|------|
| `stores/project.ts` | `config`（GET /project/config）、outline 树 | 顶栏标题映射、多页共用，避免重复请求；`currentPosition` 变更后同步刷新 |
| `stores/chat.ts` | 会话列表、当前 SSE 运行态、提案卡片队列 | 跨页跳转恢复会话 |
| `stores/ui.ts` | 全局错误横幅、toast、确认对话框 | 通用交互 |

### 3.2 统一组件约定

- **加载态**：区块级骨架或「加载中…」文案，各页自行定义。
- **错误横幅**：`code + message`，按错误码给出引导文案（各页定义映射）。
- **确认对话框**：危险操作（软删、purge、删关系）必须二次确认，并说明影响范围。
- **空态**：一句说明 + 一个主操作按钮，各页定义。
- **toast**：轻提示（保存成功、已移入回收站等）。

### 3.3 跨页跳转约定

- **带上下文进聊天**：任一页「问 AI」→ 跳 `#/chat`，经 chat store 注入 `context`（`focus_entity_type` / `focus_entity_id` / `focus_node_id`，对应 POST /api/v1/chat 请求体 `context` 字段），Chat 输入框上方显示 focus 小条。
- **详情页 404**：EntityDetail 显示「去回收站」链接（`#/trash`）。
- **软删成功**：跳回列表/大纲页 + toast「已移入回收站，可随时还原」。

## 4. 页面归属速查

| 页面 | 路由 | 核心 API | 细案 |
|------|------|---------|------|
| Dashboard | `#/` | project/config、project/list（书架）、entity/:type ×4、outline、chat/sessions | pages/dashboard.md |
| Outline | `#/outline` | outline CRUD、project/config（设当前位置） | pages/outline.md |
| Canvas | `#/canvas` | outline、relation（plot_edge）、localStorage 布局 | pages/canvas.md |
| EntityList | `#/entities/:type` | entity/:type（列表） | pages/entity-list.md |
| EntityDetail | `#/entities/:type/:id` | entity/:type/:id、relation | pages/entity-detail.md |
| Chat | `#/chat` | chat（SSE）、chat/sessions、proposal | pages/chat.md |
| HookPanel | `#/hooks` | entity/hook、outline、relation、delta | pages/hook-panel.md |
| Trash | `#/trash` | trash/* | pages/trash.md |
| Settings | `#/settings` | settings/llm | pages/settings.md |
