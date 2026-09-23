# 实体 CRUD

> 七类实体泛型 CRUD + event/timepoint/setting 排序移动端点。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

> **软删过滤**：常规查询端点（GET 列表/详情、关系查询、Delta 查询等）**默认过滤软删对象**；回收站 API（`/api/v1/trash/*`）是访问软删对象的唯一入口。

> **实体类型（2026-08；扩展）**：`type` 现支持 **7 种**——`character` / `setting` / `location` / `hook` / **`event`（事件，时间轴）** / **`timepoint`（时间标签点，时间轴）** / **`reference`（参考资料）**。全部 7 种完全复用本章节泛型端点（列表/详情/创建/更新/软删），id 前缀 `ev-` / `tp-`；软删/回收站走 `/api/v1/trash/entity/:type/:id/*` 泛型路径（无需独立端点）。
>
> **reference 特例（2026-09 起）**：参考资料正文是**块文档**——真相存 `document_records`（`owner_kind='reference'`），`entities.data` 只留短字段（`type` / `url` / `tags`）。读写对本组端点的**外部形态不变**（请求/响应仍走 `data.content`），服务端内部把 `data.content` 拆写到文档表（单事务）。**不再有项目目录文件联动**：`references/` 目录、文件扫描、frontmatter、`kind`（file/link）与 `file_name`/`file_mtime` 均已废弃（外部编辑能力改为单文件导入导出，见下）。

**event 的 data 字段（shared `eventDataSchema`）**：

| 字段 | 是否必选 | 数据类型 | 取值范围 | 备注 |
| :--- | :------- | :------- | :------- | :--- |
| `description` | 否 | string | — | 事件描述文本 |
| `tags` | 否 | string[] | — | 标签数组，分类筛选用 |

**G2 修订（2026-08）**：`time_label` 字段**已移除**——时间标签实体化为 `timepoint`（name = 时间标签文本），事件经 `occurs_at` 关系挂载到时间点（1:n，见关系节）。旧数据经迁移 `003_timepoint.ts` 自动转换。

**timepoint 实体（G2）**：`data` 空（`{}`），`name` = 时间标签文本（可重命名）。

- **排序（双独立线性序，G2）**：`GET /api/v1/entity/event` 按 `sort_order` 升序（事件全局线性序，拖拽为权威，组内排序键）；`GET /api/v1/entity/timepoint` 按 `sort_order` 升序（时间点全局线性序，拖拽为权威，组间顺序）。`sort_order` 持久化于 data.db `entities.sort_order` 列（各类型内线性，见 `../db/schema.md`），其余实体类型无该语义。

### GET /api/v1/entity/:type

列出指定类型的所有实体。

```typescript
// Path
type: "character" | "setting" | "location" | "hook" | "event" | "timepoint" | "reference";

// Query
{
  q?: string;           // 搜索关键词（模糊匹配 name）
  offset?: number;      // 分页偏移，默认 0
  limit?: number;       // 每页条数，缺省/上限 = shared `DEFAULT_ENTITY_LIST_LIMIT` / `MAX_ENTITY_LIST_LIMIT`
  sort?: "name" | "created_at" | "updated_at" | "priority";
  // priority（2026-09）：**角色优先级档**（档位升序：主角 → 龙套；未分级沉底；同级 updated_at 降序 → id 升序）。
  //   档位取值/顺序/中文标签单一定义 = shared 常量（见 ../db/schema.md「人物 data 分层」）；
  //   该档仅 character 有语义：其余类型全部无 priority ⇒ 退化为「最近更新降序」
  order?: "asc" | "desc";
  tag?: string;         // 标签包含筛选（2026-08）：data.tags 数组字段包含该标签即命中
                        // （setting 与 event 同字段语义；单标签精确匹配；不传 = 不过滤）
  parent_id?: string;   // 上级设定筛选（2026-08，仅 setting 类型生效，其他类型传入忽略）：
                        //   匹配 = 实体在设定层级树（belongs_to）中直接或间接属于该上级
                        //   （**递归子树，不含上级自身**）；复用 listSettingHierarchyEdges 建邻接表 DFS
                        //   收集后代集合，走 db JS 过滤路径（total = 过滤后总数，分页正确）；
                        //   与 q/tag/排序/分页组合过滤（AND）；指向不存在的设定（含已软删）→ 空结果
                        //   （宽松，同 tag 无匹配不 404）；不传 = 不过滤
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
  type: "character" | "setting" | "location" | "hook" | "event" | "timepoint" | "reference";
  name: string;
  // 各类型的关键摘要字段：
  //   character → role, description (2026-09：data.description 定长截断，同 setting 口径),
  //               motivation（定长截断）、personality（定条数）、ability_panel（面板**顶层分组名**定条数）
  //               —— 2026-09 人物页改为工作台后，这些摘要只供 **AI 工具（search_entities）** 消费
  //               （工作台左栏只显示 姓名 + 角色定位；完整数据走 GET 详情）
  //               注：旧 abilities[]/status 不再提取（status 已移除，abilities 经 007 迁为 ability_panel）
  //   setting   → tags (data.tags 定条数：分类统一字段，与 event 同语义),
  //               description (M2，2026-08：data.description 定长截断——列表行展示；
  //               截断防 search_entities 工具上下文膨胀，完整文本在详情页)
  //   location  → type
  //   hook      → status, payoff_timing (从 data JSON 提取)
  //   event     → description, tags (从 data JSON 提取)
  //   timepoint → （无专属摘要字段，G2：时间标签文本 = name）
  //   reference → type, tags, url（可空）；content 字段 = **正文摘要定长截断**（长度单一定义 = db `toSummary`；来源 = 文档表的
  //               `content_text` 投影，非 block JSON 原文——列表/搜索不得拉入块体）
  summary: Record<string, unknown>;
  // 手动排序位置（2026-08）：**仅 setting 类型填充**——同级组内线性序
  // （同父/同根组内 0..n-1，NULL = 未参与手动排序）；其余类型不出现（稀疏语义）
  sortOrder?: number;
  // M2（2026-08）：**仅 setting 类型填充**——层级 = belongs_to 关系，
  // 服务端列表响应时补查设定间层级边，按 childId 映射附加；无父的设定不出现该字段（稀疏）
  parentId?: string;
  parentName?: string;
  createdAt: string;
  updatedAt: string;
}

// 注意：type="event" 时列表恒按 sort_order 升序返回（事件全局线性序），
// type="timepoint" 时列表恒按 sort_order 升序返回（时间点全局线性序，G2），
// sort/order 查询参数不参与两者排序
```

### GET /api/v1/entity/:type/:id

获取实体详情。

```typescript
// Path
type: "character" | "setting" | "location" | "hook" | "event" | "timepoint" | "reference";
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
type: "character" | "setting" | "location" | "hook" | "event" | "timepoint" | "reference";

// Req
{
  name: string;              // 必填，1-100 字符
  data?: Record<string, unknown>;  // 根据 type 有不同的 schema
}

// 各 type 的 data 字段说明：
// character: { role?, description?, alias?, gender?, age?, race?, personality?: string[], motivation?, ability_panel?, custom_fields?, priority? }
//            （2026-09：description 必填（**仅前端校验** + AI 工具约定；**校验落地 = 前端人物表单**，
//             服务端不硬校验，保护提案/旧数据/备份导入三条路径）；status 已移除；abilities 经 007 迁为 ability_panel；
//             priority = 角色优先级档（shared 常量枚举，缺省 = 未分级；清除 = `null`）；
//             分层与面板结构见 ../db/schema.md「人物 data 分层」）
// setting:   { description?, tags?: string[], rules?: string[], custom_fields? }（category/parent_id 已废弃，由 passthrough 容错）
// location:  { type?, parent_id?, description?, custom_fields? }
// hook:      { status?, category?, expected_payoff?, payoff_timing?, half_life?, is_core?, notes?, expected_resolve_node_id? }
//             (hook data 字段 schema：shared `hookDataSchema`，服务端校验)
// event:     { description?, tags?: string[] }（精校验 + passthrough，详见本章节开头字段表）
// timepoint: {}（G2：时间标签文本 = name，data 无专属字段）
// reference: { type?, url?, tags?, content? }——**内容 = 块文档**（2026-09）；
//   与其余类型的关键差异：`content` 不在 entities.data 里直接落库，而是拆写进 `document_records`
//   的 `owner_kind='reference'` 行（服务端派生 content_text 投影）；
//   未传 content = 正文保持不动（行内改标题/分类/标签场景）；url 可选（纯本地笔记不需要，外源链接才填）；
//   **type 兜底不在 REST**：缺省 material 由 scan / AI executor / client 各自兜底，本组端点不补默认值
//   存留字段：kind / file_name / file_mtime / source **已废弃**（旧值不读、不迁移）

// Res: 201
{
  id: string;                // 自动生成，如 "char-9", "hook-3", "ev-1", "ref-1"（形状示意）
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

**清空语义（2026-08 用户反馈 F1 修复）**：data 字段提交**空值即清除**——`""`（字符串字段）/ `[]`（数组字段）经浅合并覆盖原值；未传入的字段不受影响（partial）。event 字段（`description`/`tags`）支持此语义（`time_label` 已随 G2 移除）。**枚举字段例外**：`character.data.priority` 用 `null` 清除（回到「未分级」）——`""` 不是合法档位，schema 拒绝。

```typescript
// Path
type: string;
id: string;

// Req
{
  name?: string;
  data?: Partial<Record<string, unknown>>;  // 只合并传入的 data 字段，不覆盖全部
}

// reference 特例（2026-09 起）：`data.content` 传入时**拆写进 `document_records`**（单事务），
//   **未携带 `data.content` 时正文保持不动**（行内改标题/分类/标签场景）——取代旧的
//   「先原子写文件再更新 DB」链路；两者不再有先后性与自愈问题（同一事务）。
//   服务端另派生的 `content_text` 投影只进文档表，不出现在响应里。

// Res: 200
{
  id: string;
  updated: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

### DELETE /api/v1/entity/:type/:id

软删实体：标记 `deleted_at`，**本体保留**可还原；级联移除其关联的关系与 Delta 记录。**reference 特例（2026-09 起）**：其文档行**保留**（不可见，还原后原样回来），purge 时与实体一并物理删。

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

> **「未写过」与「空文档」的响应形态（2026-09 定口径）**：两者**详情可区分、列表不可区分**，且与章正文端点有意不相同——
>
> | 载体 | 未写过 | 写过空文档（`content: "[]"`） |
> | :--- | :--- | :--- |
> | 参考资料详情 | `data` 无 `content` 键（`data` 是稀疏对象，见 `../db/schema.md`） | `data.content = "[]"` |
> | 章正文 `GET /manuscript/:id` | `content: ""`（固定字段，用空串表达） | `content: "[]"` |
> | 两者列表 | 无 content 摘要（空投影不占位） | 同左 |
>
> 客户端按「**键缺失 / `""` / `"[]"` 一律当空文档**」处理（块编辑器封装里已如此）；差异只是两种载体的字段形状选择，**不要求服务端把它们归一**。

### 参考资料正文的导入导出（无端点，纯客户端）

参考资料的正文是块文档（同章正文），**外部编辑器能力改为单文件导入导出**，不新增 API：

| 方向 | 格式 | 行为 |
| :--- | :--- | :--- |
| 导出 | 块 JSON | 无损（可再导入）；前端直接序列化编辑器文档 |
| 导出 | markdown | **有损**：颜色/对齐/嵌套/媒体在 md 中无表达——导出前**必须提示** |
| 导入（新建） | markdown | 列表页「导入 md 新建」：解析后与原文比对，**存在无法导入的结构时提示并要确认** → `POST /entity/reference` |
| 导入（覆盖现有正文） | markdown / 块 JSON | 解析/校验后走 `PUT /entity/reference/:id`（携带 `data.content`）；同样先提示有损 |

**已废弃**（旧版能力，不再存在）：`POST /api/v1/reference/scan`、`GET /api/v1/reference/scan/status`、项目目录 `references/` 目录与 `.trash/`、frontmatter（title/category/tags）与文件名 sanitize 规则。参考资料不再从磁盘扫描进入系统——「我看不到磁盘上的笔记了」的替代路径就是上述导入。

### PUT /api/v1/entity/event/:id/move

调整事件在时间轴上的位置（拖拽重排）。**仅 `event` 类型支持**——时间轴事件顺序是全局事件线性序，持久化到 data.db `entities.sort_order` 列（组内排序键，G2）。

```typescript
// Path
type: "event";                // 仅事件可排序（其余实体类型无 sort_order 语义）
id: string;

// Req（shared: entityMoveReqSchema，命名风格同 outlineMoveReqSchema）
{
  order: number;             // 目标位置（0-based 全局事件线性序，范围 [0, 事件总数]）
}

// Res: 200（shared: entityMoveResSchema）
{
  moved: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

**语义**（与 `PUT /outline/:nodeId/move` 口径一致）：
- `order` 超过当前事件总数 → clamp 到末尾（不返回 4xx）；**负数在 HTTP 层被 schema 拒绝（400 VALIDATION_ERROR，`z.number().int().min(0)`）**——db 层 moveEvent 对负数 clamp 至 0 仅为内部防御语义（HTTP 路径不可达）。
- 排序为拖拽权威：移动后事件列表（`GET /api/v1/entity/event`）按新 `sort_order` 升序返回。
- **G2 跨组拖拽**：事件拖到另一时间点区块 = 改挂载（`occurs_at` 关系移除 + 新建）+ 重排——由前端**单请求调用复合端点 `POST /entity/event/:id/move_to`**（服务端事务内一次完成，见下节；两步分调已废弃——非事务有中间态风险）。

### PUT /api/v1/entity/timepoint/:id/move

调整时间点在时间轴上的位置（拖拽重排，G2 修订）。**仅 `timepoint` 类型支持**——时间点顺序是全局时间点线性序（组间顺序），持久化到 data.db `entities.sort_order` 列。

```typescript
// Path
type: "timepoint";            // 仅时间点可排序
id: string;

// Req（shared: entityMoveReqSchema 同款）
{
  order: number;             // 目标位置（0-based 全局时间点线性序，范围 [0, 时间点总数]）
}

// Res: 200（shared: entityMoveResSchema 同款）
{
  moved: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

**语义**：同 event move（clamp 到末尾、负数 400）。**拖拽时间点不修改其下事件序**——仅重排时间点 sort_order（整组移动不动内部，G2 双独立线性序）。


### PUT /api/v1/entity/setting/:id/move

设定同级重排 / 改父 + 重排（2026-08）。**仅 `setting` 类型支持**——设定手动排序 = 同级组内线性序（同父/同根组内 0..n-1），持久化到 data.db `entities.sort_order` 列（新语义；列本身已引入，**无 DDL 迁移，SCHEMA_VERSION 保持 5**）。

```typescript
// Path
id: string;   // 设定实体 id（set- 前缀）

// Req（snake_case）
{
  // 目标父设定 id；null = 移为顶层根（无上级）。null 与「不传」均视为根目标；
  // 与当前父相同（含同为根）→ 不改父，仅重排
  parent_id: string | null;
  // 目标位置（0-based 同级组内序）：改父后 = 新父子级组内位置 / 未改父 = 当前同级组内位置；
  // 越界 clamp（负数 400 schema 拒绝；超组内数 → 组尾）；不传 = 追加到组尾
  order?: number;
}

// Res: 200
{
  moved: true;
}
```

**语义**：

- **复合写端点（对齐 G2 event move_to 先例）**：改父 + 重排**一次事务提交**——①目标父存在性校验（不存在/已软删 → 400 `VALIDATION_ERROR`）；②改父（parent_id ≠ 当前父）→ 事务内建新 belongs_to 边（**防环沿用层级校验**，自指/成环 → 400 `VALIDATION_ERROR`）+ 删旧边；③重排目标同级组（组内 0..n-1 重写 sort_order，仅被移行刷 updated_at——版本戳语义；组内排序键 = `sort_order IS NULL, sort_order ASC, name ASC`，存量 NULL 沉底）。
- 设定不存在/已软删 → 404 `ENTITY_NOT_FOUND`。
- **幂等 no-op**：parent_id 与当前父相同且 order 指向当前位置 → 仅重写组内序（无副作用等价结果）。
- 前端「设定树」：手动排序模式拖拽行间插入线 / ↑↓ 箭头按钮走本端点；拖拽改父流程由原「createRelation + deleteRelation 两步」切换为本端点（详情页 handleSetParent 流程不动，超范围）。
- 其余实体类型无此端点（同 event/timepoint move 先例：仅相应类型支持排序端点）。

### POST /api/v1/entity/event/:id/move_to

事件跨组拖拽复合端点（G2 修订：改挂载 + 重排一次提交，事务原子）。**由前端跨组拖拽单请求调用**——替代「DELETE 旧 occurs_at + POST 新 occurs_at + event move」的按序两步分调（非事务有中间态风险，已废弃）。

```typescript
// Path
id: string;                    // 事件 id（ev- 前缀）

// Req（shared: eventMoveToReqSchema，.strict()）
{
  timepoint_id: string | null; // 目标时间点 id（须为存在且未软删的 timepoint，服务端校验）；
                               //   null = 移出到「未挂载」兜底区（仅重排，不建挂载）
  order: number;               // 目标位置（0-based 全局事件线性序，语义同 event move：越界 clamp、负数 400）
}

// Res: 200（shared: entityMoveResSchema 同款）
{
  moved: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }   // 事件不存在或已软删（事务回滚，旧挂载不丢）

// Res: 400
{ error: { code: "VALIDATION_ERROR" } }   // timepoint 不存在/已软删（ENDPOINT_NOT_FOUND 映射）、参数校验失败
```

**事务内语义**（`withTransaction` 一次提交，失败整体回滚）：
1. 读事件当前 `occurs_at` 挂载（未软删）；
2. **改挂载**：目标与旧挂载不同（或目标为 null）→ 物理删除旧 occurs_at（关系轻量可重建）；目标与旧挂载相同 → **幂等跳过重建**（关系 id 不变，只重排）；
3. `timepoint_id` 非 null → 建立新 occurs_at（timepoint → event，1:n 校验在此路径天然满足——旧挂载已移除）；
4. `moveEvent` 重排全局事件线性序（组内序 = 全局序投影，跨组后全数组重排）。

---
