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
| **AI 运行时** | `@earendil-works/pi-coding-agent` `0.85.1`（**exact pin**，含 `pi-ai` 模型层 / `pi-agent-core` 循环 / `pi-tui`） | 传输、流式、usage、重试、压缩、工具派发、会话文件格式全部由 pi 接管；本仓只提供领域工具、系统提示词、事件映射与 HTTP/SSE 契约 |
| **工具参数 schema** | TypeBox（经 `pi-ai` 重导出 `Type`/`Static`） | schema 运行时即 JSON Schema：一份定义同时给模型（tool parameters）、给 TS（`Static<>`）、给校验（pi `validateToolArguments`）；不做 zod→JSON Schema 转换 |
| **前端框架** | React 19 | 生态成熟，组件化 |
| **前端构建** | Vite 7 | 快速 HMR，Tree-shaking |
| **状态管理** | Zustand 5 | 轻量、TypeScript 优秀、selector 自动优化 |
| **前端组件基座** | antd v6（ConfigProvider zhCN + 双主题 algorithm + **Notion 工作区暖灰 token 覆盖**）+ `@ant-design/icons`（**全站唯一图标集**）；会话场景 `@ant-design/x`（Bubble/Sender/Thought）+ `@ant-design/x-markdown` | 成熟组件红利统一视觉与交互；主题 = antd token 派发（**视觉契约见 `docs/ui/DESIGN.md`**）；颜色一律经 antd token，禁止硬编码色值/色类 |
| **样式** | Tailwind CSS 4（**仅布局 utility，不含颜色**）+ `docs/ui/DESIGN.md` 视觉契约 + `design-discipline.test.ts` 源码扫描 | v4 CSS-first 配置；**antd 样式是运行时无层 CSS，会静默压掉 Tailwind 工具类**——antd 组件根元素上不挂 `w-/h-/px-/py-/justify-/rounded-/text-*` |
| **Schema 验证** | Zod 4 | 运行时类型安全，**仅 API 入参**（工具参数改用 TypeBox） |
| **路由** | 轻量 hash-based（自制 `useHashRoute`） | 单页桌面应用不需要 React Router；路由一级化（见 `ui/DESIGN.md`） |

## AI 运行时（pi 嵌入形态）

嵌入方式与 pi-web 同款：单进程内构建 `ModelRuntime` + `SessionManager` + `AgentSession`，不经 CLI/RPC 子进程。

| 能力 | 由谁提供 | 本仓的接入点 |
|---|---|---|
| 模型目录 / provider 目录 / 认证状态 | `ModelRuntime`（静态内置目录 + `~/.pi/agent/models.json` 覆盖 + 远端 catalog overlay + credential store） | 设置页读写；激活模型查询 |
| 凭据 | pi credential store（`~/.pi/agent/auth.json`，env 优先） | 设置页写 key（不再有自建 key 解析链） |
| 会话文件（v3 树状 JSONL、含 thinking/压缩/model_change 等 entry） | `SessionManager` | 会话目录 = `<项目目录>/sessions/`；列表/读取/删除/续聊 |
| 对话循环 / 工具派发 / 取消 / steering | `pi-agent-core` Agent（`AgentSession` 包装） | `AgentSession.prompt()` + 事件订阅 |
| 重试 / 上下文压缩 | pi auto-retry + auto-compaction | 参数走 pi settings，不在本仓 |
| 系统提示词 / AGENTS.md 注入 | pi resource loader | 内核提示词 + `agentsFilesOverride`（只读项目根 AGENTS.md，见 `20-context.md`） |
| 领域工具（实体/关系/大纲/伏笔/提案） | 本仓 `tools` 包（TypeBox `AgentTool`） | 装配进 AgentSession |

**显式不启用**：pi 的编码工具（read/bash/edit/write/…）、扩展加载（`noExtensions`）、技能与提示词模板（`noSkills`/`noPromptTemplates`）、项目信任门、TUI 交互模式。理由：本项目是创作顾问，不是编码 agent；项目目录内的可执行扩展是安全面而非能力面。

**版本纪律**：`@earendil-works/*` 一律 exact pin（上游 pi 自身也用 `check-pinned-deps` 强制精确版本）。升级 = 显式 commit 齐抬版本 + 全量测试——本仓依赖的是 pi 的内部形态（事件名、session v3 格式、loader options），不是稳定公共契约语义。

## 分包方案

五个发布包 + 一个私有前端包：

```
packages/
├── shared    # 前后端共享层：纯 TS 类型 + Zod（API schema）+ 常量 + 纯函数（零 Node 依赖）
├── db        # 存储层：连接/事务/WAL、schema 版本三态分流、增量迁移、drizzle 查询、项目目录文件存储（参考资料、原子写）
├── tools     # 领域工具层：TypeBox 工具定义 + 查询/分析实现 + 提案仓 + 确认后执行的写操作
├── agent     # AI 运行时层：pi 嵌入装配（ModelRuntime/SessionManager/AgentSession）、系统提示词、事件→SSE 帧映射
├── server    # Hono API 层：REST 路由 + SSE 流 + 静态 SPA 托管（顶层装配包）
└── client    # React SPA（private，不发布）：页面、组件（antd v6 + @ant-design/x）、store、hooks、lib
```

| 包 | 职责边界 | 对外契约 |
|----|---------|---------|
| `shared` | 数据结构/类型/常量/纯工具（无 Node API）；**不持有业务逻辑** | `types/api.ts` Zod schema = API 请求/响应契约单一来源 |
| `db` | 存储语义：表/查询/迁移/软删级联/状态计算 + 项目目录文件存储（参考资料、原子写） | `(db: Db)` 签名查询函数；`SCHEMA_VERSION` 与迁移目录；事务辅助 |
| `tools` | 把模型意图映射到写操作：查询/分析工具（自动执行）+ 提案工具（确认后执行）；读写经 db | 工具定义（TypeBox schema + 权限级别）、提案仓、执行器 |
| `agent` | pi 运行时装配：模型/凭据/会话/循环接入、系统提示词、事件映射、工具注册 | `AgentSession` 生命周期 API 与事件流；写操作一律走工具提案 |
| `server` | HTTP/路由/请求校验/项目生命周期（书架）/自动备份/静态托管 | `/api/v1` REST + `POST /chat` SSE（契约见 shared schema + api 文档） |
| `client` | UI：页面、组件、状态、hash 路由；只消费 shared 类型/常量（编译期消失） | 无对外 API |

**约束要点**：

- 依赖只许沿 `shared → db → tools → agent → server`，`client → shared`（仅类型+常量）；禁止反向或旁路依赖。
- **前端页面组织与后端 API 路由完全解耦**：API 按数据对象类型划分，页面形状/导航层级/hash 路由名变更只动 client。
- **Zod 校验仅在服务端执行**——client 不打包校验函数（避免 50KB 级依赖进浏览器包）。
- server 是**顶层装配包**：依赖任一下层方向均合规、无环。

## 包依赖链与方向

```
shared（纯类型/常量/工具，零 Node 依赖，可被 client 安全 tree-shake）
  ├── db      ← better-sqlite3 + drizzle-orm
  ├── tools   ← db（查询/分析直连 db；提案仅返回对象不执行；executor 确认后执行）
  ├── agent   ← pi-coding-agent（模型/循环/会话）+ tools（工具注册）
  ├── server  ← db（GUI 直接读写）+ agent（chat 流）+ tools（提案执行）
  └── client  ← shared（仅类型/常量）
```

依赖方向图：`shared ← db ← tools ← agent ← server`；`client ← shared`（编译期消失，零运行时依赖）。

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
    "@earendil-works/pi-ai": "0.85.1"        // Type/Static（TypeBox 经 pi-ai 重导出，不单独装 typebox）
  }
}

// packages/agent/package.json
{
  "name": "@whispering233/ai-editor-agent",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@whispering233/ai-editor-tools": "workspace:*",
    "@earendil-works/pi-coding-agent": "0.85.1",   // 含 pi-ai / pi-agent-core / pi-tui（exact pin）
    "@earendil-works/pi-ai": "0.85.1"
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
    "hono": "^4.7.0"
  }
}

// packages/client/package.json（private）
{
  "name": "@whispering233/ai-editor-client",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "react": "^19.0.0",
    "antd": "^6.6.2",
    "@ant-design/x": "^2.9.0",
    "zustand": "^5.0.0"
  }
}
```

## 为什么拆六包

**核心原则：每个包只有一种理由变更。**

| 包 | 变更理由 | 可独立复用 |
|----|---------|-----------|
| `shared` | 数据结构/常量变更 | ✅ 任何需要类型定义的项目 |
| `db` | 数据库/查询变更 | ❌ 紧耦合 shared |
| `tools` | 工具定义/领域分析变更 | ❌ 紧耦合 db + shared |
| `agent` | pi 集成/提示词/事件协议变更 | ❌ 紧耦合 pi + tools |
| `server` | HTTP/路由变更 | ❌ 应用层 |
| `client` | UI 变更 | ✅ 纯浏览器端，可换框架 |

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

本地开发、构建、打包发布、启动流程（端口/绑定/创作根/书架/调试）见 `docs/design/build.md`；配置载体与读写边界见 `docs/design/config.md`。
