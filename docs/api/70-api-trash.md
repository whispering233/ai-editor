# 回收站

> 回收站列表、restore（级联还原）、purge（物理清除）。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

软删（软删）的实体与大纲节点进入回收站，本体保留可还原；回收站定期清理（实现期定义保留时长）。

### GET /api/v1/trash

列出回收站中的软删对象。

```typescript
// Res: 200
{
  entities: { id: string; type: string; name: string; deletedAt: string }[];
  nodes:    { id: string; type: string; title: string; deletedAt: string }[];
}
```

### POST /api/v1/trash/entity/:type/:id/restore

还原软删实体（恢复 `deleted_at` 为 NULL），并**级联还原**其关联的关系与 Delta。

```typescript
// Path
type: string;
id: string;

// Res: 200
{ restored: true; restoredRelations: number; restoredDeltas: number }

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

> **可见性**：级联还原全部关系（不因另一端仍软删而跳过）；还原后若某关系的端点仍软删，该关系暂不可见，端点还原后自动可见。

### POST /api/v1/trash/outline/:nodeId/restore

还原软删大纲节点（恢复 `deleted`/`deleted_at` 标记），并**级联还原**其关联的关系与 Delta；子节点若仍在回收站则一并还原。可见性规则同实体 restore（端点仍软删的关系暂不可见）。

```typescript
// Path
nodeId: string;

// Res: 200
{ restored: true; restoredChildren: number; restoredRelations: number; restoredDeltas: number }

// Res: 404
{ error: { code: "OUTLINE_NODE_NOT_FOUND" } }

// Res: 409
{ error: { code: "OUTLINE_ANCESTOR_DELETED", message: "..." } }
// 存在软删祖先：需先还原祖先，杜绝「可见节点挂在不可见父」的畸形树
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
