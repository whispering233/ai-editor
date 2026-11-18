# 大纲操作

> 大纲树 CRUD、节点移动（拖拽重排）。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

### GET /api/v1/outline

获取完整大纲树（严格三层，无游离节点）。

```typescript
// Query
{
  with_metadata?: boolean;   // 为 true 时计算节点 metadata 统计（跨 outline.json × data.db 联查，默认 false）
}

// Res: 200
{
  id: "root";
  type: "root";
  schemaVersion: number;     // outline.json 顶层 schema_version
  children: OutlineNode[];
}

// OutlineNode
{
  id: string;                    // 如 "vol-1", "ch-3", "sc-15"
  type: "volume" | "chapter" | "scene";
  title: string;
  summary?: string;              // 可选描述
  data?: Record<string, unknown>; // 节点结构化信息（麦基字段集；无 data 时省略）
  children?: OutlineNode[];      // 卷下有章，章下有场景
  updatedAt: string;             // 节点版本戳（提案快照比对）
  metadata?: {                   // 仅 with_metadata=true 时返回
    hookCount?: number;          // 关联的伏笔数
    charCount?: number;          // 关联角色数（appears_in 指向该节点的关系数）
    deltaCount?: number;         // 此节点触发的 Delta 数
    textLength?: number;         // （章，2026-09）正文字数 = document_records.content_text 长度；无正文 = 0
    documentUpdatedAt?: string;  // （章，2026-11）最近一次正文保存的服务端时刻 = document_records.updated_at；无正文 = 字段缺省
  };
}
```

> **节点 `data`（2026-08 新增）**：按层级 schema（`OUTLINE_NODE_DATA_SCHEMAS`，shared 单一来源）校验——scene：`goal`/`conflict_levels`/`value_from`/`value_to`；chapter：`reversal`/`climax_scene` + **2026-11 工作面四字段** `status`(`draft`/`revision`/`final`)、`tags`(≤5 个，单值 1–24 字，trim)、`function`(`setup`/`advance`/`turn`/`resolve`/`breather`)、`tension`(`low`/`mid`/`high`)；scene：`tags` 同 schema（仅开放读写，UI 本轮只编辑章）；volume：`climax_scene`/`inciting_scene`。`tags` 是**章级剧情线标记**（自由文本），与 `advances` 等关系是两层语义：标签说「属于哪条线」，关系说「推进了哪条线」，不互相转换。引用字段（`climax_scene`/`inciting_scene`）宽松校验（任意场景节点 id），MVP 不校验引用范围。编辑 data 不自动生成 Delta。
>
> **节点 `metadata.textLength`（2026-09）**：仅 `with_metadata=true` 时返回的**章**统计——正文字数（= `document_records.content_text` 长度），大纲树与写作页卷章导航栏据此展示「已写 / 字数」而**不拉取正文全文**。与既有 `metadata.charCount`（关联角色数）不是同一字段，勿混用。
>
> **节点 `metadata.documentUpdatedAt`（2026-11）**：仅 `with_metadata=true` 时返回的**章**统计——该章正文行 `document_records.updated_at`（最近一次保存的服务端时刻）；**无正文 = 字段缺省**（不是空串 / 0）。写作页 `#/writing` 的**回退**导航用它：优先 localStorage 最近打开，命中不了才取 `documentUpdatedAt` 最大值并 `location.replace`；**不是** `project.json.current_position`（阅读进度），不新增服务端字段 / 表。`PUT /manuscript/:id` 返回的 `updatedAt` 与它是同一个值。

### POST /api/v1/outline

创建新大纲节点。**严格三层，parent_id 必填**（无游离节点）。**层级非法 → 400 `VALIDATION_ERROR`**（`db assertCanHold` 单点校验，创建与移动共用）；**存量根级章（旧数据）读容忍**——能渲染/改名/删除/拖进卷，但不能再新建、也不能移回 root。

```typescript
// Req
{
  type: "volume" | "chapter" | "scene";
  title: string;                 // 1-200 字符
  parent_id: string;             // 必填，无默认值
                                 // volume → 挂 root
                                 // chapter → 只能挂 volume（2026-09：root 不再接纳章）
                                 // scene → 必须挂 chapter
  summary?: string;
  data?: Record<string, unknown>; // 可选，节点结构化信息（按层级 schema 校验）
}

// Res: 201
{
  id: string;                    // "vol-2", "ch-8" 等（前缀 + nanoid）
  type: string;
  title: string;
  parentId: string | null;
  updatedAt: string;             // 创建时间戳（节点版本戳）
}

// Res: 400
{ error: { code: "VALIDATION_ERROR", message: "parent_id is required" } }
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
  data?: Record<string, unknown>; // 部分合并（按层级 schema 校验，失败 400 VALIDATION_ERROR）
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
  parent_id: string;             // 新的父节点 ID（严格三层约束同 POST /outline）
  order: number;                 // 在兄弟节点中的位置（0-based）
}

// Res: 200
{
  moved: true;
  previousParentId: string;
  newParentId: string;
}

// 大纲树节点移动（节点即大纲，无游离节点、无独立投影）
```

### DELETE /api/v1/outline/:nodeId

软删大纲节点：标记 `deleted`，**本体保留**可还原；级联移除子节点、关联的 Delta 和关系（仅移除关联数据，被删对象本体保留）。

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
