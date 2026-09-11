# API 接口索引（00）

> 接口速查表。端点契约（请求/响应字段、语义、错误）见各模块文档；公共约定见 [api-public.md](./api-public.md)；错误码见 [error-code.md](./error-code.md)；
> AI 工具（无 HTTP 接口）目录见 [tool-calling.md](./tool-calling.md)；请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`。


### 项目管理（[10-api-project.md](./10-api-project.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| POST | `/api/v1/project/create` | 项目管理 |
| POST | `/api/v1/project/open` | 项目管理 |
| POST | `/api/v1/project/close` | 项目管理 |
| GET | `/api/v1/project/list` | 项目管理 |
| GET | `/api/v1/project/config` | 项目管理 |
| PUT | `/api/v1/project/config` | 项目管理 |
| GET | `/api/v1/project/agents` | 项目管理 |
| PUT | `/api/v1/project/agents` | 项目管理 |
| GET | `/api/v1/project/export` | 项目管理 |
| POST | `/api/v1/project/import` | 项目管理 |

### 备份管理（[20-api-backup.md](./20-api-backup.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| GET | `/api/v1/project/backups` | 备份管理 |
| POST | `/api/v1/project/backup` | 备份管理 |
| POST | `/api/v1/project/backup/rename` | 备份管理 |
| POST | `/api/v1/project/backup/restore` | 备份管理 |
| POST | `/api/v1/project/rename` | 备份管理 |

### 实体 CRUD（[30-api-entity.md](./30-api-entity.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| GET | `/api/v1/entity/:type` | 实体 CRUD |
| GET | `/api/v1/entity/:type/:id` | 实体 CRUD |
| POST | `/api/v1/entity/:type` | 实体 CRUD |
| PUT | `/api/v1/entity/:type/:id` | 实体 CRUD |
| DELETE | `/api/v1/entity/:type/:id` | 实体 CRUD |
| POST | `/api/v1/reference/scan` | 实体 CRUD |
| PUT | `/api/v1/entity/event/:id/move` | 实体 CRUD |
| PUT | `/api/v1/entity/timepoint/:id/move` | 实体 CRUD |
| PUT | `/api/v1/entity/setting/:id/move` | 实体 CRUD |
| POST | `/api/v1/entity/event/:id/move_to` | 实体 CRUD |

### 关系管理（[40-api-relation.md](./40-api-relation.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| GET | `/api/v1/relation` | 关系管理 |
| POST | `/api/v1/relation` | 关系管理 |
| PUT | `/api/v1/relation/:id` | 关系管理 |
| DELETE | `/api/v1/relation/:id` | 关系管理 |

### Delta 变更追踪（[50-api-delta.md](./50-api-delta.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| POST | `/api/v1/delta` | Delta 变更追踪 |
| GET | `/api/v1/delta/node/:nodeId` | Delta 变更追踪 |
| POST | `/api/v1/delta/compute` | Delta 变更追踪 |

### 大纲操作（[60-api-outline.md](./60-api-outline.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| GET | `/api/v1/outline` | 大纲操作 |
| POST | `/api/v1/outline` | 大纲操作 |
| PUT | `/api/v1/outline/:nodeId` | 大纲操作 |
| PUT | `/api/v1/outline/:nodeId/move` | 大纲操作 |
| DELETE | `/api/v1/outline/:nodeId` | 大纲操作 |
| GET | `/api/v1/outline/:nodeId/path` | 大纲操作 |

### 回收站（[70-api-trash.md](./70-api-trash.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| GET | `/api/v1/trash` | 回收站 |
| POST | `/api/v1/trash/entity/:type/:id/restore` | 回收站 |
| POST | `/api/v1/trash/outline/:nodeId/restore` | 回收站 |
| DELETE | `/api/v1/trash/entity/:type/:id` | 回收站 |
| DELETE | `/api/v1/trash/outline/:nodeId` | 回收站 |

### AI 对话与提案确认（[80-api-chat.md](./80-api-chat.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| POST | `/api/v1/chat` | AI 对话与提案确认（SSE） |
| GET | `/api/v1/chat/sessions` | AI 对话与提案确认 |
| GET | `/api/v1/chat/sessions/:id/messages` | AI 对话与提案确认 |
| GET | `/api/v1/chat/sessions/:id/messages/:messageId/thinking` | 思维链全文（按块按需拉取） |
| DELETE | `/api/v1/chat/sessions/:id` | 删除会话（物理删文件；404/409） |
| POST | `/api/v1/names/resolve` | AI 对话与提案确认 |
| POST | `/api/v1/proposal/:proposalId/confirm` | AI 对话与提案确认 |
| POST | `/api/v1/proposal/:proposalId/reject` | AI 对话与提案确认 |

### 系统设置（[90-api-settings.md](./90-api-settings.md)）

| 方法 | 路径 | 文档 |
| :--- | :--- | :--- |
| GET | `/api/v1/settings/llm` | 系统设置 |
| PUT | `/api/v1/settings/llm` | 系统设置 |
