# 迭代优化清单（Backlog）

MVP 明确不做、延后迭代的事项。每项记录：现状、优化方案、触发条件。

| # | 事项 | 现状 | 优化方案 | 触发条件 |
|---|------|------|---------|---------|
| 1 | 多标签页并发写入 | 单进程内存 `currentProject`，双标签页后写覆盖 | 写入前版本校验（mtime/版本号），过期返回 409 + 前端提示刷新 | 多开标签页成为用户习惯 |
| 2 | 导出/导入项目 | product.md 承诺「随时导出完整项目数据」，但无 API | `GET /project/export`（zip 打包 project.json + outline.json + checkpoint 后的 data.db）与 `POST /project/import` | 正式发布前必须补 |
| 3 | 操作级撤销/重做 | 软删仅覆盖删除场景；拖拽、编辑无 undo | 操作日志式 undo（内存级即可） | 用户反馈误操作损失 |
| 4 | token 用量统计/成本控制 | llm/token.ts 仅估算，无统计 | 每会话 token 累计与上限、用量展示 | 正式发布前建议补 |
| 5 | 大项目性能 | 大纲整树全量读写 O(n)、computeState 每次从根重算 | 标注设计上限（如 5000 节点）或增量写/缓存 | 实测性能瓶颈 |
| 6 | 静态资源缓存 | /assets/* 无缓存策略 | cache-control + 版本 hash 文件名 | 发布优化 |
| 7 | 命名统一 | 请求/查询参数 snake_case vs 响应 camelCase 的映射契约尚未落文档（原 orphan_nodes vs orphanNodes 冲突已随决策 19 消除） | 在 `@ai-editor/shared/utils` 定义显式映射函数（文件字段 ↔ API 字段），endpoints.md 通用约定已声明 | 实现前 |
| 8 | better-sqlite3 全局安装 | 已随 ^13（N-API 重写）解决 ABI 失配；但 7 包 `workspace:*` 依赖发布为 npm 包 + `npm -g` 安装的完整管道**未演练** | 发布前用 `pnpm pack`/`pnpm deploy` 演练一次全局安装；声明最低 Node ≥ 22.12；pnpm 10 需 `onlyBuiltDependencies: [better-sqlite3]` | 发布打包阶段 |
| 9 | ~~伏笔健康指标「当前章节」参照~~ | **已解决（2026-08）**：`current_position` 已纳入 project.json 契约（`doc/database/schema.md`），config 端点支持读写；「当前章节」口径 = current_position 指向节点的章节序 | — | — |
| 10 | 项目切换残留状态 | create/open 切换 currentProject 时，进行中的 SSE、未确认提案、客户端缓存处理未定义 | 切换前强制结束会话、清空提案、失效客户端缓存 | 实现项目管理 UI 时 |
| 11 | ~~孤儿节点层级限制~~ | **已取消（2026-08）**：游离节点设计整体删除（决策 19），move 不再支持 `__orphan__`，创建必须显式指定父节点（volume→root、chapter→volume/root、scene→chapter） | — | — |
| 12 | schema 演进策略复审 | 删库重建仅限 MVP | 首次发布前重新评估（用户已有真实数据） | 首次发布前 |
