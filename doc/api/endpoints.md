# 核心 API 端点设计

所有 API 遵循 REST 风格，由 Hono 框架实现。前缀 `/api/v1`。

**通用约定**：
- 请求体为 JSON
- 成功响应：`{ success: true, data: T }`
- 错误响应：`{ success: false, error: { code: string, message: string } }`
- 统一 HTTP 状态码：200 成功、400 参数错误、404 不存在、409 冲突、500 服务端错误

**类型定义**：以下 `Req` / `Res` 类型对应 `@ai-editor/shared` 包中 `types/api.ts` 的 Zod schema。

---

## 项目管理

### POST /api/v1/project/create

创建新项目。

```typescript
// Req
{
  path: string;          // 项目目录路径（绝对路径）
  config?: {
    name?: string;       // 项目名称，默认取目录名
    language?: "zh" | "en";
    prompt?: string;     // 项目级提示词
  };
}

// Res: 200
{
  id: string;            // project_id
  path: string;
  created: true;
}
```

### POST /api/v1/project/open

打开已有项目。

```typescript
// Req
{
  path: string;          // 已有项目目录（必须包含 project.json）
}

// Res: 200
{
  id: string;
  name: string;
  language: "zh" | "en";
  config: ProjectConfig;  // 完整项目配置
  // ProjectConfig 含 schema_version: number（对应 project.json 的 schema_version，决策 13）
}
```

**路径校验（create/open 通用，决策 17）**：
- 路径需规范化（`path.resolve`），拒绝相对路径逃逸与符号链接指向项目目录之外（防越权读写任意目录）。
- open 必须校验目标目录包含 `project.json`，否则拒绝。
- 校验失败返回 `{ code: "INVALID_PROJECT_PATH" }`（400）。

**schema 版本检测（open 时，决策 13 修订）**：
- 以 data.db 的 `user_version` 为准判定是否重建；与当前版本不匹配时执行**删库重建**，并同步重置 outline.json（先备份为 `outline.json.bak`）、清空回收站；完成后向客户端提示已重建。
- `project.json` 的 `schema_version` 仅用于 JSON 结构判断。

### POST /api/v1/project/close

关闭当前项目（释放数据库连接）。

```typescript
// Req: (none)

// Res: 200
{
  saved: true;
}
```

### GET /api/v1/project/config

获取当前项目配置。

```typescript
// Query: (none)

// Res: 200
{
  id: string;
  name: string;
  language: "zh" | "en";
  prompt: string;            // 项目提示词
  schemaVersion: number;     // schema 版本（对应 project.json 的 schema_version，决策 13）
  createdAt: string;         // ISO datetime
  updatedAt: string;
}
```

### PUT /api/v1/project/config

更新项目配置。

```typescript
// Req
{
  name?: string;
  language?: "zh" | "en";
  prompt?: string;
}

// Res: 200
{
  updated: true;
}
```

---

## 实体 CRUD

> **软删过滤（决策 12 修订）**：常规查询端点（GET 列表/详情、关系查询、Delta 查询等）**默认过滤软删对象**；回收站 API（`/api/v1/trash/*`）是访问软删对象的唯一入口。

### GET /api/v1/entity/:type

列出指定类型的所有实体。

```typescript
// Path
type: "character" | "setting" | "location" | "hook";

// Query
{
  q?: string;           // 搜索关键词（模糊匹配 name）
  offset?: number;      // 分页偏移，默认 0
  limit?: number;       // 每页条数，默认 50，最大 200
  sort?: "name" | "created_at" | "updated_at";
  order?: "asc" | "desc";
}

// Res: 200
{
  items: EntitySummary[];
  total: number;
  offset: number;
  limit: number;
}

// EntitySummary（列表用摘要，不含完整 data）
{
  id: string;
  type: "character" | "setting" | "location" | "hook";
  name: string;
  // 各类型的关键摘要字段：
  //   character → role, status
  //   setting   → category
  //   location  → type
  //   hook      → status, payoff_timing (从 data JSON 提取)
  summary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

### GET /api/v1/entity/:type/:id

获取实体详情。

```typescript
// Path
type: "character" | "setting" | "location" | "hook";
id: string;

// Res: 200
{
  id: string;
  type: string;
  name: string;
  data: Record<string, unknown>;  // 完整字段
  // 关联信息（紧邻 1 跳）
  relations: RelationSummary[];
  deltaCount: number;
  createdAt: string;
  updatedAt: string;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND", message: "..." } }
```

### POST /api/v1/entity/:type

创建实体。

```typescript
// Path
type: "character" | "setting" | "location" | "hook";

// Req
{
  name: string;              // 必填，1-100 字符
  data?: Record<string, unknown>;  // 根据 type 有不同的 schema
}

// 各 type 的 data 字段说明：
// character: { role?, gender?, age?, personality?: string[], motivation?, abilities?: string[], status?, custom_fields? }
// setting:   { category?, parent_id?, description?, rules?: string[], custom_fields? }
// location:  { type?, parent_id?, description?, custom_fields? }
// hook:      { status?, category?, expected_payoff?, payoff_timing?, half_life?, is_core?, notes? }
//             (详见 database/hooks.md)

// Res: 201
{
  id: string;                // 自动生成，如 "char-9", "hook-3"
  type: string;
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// Res: 400（校验失败）
{ error: { code: "VALIDATION_ERROR", message: "name is required", fields?: string[] } }
```

### PUT /api/v1/entity/:type/:id

更新实体。使用 partial update（仅修改传入字段）。

```typescript
// Path
type: string;
id: string;

// Req
{
  name?: string;
  data?: Partial<Record<string, unknown>>;  // 只合并传入的 data 字段，不覆盖全部
}

// Res: 200
{
  id: string;
  updated: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

### DELETE /api/v1/entity/:type/:id

软删实体（决策 12）：标记 `deleted_at`，**本体保留**可还原；级联移除其关联的关系与 Delta 记录。

```typescript
// Path
type: string;
id: string;

// Res: 200
{
  deleted: true;                // 软删：仅标记 deleted_at，实体本体仍保留（可还原）
  cascaded: {
    relations: number;    // 一并软删的关系数
    deltas: number;       // 一并软删的 Delta 数
  };
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

---

## 关系管理

### GET /api/v1/relation

查询关系。支持从任意实体出发的 k 跳遍历。

```typescript
// Query
{
  source_type?: string;   // 起点类型，不传则查询所有类型
  source_id?: string;     // 起点 ID，不传则按 type 过滤
  target_type?: string;   // 终点类型过滤
  target_id?: string;     // 终点 ID 过滤
  relation_type?: string; // 关系类型过滤
  depth: 1 | 2 | 3;      // 1=紧邻, 2=k跳, 3=全量遍历
}

// Res: 200
{
  // depth=1: 直接关系
  relations: {
    id: string;
    sourceType: string;
    sourceId: string;
    sourceName?: string;     // 联表查询填充
    targetType: string;
    targetId: string;
    targetName?: string;
    relationType: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }[];

  // depth>=2: 追加路径信息
  paths?: {
    nodes: { type: string; id: string; name: string }[];
    edges: { from: string; to: string; relationType: string }[];
  }[];
}
```

### POST /api/v1/relation

建立关系。

```typescript
// Req
{
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relation_type: string;     // 参见 database/schema.md 预定义关系类型
  metadata?: Record<string, unknown>;
}

// Res: 201
{
  id: string;
  relation: {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    relationType: string;
  };
}

// Res: 409（关系已存在）
{ error: { code: "RELATION_EXISTS" } }
```

### DELETE /api/v1/relation/:id

删除关系。

```typescript
// Path
id: string;

// Res: 200
{
  deleted: true;
}

// Res: 404
{ error: { code: "RELATION_NOT_FOUND" } }
```

---

## Delta 变更追踪

### POST /api/v1/delta

追加属性变更记录。

```typescript
// Req
{
  node_id: string;                // 触发变更的大纲节点 ID
  target_type: string;            // 变更目标类型
  target_id: string;              // 变更目标 ID
  changes: {
    field: string;                // 字段名
    op: "set" | "update" | "add" | "remove";
    from?: string | number | null;  // 旧值（op=update 时必填）
    to?: string | number | null;    // 新值（op=set/update/add 时必填）
    value?: string | number;         // 值（op=add 时使用）
  }[];
  description: string;            // 人类可读描述
  // 注意：无 order 入参——order 由服务端生成，全局单调递增（与 schema.md 一致）
}

// Res: 201
{
  id: string;
  applied: DeltaRecord;           // 完整的 Delta 记录
}

// Res: 400
{ error: { code: "VALIDATION_ERROR" } }

// 示例
// Req: { node_id: "sc-37", target_type: "character", target_id: "char-3",
//        changes: [{ field: "combat_power", op: "update", from: "100", to: "150" }],
//        description: "张三获得断剑认可" }
```

### GET /api/v1/delta/node/:nodeId

获取指定大纲节点触发的所有 Delta。

```typescript
// Path
nodeId: string;

// Res: 200
{
  nodeId: string;
  deltas: DeltaRecord[];
}

// DeltaRecord
{
  id: string;
  nodeId: string;
  targetType: string;
  targetId: string;
  targetName?: string;        // 联表填充
  changes: { field: string; op: string; from?: unknown; to?: unknown }[];
  description: string;
  order: number;
  createdAt: string;
}
```

### POST /api/v1/delta/compute

计算实体到达指定大纲节点时的累积状态。

```typescript
// Req
{
  target_type: string;          // 目标实体类型
  target_id: string;            // 目标实体 ID
  at_node_id: string;           // 到达的大纲节点 ID
  path_ids?: string[];          // 可选，显式指定路径节点列表
                                // 不传则自动计算从根到 at_node 的路径
}

// Res: 200
{
  targetType: string;
  targetId: string;
  atNodeId: string;
  state: Record<string, unknown>;   // 初始 data + 路径上所有 Delta 累积后的结果
  appliedDeltas: {                   // 参与计算的 Delta 列表
    nodeId: string;
    description: string;
    changes: unknown[];
  }[];
}

// Delta 累积规则：
//   到达目标节点的状态 = 实体初始 data
//     + path_ids 路径上所有 node_id 的 Delta 按 order 顺序应用
//   set:     直接替换值
//   update:  旧值→新值（验证当前值等于 from）
//   add:     向数组追加
//   remove:  从数组中移除
```

---

## 大纲操作

### GET /api/v1/outline

获取完整大纲树。

```typescript
// Res: 200
{
  id: "root";
  type: "root";
  children: OutlineNode[];
  orphanNodes: OutlineNode[];
}

// OutlineNode
{
  id: string;                    // 如 "vol-1", "ch-3", "sc-15"
  type: "volume" | "chapter" | "scene";
  title: string;
  summary?: string;              // 可选描述
  children?: OutlineNode[];      // 卷下有章，章下有场景
  metadata?: {
    hookCount?: number;          // 关联的伏笔数
    charCount?: number;          // 关联角色数
    deltaCount?: number;         // 此节点触发的 Delta 数
  };
}
```

### POST /api/v1/outline

创建新大纲节点。

```typescript
// Req
{
  type: "volume" | "chapter" | "scene";
  title: string;                 // 1-200 字符
  parent_id?: string;            // 父节点 ID
                                 // volume 不传 parent → 挂到 root
                                 // chapter 不传 parent → 挂到 root（变为游离卷）
                                 // scene 必须传 parent（属于某章）
  summary?: string;
}

// Res: 201
{
  id: string;                    // 自动生成 "vol-2", "ch-8" 等
  type: string;
  title: string;
  parentId: string | null;
}
```

### PUT /api/v1/outline/:nodeId

更新大纲节点信息。

```typescript
// Path
nodeId: string;

// Req
{
  title?: string;
  summary?: string;
}

// Res: 200
{
  updated: true;
}
```

### PUT /api/v1/outline/:nodeId/move

移动大纲节点（拖拽重排）。

```typescript
// Path
nodeId: string;

// Req
{
  parent_id: string;             // 新的父节点 ID
  order: number;                 // 在兄弟节点中的位置（0-based）
                                 // 移入 root: parent_id="root"
                                 // 移入 orphan_nodes: parent_id="__orphan__"
}

// Res: 200
{
  moved: true;
  previousParentId: string;
  newParentId: string;
}

// 画布视图中的连线自动从新的父子关系推导
```

### DELETE /api/v1/outline/:nodeId

软删大纲节点（决策 12）：标记 `deleted`，**本体保留**可还原；级联移除子节点、关联的 Delta 和关系（仅移除关联数据，被删对象本体保留）。

```typescript
// Path
nodeId: string;

// Res: 200
{
  deleted: true;                // 软删：仅标记 deleted + deleted_at，节点本体保留（可还原）
  cascaded: {
    children: number;       // 递归软删的子节点数
    relations: number;      // 一并软删的关联关系数
    deltas: number;         // 一并软删的 Delta 数
  };
}
```

### GET /api/v1/outline/:nodeId/path

获取从根到指定节点的路径 ID 列表。

```typescript
// Path
nodeId: string;

// Res: 200
{
  nodeId: string;
  path: string[];               // 从根到目标节点的 ID 数组
                                 // 如 ["root", "vol-1", "ch-3", "sc-15"]
}
```

---

## 回收站

软删（决策 12）的实体与大纲节点进入回收站，本体保留可还原；回收站定期清理（实现期定义保留时长）。

### GET /api/v1/trash

列出回收站中的软删对象。

```typescript
// Res: 200
{
  entities: { id: string; type: string; name: string; deleted_at: string }[];
  nodes:    { id: string; type: string; title: string; deleted_at: string }[];
}
```

### POST /api/v1/trash/entity/:type/:id/restore

还原软删实体（恢复 `deleted_at` 为 NULL），并**级联还原**其关联的关系与 Delta（决策 12 修订）。

```typescript
// Path
type: string;
id: string;

// Res: 200
{ restored: true; restoredRelations: number; restoredDeltas: number }

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

### POST /api/v1/trash/outline/:nodeId/restore

还原软删大纲节点（恢复 `deleted`/`deleted_at` 标记），并**级联还原**其关联的关系与 Delta；子节点若仍在回收站则一并还原（决策 12 修订）。

```typescript
// Path
nodeId: string;

// Res: 200
{ restored: true; restoredChildren: number; restoredRelations: number; restoredDeltas: number }

// Res: 404
{ error: { code: "OUTLINE_NODE_NOT_FOUND" } }
```

### DELETE /api/v1/trash/entity/:type/:id

彻底删除（purge，物理清除且不可恢复）：清除实体本体及其关联的关系与 Delta。仅用于回收站清理。

```typescript
// Path
type: string;
id: string;

// Res: 200
{ purged: true }
```

### DELETE /api/v1/trash/outline/:nodeId

彻底删除大纲节点（purge，物理清除且不可恢复）：**递归物理删除整棵子树**（子节点一并清除），并清除其关联的关系与 Delta。仅用于回收站清理。

```typescript
// Path
nodeId: string;

// Res: 200
{ purged: true }
```

---

## AI 对话

### POST /api/v1/chat

发送消息给 AI，通过 SSE 流式返回。

```typescript
// Req
{
  message: string;              // 用户消息
  session_id?: string;          // 会话 ID，不传则创建新会话
  context?: {
    focus_entity_type?: string;  // 当前聚焦的实体类型（用于上下文组装）
    focus_entity_id?: string;    // 当前聚焦的实体 ID
    focus_node_id?: string;      // 当前聚焦的大纲节点 ID
  };
}

// 对话历史持久化（决策 18）：本会话的消息写入 data.db 的 chat_messages 表；
// 服务重启后携带同一 session_id 即可继续上次对话。

// Res: SSE stream
// 消息格式（SSE event stream, text/event-stream）:
//
// event: tool_call         // AI 调用了工具
// data: { "tool": "get_entity", "args": {...}, "id": "call_xxx" }
//
// event: tool_result       // 工具执行结果
// data: { "tool": "get_entity", "result": {...}, "id": "call_xxx" }
//
// event: text              // AI 文本回复片段
// data: { "delta": "张三这个角色..." }
//
// event: proposal          // AI 发出提案
// data: { "proposal_id": "prop_xxx", "type": "propose_create_entity", "preview": {...} }
//
// event: done              // 对话轮次结束
// data: { "session_id": "sess_xxx" }
//
// event: error
// data: { "code": "...", "message": "..." }
```

**取消语义（决策 16）**：SSE 断开（浏览器刷新/断网）即触发全链路取消——服务端通过 AbortController 终止 agent 循环、中止 DeepSeek fetch；未确认提案作废；正在执行的写操作完成当前一步后停止，操作顺序固定「先 DB 后 JSON」，两存储间不一致由 `find_orphan_elements` 工具兜底修复。客户端重连后提示「上次会话已取消」。

---

## 提案确认

### POST /api/v1/proposal/:proposalId/confirm

用户确认提案。

```typescript
// Path
proposalId: string;

// Res: 200
{
  confirmed: true;
  result: unknown;              // 执行结果（如新创建的 entity id）
}

// Res: 409 — 提案过期（决策 14）
// 确认时服务端重新校验提案引用的实体/大纲节点仍存在且无冲突；
// 校验失败返回 { code: "PROPOSAL_STALE" }，前端提示重新生成提案。
```

### POST /api/v1/proposal/:proposalId/reject

用户拒绝提案。

```typescript
// Path
proposalId: string;

// Res: 200
{
  rejected: true;
}
```
