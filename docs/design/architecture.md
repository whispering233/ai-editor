# 技术架构与分包方案

> 技术栈与分包边界。AI 链路语义见 `20-context.md` / `30-agent-loop.md`；配置载体见 `config.md`；运行/构建/发布见 `build.md`。

## 技术栈全景

| 层 | 技术选型 | 理由 |
|---|---------|------|
| **包管理** | pnpm workspace (monorepo) | 多包共享，依赖隔离，构建解耦 |
| **运行时** | Node ≥ 22.12，**全仓 ESM** | nanoid v5 ESM-only 消费、`require(esm)` 默认开启；避免 CJS/ESM 混合坑 |
| **语言** | TypeScript (strict mode) | 全栈统一类型，减少运行时错误 |
| **API 服务端** | Hono 4 + `@hono/node-server` | 轻量、TypeScript 友好、SSE 原生支持 |
| **数据库** | better-sqlite3 ^13 (WAL mode) + drizzle-orm | N-API 重写（v13），全局安装无 ABI 失配；同步 API 简单可靠，零配置，内嵌；drizzle-orm 查询构建层（不引入 drizzle-kit） |
| **AI 运行时** | `@earendil-works/pi-coding-agent` `1.4.0`（**exact pin**，含 `pi-ai` 模型层 / `pi-agent-core` 循环 / `pi-tui`） | 传输、流式、usage、重试、压缩、工具派发、会话文件格式全部由 pi 接管；本仓只提供领域工具、系统提示词、事件映射与 HTTP/SSE 契约 |
| **工具参数 schema** | TypeBox（经 `pi-ai` 重导出 `Type`/`Static`） | schema 运行时即 JSON Schema：一份定义同时给模型（tool parameters）、给 TS（`Static<>`）、给校验（pi `validateToolArguments`）；不做 zod→JSON Schema 转换 |
| **前端框架** | React 19 | 生态成熟，组件化 |
| **前端构建** | Vite 7 | 快速 HMR，Tree-shaking |
| **状态管理** | Zustand 5 | 轻量、TypeScript 优秀、selector 自动优化 |
| **前端组件基座** | antd v6（ConfigProvider zhCN + 双主题 algorithm + **Notion 工作区暖灰 token 覆盖**）+ `@ant-design/icons`（**全站唯一图标集**）；会话场景 `@ant-design/x`（Bubble/Sender/Thought）+ `@ant-design/x-markdown`；**块文档编辑器 `@blocknote/core` + `@blocknote/react` + `@blocknote/ariakit`（exact pin）** | 成熟组件红利统一视觉与交互；主题 = antd token 派发（**视觉契约见 `docs/ui/DESIGN.md`**）；颜色一律经 antd token，禁止硬编码色值/色类；块编辑器是**受控的第二套表皮**（只改 `--bn-*` 变量，见 DESIGN.md） |
| **样式** | Tailwind CSS 4（**仅布局 utility，不含颜色**）+ `docs/ui/DESIGN.md` 视觉契约 + `design-discipline.test.ts` 源码扫描 | v4 CSS-first 配置；**antd 样式是运行时无层 CSS，会静默压掉 Tailwind 工具类**——antd 组件根元素上不挂 `w-/h-/px-/py-/justify-/rounded-/text-*` |
| **Schema 验证** | Zod 4 | 运行时类型安全，**仅 API 入参**（工具参数改用 TypeBox） |
| **路由** | 轻量 hash-based（自制 `useHashRoute`） | 单页桌面应用不需要 React Router；路由一级化（见 `ui/DESIGN.md`） |
| **桌面外壳** | Electron **44.3.0**（exact pin）+ electron-builder | 主进程内 in-process 复用整个 Node 侧服务形态，零 server 改动；设计见 `50-desktop.md` |

## AI 运行时（pi 嵌入形态）

嵌入方式与 pi-web 同款：单进程内构建 `ModelRuntime` + `SessionManager` + `AgentSession`，不经 CLI/RPC 子进程。

| 能力 | 由谁提供 | 本仓的接入点 |
|---|---|---|
| 模型目录 / provider 目录 / 认证状态 | `ModelRuntime`（静态内置目录 + `~/.pi/agent/models.json` 覆盖 + 远端 catalog overlay + credential store） | 设置页读写；激活模型查询 |
| 凭据 | pi credential store（`~/.pi/agent/auth.json`；**存量凭据优先、环境变量仅在该家无条目时兜底**） | 设置页写 key（不再有自建 key 解析链） |
| 会话文件（v3 树状 JSONL、含 thinking/压缩/model_change 等 entry） | `SessionManager` | 会话目录 = `<项目目录>/sessions/`；列表/读取/删除/续聊 |
| 对话循环 / 工具派发 / 取消 / steering | `pi-agent-core` Agent（`AgentSession` 包装） | `AgentSession.prompt()` + 事件订阅 |
| 重试 / 上下文压缩 | pi auto-retry + auto-compaction | 参数走 pi settings，不在本仓 |
| 系统提示词 / AGENTS.md 注入 | pi resource loader | 内核提示词 + `agentsFilesOverride`（只读项目根 AGENTS.md，见 `20-context.md`） |
| 领域工具（实体/关系/大纲/伏笔/提案；练习工作区为 7 件练习工具） | 本仓 `tools` 包（TypeBox `AgentTool` + `scope` 按 kind 过滤） | 装配进 AgentSession（清单见 `../api/tool-calling.md`） |

**显式不启用**：pi 的编码工具（read/bash/edit/write/…）、扩展加载（`noExtensions`）、技能与提示词模板（`noSkills`/`noPromptTemplates`）、项目信任门、TUI 交互模式。理由：本项目是创作顾问，不是编码 agent；项目目录内的可执行扩展是安全面而非能力面。

**版本纪律**：`@earendil-works/*` 一律 exact pin（上游 pi 自身也用 `check-pinned-deps` 强制精确版本）。升级 = 显式 commit 齐抬版本 + 全量测试 + **无锁安装冒烟**（`pnpm pack:test` + `pnpm start:test`；`pnpm test` 绿不代表装得上——只有 npm 全新安装能暴露上游传递包的破坏）——本仓依赖的是 pi 的内部形态（事件名、session v3 格式、loader options），不是稳定公共契约语义。**传递包不需要本仓写解析锁**：上游 1.3.0 起对内部 pi 包（`pi-agent-core`/`pi-codemode`/`pi-tui`/`pi-mcp`）同样 exact pin ⇒ 本仓只为**运行时 import 到的包**声明直接依赖（清单见下），不为解析形状额外钉钉子。

## 分包方案

五个发布包 + 两个私有包（client / desktop）：

```
packages/
├── shared    # 前后端共享层：纯 TS 类型 + Zod（API schema）+ 常量 + 纯函数（零 Node 依赖；含块文档投影/校验）
├── db        # 存储层：连接/事务/WAL、schema 版本三态分流、增量迁移、drizzle 查询、块文档（document_records）、项目目录文件存储（原子写）
├── tools     # 领域工具层：TypeBox 工具定义 + 查询/分析实现 + 提案仓 + 确认后执行的写操作
├── agent     # AI 运行时层：pi 嵌入装配（ModelRuntime/SessionManager/AgentSession）、系统提示词、事件→SSE 帧映射
├── server    # Hono API 层：REST 路由 + SSE 流 + 静态 SPA 托管（服务端装配包）
├── client    # React SPA（private，不发布）：页面、组件（antd v6 + @ant-design/x）、store、hooks、lib
└── desktop   # Electron 外壳（private，不发布）：主进程接线（in-process 启 server）+ preload + 打包配置
```

| 包 | 职责边界 | 对外契约 |
|----|---------|---------|
| `shared` | 数据结构/类型/常量/纯工具（无 Node API）；**不持有业务逻辑** | `types/api.ts` Zod schema = API 请求/响应契约单一来源；块文档纯函数（`isBlockArray` 浅校验 + `blocksToPlainMd` 投影） |
| `db` | 存储语义：表/查询/迁移/软删级联/状态计算 + 块文档读写（`document_records`）+ 项目目录文件存储（原子写） | `(db: Db)` 签名查询函数；`SCHEMA_VERSION` 与迁移目录；事务辅助 |
| `tools` | 把模型意图映射到写操作：查询/分析工具（自动执行）+ 提案工具（确认后执行）；读写经 db | 工具定义（TypeBox schema + 权限级别）、提案仓、执行器 |
| `agent` | pi 运行时装配：模型/凭据/会话/循环接入、系统提示词、事件映射、工具注册 | `AgentSession` 生命周期 API 与事件流；写操作一律走工具提案 |
| `server` | HTTP/路由/请求校验/项目生命周期（书架）/自动备份/静态托管 | `/api/v1` REST + `POST /chat` SSE（契约见 shared schema + api 文档） |
| `client` | UI：页面、组件、状态、hash 路由；只消费 shared 类型/常量（编译期消失） | 无对外 API |
| `desktop` | 桌面外壳：窗口/菜单/preload 目录选择/书库位置配置/日志落盘/electron-builder 打包；**不承载业务逻辑** | 无对外 API |

**约束要点**：

- 依赖只许沿 `shared → db → tools → agent → server → desktop`，`client → shared`（仅类型+常量）；禁止反向或旁路依赖。
- **前端页面组织与后端 API 路由完全解耦**：API 按数据对象类型划分，页面形状/导航层级/hash 路由名变更只动 client。
- **Zod 校验仅在服务端执行**——client 不打包校验函数（避免 50KB 级依赖进浏览器包）。
- server 是**服务端装配包**（依赖任一下层方向均合规、无环）；`desktop` 是**顶层外壳**——只依赖 server，不被任何包依赖。

## 包依赖链与方向

```
shared（纯类型/常量/工具，零 Node 依赖，可被 client 安全 tree-shake）
  ├── db      ← better-sqlite3 + drizzle-orm
  ├── tools   ← db（查询/分析直连 db；提案仅返回对象不执行；executor 确认后执行）
  ├── agent   ← pi-coding-agent（模型/循环/会话）+ tools（工具注册）
  ├── server  ← db（GUI 直接读写）+ agent（chat 流）+ tools（提案执行）
  ├── client  ← shared（仅类型/常量）
  └── desktop ← server（in-process 启动 + 同源加载 SPA）+ electron 44.3.0（exact pin）
```

依赖方向图：`shared ← db ← tools ← agent ← server ← desktop`；`client ← shared`（编译期消失，零运行时依赖）。

### 各包依赖声明

```json
// packages/shared/package.json
{
  "name": "@whispering233/ai-editor-shared",
  "dependencies": { "zod": "^4.0.0", "nanoid": "^5.1.0" }
}

// packages/db/package.json
{
  "name": "@whispering233/ai-editor-db",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "better-sqlite3": "^13.0.0",
    "drizzle-orm": "0.45.2"
  }
}

// packages/tools/package.json
{
  "name": "@whispering233/ai-editor-tools",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@whispering233/ai-editor-db": "workspace:*",
    "@earendil-works/pi-ai": "1.4.0"        // Type/Static（TypeBox 经 pi-ai 重导出，不单独装 typebox）
  }
}

// packages/agent/package.json
{
  "name": "@whispering233/ai-editor-agent",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@whispering233/ai-editor-tools": "workspace:*",
    "@earendil-works/pi-coding-agent": "1.4.0",   // 含 pi-ai / pi-agent-core / pi-tui（exact pin）
    "@earendil-works/pi-ai": "1.4.0"
  }
}

// packages/server/package.json
{
  "name": "@whispering233/ai-editor-server",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@whispering233/ai-editor-db": "workspace:*",
    "@whispering233/ai-editor-tools": "workspace:*",
    "@whispering233/ai-editor-agent": "workspace:*",
    "@earendil-works/pi-coding-agent": "1.4.0", // 会话/工具派发（exact pin；其内部 pi 包由上游精确钉住，本仓不另写解析锁）
    "@earendil-works/pi-ai": "1.4.0",         // 模型目录与凭据（运行时 import，必须进 dependencies）
    "@hono/node-server": "^2.0.12",
    "hono": "^4.7.0",
    "fflate": "^0.8.3",          // 备份导出/导入 + 小说文档导出的 zip 打包（无 Node 原生依赖）
    "undici": "8.5.0",           // 出站 HTTP dispatcher（与 pi CLI 同款，见 http-dispatcher.ts）
    "zod": "^4.4.3"              // 仅服务端执行校验（client 不打包）
  }
}

// packages/client/package.json（private）
{
  "name": "@whispering233/ai-editor-client",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "antd": "^6.6.2",                          // 组件基座（token 派发 + cssVar 双算法）
    "@ant-design/icons": "^6.3.4",             // 全站唯一图标集
    "@ant-design/x": "^2.9.0",                 // 会话组件族（Bubble/Sender/Conversations…）
    "@ant-design/x-markdown": "^2.9.0",        // 流式 markdown 渲染
    "@blocknote/core": "0.54.2",              // 块文档模型/编辑器内核（exact pin）
    "@blocknote/react": "0.54.2",             // React 绑定（useCreateBlockNote / BlockNoteView）
    "@blocknote/ariakit": "0.54.2",           // 表皮变体（自带 54KB CSS；无额外 UI 库 peer）
    "clsx": "^2.1.1",                          // 类名拼接（cn = clsx + tailwind-merge）
    "tailwind-merge": "^3.6.0",
    "tw-animate-css": "^1.4.0",                // Tailwind 4 动画工具类（index.css 引入）
    "zustand": "^5.0.0"
  }
}

// packages/desktop/package.json（private；**包名有意不带 scope**——electron-builder 的
// `updaterCacheDirName` 派生自 name 且无配置项，带 scope 会在 %LOCALAPPDATA% 生成怪目录名，
// 详见 50-desktop.md §5.1）
{
  "name": "ai-editor-desktop",
  "dependencies": {
    "@whispering233/ai-editor-server": "workspace:*",  // 主进程 in-process 启动
    "electron-updater": "6.8.9"                        // Windows 安装态自动更新（exact pin；CJS ⇒ 默认导入）
  },
  "devDependencies": {
    "electron": "44.3.0",                              // exact pin（同 @earendil-works/* 纪律）
    "electron-builder": "^26.15.3"
  }
}
```

## 工作区类型（kind）与能力收窄（2026-10）

创作根下的顶层单位是**工作区**，其类型（`kind`）是**一个字段**，不是一套新后端：

| 面 | `kind` 决定什么 | 单一定义处 |
| :--- | :--- | :--- |
| 目录映射 | `books/` ↔ `practice/` | shared 常量表（服务端拼路径与云端目录命名同源） |
| 表集 | 小说语义表 vs 工作区专属表 | `db` 表结构声明（单源） |
| 工具集 | 注册进 AgentSession 的工具白名单（按工具定义的 `scope` 过滤） | `tools` 注册表 + `agent` 装配 |
| 内核提示词 | 小说版 / 练习版 | `agent` 提示词常量 |
| 路由守卫 | 小说语义端点（entity / outline / manuscript / relation / delta / trash / names / proposal）vs 练习端点（不匹配 → 400 `KIND_MISMATCH`） | `server` 中间件 |
| 导航与页面 | 左栏项集与路由表 | `client` 常量表 |
| 预置素材 | 作家介绍 / 作品清单 / 作家风格说明预置文本 | shared 常量目录 `authors/`（**客户端与服务端同一份**；新增作家 = 加文件 + 清单一行，无迁移） |

**不变式**：

- **库不隔离、表隔离**：所有工作区共用一个 `data.db` 与**一条**迁移链——备份三文件、云端整包、恢复覆盖、导入校验、原子写全部自动继承；不同语义用各自专属表，**不把不同语义塞进同一张表**（`entities` 的 `type` 带 CHECK、加值即重建表；JSON 提取查询已在多处踩过坏 JSON 打挂整表的坑）。
- **表结构声明单源**：新表只经 `db` 包的表结构声明 + 一条迁移（建表 SQL 与迁移 DDL 必须同形）；**不搞按 kind 建表**——非本 kind 的表在本库里是空表，零成本。
- **工具集按 kind 收窄是结构性边界**：非小说工作区**不注册**小说工具与提案工具（靠注册过滤，不靠提示词）。
- **练习工作区的单位是「一位预置作家」**（`project.json` 的 `author_id`）：作家由产品预置、不可新建；用户可改的只有**风格说明素材包**，它落 `data.db` 专属表（进三文件 ⇒ 备份 / 云端 / 导出 / 恢复自动继承）——**凡需随工作区搬运的用户内容都不落项目目录的散文件**。
- **依赖方向不变**：`kind` 不新增包、不新增依赖边；`shared → db → tools → agent → server → desktop` 与 `client → shared` 保持原样。

## 为什么拆七包

**核心原则：每个包只有一种理由变更。**

| 包 | 变更理由 | 可独立复用 |
|----|---------|-----------|
| `shared` | 数据结构/常量变更 | ✅ 任何需要类型定义的项目 |
| `db` | 数据库/查询变更 | ❌ 紧耦合 shared |
| `tools` | 工具定义/领域分析变更 | ❌ 紧耦合 db + shared |
| `agent` | pi 集成/提示词/事件协议变更 | ❌ 紧耦合 pi + tools |
| `server` | HTTP/路由变更 | ❌ 应用层 |
| `client` | UI 变更 | ✅ 纯浏览器端，可换框架 |
| `desktop` | 外壳/打包/分发变更 | ❌ 紧耦合 server + Electron |

模型接入与对话循环不再单独成包：两者都由 pi 提供，本仓剩下的是**装配与领域工具**——`agent` 一个变更理由（pi 集成）覆盖两者。

## shared 包的内容准则

`shared` 有一条硬性约束：**不能引入任何 Node.js 内置模块或服务端专用包**——client 要在浏览器中 bundle `shared` 的代码：

```typescript
// ❌ 禁止——引入 Node API
import { readFile } from "node:fs";

// ❌ 禁止——引入服务端特有包
import Database from "better-sqlite3";

// ✅ 允许——纯标准库
import { z } from "zod";
import { nanoid } from "nanoid";
```

`shared` 包含三类内容：**类型 + Zod**（API 契约）、**常量**（枚举值、工具名、权限级别）、**纯工具**（`generateId()` 等）。

> **校验执行边界**：Zod 校验仅在服务端执行（server 层），client 只消费类型与常量；工具参数 schema 不在此包（见 `docs/api/tool-calling.md`）。

## 运行与部署

本地开发、构建、打包发布、启动流程（端口/绑定/创作根/书架/调试）见 `docs/design/build.md`；配置载体与读写边界见 `docs/design/config.md`；桌面版（Electron 外壳：进程模型/端口策略/打包分发）见 `docs/design/50-desktop.md`。
