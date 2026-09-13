# 实体 CRUD

> 七类实体泛型 CRUD + reference 文件联动扫描 + event/timepoint/setting 排序移动端点。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

> **软删过滤**：常规查询端点（GET 列表/详情、关系查询、Delta 查询等）**默认过滤软删对象**；回收站 API（`/api/v1/trash/*`）是访问软删对象的唯一入口。

> **实体类型（2026-08；扩展）**：`type` 现支持 **7 种**——`character` / `setting` / `location` / `hook` / **`event`（事件，时间轴）** / **`timepoint`（时间标签点，时间轴）** / **`reference`（参考资料）**。前 6 种完全复用本章节泛型端点（列表/详情/创建/更新/软删），id 前缀 `ev-` / `tp-`；软删/回收站走 `/api/v1/trash/entity/:type/:id/*` 泛型路径（无需独立端点）。**reference 特例**：`kind='file'` 时服务端**文件联动**——create 落盘 `references/<标题>.md`（YAML frontmatter + 正文）+ 建索引；update **先原子写文件再更新 DB**（文件写失败操作报错、DB 失败 scan 自愈）；软删移文件入 `references/.trash/`、restore 移回、purge 物理删（trash 泛型端点内部分支）；`kind='link'` 纯 DB 无文件联动。

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
  limit?: number;       // 每页条数，默认 50，最大 200
  sort?: "name" | "created_at" | "updated_at";
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
  //   character → role, description (2026-09：data.description 截断 100 字符，同 setting 口径),
  //               motivation（截断 40）、personality（前 2）、ability_panel（面板**顶层分组名**前 2）
  //               —— 2026-09 人物页改为工作台后，这些摘要只供 **AI 工具（search_entities）** 消费
  //               （工作台左栏只显示 姓名 + 角色定位；完整数据走 GET 详情）
  //               注：旧 abilities[]/status 不再提取（status 已移除，abilities 经 007 迁为 ability_panel）
  //   setting   → tags (data.tags 前 3 个：分类统一字段，与 event 同语义),
  //               description (M2，2026-08：data.description 截断 100 字符——列表行展示；
  //               截断防 search_entities 工具上下文膨胀，完整文本在详情页)
  //   location  → type
  //   hook      → status, payoff_timing (从 data JSON 提取)
  //   event     → description, tags (从 data JSON 提取)
  //   timepoint → （无专属摘要字段，G2：时间标签文本 = name）
  //   reference → type, tags, source；kind（file/link）、file_name（file 类相对路径）、
  //               url（link 类）——来源列渲染依据
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
// character: { role?, description?, alias?, gender?, age?, race?, personality?: string[], motivation?, ability_panel?, custom_fields? }
//            （2026-09：description 必填（**仅前端校验** + AI 工具约定；**校验落地 = 卡 3.3 前端表单**，
//             服务端不硬校验，保护提案/旧数据/备份导入三条路径）；status 已移除；abilities 经 007 迁为 ability_panel；
//             分层与面板结构见 ../db/schema.md「人物 data 分层」）
// setting:   { description?, tags?: string[], rules?: string[], custom_fields? }（category/parent_id 已废弃，由 passthrough 容错）
// location:  { type?, parent_id?, description?, custom_fields? }
// hook:      { status?, category?, expected_payoff?, payoff_timing?, half_life?, is_core?, notes?, expected_resolve_node_id? }
//             (hook data 字段 schema：shared `hookDataSchema`，服务端校验)
// event:     { description?, tags?: string[] }（精校验 + passthrough，详见本章节开头字段表）
// timepoint: {}（G2：时间标签文本 = name，data 无专属字段）
// reference: 两类承载：
//   file 类：{ kind: "file", type?, tags?, content? }——服务端落盘 references/<标题 sanitize>.md
//     （YAML frontmatter: title/category/tags + 正文；重名自动 `标题 (N).md`）+ 建索引
//     （data.file_name 相对路径 / content 正文镜像 / file_mtime 同步快照）；kind 缺省视为 link
//   link 类：{ kind: "link", url, type?, tags?, content? }——url **必填**（非空字符串），纯 DB 无文件
// 备注：新建条目不再写入 source 字段（存量旧条目兼容保留）

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

**清空语义（2026-08 用户反馈 F1 修复）**：data 字段提交**空值即清除**——`""`（字符串字段）/ `[]`（数组字段）经浅合并覆盖原值；未传入的字段不受影响（partial）。event 字段（`description`/`tags`）支持此语义（`time_label` 已随 G2 移除）。

```typescript
// Path
type: string;
id: string;

// Req
{
  name?: string;
  data?: Partial<Record<string, unknown>>;  // 只合并传入的 data 字段，不覆盖全部
}

// reference file 类特例：先原子写文件再更新 DB——
//   正文真相在文件：请求未携带 data.content 时（行内编辑标题/分类/标签场景）服务端读原文件正文
//   与最新元数据重写 frontmatter 保留正文；文件读失败（外部删除）→ 409 REFERENCE_FILE_MISSING
//   提示先扫描；文件名不随标题重命名（创建时确定）

// Res: 200
{
  id: string;
  updated: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

### DELETE /api/v1/entity/:type/:id

软删实体：标记 `deleted_at`，**本体保留**可还原；级联移除其关联的关系与 Delta 记录。**reference file 类特例**：文件同时移入 `references/.trash/`（restore 移回、purge 物理删）。

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

### POST /api/v1/reference/scan

扫描重建参考资料索引——幂等全量比对，**文件 = 真相源**：

```typescript
// Req: {}（无参数）

// Res: 200
{
  scanned: {
    added: number;      // 新建索引（references/ 下无匹配索引的 md 文件）
    updated: number;    // 更新索引（mtime 不一致 → 以文件为准重新解析 frontmatter + 正文）
    restored: number;   // 还原索引（文件回归 references/ 且存在软删索引匹配）
    removed: number;    // 软删索引（非软删 file 类索引对应文件在 references/ 与 .trash/ 均缺失）
    skipped: number;    // 跳过（索引存在且 file_mtime 与文件 mtime 一致）
    errors: string[];   // 解析失败文件列表（frontmatter 非法容错为纯 markdown，一般不产生）
  }
}
```

**语义**：
- 遍历 `references/` 顶层 `*.md`（**排除 `.trash/`**，已软删文件不重复建索引）；
- 匹配规则：非软删索引 `data.kind='file'` 且 `file_name` 相同 → mtime 比对（**一致跳过**，不一致以文件为准更新 title/category/tags/content/file_mtime/updated_at）；软删索引匹配 → 还原（`deleted_at=NULL`，文件留原地）并更新；无匹配 → 新建；
- 反向：所有非软删 file 类索引，文件在 `references/` 与 `.trash/` 均缺失 → 索引同步软删（进回收站可还原，软删语义）；
- frontmatter 缺失/非法 → 容错纯 markdown（title=文件名去扩展名、category=material、tags=[]），不报错；
- 仅处理顶层文件（不支持子目录，YAGNI）；无项目 → 409 `NO_PROJECT_OPEN`。

### GET /api/v1/reference/scan/status

**只读探测**：`references/` 下未同步的本地文档数（无副作用，不建索引）。列表页打开时提示条「检测到 N 个未同步的本地文档」用；执行 `POST /reference/scan` 后该值应为 0。

```typescript
// Res: 200
{
  unsynced: number;  // 未同步文件数（同 scanReferences 的匹配规则：新增 + mtime 不一致 + 软删可还原）
}
```

```typescript
// Res: 409
{ error: { code: "NO_PROJECT_OPEN" } }
```

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
