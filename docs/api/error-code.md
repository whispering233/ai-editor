# 错误码说明（ErrorCode）

> **单一来源**：`@whispering233/ai-editor-shared` `types/api.ts` `ERROR_CODES` 枚举——REST 错误响应、SSE `error` 事件、工具结果共用；本文档表格为同一枚举的说明视图，新增/修订错误码须同步改枚举注释。

| code | HTTP | 说明 |
| :--- | :--- | :--- |
| `VALIDATION_ERROR` | 400 | 400 参数校验失败（entity/delta/outline 创建等） |
| `ENTITY_NOT_FOUND` | 404 | 404 实体不存在（详情/更新/删除/restore） |
| `RELATION_EXISTS` | 409 | 409 关系已存在 |
| `EVENT_ALREADY_MOUNTED` | 409 | 409 事件已挂载时间点，occurs_at 1:n 重复挂载拒绝（G2） |
| `RELATION_NOT_FOUND` | 404 | 404 关系不存在 |
| `OUTLINE_NODE_NOT_FOUND` | 404 | 404 大纲节点不存在（compute / path / restore / purge） |
| `OUTLINE_ANCESTOR_DELETED` | 409 | 409 restore 时存在软删祖先 |
| `INVALID_PROJECT_PATH` | 400 | 400 create/open 路径校验失败 |
| `PROPOSAL_STALE` | 409 | 409 确认时引用快照不一致 |
| `PROPOSAL_NOT_FOUND` | 404 | 404 proposal_id 不存在 |
| `PROPOSAL_PROJECT_MISMATCH` | 409 | 409 提案所属项目 ≠ 当前项目 |
| `SCHEMA_VERSION_MISMATCH` | 409 | 409 导入 zip 的 data.db user_version 与当前程序版本不匹配（拒绝导入，不静默重建） |
| `PROJECT_VERSION_NEWER` | 409 | 409 open 时项目 data.db user_version 高于当前程序版本（拒绝打开并提示升级程序，堵降级数据丢失） |
| `BACKUP_TARGET_EXISTS` | 409 | 409 重命名备份目标文件名已存在（B2.6：renameSync 目标存在会静默覆盖——显式拒绝防数据丢失） |
| `REFERENCE_FILE_MISSING` | 409 | 409 参考资料 file 类文件缺失（PUT 更新时读原文件失败——外部删除，提示先扫描同步） |
| `DELTA_CONFLICT` | —（已废弃） | 已废弃（2026-08 修订：computeState 以 conflicts 字段替代 409） |
| `TOOL_RESULT_TOO_LARGE` | — | 单条工具结果超 token 预算：**截断 + 结构化提示**（不终止对话；同时写调试日志使用量类别） |
| `AGENT_DISPATCH_ERROR` | — | 工具调度器缺陷（S7.3 防御：结果条数不符 / id 错位 / 调度器抛错），终止循环 |
| `AGENT_INTERNAL_ERROR` | — | agent 循环内部未知异常（S7.3 防御路径——chatStream 不 throw，理论不可达） |
| `AGENT_MAX_ITERATIONS` | — | agent 循环超 8 轮上限，发 error 事件终止 |
| `AGENT_TIMEOUT` | — | 单轮 120s 超时终止 |
| `AGENT_TOKEN_BUDGET` | — | 上下文 token 预算超限终止 |

- REST 错误响应统一 `{ success: false, error: { code, message } }`（SSE 用 `error` 事件 + `data: { code, message }`，无 HTTP 状态码）。
- HTTP 状态码约定：200 成功 / 400 参数 / 404 不存在 / 409 冲突 / 500 服务端错误（端点级特例见各模块文档）。
- `DELTA_CONFLICT` 为 2026-08 修订废弃码（computeState 改 skipped/conflicts 字段呈现），保留枚举兼容历史引用。

