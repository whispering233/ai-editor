# 技术架构与分包方案

## 技术栈全景

| 层 | 技术选型 | 理由 |
|---|---------|------|
| **包管理** | pnpm workspace (monorepo) | 多包共享，依赖隔离，构建解耦 |
| **运行时** | Node ≥ 22.12，**全仓 ESM** | nanoid v5 ESM-only 消费、`require(esm)` 默认开启；避免 CJS/ESM 混合坑 |
| **语言** | TypeScript (strict mode) | 全栈统一类型，减少运行时错误 |
| **API 服务端** | Hono 4 + `@hono/node-server` | 轻量、TypeScript 友好、SSE 原生支持 |
| **数据库** | better-sqlite3 ^13 (WAL mode) + drizzle-orm | N-API 重写（v13），全局安装无 ABI 失配；同步 API 简单可靠，零配置，内嵌；drizzle-orm 查询构建层（查询构建+行类型推断，不引入 drizzle-kit，迁移/事务/JSON 防御语义不变） |
| **前端框架** | React 19 | 生态成熟，组件化 |
| **前端构建** | Vite 7 | 快速 HMR，Tree-shaking（Vite 6 已停止常规维护） |
| **状态管理** | Zustand 5 | 轻量、TypeScript 优秀、selector 自动优化 |
| **样式** | Tailwind CSS 4 + shadcn/ui + Prettier（prettier-plugin-tailwindcss） | 原子化 CSS 灵活度 + 组件开箱即用（v4 CSS-first 配置，无 tailwind.config.js）；主题 tokens 与共享样式常量见 client 包 `index.css`/样式常量模块，组件一律 token 类禁硬编码色类；样式细节规范不重复入文档（ui/layout.md 只承载布局） |
| **AI 调用** | `@earendil-works/pi-ai`（统一多提供商 LLM 接口；批次十六起注册 deepseek + opencode-go 两 provider，模型名/思考强度可配置，key 按 provider 独立解析） | 传输/SSE/usage 解析由 pi-ai 接管，llm 包单向 adapter 保留对外契约；注册/解析细节见 llm 包与 config.md |
| **Schema 验证** | Zod 4 | 运行时类型安全，API 入参校验（v4 API，注意迁移破坏项） |
| **路由** | 轻量 hash-based（自制 `useHashRoute`） | 单页桌面应用不需要 React Router |

## 分包方案

七个包，按职责粒度拆分，**分包只到包级**——包内文件/模块结构以各包代码为事实源，不在架构文档中列举（代码文件不是契约面，文档级列举只会制造耦合点）：

```
packages/
├── shared    # 前后端共享层：纯 TS 类型 + Zod schema + 常量 + 纯函数（零 Node 依赖，client 可打包）
├── llm       # 模型接入层：pi-ai 单向 adapter 防腐，多 provider 注册/模型目录/key 解析链
├── db        # 数据库层：连接/事务/WAL、schema 版本三态分流、增量迁移、drizzle 查询层
├── tools     # AI 工具层：工具定义/注册表/执行器（查询·分析自动权限，写操作提案权限）
├── agent     # AI 对话循环：会话、上下文组装、runAgent 主循环、工具调度
├── server    # Hono API 层：REST 路由 + SSE 流 + 静态 SPA 托管（顶层装配包）
└── client    # React SPA（private，不发布）：页面、组件、store、hooks、lib
```

| 包 | 职责边界 | 对外契约 |
|----|---------|---------|
| `shared` | 数据结构/类型/常量/纯工具（无 Node API）；**不持有业务逻辑** | `types/api.ts` Zod schema = 全部 API 请求/响应契约单一来源；`types`/`constants`/`utils` 导出 |
| `llm` | 怎么调模型：协议/流式/usage/错误归一化；多 provider 注册与模型目录；**不知道工具与业务** | `chatStream` / `LLMStreamEvent` / `LLMError` / `getAvailableModels` / provider 常量 |
| `db` | 存储语义：表/查询/迁移/软删级联/状态计算 | `(db: Db)` 签名查询函数；`SCHEMA_VERSION` 与迁移目录；事务辅助 |
| `tools` | 把模型意图映射到写操作：查询/分析工具（自动执行）+ 提案工具（确认后执行）；读写经 db | 工具名/参数 schema/权限级别常量（shared）；registry 导出 |
| `agent` | 怎么组织对话：分层上下文、滑动窗口裁剪、成对重组、提案生命周期、断连取消 | `runAgent` 主循环入口与事件流；写操作一律走工具提案 |
| `server` | HTTP/路由/请求校验/项目生命周期（书架）/自动备份/静态托管 | `/api/v1` REST + `POST /chat` SSE（契约见 shared schema + api 文档） |
| `client` | UI：页面、组件、状态、hash 路由；只消费 shared 类型/常量（编译期消失） | 无对外 API |

**约束要点**：

- 依赖只许沿 `shared → llm/db → tools → agent → server`，`client → shared`（仅类型+常量）；禁止反向或旁路依赖。
- **Zod 校验仅在服务端执行**——client 不打包校验函数（避免 50KB 级依赖进浏览器包）。
- server 是**顶层装配包**：依赖任一下层方向均合规、无环。
- shared 硬约束见 §「shared 包的内容准则」。

## 包依赖链与方向

```
shared（纯类型/常量/工具，零 Node 依赖，可被 client 安全 tree-shake）
  ├── llm     ← pi-ai（多 provider）
  ├── db      ← better-sqlite3 + drizzle-orm
  ├── tools   ← db（查询/分析直连 db；提案仅返回对象不执行；executor 确认后执行）
  ├── agent   ← llm（调用模型）+ tools（调度工具）
  ├── server  ← db（GUI 直接读写）+ agent（chat 流）+ tools/llm（提案执行/直连流）
  └── client  ← shared（仅类型/常量）
```

依赖方向图：`shared ← llm/db ← tools ← agent ← server`；`client ← shared`（编译期消失，零运行时依赖）。

### 各包依赖声明

```json
// packages/shared/package.json
{
  "name": "@whispering233/ai-editor-shared",
  "dependencies": { "zod": "^4.0.0", "nanoid": "^5.1.0" }
}

// packages/llm/package.json
{
  "name": "@whispering233/ai-editor-llm",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@earendil-works/pi-ai": "^0.81.1"   // 统一多提供商 LLM 接口（可 tree-shaking 子路径注册）
  }
}

// packages/db/package.json
{
  "name": "@whispering233/ai-editor-db",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "better-sqlite3": "^13.0.0"
  }
}

// packages/tools/package.json
{
  "name": "@whispering233/ai-editor-tools",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@whispering233/ai-editor-db": "workspace:*"
  }
}

// packages/agent/package.json
{
  "name": "@whispering233/ai-editor-agent",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@whispering233/ai-editor-llm": "workspace:*",
    "@whispering233/ai-editor-tools": "workspace:*"
  }
}

// packages/server/package.json
{
  "name": "@whispering233/ai-editor-server",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "@whispering233/ai-editor-db": "workspace:*",
    "@whispering233/ai-editor-agent": "workspace:*",
    "@whispering233/ai-editor-tools": "workspace:*",
    "@whispering233/ai-editor-llm": "workspace:*",
    "hono": "^4.7.0"
  }
}

// packages/client/package.json（private）
{
  "name": "@whispering233/ai-editor-client",
  "dependencies": {
    "@whispering233/ai-editor-shared": "workspace:*",
    "react": "^19.0.0",
    "zustand": "^5.0.0"
  }
}
```

## shared 包的内容准则

`shared` 有一条硬性约束：**不能引入任何 Node.js 内置模块或服务端专用包**——client 要在浏览器中 bundle `shared` 的代码，任何 Node API 的引入都会导致 Vite 构建失败：

```typescript
// ❌ 禁止——引入 Node API
import { readFile } from "node:fs";

// ❌ 禁止——引入服务端特有包
import Database from "better-sqlite3";

// ✅ 允许——纯标准库
import { z } from "zod";
import { nanoid } from "nanoid";

// ✅ 允许——纯 TS 类型
export interface Entity { id: string; type: EntityType; name: string; }
```

`shared` 包含三类内容：

| 类别 | 内容 | 示例 |
|------|------|------|
| **类型 + Zod** | 所有数据类型的 TypeScript 定义和 Zod schema | `Entity`, `RelationRecord`, `DeltaRecord` |
| **常量** | 枚举值、工具名列表、权限级别 | `ENTITY_TYPES`, `RELATION_TYPES`, `HOOK_STATUSES` |
| **纯工具** | 不依赖 Node API 的辅助函数 | `generateId()`, `formatTiming()` |

> **校验执行边界**：Zod 校验仅在服务端执行（server/db 层）；client 只消费 `shared` 的类型与常量，不打包 zod 校验函数——避免 50KB 级运行时依赖进浏览器包，「仅类型+常量、编译期消失」的承诺才成立。

## 为什么拆七包

**核心原则：每个包只有一种理由变更。**

| 包 | 变更理由 | 可独立复用 |
|----|---------|-----------|
| `shared` | 数据结构/常量变更 | ✅ 任何需要类型定义的项目 |
| `llm` | 模型/API 变更 | ✅ 任何需要统一 LLM 接口的项目（pi-ai，多提供商） |
| `db` | 数据库/查询变更 | ❌ 紧耦合 shared |
| `tools` | 工具定义/逻辑变更 | ❌ 紧耦合 db + shared |
| `agent` | AI 交互逻辑变更 | ❌ 紧耦合 llm + tools |
| `server` | HTTP/路由变更 | ❌ 应用层 |
| `client` | UI 变更 | ✅ 纯浏览器端，可换框架 |

`llm` 和 `agent` 分离是关键——`llm` 只关心「怎么调模型」，`agent` 关心「怎么组织对话」。换模型供应商只改 `llm`；改对话策略（多轮记忆压缩等）只改 `agent`。

## 运行与部署

本地开发、构建、打包发布、启动流程（端口/绑定/创作根/书架/调试）见 `docs/design/build.md`；配置载体与读写边界见 `docs/design/config.md`；版本发布纪律见根 `AGENTS.md`。
