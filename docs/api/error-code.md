# 错误码说明（ErrorCode）

> **单一来源**：`@whispering233/ai-editor-shared` `types/api.ts` `ERROR_CODES` 枚举——REST 错误响应、SSE `error` 事件、工具结果共用；本文档表格为同一枚举的说明视图，新增/修订错误码须同步改枚举注释。

| code | HTTP | 说明 |
| :--- | :--- | :--- |
| `VALIDATION_ERROR` | 400 | 400 参数校验失败（entity/delta/outline 创建等） |
| `ENTITY_NOT_FOUND` | 404 | 404 实体不存在（详情/更新/删除/restore） |
| `RELATION_EXISTS` | 409 | 409 关系已存在 |
| `EVENT_ALREADY_MOUNTED` | 409 | 409 事件已挂载时间点，occurs_at 1:n 重复挂载拒绝（G2） |
| `RELATION_NOT_FOUND` | 404 | 404 关系不存在 |
| `OUTLINE_NODE_NOT_FOUND` | 404 | 404 大纲节点不存在（compute / path / restore / purge）；**例外**：`PUT /project/config` 写侧同码用 **400**（参数语义错误而非资源访问，见 `10-api-project.md`） |
| `OUTLINE_ANCESTOR_DELETED` | 409 | 409 restore 时存在软删祖先 |
| `INVALID_PROJECT_PATH` | 400 | 400 create/open 路径校验失败 |
| `PROPOSAL_STALE` | 409 | 409 确认时引用快照不一致 |
| `PROPOSAL_NOT_FOUND` | 404 | 404 proposal_id 不存在 |
| `PROPOSAL_PROJECT_MISMATCH` | 409 | 409 提案所属项目 ≠ 当前项目 |
| `SESSION_NOT_FOUND` | 404 | 404 会话不存在（消息/思维链/删除端点：id 经磁盘发现解析未命中，或会话文件已被删除） |
| `SESSION_BUSY` | 409 | 409 删除会话时该会话有在途 SSE 流（拒绝删除） |
| `THINKING_NOT_FOUND` | 404 | 404 思维链全文端点：blockIndex 越界或该块非 thinking |
| `CHAT_BUSY` | 409 | 409 当前项目已有在途 chat 流（单项目单流约束） |
| `SCHEMA_VERSION_MISMATCH` | 409 | 409 导入 zip 的 data.db user_version 与当前程序版本不匹配（拒绝导入，不静默重建） |
| `PROJECT_VERSION_NEWER` | 409 | 409 open 时项目 data.db user_version 高于当前程序版本（拒绝打开并提示升级程序，堵降级数据丢失） |
| `BACKUP_TARGET_EXISTS` | 409 | 409 重命名备份目标文件名已存在（B2.6：renameSync 目标存在会静默覆盖——显式拒绝防数据丢失） |
| `REFERENCE_FILE_MISSING` | 409 | 409 参考资料 file 类文件缺失（PUT 更新时读原文件失败——外部删除，提示先扫描同步） |
| `DELTA_CONFLICT` | —（已废弃） | 已废弃（2026-08 修订：computeState 以 conflicts 字段替代 409） |
| `TOOL_RESULT_TOO_LARGE` | — | 单条工具结果超 token 上限：**截断 + 结构化提示**（不终止对话；同时写调试日志使用量类别） |

- REST 错误响应统一 `{ success: false, error: { code, message } }`；SSE 流内的错误不再有独立 `error` 事件——错误以 `agent_end` 帧的 `stopReason`（`error`/`aborted`）与 `errorMessage` 表达（见 [80-api-chat.md](./80-api-chat.md)）。
- HTTP 状态码约定：200 成功 / 400 参数 / 404 不存在 / 409 冲突 / 500 服务端错误（端点级特例见各模块文档）。
- `DELTA_CONFLICT` 为 2026-08 修订废弃码（computeState 改 skipped/conflicts 字段呈现），保留枚举兼容历史引用。

