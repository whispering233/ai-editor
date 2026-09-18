# 数据库 Schema

## 项目文件结构

**书架模型（2026-08，参考 inkos）**：启动目录 = 创作根（书架），每本书一个子目录（`books/<书名>/`），书的数据文件在该子目录下。旧单项目部署（启动目录本身是书）仍兼容。

```
创作根（书架，启动目录）/
├── books/                    # 书架子目录（S1.5 起）
│   └── <书名>/               # 每本书一个目录（创建书 = 新建子目录）
│       ├── project.json       # 项目配置（id/schema_version/current_position 等，见下文契约）
│       ├── outline.json       # 大纲树（卷 → 章 → 场景，严格三层，无游离节点；2026-09：章只挂卷）
│       ├── AGENTS.md          # 项目规则文件（项目规则唯一事实源，可选文件，见下文）
│       ├── sessions/          # 对话历史（一 session 一 JSONL，格式 = pi session v3）
│       │   └── <timestamp>_<session_id>.jsonl
│       └── data.db            # SQLite
│           ├── entities       # 人物 / 设定 / 地点 / 伏笔 / 事件 / 时间点 / 参考资料
│           ├── relation_records  # 通用关系表
│           ├── delta_records    # 属性变更记录
│           └── document_records # 块文档（章正文 / 参考资料正文，2026-10）
│       # 注：项目目录下**不再有** references/ 目录（2026-10 废弃：参考资料正文进 document_records，
│       #     外部编辑能力改为单文件导入导出；历史遗留的同名目录不被读取、不被打包）

# 兼容：启动目录本身含 project.json 时按旧语义打开；
# 无 project.json 时进入书架模式——Dashboard 引导创建（自动建 books/<书名>/）或打开
```

**时间约定**：所有时间列/字段统一 ISO 8601 字符串（如 `2026-08-01T10:00:00Z`），由应用层写入，不使用 SQLite 内置 `datetime('now')`——回收站按 `deleted_at` 排序需跨 SQLite 与 outline.json 统一格式。

**表结构声明层（2026-08）**：表结构的**当前声明**在 db 包 `src/tables.ts`（drizzle `sqliteTable` 定义 + 手写 DDL 常量，同文件、`schema.test.ts` 断言锁对齐）；`db/src/migrations/` 的迁移 SQL 是历史轨迹（自建 user_version 管线）；下表以当前 DDL 为准。

**schema 版本与迁移**：

- **版本判定**：以 data.db 的 `PRAGMA user_version` 为准（`packages/db/src/schema.ts` 的 `SCHEMA_VERSION` 常量）；`project.json`/`outline.json` 顶层的 `schema_version` 仅用于 JSON 结构判断。
- **三态分流（open 时，`ensureSchemaCompatible`）**：
  - `user_version === SCHEMA_VERSION` → 正常打开；
  - `user_version > SCHEMA_VERSION`（未来版本）→ **拒绝打开** 409 `PROJECT_VERSION_NEWER`（数据原封不动，提示升级程序）；
  - `user_version < SCHEMA_VERSION`（旧版本）→ **有迁移路径**（`packages/db/src/migrations/` 存在从当前版本到目标版本的连续迁移链）→ `runMigrations` 前向迁移；**无迁移路径** → 删库重建兜底（备份 `data.db.v{n}.bak` + `outline.json.v{n}.bak`）。
- **迁移机制**：`migrations/` 目录每个文件导出一个 `Migration = { version, up }`（`001_xxx.ts` → version 1），`index.ts` 按 version 升序聚合导出 `MIGRATIONS`（tsc 编译进 dist 随包分发，无运行时目录读取）。`runMigrations` 对缺失版本逐个执行：**每个迁移一个事务（`up(db)` + `setUserVersion(version)` 原子提交——成功 ⇒ 版本已写入；失败 ⇒ 版本未变）**；**整批迁移前自动快照** data.db → `data.db.v{n}.{YYYYMMDDHHmmssSSSZ}.bak`（checkpoint 后复制主文件，时间戳命名，失败重试现场保留）。迁移失败 → 该迁移回滚 + 版本停在前一迁移后，下次 open 重试。（**粒度注**：迁移侧快照为毫秒时间戳且**无去重循环**——同一毫秒的两次批量迁移会后者覆盖前者；真实升级路径不可达，与备份侧 backup 的 +1ms 去重口径不同但已接受。）
- 当前 `SCHEMA_VERSION = 8`；迁移链：`002_event_timeline.ts`（version 2：entities 表 CHECK 扩入 `'event'` + 新增 `sort_order` 列）、`003_timepoint.ts`（version 3，G2 修订：entities 表 CHECK 扩入 `'timepoint'` + `event.data.time_label` 迁移为 timepoint 实体 + occurs_at 关系，同名 time_label 合并为同一 timepoint）、`004_setting_tags.ts`（version 4，K2 修订：**无 DDL**——setting 旧 `data.rules` 分类值复制到 `data.tags` 并移除 rules，仅 data JSON 数据迁移）、`005_reference.ts`（version 5：entities 表 CHECK 扩入 `'reference'`，无数据搬移仅 DDL）、`006_sessions_jsonl.ts`（version 6：**对话历史出库**——`chat_messages` 全量导出为旧格式 `sessions/<session_id>.jsonl` 后 `DROP TABLE`；产物为旧 v1 格式，现已被 pi session 格式取代、不再被读取（数据保留在磁盘）；**id 不合法的旧会话以 `sess_legacy_<sha256 前 16 位>` 文件名导出**）、`007_character_ability_panel.ts`（version 7，2026-09：**无 DDL**——`character.data.abilities[]` 迁为 `ability_panel` 叶子并移除旧字段，幂等且不覆盖已有 `ability_panel`，仅 data JSON 数据迁移，同 004 先例）、`008_document_records.ts`（version 8，2026-10：新增 `document_records` 表（块文档），纯 DDL 无数据搬移——开发阶段，旧 `references/` 目录与旧参考资料行不作兼容读取）。**SQLite 无法直接修改 CHECK 约束**，迁移走「建新表（新 CHECK）→ 拷贝数据 → drop 旧表 → rename」四步（`relation_records`/`delta_records` 无外键指向 entities，迁移只动 entities 表）；v1 → v8 迁移链存在 ⇒ 旧库 open 时自动前向迁移，不再走删库重建兜底。
- **import 侧联动**：导入备份时 `user_version < SCHEMA_VERSION` 且**有迁移路径** → 接受（搬入后 open 自动迁移，v5 及更早备份经增量迁移升到 **v8**，含对话历史出库、能力面板迁移与块文档表创建）；无路径 → 409 `SCHEMA_VERSION_MISMATCH`；`>` 当前 → 409（未来版本语义）。
- **全新空库短路（2026-09，卡 2.9）**：`user_version = 0` 且**表结构与当前 DDL 一致**且**业务表无行** → 直接写入 `SCHEMA_VERSION`（**不重建、不备份、不碰 `outline.json`**）——覆盖“书目录有 project.json/outline.json 但缺 data.db”的场景（否则会走无路径重建兼重置大纲）。**反向守住**：结构陈旧（旧 CHECK / 残留表）或有数据的 v0 库仍走既有重建兑底。**已知不对称（已登记）**：备份包内的 v0 空库仍在导入侧被 409 拒绝（`validateBackupPackage` 复用 `hasMigrationPath`），而盘上同内容文件现在会被接受——偏差方向只宽松、无数据风险。

## entities — 实体表

```sql
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event', 'timepoint', 'reference')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',  -- JSON: 各类型的专属字段
  sort_order  INTEGER,                     -- 线性序：event/timepoint 各类型内线性（各自 0..n-1）；setting 为**同级组内线性序**（同父/同根组内 0..n-1，NULL = 未参与手动排序）；其余类型恒为 NULL
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对）
  deleted_at  TEXT             -- 软删标记，NULL 表示未删除；非 NULL 时该实体进入回收站，本体保留可还原
);
```

`data` 列按 `type` 存储不同的 JSON 结构：

| type | data 关键字段 |
|------|-------------|
| `character` | **不可变**：`role`（角色定位——**新建弹窗必填；详情页允许为空**，两者口径有意不同）, `description`（**必填**——人物概述：这个人物是谁；**校验落地 = 卡 3.3 前端表单 + AI 工具约定，服务端不硬校验**）；**可变**：`alias`（假名/化名——**单值**：阅读进度时这个人的化名是什么；Delta `set`/`update` 标量而非数组）, `gender`, `age`, `race`, `motivation`, `personality[]`, `ability_panel`（能力面板树）；`custom_fields`。（**2026-09 修订**：`status` 彻底移除——详情表单/列表/AI 摘要三处早已无展示，旧残留由 `.passthrough()` 容错；`abilities[]` 经 007 迁移为 `ability_panel`，见下方「人物 data 分层」） |
| `setting` | `description`, `tags[]`（**分类标签，统一字段**）, `rules[]`（**规则条款，仅详情页编辑**）, `custom_fields` —— **`parent_id` 与 `category` 均已废弃**：层级由 belongs_to 关系表达、分类由 tags 承接；旧字段残留由 `.passthrough()` 容错；旧 rules 分类值经 004 迁移（SCHEMA_VERSION 4）复制到 tags |
| `location` | `type`, `parent_id`, `description`, `custom_fields` |
| `hook` | 伏笔（关系生命周期见下方 `plants`/`advances`/`resolves` 等）；data 字段集见 shared `hookDataSchema`（status/category/expected_payoff/payoff_timing/half_life/is_core/notes/expected_resolve_node_id），服务端按 schema 校验 |

> **`hook.data.expected_resolve_node_id`（预计回收节点）三层口径（卡 7.2 登记）**：**UI 只列章**（`HookPanel` 与 `#/hooks/:id` 两处渲染器都用 `chapterNodeOptions`）；**数据层接受任意节点**（`hookDataSchema` 无章约束）；**分析层容忍非章**（`packages/tools/src/analysis/hook.ts` 的 `ready_to_resolve`：节点无章号 → `null`，不猜测——场景值按其所属章序参与判定）。注意与**伏笔关系**源端（`plants`/`advances`/`resolves`）区分：那一层是**硬校验章**（服务端 400），与本 data 字段不是同一层。
| `event` | `description`（文本）, `tags[]`（字符串数组，分类筛选用）——**G2 修订：`time_label` 已移除**（迁移至 timepoint 实体 + occurs_at 关系，见下） |
| `timepoint` | `{}`（无专属字段——**G2：时间标签文本 = name**，可重命名；YAGNI 不加 data） |
| `reference` | `type`（**自由文本分类**——缺省 `material` 写入侧兜底）、`url`（可选——外源链接才填）、`tags[]`（标签数组）——参考资料是外部素材/灵感笔记，AI 可读取参考、提案写入；**正文不在 data 里**：`content` 存在 `document_records`（`owner_kind='reference'`），`data` 只留上述短字段（**`kind` / `file_name` / `file_mtime` / `source` 均已废弃**，2026-10：两类承载合并为一类；外部编辑改为单文件导入导出，不再有 `references/` 目录与扫描） |

### 人物 data 分层（2026-09）

人物 data 按**可变性三分**建模——它同时是「双视图」（UI 文案：人物档案 / 阅读进度）、「变更记录字段白名单」与「AI 变更提案边界」的共同依据：

| 分层 | 字段 | 是否参与 Delta |
|------|------|----------------|
| **不可变** | `entities.name`（姓名，**列**不是 data 字段）、`data.role`（角色定位）、`data.description`（描述，必填） | **否**——不出现在变更记录的字段下拉；人工经 `PUT` 直接编辑 |
| **可变** | `data.alias` / `gender` / `age` / `race` / `motivation` / `personality[]` / `ability_panel` 叶子值 / **`custom_fields`**（可被点分路径 Delta 命中，故与不可变区语义互诉；MVP 只在已有该键时渲染、不可新增键） | **是**——沿大纲树父链（章序前缀）累积，构成「阅读进度」视图 |
| **关系网** | `relation_records`（人↔人 5 类 + `appears_in` / `belongs_to` / `owns` / `masters`） | 否——关系不参与 `computeState` |

**`ability_panel` 能力面板结构**（用户自定义字段树，递归）：

```json
[
  { "name": "火系", "children": [
      { "name": "等级", "value": 3 },
      { "name": "熟练度" }
  ]}
]
```

- **结构不变式**：有 `children` = 分支（**不可赋值**）；无 `children` = 叶子（**可赋值**）；**空数组 `children: []` 视为叶子**（归一化时删除该键——与「删掉最后一个子节点即降级为叶子」一致）。删除分支的最后一个子节点 → 该节点降级为叶子。叶子 `value` 允许缺省（空值）。嵌套层数不限；顺序 = 数组顺序（**无 `sort_order` 列、无迁移**）。
- **叶子值类型**：`string | number`（与 `DeltaChange` 的 `from`/`to`/`value` 同域）；UI 自动判定（纯数字 → number）。**两条写入路径同源**（卡 3.4 修复轮）：面板编辑器与「+ 新建变更」字段（面板叶子选项带 `panelLeaf` 标记）**均走 shared `coerceAbilityValue`**——纯数字字面量 → `number`，其余 → `string`，空/空白 → 空值；无值叶子同样按此判定（不因"首次写入路径"而异）。
- **结构与值分工**：增删/改名/排序节点 = 人工编辑（`PUT /entity/character/:id` partial，**不产生 Delta**）；**只有已存在的叶子**可被 Delta 修改，字段路径 = 点分拼接（如 `ability_panel.火系.等级`）。
- **宽校验**：`characterDataSchema` 对 `ability_panel` 不做结构精校验（`z.unknown().optional()`，沿用 `custom_fields` 的宽松先例）——UI 输入受控 + 读取端防御（**口径：缺失/顶层非数组 → 空面板；数组内坏元素跳过、合法元素保留**，绝不抛错打挂 `computeState`/列表接口）。**因此所有读端（摘要/统计/叶子路径枚举/副本派生）都必须先过 `parseAbilityPanel` 规范化**，消费方不得假定 `data.ability_panel` 是规范形状。

**`status` 移除与 `abilities` 迁移（007 迁移，SCHEMA_VERSION 7）**：

- `status`（旧「人物当前处境」自由文本）：**彻底移除**（`characterDataSchema` + `toSummary` character 分支 + `getEntitySummary(character).byStatus` + 文档）。**`data.status` 机制本身保留**——伏笔 `hook.data.status` 生命周期（`planted → progressing → resolved / abandoned`）与 `matchDataFilters.status` / `filters.status` 通用过滤不受影响。**无数据迁移**（旧残留 passthrough 兜底，不解析不展示）。
- `abilities[]`（旧标签数组）→ `ability_panel`：007 迁移把每个标签迁成**顶层分组「能力」下的一个叶子**（`value` 留空），并移除旧字段。**幂等 + 不覆盖**：仅处理「含 `abilities` 且无 `ability_panel`」的角色行，已手建面板的角色不动。**软删角色行同样被迁移**（还原后即带面板）；非 character 类型不动；坏 JSON / 非对象 data 行跳过不抛错。
- **统计口径连带**：`get_entity_summary(character).topAbilities` 与 `toSummary` 的能力摘要改读**面板顶层分组名**（如「火系」「水系」）——叶子名多是「等级/熟练度」这类重复词，按叶子计数无意义。

### 时间轴（时间标签点实体化）

**G2 设计（2026-08 用户裁决）**：时间轴数据项分两类——**时间标签点（timepoint）** 与 **事件（event）**，时间标签从事件剥离为独立实体：

- **第 6 种实体类型 `timepoint`（时间标签点）**：id 前缀 `tp-`；`name` = 时间标签文本（如「第二天黄昏」「第三纪元」，可重命名）；`data` 空；`sort_order` = 时间点全局线性序（拖拽为权威，组间顺序）。
- **第 5 种实体类型 `event`（事件）**：id 前缀 `ev-`；`data` 含 `description` / `tags[]`（`time_label` 已移除）；`sort_order` = 事件全局线性序（拖拽为权威，**组内排序键**——渲染时组内按事件全局序投影排序）。
- **双独立线性序**：timepoint.sort_order（组间序）与 event.sort_order（组内序）完全正交；**拖拽时间点不修改其下事件序**（整组移动不动内部）；跨组拖拽事件 = 改 occurs_at 关系 + 服务端重排事件全局序（全数组 0..n-1）。
- **挂载关系**：`occurs_at`（timepoint → event，**1:n**——一个事件至多挂一个时间点，服务端建关系校验；事件无挂载 = 未挂载，归入时间轴「未挂载」兜底区）。
- **软删/回收站**：timepoint 软删 → 其下事件 occurs_at 级联软删 → 事件变未挂载（事件本身不删），restore 级联还原。
- **迁移（003_timepoint.ts）**：旧 `event.data.time_label` 按值聚合——同名合并为同一 timepoint + 建 occurs_at + 从 event.data 移除 time_label；无 time_label 事件不建关系。
- **导出/导入**：自动覆盖（data.db 整库 zip）；导入端 open 时经增量迁移升到 v3。

## relation_records — 通用关系表

```sql
CREATE TABLE relation_records (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,             -- 端点类型：实体 'character'|'setting'|'location'|'hook'|'event'，大纲节点 'outline_node'
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata      TEXT,             -- JSON 扩展元数据
  created_at    TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对；软删/还原亦更新）
  deleted_at    TEXT              -- 级联软删标记：仅实体/节点级联删除时写入；
                                  -- 手动删除关系 = 物理删（不置 deleted_at，不进入回收站）
);

-- 索引（修订补）：k 跳遍历与高频关系查询
CREATE INDEX idx_relation_source ON relation_records(source_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_relation_target ON relation_records(target_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_relation_type   ON relation_records(relation_type) WHERE deleted_at IS NULL;
```

> **可见性过滤**：常规查询过滤关系时需 join 校验 source/target 端点均未软删——任一端点软删即不可见；restore 级联还原全部关系，端点还原后自动可见。

预定义关系类型：

| 关系类型 | 说明 | 示例 |
|---------|------|------|
| `belongs_to` | 所属（**层级语义**：setting→setting 表达设定父子，子 belongs_to 父；防自指/成环由 POST /relation 校验） | 人物→设定；子设定→父设定 |
| `owns` | 拥有 | 人物→物品 |
| `masters` | 掌握 | 人物→能力 |
| `ally` / `rival` / `mentor` / `family` | 人物间关系 | 人物→人物 |
| `kills` | 击杀 | 人物→人物 |
| `appears_in` | 出现于大纲节点 | 实体→大纲节点 |
| `occurs_in` | 发生于大纲节点（事件锚定） | event→大纲节点（多对多：一个事件可关联多个场景/章节，一个场景可被多个事件引用；**锚定 = 关系，无独立 chapter_anchor 字段**） |
| `occurs_at` | 发生在地点 | 大纲节点→地点 |
| `plot_edge` | 剧情连线（画布推演） | 大纲节点→大纲节点，`metadata` 存连线标签 |
| `plants` / `advances` / `resolves` | 伏笔管理（**源端仅章**：仅有 `chapter` 节点可作为伏笔锚点，`POST /relation` 校验 400——伏笔是章级叙事事件） | 章节点→hook |
| `depends_on` | 伏笔依赖 | hook→hook |
| `involves` | 涉及 | hook→实体 |

> **对称关系（2026-09）**：`ally` / `rival` / `family` 语义对等——展示层合并为一行 + 「双向」徽标（不自动建反边）、AI 冲突检测把「单向存在」报为数据缺口；两者共用同一属性（shared `RELATION_TYPE_META[*].symmetric`）。其余类型（含 `mentor`）有向，**自定义类型一律有向**。

**关系类型 = 预定义词表 ∪ 自定义**：`relation_type` 无 CHECK（裸 `TEXT`），写入白名单严格性只在写入路径（REST schema / db 守卫 / AI 工具 schema），**新增或自定义类型不需要迁移**。

- 预定义 17 类 = 推荐词表（AI 契约与 UI 分组依据）；其属性（label / group / symmetric）**单一来源 = shared `RELATION_TYPE_META`**（`Record<RelationType, …>`，加类型即编译报错直到补属性），消费方（client 标签与子集、tools 冲突检测）一律派生，禁止手抄。
- 自定义类型（2026-09）：`trim` 后非空、长度 ≤ 32、禁控制字符；**无中心记录**（类型只活在 `relation_records.relation_type` 里，下拉从「预定义 ∪ 本项目已用的**自定义**类型」派生）⇒ 无改名/合并入口（见 `../design/backlog.md`）。视觉/字段名区分：自定义类型显示原文（`relationTypeLabel` 回退），不参与伏笔锚点、`belongs_to` 防环等预定义专属校验。

## delta_records — 属性变更表

```sql
CREATE TABLE delta_records (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,       -- 触发变更的大纲节点（**仅章**：POST /delta 校验节点 type='chapter'，非章 400）
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  changes     TEXT NOT NULL,       -- JSON: [{field, op, from?, to?, value?}]
  description TEXT NOT NULL,       -- 人类可读描述
  "order"     INTEGER NOT NULL DEFAULT 0,  -- 同一节点内多个 Delta 的排序（全局单调递增，服务端生成）
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对）
  deleted_at  TEXT              -- 级联软删标记：仅实体/节点级联删除时写入。
                                -- 可见性联动触发节点与目标实体：任一端软删即不可见
);
```

> 状态计算采用**章序前缀累积**（2026-09 修订）：`computeState` 收集「章序 ≤ 目标进度章」的全部已确认 Delta，**先按章序（全局先序，树序即阅读序）→ 同一章内按 `order` 排序应用**；目标节点 → 进度章：章→自身、场景→所属章、卷→该卷最后一个未软删章、root→初始值；`plot_edge` 连线不参与。大纲严格三层、无游离节点。
>
> **锚点仅章（2026-09）**：Delta 的触发节点只能是 `chapter`——卷太粗、场景太碎，一章一个状态变化点才是叙事粒度；**收窄仅限写入**（`POST /delta` 400 + AI `propose_add_delta` 拒绝），`POST /delta/compute` 的 `at_node_id` 不限层级（「第 3 章第 2 场时他什么状态」是合法查询——**只存 API/工具层入口**：前端两个选择器（人物页「阅读进度」/ 通用 compute 探针）只列章，见 `../ui/DESIGN.md`）。**与章序前缀累积配套**：正因为锚点只在章，累积才必须按章序前缀（父链至多含一章，无法跨章累积）。
>
> **字段路径（2026-09）**：`field` 支持点分嵌套路径（`ability_panel.火系.等级`）——`computeState` 逐层下钻定位；**嵌套路径仅支持标量 `set` / `update`**，`add` / `remove`（数组语义）只在顶层字段使用。
>
> **面板路径解析口径（2026-09）**：面板是 `{name}[]` 数组而非对象 → **数组段按同层 `name` 匹配，取先序第一个**；**名字含分隔符 `.` 的节点无法被点分路径寻址**（路径按 `.` 切分后命中不到 → 记 `conflicts`，不静默写坏；由 UI 结构编辑内联提示避开）；**同层重名 → 取先序第一个**（同理提示避免）。路径前缀（`ability_panel.`）由 shared 的统一 helper 拼接，**禁止消费方手拼**。
>
> **解析步骤（唯一实现点 = `computeState`）**：① **顶层精确键优先**（`Object.hasOwn(state, field)` 命中 → 按顶层字段处理，向后兼容含字面 `.` 的顶层键）；② 未命中且字段含 `.` → 逐段下钻（对象键 / 数组段按 `name` 匹配取先序第一个）；③ **中途段不存在 → 不抛错，按「跳过 + `skipped`/`conflicts` 标注」处理**（与 `update` 不匹配同款可见性——不静默 inert）；④ `add`/`remove` **永不走点分路径**（仅顶层字段）。**已知代价**：面板结构改名/删叶子后，旧 Delta 的路径会解析失败 → 产生冲突标注（结构漂移的必然代价，不自动重写历史）。
>
> **已知边界（开发阶段决策）**：卡 1.2 之前写入的非章锚点（卷/场景）Delta **既不被累积、也无 UI 入口**（读侧宽松但不展示）——手改文件或导入旧备份时这些记录会静默 inert；开发阶段无存量数据，不做兼容。
>
> **状态机字段用 `set`（2026-09）**：伏笔 `status`（`planted → progressing → resolved / abandoned`）的 Delta 一律 `op=set`——该字段由写路径同步为**最新值**（终态守卫/列表分组/AI 统计直接读 `data.status`，见 `../design/10-data-model.md` §4、《钩子状态同步》），与 `update` 的「`data` = 初始值」前提互斥；用 `set` 后重放恒得正确终态、不再产生假 `conflicts`（from→to 叙事保留在 `description`）。**已知边界**：`at_node` 在首次转移之前时返回最新值（近似；按所属章的进度章判定，故该章之前的场景同属此窗口）。

## document_records — 块文档表（2026-10）

块文档（章正文 / 参考资料正文）的唯一存放点——**块编辑器原生文档（块数组 JSON）为真相**，外加服务端派生的纯文本投影：

```sql
CREATE TABLE document_records (
  owner_kind   TEXT NOT NULL,   -- 'chapter' | 'reference'（枚举值少且稳定，不加 CHECK）
  owner_id     TEXT NOT NULL,   -- 'ch-*'（章节点 id）| 'ref-*'（参考资料实体 id）
  content      TEXT NOT NULL,   -- 块数组 JSON 字符串（真相；服务端读路径不解析）
  content_text TEXT NOT NULL,   -- 服务端派生的轻量 md 投影（AI 读取/列表摘要/搜索/字数）
  created_at   TEXT NOT NULL,   -- ISO 8601，应用层写入
  updated_at   TEXT NOT NULL,   -- ISO 8601，应用层写入（版本戳：多标签页防覆盖）
  PRIMARY KEY (owner_kind, owner_id)
);
```

| 不变式 | 口径 |
| :--- | :--- |
| **无外键** | 两个 owner 分居不同表（章在 `outline.json`、参考资料在 `entities`），故不设 FK——存在性与层级由**写入侧守卫**保证（章必须存在、未软删且 `type='chapter'`；参考资料必须存在且未软删） |
| **生命周期跟随 owner** | 无独立 `deleted_at`：owner 软删 → 行保留且不可见（GET 404）、还原后原样可见、purge 时一并删行。文档不进回收站，也不单独可恢复 |
| **投影单一写入人** | `content_text` 只能由服务端从 `content` 重算（客户端不得提交）；派生**容错**（未知块跳过 + 整体 try/catch 兜底），**派生失败不得阻断保存** |
| **写入校验** | `content` 必须是 JSON 字符串且 `JSON.parse` 后为数组（浅守卫 400）；不做块级 schema 校验（块格式归编辑器所有） |
| **不参与 Delta / 关系** | 正文是内容而非状态事实：保存正文不产生 Delta、不进 `relation_records`、不推进 `current_position`（见 `../design/10-data-model.md` §13） |
| **不进 outline.json** | 章正文若写进大纲树，会让整树接口（大纲页、`get_outline` 工具）被动拖入长文本——因此单独成表 |

**读取投影的两个消费面**：① AI 工具（单章只读拉取 / 参考资料全文）——只拿 `content_text`，绝不拿块 JSON；② 列表与摘要（参考资料列表的 `content` 摘要 120 字、`GET /outline?with_metadata=true` 的章 `charCount`）——用 `length(content_text)` 与切片，不解析块体。

## sessions/*.jsonl — 对话历史（文件存储）

对话消息**不存 data.db**，一 session 一个 JSONL 文件，落在项目目录 `sessions/`。会话随书目录移动/备份/恢复自然携带，不依赖 db。

**格式所有权归 pi**：文件名（`<timestamp>_<id>.jsonl`）与行结构（header + 树状 entry）由 pi `SessionManager` 定义与解析——本仓**不定义、不解析**行结构，只消费下表两个投影。pi 的版本迁移链（v1→v2→v3）由 pi 在载入时自动执行。

### 本仓依赖的契约面

| 契约 | 说明 |
| :--- | :--- |
| 目录 | `<项目目录>/sessions/`（缺失则创建；不入 git、随备份整目录打包） |
| session_id | pi 生成的不透明 id；**客户端传入值只能经磁盘发现 + header id 映射解析为路径，禁止拼接** |
| 消息投影 | 每条 entry 投影为 `{ id, role, content, toolCalls?, toolCallId?, createdAt }`；`role` ∈ `user` / `assistant` / `tool`（pi 的 `toolResult` 投影为 `tool`） |
| 思维链 | assistant 消息的 thinking 内容随消息投影下发（列表投影只给预览，见 `docs/api/80-api-chat.md`） |
| 会话列表投影 | `id` / `createdAt` / `updatedAt` / `messageCount` / `lastMessage`（末条可见文本截断） |
| 删除 | 物理删文件（无回收站、无软删）；有在途 SSE 的会话拒删（409 `SESSION_BUSY`） |
| 旧格式 | v1 扁平行历史文件留在磁盘但**不被 pi 发现**（无效 header）——不出现在列表、不可续聊 |

**其他 entry**：压缩摘要、模型/思考强度变更都是 pi 的 entry，不进入消息投影（前端不展示，但影响重建后的上下文）。

## outline.json — 大纲树

大纲树是纯 JSON 文件，不与 SQLite 混合。**严格三层（卷 → 章 → 场景），无游离节点**。**2026-09 收紧：`root` 仅接纳卷（章只挂卷）**——存量根级章读容忍（可渲染/改名/删除/拖进卷，不能再新建或移回 root），无迁移。

```json
{
  "id": "root", "type": "root",
  "schema_version": 1,
  "children": [
    {
      "id": "vol-1", "type": "volume", "title": "第一卷",
      "updated_at": "2026-08-01T10:00:00Z",
      "data": { "climax_scene": "sc-12", "inciting_scene": "sc-3" },
      "children": [
        { "id": "ch-1", "type": "chapter", "title": "第一章",
          "updated_at": "2026-08-01T10:00:00Z",
          "data": { "reversal": "张三决定叛出师门", "climax_scene": "sc-5" },
          "children": [
            { "id": "sc-1", "type": "scene", "title": "灵根测试失败",
              "updated_at": "2026-08-01T10:00:00Z",
              "data": { "goal": "确认灵根品质", "conflict_levels": ["inner", "personal"],
                        "value_from": "希望", "value_to": "绝望" } }
          ]
        }
      ]
    }
  ]
}
```

**理由**：大纲的树形结构与实体关系表对存储格式的要求天然不同——大纲需要整树读写、拖拽重排，JSON 文件更合适。

**节点版本戳**：每个节点携带 `updated_at`（ISO 8601），节点任何字段变更（title/summary/data/children 重排）时由服务端在原子写流程中统一更新，支撑提案快照比对。

**节点结构化信息 `data`（2026-08 新增）**：可选 `data` 字段（`Record<string, unknown>`，默认省略），按层级 schema（`OUTLINE_NODE_DATA_SCHEMAS`）校验，字段集基于麦基《故事》理论：

| 层级 | data 字段 | 说明 |
|------|-----------|------|
| `scene` | `goal`（文本，max 1000）、`conflict_levels`（`inner`/`personal`/`extra_personal` 多选）、`value_from`/`value_to`（开场/收场价值双文本，各 max 200） | 场景目标/欲望、冲突三层次、价值转向（麦基场景定义） |
| `chapter` | `reversal`（单文本，可选，max 1000）、`climax_scene`（场景节点 id 引用，可选） | 章末反转、章高潮场景 |
| `volume` | `climax_scene`（场景节点 id 引用，可选）、`inciting_scene`（激励事件落位，可选） | 幕高潮、激励事件 |

- 引用字段宽松校验：`climax_scene`/`inciting_scene` 引用任意场景节点 id，MVP 不校验引用范围（UI 提示建议本层内），详情页可跳转。
- 编辑节点 data **不自动生成 Delta**（手动编辑 data 不产生变更记录属正常行为）；变更记录由「+ 新建变更」显式创建（S5.6）。
- 关联（人物/地点/伏笔）一律走 `relation_records`，不在 data 中重复建模。

**顶层 `schema_version`**：与 project.json 同步写入，用于 outline.json 文件格式演进判定；删库重建时同步重置。

**软删字段**：节点可选 `deleted: bool`（默认 false，省略即未删）与 `deleted_at: string`（ISO 时间，软删时写入）。软删节点本体仍保留在文件中，常规查询/渲染默认过滤，回收站列表按 `deleted_at` 排序，定期清理按 `deleted_at` 判定保留时长；还原时清除标记即可。

## project.json — 项目配置契约

项目根目录的配置文件，是**数据文件**（非代码）。首次初始化时自动创建，此后跨启动稳定存在；**实现任何 project 相关端点前先读本节**。

```json
{
  "id": "proj-abc123",
  "name": "我的小说",
  "language": "zh",
  "schema_version": 1,
  "current_position": "ch-12",
  "backup_frequency_minutes": 10,
  "created_at": "2026-08-01T10:00:00Z",
  "updated_at": "2026-08-01T10:00:00Z"
}
```

> **`prompt` 字段已废弃（2026-08）**：项目规则唯一事实源改为项目目录 `AGENTS.md` 文件（见下节），`prompt` **不再读写**——新写入不再产生该字段；旧文件中的残留字段宽松读取（不参与 schema_version 判定）。打开项目时若 `prompt` 存在且无 AGENTS.md → 自动迁移写入 AGENTS.md（内容原样，一次性）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 项目唯一 id，首次初始化时生成（前缀 `proj-` + nanoid），**跨启动稳定**；**备份/恢复的唯一 key**——导入/加载备份时以 zip 内 id 与书架比对，匹配 → 覆盖恢复，不匹配 → 导入为新书 |
| `name` | string | 项目名称，默认取目录名；**与目录名绑定**（「目录名 = 书名」不变式：同名并存时目录与 name 同步去重为 `<书名> (N)`） |
| `language` | `"zh"` \| `"en"` | 语言 |
| `prompt` | string | **已废弃**：项目级提示词——不再读写；项目规则改由项目目录 `AGENTS.md` 承载（见下节）。旧文件中的残留字段宽松读取（不参与 schema_version 判定），新写入不再产生该字段 |
| `schema_version` | number | JSON 结构版本（与 outline.json 顶层同步写入） |
| `current_position` | string \| null | 大纲「阅读进度」节点 id（**UI 文案 = 阅读进度；字段名不变**；伏笔健康指标/双视图依赖；null = 未设置；**须指向存在的非软删 `chapter` 节点**——卷/场景不承载写作进度，非章 → `PUT /project/config` 400）。**读侧宽松**：存量指向非章节点的值由 `ChapterIndex.chapterOf` 沿父链推导兜底，不报错 |
| `backup_frequency_minutes` | number \| null | **自动备份频率（可选字段）**：分钟数，仅接受枚举 1/5/10/15/30/60；`null` / `0` = 关闭；**缺省 = 10**（新项目默认开启）；随书籍（每项目独立）；不参与 schema_version 判定（宽松读取，缺省兜底） |
| `created_at` / `updated_at` | string | ISO 8601，应用层写入；首次初始化写 `created_at`，配置变更更新 `updated_at` |

> **云盘凭据不在本文件**（铁律）：云端存档的 WebDAV 地址/用户名/密码与同步状态落**创作根** `<创作根>/.ai-editor/cloud.json`（明文 + 权限 0600），与模型 API key 同等对待——**绝不进项目文件、不进备份 zip**。见 `../design/40-cloud-sync.md` 与 `../api/100-api-cloud.md`。

**约束**：
- 模型 API key **绝不写入本文件**——凭据归 pi 的 agent dir（`~/.pi/agent/auth.json`，一家一条且存量凭据优先，环境变量仅在该家无条目时兜底；写入只在设置页经 pi credential store），见 `docs/design/config.md`。
- 文件写入遵循原子写流程（outline.json 同款：临时文件 + fsync + rename）。
- **自动备份目录**：项目目录内 `.backups/` 子目录存放备份 zip。命名格式：`<YYYYMMDD-HHmmssSSS>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip`——毫秒时间戳（本地时区，字典序 = 时间序，`parseBackupFileName` 解析为列表项的 `createdAt` 与保留策略排序依据）＋类型段（`自动` = 定时器 / 覆盖前快照，`手动` = 立即备份）＋设备段（必填：来源机器，缺省 = 简化 hostname；禁 `-`）＋可选用户标签（1-30 字符）＋**尾部固定三段统计**（人物/设定/章 = 生成时点的未软删存量；固定尾部使解析可从尾部倒切）。**写入 = 解析 = 唯一格式**（2026-09 收敛）：早期三类旧命名（秒级 / 带标签无类型段 / 单字母 `-m`/`-a` 段）**不再解析**（文件留盘但不列表、不可恢复、不参与保留策略），也不做重命名迁移；`device`/`stats` 恒有（API 契约必填）。**升级兜底**：打开项目时若 `.backups/` 有文件但无一可解析 → 立即生成一份新格式备份。包内容 = 导出包：project.json + outline.json + data.db（**含正文与参考资料**）+ `sessions/**`（2026-10 起不再含 `references/**`）。**每项目保留最近 20 份**（超出删除最旧，含覆盖前自动快照；清理失败不阻塞备份主流程）；备份文件不入 git、不算数据文件（可随时删除）。**实现细节（2026-08 实测）**：同毫秒冲突用「时间戳 +1 毫秒循环去重」（保持文件名格式契约可解析）；「有变更才备份」的 mtime 判定加 1s 容差（备份管道内 wal_checkpoint 会把 data.db mtime 刷新到备份时刻，严格 `mtime > 上次备份时刻` 会自激误判——毫秒精度下文件名截断误差已消除，但粗粒度 mtime 文件系统（如 FAT/exFAT 2s 粒度）下容差仍是必要防御，`BACKUP_CHANGE_TOLERANCE_MS` 保留 1s）；变更判定同时看 `sessions/` **目录自身**的 mtime（删除会话文件不刷新剩余文件 mtime；正文/参考资料写 `data.db`，由 `-wal` 判定涵盖）；重命名备份只改标签段（时间戳/类型/设备/统计保持，同目录 rename 原子）。

## AGENTS.md — 项目规则文件（2026-08）

项目目录下的 `AGENTS.md` 是**项目规则唯一事实源**（取代 project.json `prompt` 字段；此前曾否决「另立 rules.md 与 prompt 并存」的双通道方案，规则文件定义为唯一事实源，不存在双通道漂移）。**不是 project.json 内字段**，是项目目录下的独立文件（与代码仓库 AGENTS.md 惯例一致，用户可在文件管理器中直接编辑、可纳入版本管理）。

**文件位置**：`books/<书名>/AGENTS.md`（项目目录下，与 project.json / outline.json / data.db 同级）。

**可选文件**：新项目默认不创建；无 AGENTS.md 时项目规则为空（system prompt「## 项目设定」段跳过）。

**自动迁移（打开项目时）**：
- 触发条件：project.json 存在 `prompt` 字段（非空）**且**项目目录无 AGENTS.md；
- 动作：将 `prompt` 内容**原样**写入 AGENTS.md（原子写同款）；
- **一次性**：迁移后 AGENTS.md 存在，条件不再满足，`prompt` 不再使用（字段可保留为遗留数据，宽松读取）；
- 迁移在 open 流程内完成（与增量迁移同生命周期），失败不阻塞打开（记录日志，下次 open 重试）。

**schema_version 评估**：**不升 schema_version**——`prompt` 字段废弃是「读侧不再使用」的语义变更，字段本身仍可存在于旧文件（宽松读取，不参与 JSON 结构判定），与 `backup_frequency_minutes` 可选字段先例一致（可选字段宽松读取不升版本）。

**外部编辑支持**：用户可在文件管理器中直接编辑 AGENTS.md；web 读取（`GET /project/agents`）返回文件 mtime，前端比对检测外部修改，不一致提示刷新/重新加载。

**写入**：设置页直接编辑 AGENTS.md（`PUT /project/agents`，整体替换，原子写）。

**画布视图（UI 已移除，数据能力保留）**：大纲中的节点通过 `relation_records` 中的关系形成有向图，支持多线推演和路径分析（参见 [`../api/tool-calling.md`](../api/tool-calling.md) 中的分析类工具）。连线通过 `relation_records` 的 `plot_edge` 类型存储，不进入 outline.json；**画布页与节点坐标/缩放存储已随 UI 一并移除**（纯数据能力保留）。
