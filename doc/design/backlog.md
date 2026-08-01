# 迭代优化清单（Backlog）

MVP 明确不做、延后迭代的事项。每项记录：现状、优化方案、触发条件。

| # | 事项 | 现状 | 优化方案 | 触发条件 |
|---|------|------|---------|---------|
| 1 | 多标签页并发写入 | 单进程内存 `currentProject`，双标签页后写覆盖 | 写入前版本校验（mtime/版本号），过期返回 409 + 前端提示刷新 | 多开标签页成为用户习惯 |
| 2 | 导出/导入项目 | product.md 承诺「随时导出完整项目数据」，但无 API | `GET /project/export`（zip 打包 project.json + outline.json + checkpoint 后的 data.db）与 `POST /project/import` | 正式发布前必须补 |
| 3 | 操作级撤销/重做 | 软删仅覆盖删除场景；拖拽、编辑无 undo | 操作日志式 undo（内存级即可） | 用户反馈误操作损失 |
| 4 | token 用量统计/成本控制 | llm/token.ts 仅估算，无统计 | 每会话 token 累计与上限、用量展示 | 正式发布前建议补 |
| 5 | 大项目性能 | 大纲整树全量读写 O(n)、computeState 每次从根重算；关系查询校验端点软删状态需访问 outline.json（可能每查询整树读文件） | 标注设计上限（如 5000 节点）或增量写/缓存；**建议启动时缓存大纲树内存投影**（失效时刷新） | 实测性能瓶颈 |
| 6 | 静态资源缓存 | /assets/* 无缓存策略 | cache-control + 版本 hash 文件名 | 发布优化 |
| 7 | ~~命名统一~~ | **已解决（2026-08）**：映射规则已落定（endpoints.md 通用约定）——嵌套 `data` 内部字段原样透传，camelCase 仅应用于 API 顶层契约字段 | 映射函数仍按约定定义于 `@ai-editor/shared/utils` | 实现时按 endpoints.md 通用约定执行 |
| 8 | better-sqlite3 全局安装 | 已随 ^13（N-API 重写）解决 ABI 失配；但 7 包 `workspace:*` 依赖发布为 npm 包 + `npm -g` 安装的完整管道**未演练** | 发布前用 `pnpm pack`/`pnpm deploy` 演练一次全局安装；声明最低 Node ≥ 22.12；pnpm 11+ 需 `allowBuilds: { better-sqlite3: true }`（pnpm 10 旧格式为 `onlyBuiltDependencies`，pnpm 11 会自动迁移为哨兵值导致构建被忽略） | 发布打包阶段 |
| 9 | ~~伏笔健康指标「当前章节」参照~~ | **已解决（2026-08）**：`current_position` 已纳入 project.json 契约（`doc/database/schema.md`），config 端点支持读写；「当前章节」口径 = current_position 指向节点的章节序 | — | — |
| 10 | ~~项目切换残留状态~~ | **已解决（2026-08）**：服务端部分已定义（决策 14 修订）——提案绑定 `project_id`、切换项目清空全部提案并强制结束 SSE/agent 循环 | 剩余：客户端缓存失效随项目管理 UI 实现 | 实现项目管理 UI 时 |
| 11 | ~~孤儿节点层级限制~~ | **已取消（2026-08）**：游离节点设计整体删除（决策 19），move 不再支持 `__orphan__`，创建必须显式指定父节点（volume→root、chapter→volume/root、scene→chapter） | — | — |
| 12 | schema 演进策略复审 | 删库重建仅限 MVP | 首次发布前重新评估（用户已有真实数据） | 首次发布前 |
| 13 | 伏笔面板健康指标展示 | **MVP 简化（2026-08 决策）**：`_health` REST 附加字段契约未定义，伏笔面板只列基础字段与生命周期操作（`doc/ui/pages/hook-panel.md`），章节序展示（「第5章 → 预计第45章」）不做 | 补充 hook 查询响应 `_health` 附加字段契约（决策 21 口径：age/dormancy/stale/overdue/ready_to_resolve/blocked）与 plants/advances/resolves 章节序现推 → 面板徽标与位置展示 | 伏笔面板 MVP 上线后 |
