# 关系管理

> 通用关系表查询（k 跳）/建立/元数据更新/删除（物理）。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

> **端点类型**：关系端点 source_type / target_type 支持全部实体类型（含 **`event`**、**`timepoint`**）与 `outline_node`；预定义关系类型新增 **`occurs_in`**（event→outline_node，事件锚定大纲节点，多对多）与 **`occurs_at`**（timepoint→event，**1:n，G2**）——**锚定/挂载 = 关系本身，无独立字段**；occurs_at 语义：一个事件至多挂一个时间点（服务端建关系校验，重复挂载 **409 `EVENT_ALREADY_MOUNTED`**——先移除旧挂载再建新挂载请走复合端点 `POST /entity/event/:id/move_to`，勿两步分调）；事件无挂载 = 未挂载（归入时间轴「未挂载」兜底区）。

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
  depth: 1 | 2 | 3;      // 1=紧邻, 2=k跳, 3=3 层上限（有向 BFS + 路径级防环；2026-08 修订：文档「全量遍历」对齐实现语义，避免图爆炸）
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
  relation_type: string;     // 预定义 17 类 ∪ 自定义类型（语法见下方说明）
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

> **层级校验（2026-08）**：`relation_type=belongs_to` 且两端均为 `setting` 时（设定层级：子设定 → 父设定）——禁自指（target ≠ source）、**防环**（新父的祖先链不得含该子设定，沿 belongs_to 边向上遍历，db 层全量边邻接表构建）——违规 → 400 `VALIDATION_ERROR` + 中文信息。其余 belongs_to（如人物→设定）与其它关系类型不受影响。
> **伏笔锚点仅章（2026-09）**：`relation_type ∈ {plants, advances, resolves}` 且 `source_type=outline_node` 时，源节点必须为 `chapter`——卷/场景 → 400 `VALIDATION_ERROR`（伏笔是章级叙事事件，与 Delta 锚点同口径；AI 提案通道 `propose_add_relation` 在 tools 层同步拒绝）。
> **关系类型自由化（2026-09）**：`relation_type` 为**自由字符串**（不再枚举校验）= 预定义 17 类 ∪ 自定义类型；语法 = `trim` 后非空、长度 ≤ 32、禁控制字符——违规 → 400 `VALIDATION_ERROR`（校验单一来源 = shared 纯函数，db `createRelation` 守卫同口径）。预定义专属校验（伏笔仅章 / `belongs_to` 防环 / `occurs_at` 挂载）按类型名判断，**自定义类型天然不触发**。属性（展示名 / 分组 / 对称）见 `../db/schema.md` 预定义关系类型表；**AI 提案通道仍限预定义 17 类**（见 [tool-calling.md](./tool-calling.md)）。
> **父子查询约定**：查「X 的父」= `GET /relation?target_type=setting&target_id=X&relation_type=belongs_to&depth=1`（来源端）；查「X 的子」= `GET /relation?source_type=setting&source_id=X&relation_type=belongs_to&depth=1`（目标端）。

### PUT /api/v1/relation/:id

更新关系元数据（2026-08 交互优化 I1：画布连线标签线上编辑）。**仅支持 `metadata` 字段 patch**（当前唯一用途 = `plot_edge` 连线标签）；关系三元组（source/target/relation_type）不可变——要改连接请删后重建。

```typescript
// Path
id: string;

// Req（shared: relationUpdateMetaReqSchema）
{
  metadata: Record<string, unknown>;   // 整体替换 metadata（含清空：传 {} 或 null）
}

// Res: 200
{
  updated: true;
}

// Res: 404
{ error: { code: "RELATION_NOT_FOUND" } }   // 不存在（含已软删——软删关系不可编辑）
```

**语义**：metadata 整体替换（非浅合并）——画布连线标签编辑时传 `{ label: "新标签" }`，清空标签传 `{}`；与 POST 创建侧的 trim 对称，服务端对 label 做首尾空格去除。

### DELETE /api/v1/relation/:id

删除关系。**物理删除，不进入回收站**（关系是轻量可重建对象；`deleted_at` 软删仅服务于实体/节点级联删除场景）。

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
