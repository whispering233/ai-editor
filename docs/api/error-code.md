# 错误码说明（ErrorCode）

> **单一来源**：`@whispering233/ai-editor-shared` `types/api.ts` `ERROR_CODES` 枚举——REST 错误响应与工具结果共用（**SSE 流内无 `error` 帧**，错误以 `agent_end` 的 `stopReason`/`errorMessage` 表达，见 `80-api-chat.md`）；本文档表格为同一枚举的说明视图，新增/修订错误码须同步改枚举注释。**服务端另有扩展码**（不在 shared 枚举内，与 client 的 `CLIENT_NETWORK_ERROR` 同类）：`INTERNAL_ERROR` 500 / `FORBIDDEN` 403 / `NOT_FOUND` 404 / `NO_PROJECT_OPEN` 409 / `PROJECT_ALREADY_EXISTS` 409 / `LLM_API_KEY_MISSING` 400 / 云端存档七码（**已全部实现**：`CLOUD_NOT_CONFIGURED` 409 / `CLOUD_AUTH_FAILED` 502 / `CLOUD_UNREACHABLE` 502 / `CLOUD_QUOTA_EXCEEDED` 502 / `CLOUD_BACKUP_TOO_LARGE` 400 / `CLOUD_CONFLICT` 409 / `CLOUD_FILE_NOT_FOUND` 404 / 拆解小说八码（**已实现**：`DECOMPOSE_FILE_TOO_LARGE` 400 / `DECOMPOSE_FILE_INVALID` 400 / `DECOMPOSE_JOB_NOT_FOUND` 404 / `DECOMPOSE_BATCH_NOT_FOUND` 404 / `DECOMPOSE_JOB_STATE` 409 / `DECOMPOSE_NO_CHAPTERS` 404 / `DECOMPOSE_NOTHING_TO_DO` 400 / `DECOMPOSE_JOB_RUNNING` 409）；均在 `packages/server/src/middleware/error.ts` 的 `SERVER_ERROR_CODES`）。错误码分散（shared 枚举 + 服务端补充 + client 补充）为已登记技术债，MVP 不收敛。

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
| `SESSION_READONLY` | 409 | 409 向拆解会话（`decompose-` 前缀）发消息：拆解会话只读，不可续聊（历史里是一整本原文，当上下文续聊费用与语义均错） |
| `THINKING_NOT_FOUND` | 404 | 404 思维链全文端点：blockIndex 越界或该块非 thinking |
| `CHAT_BUSY` | 409 | 409 当前项目已有在途 chat 流（单项目单流约束） |
| `SCHEMA_VERSION_MISMATCH` | 409 | 409 导入 zip 的 data.db user_version 与当前程序版本不匹配（拒绝导入，不静默重建） |
| `PROJECT_VERSION_NEWER` | 409 | 409 open 时项目 data.db user_version 高于当前程序版本（拒绝打开并提示升级程序，堵降级数据丢失） |
| `BACKUP_TARGET_EXISTS` | 409 | 409 重命名备份目标文件名已存在（B2.6：renameSync 目标存在会静默覆盖——显式拒绝防数据丢失） |
| `DOCUMENT_STALE` | 409 | 409 保存**章正文**（`PUT /api/v1/manuscript/:chapterNodeId`）时版本戳不一致（另一标签页/窗口已写入）；仅当请求携带 `base_updated_at` 时校验，省略 = 覆盖保存。**不含参考资料**：`PUT /api/v1/entity/reference/:id` 无版本戳参数（`.strict()`），参考资料正文冲突 = 后写覆盖（与其它实体一致；见 `../design/backlog.md`「参考资料正文无覆盖保护」） |
| `REFERENCE_FILE_MISSING` | —（已移除） | 2026-09 已从 shared `ERROR_CODES` 枚举删除（参考资料不再有磁盘文件与扫描链路，外部编辑改为单文件导入导出，见 [30-api-entity.md](./30-api-entity.md)） |
| `DELTA_CONFLICT` | —（已废弃） | 已废弃（2026-08 修订：computeState 以 conflicts 字段替代 409） |
| `TOOL_RESULT_TOO_LARGE` | — | 单条工具结果超 token 上限：**截断 + 结构化提示**（不终止对话；同时写调试日志使用量类别） |
| `CLOUD_NOT_CONFIGURED` | 409 | 409 云盘未配置（`cloud.json` 的 webdav url/username/password 三项未齐）就调用需要云端的动作（已实现） |
| `CLOUD_AUTH_FAILED` | 502 | 502 云盘认证失败（上游 401/403：凭据被吊销、应用密码错误、权限不足）；不自动重试，引导去设置页核对（已实现） |
| `CLOUD_UNREACHABLE` | 502 | 502 云盘不可达（网络 / DNS / TLS / 超时 / 上游 5xx）；本地功能不受影响（已实现） |
| `CLOUD_QUOTA_EXCEEDED` | 502 | 502 云盘配额耗尽（上游 507 或 403 带配额提示：空间或上传流量用尽，免费账户 1GB/月）（已实现） |
| `CLOUD_BACKUP_TOO_LARGE` | 400 | 400 备份包超过云盘单文件上限（500MB，**推送前本地判定**，不等服务器回 413）（已实现） |
| `CLOUD_CONFLICT` | 409 | 409 推送时云端 head ≠ 本机 `lastPushedFileName`（另一台机器写过）→ 弹出裁决（保留云端 / 用本机强推）（已实现） |
| `CLOUD_FILE_NOT_FOUND` | 404 | 404 拉取指定的云端备份不存在（已被保留策略清理或被手动删除）；云端还没有可拉取的备份（先在本机推送一份）同码（已实现） |
| `DECOMPOSE_FILE_TOO_LARGE` | 400 | 400 拆解小说：上传文件超体积上限（`DECOMPOSE_MAX_FILE_BYTES`） |
| `DECOMPOSE_FILE_INVALID` | 400 | 400 拆解小说：解码失败或文本为空 |
| `DECOMPOSE_JOB_NOT_FOUND` | 404 | 404 拆解小说：当前项目没有 job |
| `DECOMPOSE_BATCH_NOT_FOUND` | 404 | 404 拆解小说：批序号越界 |
| `DECOMPOSE_JOB_STATE` | 409 | 409 拆解小说：当前 job 状态不允许该操作（pause / resume / rerun 的状态前置；`continue` 也用它：已有 running/paused job 时不给开新 job） |
| `DECOMPOSE_NO_CHAPTERS` | 404 | 404 拆解小说：续拆预览时项目里没有章 |
| `DECOMPOSE_NOTHING_TO_DO` | 400 | 400 拆解小说：续拆启动时范围里一章都没有（缺省且无未拆章） |
| `DECOMPOSE_JOB_RUNNING` | 409 | 409 删除会话被拒：该 `decompose-` 会话所属 job 仍在跑 |
| `NO_PROJECT_OPEN` | 409 | 409 无当前项目（服务端扩展码，复用）——`/decompose/job` 系列端点在无已打开项目时同码 |

- REST 错误响应统一 `{ success: false, error: { code, message } }`；**SSE 流内无独立 `error` 事件**——错误以 `agent_end` 帧的 `stopReason`（`error`/`aborted`）与 `errorMessage` 表达（见 [80-api-chat.md](./80-api-chat.md)）。
- HTTP 状态码约定：200 成功 / 400 参数 / 404 不存在 / 409 冲突 / 500 服务端错误（端点级特例见各模块文档）。
- `DELTA_CONFLICT` 为 2026-08 修订废弃码（computeState 改 skipped/conflicts 字段呈现），保留枚举兼容历史引用。

