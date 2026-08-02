# 技术架构与分包方案

## 技术栈全景

| 层 | 技术选型 | 理由 |
|---|---------|------|
| **包管理** | pnpm workspace (monorepo) | 多包共享，依赖隔离，构建解耦 |
| **运行时** | Node ≥ 22.12，**全仓 ESM** | nanoid v5 ESM-only 消费、`require(esm)` 默认开启；避免 CJS/ESM 混合坑 |
| **语言** | TypeScript (strict mode) | 全栈统一类型，减少运行时错误 |
| **API 服务端** | Hono 4 + `@hono/node-server` | 轻量、TypeScript 友好、SSE 原生支持 |
| **数据库** | better-sqlite3 ^13 (WAL mode) | N-API 重写（v13），全局安装无 ABI 失配；同步 API 简单可靠，零配置，内嵌 |
| **前端框架** | React 19 | 生态成熟，组件化 |
| **前端构建** | Vite 7 | 快速 HMR，Tree-shaking（Vite 6 已停止常规维护） |
| **状态管理** | Zustand 5 | 轻量、TypeScript 优秀、selector 自动优化 |
| **样式** | Tailwind CSS 4 + shadcn/ui | 原子化 CSS 灵活度 + 组件开箱即用（v4 CSS-first 配置，无 tailwind.config.js） |
| **AI 调用** | 原生 fetch → DeepSeek API（模型名可配置，默认 `deepseek-v4-flash`） | 零依赖，直接控制工具循环 |
| **Schema 验证** | Zod 4 | 运行时类型安全，API 入参校验（v4 API，注意迁移破坏项） |
| **路由** | 轻量 hash-based（自制 `useHashRoute`） | 单页桌面应用不需要 React Router |

## 分包方案

采用 pnpm monorepo，七个包，按职责粒度拆分：

```
ai-editor/
├── pnpm-workspace.yaml           # 含 allowBuilds: { better-sqlite3: true }（pnpm 11+ 构建批准）
├── package.json                   # 根：dev 脚本、lint、typecheck（"type": "module"）
├── tsconfig.base.json             # 公共 TS 配置（ESM: module/moduleResolution 统一）
│
├── packages/
│   ├── shared/                    # @ai-editor/shared（前后端共享层，零 Node 依赖）
│   │   ├── src/
│   │   │   ├── types/             # 数据类型（纯 TS 类型 + Zod schema）
│   │   │   │   ├── entity.ts      # Entity / Relation / Delta
│   │   │   │   ├── outline.ts     # 大纲树
│   │   │   │   ├── project.ts     # 项目配置
│   │   │   │   ├── tool.ts        # 工具参数 schema
│   │   │   │   ├── chat.ts        # 对话消息
│   │   │   │   └── api.ts         # API 请求/响应契约（前后端共享）
│   │   │   ├── constants/         # 常量定义
│   │   │   │   ├── entity.ts      # entity 类型枚举、关系类型列表
│   │   │   │   ├── hook.ts        # 伏笔状态/分类/节奏常量
│   │   │   │   └── tool.ts        # 工具权限级别、工具名常量
│   │   │   └── utils/             # 纯工具函数（无 Node API）
│   │   │       ├── id.ts          # ID 生成（nanoid）
│   │   │       ├── validate.ts    # Zod 校验辅助
│   │   │       └── format.ts      # 文本格式化
│   │   ├── package.json           # deps: zod, nanoid（无 Node 内置模块）
│   │   └── tsconfig.json
│   │
│   ├── llm/                       # @ai-editor/llm（模型接入层）
│   │   ├── src/
│   │   │   ├── client.ts          # LLMClient 类（fetch → DeepSeek API）
│   │   │   ├── retry.ts           # 重试/退避逻辑
│   │   │   ├── token.ts           # Token 估算
│   │   │   └── types.ts           # LLM 请求/响应类型
│   │   ├── package.json           # deps: @ai-editor/shared
│   │   └── tsconfig.json
│   │
│   ├── db/                        # @ai-editor/db（数据库层）
│   │   ├── src/
│   │   │   ├── schema.ts          # 建表 SQL + migration
│   │   │   ├── connection.ts      # Database 类（连接/事务/WAL）
│   │   │   └── queries/           # 查询函数
│   │   │       ├── entity.ts      # 实体 CRUD
│   │   │       ├── relation.ts    # 关系查询
│   │   │       ├── delta.ts       # Delta 增删查
│   │   │       ├── outline.ts     # 大纲操作
│   │   │       └── project.ts     # 项目配置
│   │   ├── package.json           # deps: @ai-editor/shared, better-sqlite3
│   │   └── tsconfig.json
│   │
│   ├── tools/                     # @ai-editor/tools（工具定义 + 执行器）
│   │   ├── src/
│   │   │   ├── registry.ts        # 工具注册表（所有工具列表）
│   │   │   ├── query/             # 查询类工具（自动权限）
│   │   │   │   ├── entity.ts      # get_entity, search_entities
│   │   │   │   ├── relation.ts    # query_relationships
│   │   │   │   ├── outline.ts     # get_outline, get_outline_path
│   │   │   │   └── delta.ts       # compute_state, get_delta_history
│   │   │   ├── analysis/          # 分析类工具（自动权限）
│   │   │   │   ├── consistency.ts # analyze_consistency
│   │   │   │   ├── conflict.ts    # detect_conflicts
│   │   │   │   ├── path.ts        # trace_plot_paths
│   │   │   │   ├── hook.ts        # analyze_hook_health, trace_hook_lifecycle
│   │   │   │   └── orphan.ts      # find_orphan_elements
│   │   │   ├── proposal/          # 提案类工具（确认权限）
│   │   │   │   ├── entity.ts      # propose_create/update/delete_entity
│   │   │   │   ├── relation.ts    # propose_add/remove_relation
│   │   │   │   ├── delta.ts       # propose_add_delta
│   │   │   │   ├── outline.ts     # propose_outline/move/delete_node
│   │   │   │   └── hook.ts        # propose_create/advance/resolve_hook
│   │   │   └── executor/          # 执行类工具（不暴露给 LLM）
│   │   │       ├── entity.ts      # create/update/delete_entity
│   │   │       ├── relation.ts    # add/remove_relation
│   │   │       ├── delta.ts       # add_delta
│   │   │       ├── outline.ts     # create/move/delete_outline_node
│   │   │       └── hook.ts        # advance/resolve_hook
│   │   ├── package.json           # deps: @ai-editor/shared, @ai-editor/db
│   │   └── tsconfig.json
│   │
│   ├── agent/                     # @ai-editor/agent（AI 对话循环）
│   │   ├── src/
│   │   │   ├── session.ts         # 对话会话管理（历史/缓存/转录）
│   │   │   ├── context.ts         # 上下文组装（聚焦上下文 + 工具注入）
│   │   │   ├── run.ts             # runAgent() 主循环
│   │   │   └── executor.ts        # 工具调度器（收到 LLM tool_call → 执行）
│   │   ├── package.json           # deps: @ai-editor/shared, @ai-editor/llm, @ai-editor/tools
│   │   └── tsconfig.json
│   │
│   ├── server/                    # @ai-editor/server（Hono API）
│   │   ├── src/
│   │   │   ├── index.ts           # startServer(projectRoot, port)
│   │   │   ├── routes/
│   │   │   │   ├── entity.ts      # 实体 CRUD 路由
│   │   │   │   ├── relation.ts    # 关系管理路由
│   │   │   │   ├── delta.ts       # Delta 路由
│   │   │   │   ├── outline.ts     # 大纲操作路由
│   │   │   │   ├── chat.ts        # AI 对话（SSE 流式响应）
│   │   │   │   └── project.ts     # 项目配置路由
│   │   │   └── middleware/
│   │   │       ├── project.ts     # 项目路径注入
│   │   │       └── error.ts       # 统一错误处理
│   │   ├── package.json           # deps: @ai-editor/shared, @ai-editor/db, @ai-editor/agent, hono
│   │   └── tsconfig.json
│   │
│   └── client/                    # @ai-editor/client（React SPA）
│       ├── src/
│       │   ├── main.tsx
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx
│       │   │   ├── Outline.tsx
│       │   │   ├── Canvas.tsx
│       │   │   ├── EntityList.tsx
│       │   │   ├── EntityDetail.tsx
│       │   │   ├── Chat.tsx
│       │   │   ├── HookPanel.tsx
│       │   │   └── Settings.tsx
│       │   ├── components/
│       │   │   ├── ui/            # shadcn 基础组件
│       │   │   ├── entity/
│       │   │   ├── outline/
│       │   │   ├── canvas/        # 画布（拖拽/连线）
│       │   │   ├── chat/
│       │   │   └── hook/
│       │   ├── stores/            # Zustand
│       │   │   ├── chat.ts
│       │   │   ├── project.ts
│       │   │   └── ui.ts
│       │   ├── hooks/
│       │   │   ├── use-api.ts
│       │   │   ├── use-sse.ts
│       │   │   └── use-route.ts
│       │   └── lib/
│       │       └── api.ts
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── .gitignore
└── tsconfig.base.json
```

## 包依赖链

```
shared（纯类型 + 常量 + 工具函数，零 Node 依赖）
  │   可被 client 安全引用（tree-shake 掉未用代码）
  │
  ├── llm（AI 模型接入）
  │     └── client.ts → 封装 fetch → DeepSeek API
  │
  ├── db（数据库操作）
  │     └── queries/ → better-sqlite3
  │
  ├── tools（工具定义 + 执行器）
  │     ├── query/ → 直接调 db
  │     ├── analysis/ → 调 db + 业务逻辑
  │     ├── proposal/ → 返回提案对象，不执行
  │     └── executor/ → 调 db（用户确认后调用）
  │
  ├── agent（AI 对话循环）
  │     ├── session → 管理对话历史
  │     ├── context → 组装 Prompt + 工具列表
  │     ├── run → 循环: 发消息 → 收 tool_call → 调 tools → 继续
  │     └── executor → 收到 LLM 的 tool_call，调用 tools/query|analysis|proposal
  │
  ├── server（Hono HTTP 层）
  │     ├── routes/chat → 调用 agent/run
  │     ├── routes/* → 直接调 db（用户 GUI 操作）
  │     └── 挂载 client/dist/ 为静态文件
  │
  └── client（React SPA）
        └── 依赖 @ai-editor/shared（仅类型 + 常量，编译期消失）
            不依赖任何 Node.js 包
```

### 依赖方向

```
shared ← llm
shared ← db
shared ← tools ← db
shared ← tools ← agent ← llm
shared ← db ← server ← agent
                          server ← hono
shared ← client（仅类型/常量，零运行时）
```

### 各包依赖声明

```json
// packages/shared/package.json
{
  "name": "@ai-editor/shared",
  "dependencies": { "zod": "^4.0.0", "nanoid": "^5.1.0" }
}

// packages/llm/package.json
{
  "name": "@ai-editor/llm",
  "dependencies": { "@ai-editor/shared": "workspace:*" }
}

// packages/db/package.json
{
  "name": "@ai-editor/db",
  "dependencies": {
    "@ai-editor/shared": "workspace:*",
    "better-sqlite3": "^13.0.0"
  }
}

// packages/tools/package.json
{
  "name": "@ai-editor/tools",
  "dependencies": {
    "@ai-editor/shared": "workspace:*",
    "@ai-editor/db": "workspace:*"
  }
}

// packages/agent/package.json
{
  "name": "@ai-editor/agent",
  "dependencies": {
    "@ai-editor/shared": "workspace:*",
    "@ai-editor/llm": "workspace:*",
    "@ai-editor/tools": "workspace:*"
  }
}

// packages/server/package.json
{
  "name": "@ai-editor/server",
  "dependencies": {
    "@ai-editor/shared": "workspace:*",
    "@ai-editor/db": "workspace:*",
    "@ai-editor/agent": "workspace:*",
    "hono": "^4.7.0"
  }
}

// packages/client/package.json
{
  "name": "@ai-editor/client",
  "dependencies": {
    "@ai-editor/shared": "workspace:*",
    "react": "^19.0.0",
    "zustand": "^5.0.0"
  }
}
```

## shared 包的内容准则

`shared` 包有一条硬性约束：**不能引入任何 Node.js 内置模块或服务端专用包**。

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

原因是 client 要在浏览器中 bundle `shared` 的代码。任何 Node API 的引入都会导致 Vite 构建失败。`shared` 必须是**纯前端安全的代码**。

具体来说 `shared` 包含三类内容：

| 类别 | 内容 | 示例 |
|------|------|------|
| **类型 + Zod** | 所有数据类型的 TypeScript 定义和 Zod schema | `Entity`, `RelationRecord`, `DeltaRecord` |
| **常量** | 枚举值、工具名列表、权限级别 | `ENTITY_TYPES`, `RELATION_TYPES`, `HOOK_STATUSES` |
| **纯工具** | 不依赖 Node API 的辅助函数 | `generateId()`, `formatTiming()` |

> **校验执行边界（2026-08 修订）**：Zod 校验**仅在服务端执行**（server/db 层）；client 只消费 `shared` 的类型与常量，不打包 zod 校验函数——避免 50KB 级运行时依赖进浏览器包，「仅类型+常量、编译期消失」的承诺才成立。

## 构建与部署

```
开发态（pnpm dev）:
  packages/client:  Vite dev server (port 5173)
                      → proxy /api → Hono (port 3456)
  packages/server:  tsx watch src/index.ts (port 3456)
  packages/shared:  tsc --watch
  packages/llm:     tsc --watch
  packages/db:      tsc --watch
  packages/tools:   tsc --watch
  packages/agent:   tsc --watch
  # dev 态端口被占直接报错（不自动 +1）——Vite proxy 写死 3456，
  # 自动 +1 会造成 proxy 与实际监听不一致（与生产态行为不同，2026-08 修订）
  # 来源校验（决策 17 修订）：仅校验 host ∈ {127.0.0.1, localhost, ::1}，不校验端口；
  # Vite proxy 无需 changeOrigin（转发后 Origin/Host 端口为 5173，不影响校验）

发布态（pnpm build）:
  pnpm -r build  # 按依赖顺序自动构建
    → shared → llm → db → tools → agent → server
    → client（vite build，独立）

打包发布（2026-08 实测，backlog #8 演练）:
  借鉴 @actalk/inkos 的发布机制（scripts/prepare-package-for-publish.mjs + restore-package-json.mjs）:
    pnpm --filter @ai-editor/<pkg> pack --pack-destination <目录>
      → prepack 钩子：copy-client-dist（SPA 进包）→ workspace:* 替换为真实版本号
      → postpack 钩子：恢复原 package.json
    6 个可发布包（shared/llm/db/tools/agent/server）统一挂 prepack/postpack；
    server 包 bin: {"ai-editor": "dist/index.js"}，tarball 含 dist/ + client-dist/（SPA）
  安装（未发布 registry 也能装——npm 对同批 tarball 复用依赖）:
    npm install <server.tgz + 依赖 tgz>
  运行: npx ai-editor <项目目录> → 服务 + 自动打开浏览器界面（SPA 随包）

启动流程（Node ≥ 22.12，产物为全仓 ESM）:
  node packages/server/dist/index.js [projectRoot]
    → 参数: projectRoot（缺省 process.cwd()）
    → detectProject：有 project.json → 打开；无 → 待命（不初始化，前端引导 create/open，
      2026-08 修订——原「不存在则初始化」改为待命，避免空目录被替用户决定初始化/污染代码包）
    → 启动 Hono (port 3456，占用时生产态自动 +1；AI_EDITOR_PORT 可覆盖)
    → 加载 SPA（defaultClientDist 双路径：monorepo 开发态 ../../client/dist /
      打包安装态 ../client-dist——随 tarball 携带）为 SPA fallback
    → 打开浏览器（127.0.0.1，决策 8）
  测试项目目录: test-project/（借鉴 inkos test-project 模式，运行时数据不入库，见其 README）
```

## 为什么拆七包

**核心原则：每个包只有一种理由变更。**

| 包 | 变更理由 | 可独立复用 |
|----|---------|-----------|
| `shared` | 数据结构/常量变更 | ✅ 任何需要类型定义的项目 |
| `llm` | 模型/API 变更 | ✅ 任何需要调 DeepSeek 的项目 |
| `db` | 数据库/查询变更 | ❌ 紧耦合 shared |
| `tools` | 工具定义/逻辑变更 | ❌ 紧耦合 db + shared |
| `agent` | AI 交互逻辑变更 | ❌ 紧耦合 llm + tools |
| `server` | HTTP/路由变更 | ❌ 应用层 |
| `client` | UI 变更 | ✅ 纯浏览器端，可换框架 |

`llm` 和 `agent` 分离是关键的——`llm` 只关心"怎么调模型"，`agent` 关心"怎么组织对话"。如果以后换模型供应商，只改 `llm`；如果改对话策略（比如加多轮记忆压缩），只改 `agent`。
