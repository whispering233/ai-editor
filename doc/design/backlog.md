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
| 7 | 命名统一 | outline.json 文件字段 `orphan_nodes` vs API 响应 `orphanNodes` | 统一 snake_case（文件）与 camelCase（API）映射文档 | 实现前 |
| 8 | better-sqlite3 全局安装 | 原生模块随 npm -g 安装，Node ABI 失配需重装 | 声明最低 Node 版本 + 安装后自检 | 发布打包阶段 |
| 9 | 伏笔健康指标「当前章节」参照 | `_health.age/dormancy` 依赖「当前位置」，但无此数据 | project.json 增加 `current_position`（指向某大纲节点），定义非线性大纲下的计算口径 | 实现 analyze_hook_health 前 |
| 10 | 项目切换残留状态 | create/open 切换 currentProject 时，进行中的 SSE、未确认提案、客户端缓存处理未定义 | 切换前强制结束会话、清空提案、失效客户端缓存 | 实现项目管理 UI 时 |
| 11 | 孤儿节点层级限制 | `parent_id="__orphan__"` 的 move 是否允许卷/章层级未定义 | 明确孤儿节点类型限制 | 实现 move 时 |
| 12 | schema 演进策略复审 | 删库重建仅限 MVP | 首次发布前重新评估（用户已有真实数据） | 首次发布前 |
