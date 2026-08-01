# AGENTS.md

## 项目状态

- 目前**只有设计文档，没有任何代码**：不存在 package.json、pnpm-workspace.yaml、tsconfig 等文件。
- 一切实现工作必须按 `doc/design/architecture.md` 的分包方案从零脚手架搭建，不得擅自改变包划分或依赖方向。

## 文档即契约

实现任何功能前先读对应文档，它们是单一事实来源：

| 目录 | 内容 | 何时读 |
|------|------|--------|
| `doc/design/` | `product.md` 产品定位、`architecture.md` 架构与分包、`decisions.md` 关键决策 1-21、`backlog.md` 迭代优化清单（MVP 不做） | 任何改动前 |
| `doc/api/` | `endpoints.md` 端点契约、`tools.md` AI 工具目录、`data-flow.md` 数据流 | 前后端改动 |
| `doc/database/` | `schema.md` 表结构与 outline.json/project.json 契约、`hooks.md` 伏笔系统与健康指标 | 数据/后端改动 |
| `doc/ui/` | UI 原型（目录尚不存在，规划中） | 前端改动 |

阅读顺序（见 `doc/README.md`）：`design/product.md` → `design/architecture.md` → `design/decisions.md`（决策 9-19 是数据模型与安全基线，20/21 为 SSE 断开检测与伏笔健康指标）→ 按职责读 `api/` 与 `database/`。

## 易踩坑的架构约束

- pnpm monorepo，7 个包：`shared → llm/db/tools → agent → server`，`client` 只依赖 `shared`。
- **`shared` 硬约束**：禁止任何 Node.js 内置模块或服务端包（只允许 zod / nanoid / 纯 TS）。client 会在浏览器打包它，违反即 Vite 构建失败。**Zod 校验仅在服务端执行**——client 只消费 shared 的类型与常量，不打包校验函数（避免 50KB 级依赖进浏览器包）。
- 存储**三个数据文件**，不要试图统一：`outline.json`（大纲树 JSON）、`data.db`（实体/关系/Delta/对话历史 `chat_messages` 表，决策 18 含 `tool_call_id`/`project_id` 列）、`project.json`（项目配置：id/name/language/prompt/`schema_version`/`current_position`，决策 8/21；写入与 outline.json 同款原子写，**DeepSeek key 绝不写入**）。
- 大纲**严格三层**（卷→章→场景），**无游离节点**：创建必须显式指定 parent_id，scene 只能挂 chapter（决策 19）；outline.json 无 `orphan_nodes` 字段，节点带 `updated_at` 版本戳、顶层带 `schema_version`。
- 关系用**一张通用表** `relation_records`（含 `plot_edge` 剧情连线），不要按实体类型分表。**Delta 不在此表**——独立存 `delta_records`，`attribute_change` 类型已废弃（决策 3，2026-08 修订）。
- 状态计算 `computeState` **只沿大纲树父链累积已确认 Delta**：节点间按树路径序、节点内按 `order` 双层排序；`plot_edge` 连线不参与；`op=update` 校验 from 失败**跳过该 change 并在 `conflicts` 中标注**（不返回 409——手动编辑 data 不产生 Delta 属正常行为，决策 9 修订）。
- 删除走**软删 + 回收站**：实体/关系/Delta 标 `deleted_at`、节点标 `deleted`，**级联一并软删**（purge 才物理清除），常规查询默认过滤，restore 级联还原；还原/清理走 `/api/v1/trash/*`。**手动删关系 = 物理删**（不进回收站）；关系可见性联动端点状态（任一端点软删即不可见）；restore 大纲节点校验祖先链——存在软删祖先返回 409 `OUTLINE_ANCESTOR_DELETED`；Delta 可见性同规则联动触发节点/目标实体（任一端软删，computeState 与常规查询均不可见）（决策 12 修订）。
- 伏笔系统（决策 21）：**健康指标 `_health` 仅运行时计算，作为响应附加字段返回，绝不写回 data**；`plants`/`advances`/`resolves` 关系**不存 chapter 元数据**——章节序由服务端基于 source_id 从大纲树查询时现推（节点 move 后不陈旧）；「当前章节」= project.json 的 `current_position`；`ready_to_resolve` 依据 hook 的 `expected_resolve_node_id`（未设置返回未计算，不猜测）。
- 画布节点坐标/缩放存**浏览器 localStorage**（纯展示层，不进数据文件，决策 10）。
- 前端技术栈已定（architecture.md）：React 19 + Zustand 5 + Tailwind 4 + shadcn/ui；路由用自制 hash 路由（`useHashRoute`），**不要引入 React Router**。
- `outline.json` 保存必须**原子写**（临时文件 + fsync + rename），禁止直接覆盖（决策 11）。
- 大纲树与画布是**同一数据的两种投影**（节点即大纲），不是需同步的两份数据。
- AI 是创作顾问**不生成正文**；AI 工具按风险分**两级权限**（自动 / 提案确认），写操作必须走提案；**提案仅存内存**（TTL 10 分钟 + 条数上限），确认时服务端重新校验引用（存在性 + updated_at 快照比对，大纲节点用节点级 `updated_at`），失败返回 409 `PROPOSAL_STALE`，proposal_id 不存在返回 404 `PROPOSAL_NOT_FOUND`（决策 14/19）。
- agent 循环有硬性终止：max 8 轮 / 单轮 120s / token 预算（工具结果也有 token 上限）；SSE 断开即全链路取消——**心跳（15-30s ping）+ 三路断开检测**（onAbort + req close/error + 心跳写失败，决策 20）；心跳对 **TCP 半开连接**（客户端断电）无法即时感知，客户端需自身超时兜底（60s 无任何事件即提示断开）；跨 data.db / outline.json 的写操作**先 DB 后 JSON**，不一致由**启动一致性校验**兜底补标（决策 16 修订）。
- `/api/v1/chat` 是 **POST + SSE**：浏览器原生 `EventSource` 只支持 GET，客户端必须用 `fetch` + `ReadableStream` 自写 SSE 解析（`client/src/hooks/use-sse.ts`），处理跨 chunk 的 `data:` 行拼接与注释行。
- 服务默认绑定 `127.0.0.1`，**全部请求**（含读）校验来源：仅校验 host ∈ {127.0.0.1, localhost, ::1}（**不校验端口**——端口自动 +1 与 dev proxy 依赖此规则，决策 17 修订）；DeepSeek key 走环境变量或用户级配置（`~/.ai-editor/config.json`），**不入项目文件**；生产态端口占用自动 +1 并打开实际端口（**dev 态被占直接报错**，Vite proxy 写死 3456）；打开浏览器/提示 URL 一律用 `127.0.0.1` 而非 `localhost`（IPv6 优先系统上 localhost 可能解析为 `::1` 导致连接被拒）（决策 8）。
- 运行环境（2026-08 修订，以 architecture.md 版本声明为准）：Node ≥ 22.12、**全仓 ESM**；better-sqlite3 `^13`（N-API 重写，全局安装无 ABI 失配）、zod `^4`、Vite 7、Hono 4；pnpm-workspace.yaml 需配 `onlyBuiltDependencies: [better-sqlite3]`（pnpm 10 构建批准）。
- schema 演进 MVP 用**删库重建**（`PRAGMA user_version` 为准判定，`schema_version` 管 JSON，重建时同步重置 outline.json 并备份 `.bak`，**data.db 也备份 `.bak`**），无迁移脚本；首次发布前必须复审此策略（决策 13）。
- 部署：单命令 `ai-editor`，单进程 Hono `:3456` 同时服务 `/api/v1` 与 SPA 静态文件；dev 态 Vite `:5173` 通过 proxy 转发 `/api` 到 `:3456`。命令约定（architecture.md）：根 `pnpm dev` = client Vite `:5173` + server `tsx watch :3456` + 各库 `tsc --watch`；`pnpm -r build` 按依赖序构建（shared → llm → db → tools → agent → server → client）。

## 约定

- 文档与提交信息用中文；commit 遵循 conventional commits（如 `feat(doc): ...`）。
- 所有 API 请求/响应契约集中在 `@ai-editor/shared` 的 `types/api.ts`（Zod schema），前后端共用，不要各自定义；错误码统一 `ErrorCode` 枚举（REST/SSE/工具共用）。
- 对话历史 / 上下文走分层策略（系统指令 → 聚焦上下文 → 工具按需扩展 → 滑动窗口历史），不要把整个世界塞进 prompt。续聊重建与裁剪按 `assistant.tool_calls[].id` ↔ `tool.tool_call_id` **成对重组、同裁同留**，孤儿半对整对丢弃（DeepSeek 要求严格配对，缺一即拒，决策 18）。
- API 命名：请求体/查询参数 **snake_case**，响应体 **camelCase**，outline.json 内部字段 snake_case；文件字段 ↔ API 字段的映射函数定义于 `@ai-editor/shared/utils`。id 前缀：`char-`/`set-`/`loc-`/`hook-`、`sc-`/`ch-`/`vol-`、`proj-`，运行时对象 `prop_`/`sess_`/`call_`（文档示例的 `char-9` 是形状示意，**非自增序号**）。
- 时间约定：所有时间列/字段统一 ISO 8601 字符串、**由应用层写入**，不用 SQLite `datetime('now')`——回收站按 `deleted_at` 排序跨 SQLite 与 outline.json，格式必须统一。
- 延期项（多标签页并发、导出/导入、undo、token 统计等）见 `doc/design/backlog.md`，MVP 不做，不要顺手实现。
