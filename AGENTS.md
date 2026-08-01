# AGENTS.md

## 项目状态

- 目前**只有设计文档，没有任何代码**：不存在 package.json、pnpm-workspace.yaml、tsconfig 等文件。
- 一切实现工作必须按 `doc/design/architecture.md` 的分包方案从零脚手架搭建，不得擅自改变包划分或依赖方向。

## 文档即契约

实现任何功能前先读对应文档，它们是单一事实来源：

| 目录 | 内容 | 何时读 |
|------|------|--------|
| `doc/design/` | `product.md` 产品定位、`architecture.md` 架构与分包、`decisions.md` 关键决策 1-18、`backlog.md` 迭代优化清单（MVP 不做） | 任何改动前 |
| `doc/api/` | `endpoints.md` 端点契约、`tools.md` AI 工具目录、`data-flow.md` 数据流 | 前后端改动 |
| `doc/database/` | `schema.md` 表结构、`hooks.md` 伏笔系统 | 数据/后端改动 |
| `doc/ui/` | UI 原型（目录尚不存在，规划中） | 前端改动 |

## 易踩坑的架构约束

- pnpm monorepo，7 个包：`shared → llm/db/tools → agent → server`，`client` 只依赖 `shared`。
- **`shared` 硬约束**：禁止任何 Node.js 内置模块或服务端包（只允许 zod / nanoid / 纯 TS）。client 会在浏览器打包它，违反即 Vite 构建失败。
- 存储双轨：**大纲树存 JSON（`outline.json`），实体/关系/Delta 存 SQLite（`data.db`）**，不要试图统一。对话历史存 `chat_messages` 表（同库，决策 18）。
- 关系用**一张通用表** `relation_records`（含 `plot_edge` 剧情连线），不要按实体类型分表。**Delta 不在此表**——独立存 `delta_records`，`attribute_change` 类型已废弃（决策 3，2026-08 修订）。
- 状态计算 `computeState` **只沿大纲树父链累积已确认 Delta**；`plot_edge` 连线不参与；游离节点仅累积直接挂载的 Delta（决策 9）。
- 删除走**软删 + 回收站**：实体/关系/Delta 标 `deleted_at`、节点标 `deleted`，**级联一并软删**（purge 才物理清除），常规查询默认过滤，restore 级联还原；还原/清理走 `/api/v1/trash/*`（决策 12）。
- 画布节点坐标/缩放存**浏览器 localStorage**（纯展示层，不进数据文件，决策 10）。
- `outline.json` 保存必须**原子写**（临时文件 + fsync + rename），禁止直接覆盖（决策 11）。
- 大纲树与画布是**同一数据的两种投影**（节点即大纲），不是需同步的两份数据。
- AI 是创作顾问**不生成正文**；AI 工具按风险分三级权限（自动 / 提案确认 / 二次确认），写操作必须走提案；**提案仅存内存**，确认时服务端重新校验引用（存在性 + updated_at 快照比对），失败返回 409 `PROPOSAL_STALE`（决策 14）。
- agent 循环有硬性终止：max 8 轮 / 单轮 120s / token 预算（工具结果也有 token 上限）；SSE 断开即全链路取消；跨 data.db / outline.json 的写操作**先 DB 后 JSON**，不一致由 `find_orphan_elements` 兜底（决策 15/16）。
- 服务默认绑定 `127.0.0.1`，**全部请求**（含读）校验 Origin/Host；DeepSeek key 走环境变量或用户级配置（`~/.ai-editor/config.json`），**不入项目文件**；端口占用自动 +1 并打开实际端口；打开浏览器/提示 URL 一律用 `127.0.0.1` 而非 `localhost`（IPv6 优先系统上 localhost 可能解析为 `::1` 导致连接被拒）（决策 17/8）。
- schema 演进 MVP 用**删库重建**（`PRAGMA user_version` 为准判定，`schema_version` 管 JSON，重建时同步重置 outline.json 并备份 .bak），无迁移脚本；首次发布前必须复审此策略（决策 13）。
- 部署：单命令 `ai-editor`，单进程 Hono `:3456` 同时服务 `/api/v1` 与 SPA 静态文件；dev 态 Vite `:5173` 通过 proxy 转发 `/api` 到 `:3456`。

## 约定

- 文档与提交信息用中文；commit 遵循 conventional commits（如 `feat(doc): ...`）。
- 所有 API 请求/响应契约集中在 `@ai-editor/shared` 的 `types/api.ts`（Zod schema），前后端共用，不要各自定义。
- 对话历史 / 上下文走分层策略（系统指令 → 聚焦上下文 → 工具按需扩展 → 滑动窗口历史），不要把整个世界塞进 prompt。
- 延期项（多标签页并发、导出/导入、undo、token 统计等）见 `doc/design/backlog.md`，MVP 不做，不要顺手实现。
