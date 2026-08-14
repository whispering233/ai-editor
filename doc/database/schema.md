# 数据库 Schema

## 项目文件结构

**书架模型（2026-08，参考 inkos）**：启动目录 = 创作根（书架），每本书一个子目录（`books/<书名>/`），书的数据文件在该子目录下。旧单项目部署（启动目录本身是书）仍兼容。

```
创作根（书架，启动目录）/
├── books/                    # 书架子目录（S1.5 起）
│   └── <书名>/               # 每本书一个目录（创建书 = 新建子目录）
│       ├── project.json       # 项目配置（id/schema_version/current_position 等，见下文契约）
│       ├── outline.json       # 大纲树（卷 → 章 → 场景，严格三层，无游离节点）
│       └── data.db            # SQLite
│           ├── entities       # 人物 / 设定 / 地点 / 伏笔 / 事件
│           ├── relation_records  # 通用关系表
│           ├── delta_records    # 属性变更记录
│           └── chat_messages    # 对话历史（决策 18）

# 兼容：启动目录本身含 project.json 时按旧语义打开（决策 8 修订）；
# 无 project.json 时进入书架模式——Dashboard 引导创建（自动建 books/<书名>/）或打开
```

**时间约定**：所有时间列/字段统一 ISO 8601 字符串（如 `2026-08-01T10:00:00Z`），由应用层写入，不使用 SQLite 内置 `datetime('now')`——回收站按 `deleted_at` 排序需跨 SQLite 与 outline.json 统一格式。

**schema 版本与迁移（E5，决策 13 增补）**：

- **版本判定**：以 data.db 的 `PRAGMA user_version` 为准（`packages/db/src/schema.ts` 的 `SCHEMA_VERSION` 常量）；`project.json`/`outline.json` 顶层的 `schema_version` 仅用于 JSON 结构判断（决策 13）。
- **三态分流（open 时，`ensureSchemaCompatible`）**：
  - `user_version === SCHEMA_VERSION` → 正常打开；
  - `user_version > SCHEMA_VERSION`（未来版本，E4）→ **拒绝打开** 409 `PROJECT_VERSION_NEWER`（数据原封不动，提示升级程序）；
  - `user_version < SCHEMA_VERSION`（旧版本）→ **有迁移路径**（`packages/db/src/migrations/` 存在从当前版本到目标版本的连续迁移链）→ `runMigrations` 前向迁移；**无迁移路径** → 删库重建兜底（决策 13，备份 `data.db.v{n}.bak` + `outline.json.v{n}.bak`）。
- **迁移机制（E5）**：`migrations/` 目录每个文件导出一个 `Migration = { version, up }`（`001_xxx.ts` → version 1），`index.ts` 按 version 升序聚合导出 `MIGRATIONS`（tsc 编译进 dist 随包分发，无运行时目录读取）。`runMigrations` 对缺失版本逐个执行：**每个迁移一个事务（`up(db)` + `setUserVersion(version)` 原子提交——成功 ⇒ 版本已写入；失败 ⇒ 版本未变）**；**整批迁移前自动快照** data.db → `data.db.v{n}.{YYYYMMDDHHmmssSSSZ}.bak`（checkpoint 后复制主文件，时间戳命名不覆盖旧备份，失败重试现场保留）。迁移失败 → 该迁移回滚 + 版本停在前一迁移后，下次 open 重试。
- 当前 `SCHEMA_VERSION = 2`；迁移链含 `002_event_timeline.ts`（version 2，决策 26：entities 表 CHECK 扩入 `'event'` + 新增 `sort_order` 列）。**SQLite 无法直接修改 CHECK 约束**，该迁移走「建新表（新 CHECK + sort_order 列）→ 拷贝数据 → drop 旧表 → rename」四步（`relation_records`/`delta_records` 无外键指向 entities，迁移只动 entities 表）；v1 → v2 迁移存在 ⇒ 旧库 open 时自动前向迁移，不再走删库重建兜底。
- **import 侧联动（E5 决议）**：导入备份时 `user_version < SCHEMA_VERSION` 且**有迁移路径** → 接受（搬入后 open 自动迁移，v1 备份经 E5 迁移升到 v2）；无路径 → 409 `SCHEMA_VERSION_MISMATCH`；`>` 当前 → 409（E4 语义）。

## entities — 实体表

```sql
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',  -- JSON: 各类型的专属字段
  sort_order  INTEGER,                     -- 时间轴事件全局线性序（决策 26）：仅 event 使用，NULL = 未参与排序；其余类型恒为 NULL
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对，决策 14）
  deleted_at  TEXT             -- 软删标记（决策 12），NULL 表示未删除；非 NULL 时该实体进入回收站，本体保留可还原
);
```

`data` 列按 `type` 存储不同的 JSON 结构：

| type | data 关键字段 |
|------|-------------|
| `character` | `role`, `gender`, `age`, `personality[]`, `motivation`, `abilities[]`, `status`, `custom_fields` |
| `setting` | `category`, `parent_id`, `description`, `rules[]`, `custom_fields` |
| `location` | `type`, `parent_id`, `description`, `custom_fields` |
| `hook` | 详见 [hooks.md](./hooks.md) |
| `event` | `description`（文本）, `time_label`（自由文本时间标签，如「第二天黄昏」「第三纪元」，**不参与排序、不解析**）, `tags[]`（字符串数组，分类筛选用） |

### 时间轴事件（决策 26）

- **第 5 种实体类型 `event`（事件）**：id 前缀 `ev-`（与 `char-`/`set-`/`loc-`/`hook-` 并列）；`data` 字段按决策 23 风格精校验 + passthrough（仅校验上述三字段，额外字段透传不拒绝）。
- **排序**：时间轴顺序是**全局事件线性序**（`sort_order` 列，拖拽为权威，midpoint 或数组索引语义），`time_label` 仅作展示、不参与排序；非 event 实体 `sort_order` 恒为 NULL。
- **软删/回收站**：event 自动获得（泛型路由 parseTypeParam）；软删级联 occurs_in 关系（现有级联逻辑复用），restore 级联还原。
- **Delta**：手动编辑事件不产生 Delta（与现有实体语义一致，决策 9）。
- **导出/导入**：自动覆盖（data.db 整库 zip）；导入端 open 时经 E5 迁移升到 v2。

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
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对，决策 14；软删/还原亦更新，决策 12 修订）
  deleted_at    TEXT              -- 级联软删标记（决策 12）：仅实体/节点级联删除时写入；
                                  -- 手动删除关系 = 物理删（不置 deleted_at，不进入回收站）
);

-- 索引（决策 12 修订补）：k 跳遍历与高频关系查询
CREATE INDEX idx_relation_source ON relation_records(source_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_relation_target ON relation_records(target_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_relation_type   ON relation_records(relation_type) WHERE deleted_at IS NULL;
```

> **可见性过滤（决策 12 修订）**：常规查询过滤关系时需 join 校验 source/target 端点均未软删——任一端点软删即不可见；restore 级联还原全部关系，端点还原后自动可见。

预定义关系类型：

| 关系类型 | 说明 | 示例 |
|---------|------|------|
| `belongs_to` | 所属 | 人物→设定 |
| `owns` | 拥有 | 人物→物品 |
| `masters` | 掌握 | 人物→能力 |
| `ally` / `rival` / `mentor` / `family` | 人物间关系 | 人物→人物 |
| `kills` | 击杀 | 人物→人物 |
| `appears_in` | 出现于大纲节点 | 实体→大纲节点 |
| `occurs_in` | 发生于大纲节点（事件锚定，决策 26） | event→大纲节点（多对多：一个事件可关联多个场景/章节，一个场景可被多个事件引用；**锚定 = 关系，无独立 chapter_anchor 字段**） |
| `occurs_at` | 发生在地点 | 大纲节点→地点 |
| `plot_edge` | 剧情连线（画布推演） | 大纲节点→大纲节点，`metadata` 存连线标签 |
| `plants` / `advances` / `resolves` | 伏笔管理 | 大纲节点→hook |
| `depends_on` | 伏笔依赖 | hook→hook |
| `involves` | 涉及 | hook→实体 |

## delta_records — 属性变更表

```sql
CREATE TABLE delta_records (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,       -- 触发变更的大纲节点
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  changes     TEXT NOT NULL,       -- JSON: [{field, op, from?, to?, value?}]
  description TEXT NOT NULL,       -- 人类可读描述
  "order"     INTEGER NOT NULL DEFAULT 0,  -- 同一节点内多个 Delta 的排序（全局单调递增，服务端生成）
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对，决策 14）
  deleted_at  TEXT              -- 级联软删标记（决策 12）：仅实体/节点级联删除时写入。
                                -- 可见性联动触发节点与目标实体（决策 12 修订）：任一端软删即不可见
);
```

> 状态计算只沿大纲树父链累积已确认 Delta（决策 9）：`computeState` 从根到目标节点收集路径上所有 Delta，**节点间按树路径顺序、同一节点内按 `order` 应用**（双层排序）；`plot_edge` 连线不参与。大纲严格三层、无游离节点（决策 19）。

## chat_messages — 对话历史表

对话消息持久化（决策 18），与 data.db 同库存储。

```sql
CREATE TABLE chat_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL,          -- 会话按项目隔离（决策 18 修订）
  role          TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content       TEXT,
  tool_calls    TEXT,                   -- JSON: 助手消息的工具调用数组
  tool_call_id  TEXT,                   -- tool 消息关联的 assistant 工具调用 id（决策 18 修订）
  created_at    TEXT NOT NULL           -- ISO 8601，应用层写入
);

CREATE INDEX idx_chat_session ON chat_messages(session_id, created_at);
```

> MVP 只存原始消息，不做摘要持久化；会话级滑动窗口裁剪与摘要压缩在 agent/session.ts 运行时完成（决策 6）。**历史重建规则（决策 18 修订）**：按 `assistant.tool_calls[].id` ↔ `tool.tool_call_id` 成对重组喂回模型；滑动窗口裁剪必须成对（tool_call 与对应 tool_result 同裁同留）。服务重启后凭 `session_id` 重建「继续上次对话」，会话列表走 `GET /api/v1/chat/sessions`。

## outline.json — 大纲树

大纲树是纯 JSON 文件，不与 SQLite 混合。**严格三层（卷 → 章 → 场景），无游离节点（决策 19）**。

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

**节点版本戳（决策 19）**：每个节点携带 `updated_at`（ISO 8601），节点任何字段变更（title/summary/data/children 重排）时由服务端在原子写流程中统一更新，支撑决策 14 的提案快照比对。

**节点结构化信息 `data`（决策 23，2026-08 新增）**：可选 `data` 字段（`Record<string, unknown>`，默认省略），按层级 schema（`OUTLINE_NODE_DATA_SCHEMAS`）校验，字段集基于麦基《故事》理论：

| 层级 | data 字段 | 说明 |
|------|-----------|------|
| `scene` | `goal`（文本，max 1000）、`conflict_levels`（`inner`/`personal`/`extra_personal` 多选）、`value_from`/`value_to`（开场/收场价值双文本，各 max 200） | 场景目标/欲望、冲突三层次、价值转向（麦基场景定义） |
| `chapter` | `reversal`（单文本，可选，max 1000）、`climax_scene`（场景节点 id 引用，可选） | 章末反转、章高潮场景 |
| `volume` | `climax_scene`（场景节点 id 引用，可选）、`inciting_scene`（激励事件落位，可选） | 幕高潮、激励事件 |

- 引用字段宽松校验：`climax_scene`/`inciting_scene` 引用任意场景节点 id，MVP 不校验引用范围（UI 提示建议本层内），详情页可跳转。
- 编辑节点 data **不自动生成 Delta**（决策 9 修订语义不变）；变更记录由「+ 新建变更」显式创建（S5.6）。
- 关联（人物/地点/伏笔）一律走 `relation_records`，不在 data 中重复建模。

**顶层 `schema_version`（决策 13 修订）**：与 project.json 同步写入，用于 outline.json 文件格式演进判定；删库重建时同步重置。

**软删字段（决策 12）**：节点可选 `deleted: bool`（默认 false，省略即未删）与 `deleted_at: string`（ISO 时间，软删时写入）。软删节点本体仍保留在文件中，常规查询/渲染默认过滤，回收站列表按 `deleted_at` 排序，定期清理按 `deleted_at` 判定保留时长；还原时清除标记即可。

## project.json — 项目配置契约

项目根目录的配置文件，是**数据文件**（非代码）。首次初始化时自动创建（决策 8），此后跨启动稳定存在；**实现任何 project 相关端点前先读本节**。

```json
{
  "id": "proj-abc123",
  "name": "我的小说",
  "language": "zh",
  "prompt": "力量体系：练气→筑基→金丹",
  "schema_version": 1,
  "current_position": "sc-42",
  "backup_frequency_minutes": 10,
  "created_at": "2026-08-01T10:00:00Z",
  "updated_at": "2026-08-01T10:00:00Z"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 项目唯一 id，首次初始化时生成（前缀 `proj-` + nanoid），**跨启动稳定**；画布布局 localStorage 的隔离 key（决策 10）；**备份/恢复的唯一 key（决策 27）**——导入/加载备份时以 zip 内 id 与书架比对，匹配 → 覆盖恢复，不匹配 → 导入为新书 |
| `name` | string | 项目名称，默认取目录名；**与目录名绑定**（「目录名 = 书名」不变式，决策 27：同名并存时目录与 name 同步去重为 `<书名> (N)`） |
| `language` | `"zh"` \| `"en"` | 语言 |
| `prompt` | string | 项目级提示词（决策 7 三层注入的项目层） |
| `schema_version` | number | JSON 结构版本（决策 13；与 outline.json 顶层同步写入） |
| `current_position` | string \| null | 大纲「当前位置」节点 id（伏笔健康指标依赖，见 `hooks.md`；null = 未设置；须指向存在的非软删节点） |
| `backup_frequency_minutes` | number \| null | **自动备份频率（决策 27，可选字段）**：分钟数，仅接受枚举 5/10/15/30/60；`null` / `0` = 关闭；**缺省 = 10**（新项目默认开启）；随书籍（每项目独立）；不参与 schema_version 判定（宽松读取，缺省兜底） |
| `created_at` / `updated_at` | string | ISO 8601，应用层写入；首次初始化写 `created_at`，配置变更更新 `updated_at` |

**约束**：
- DeepSeek API key **绝不写入本文件**（决策 17）——只走环境变量 `DEEPSEEK_API_KEY` 或用户级配置 `~/.ai-editor/config.json`。
- 文件写入遵循决策 11 的原子写流程（outline.json 同款：临时文件 + fsync + rename）。
- **自动备份目录（决策 27 + 决策 28 + 决策 29）**：项目目录内 `.backups/` 子目录存放备份 zip（时间戳命名 `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip` 毫秒精度，**kind 类型标记段（决策 29）**：`m` = 手动（无名称也带 `-m` 段，与自动可靠区分）/ `a` = 自动备份重命名后带名称；自动备份与覆盖前快照为纯时间戳 `<YYYYMMDD-HHmmssSSS>.zip`；手动带名称 `<YYYYMMDD-HHmmssSSS>-m-<名称>.zip`；**旧格式兼容解析不迁移**：旧秒级 `<YYYYMMDD-HHmmss>.zip` → auto、旧带名称无 kind 段 `<YYYYMMDD-HHmmssSSS>-<名称>.zip` → manual、纯时间戳 → auto；格式 = E1 导出包：project.json + outline.json + data.db）；**每项目保留最近 20 份**（超出删除最旧，含覆盖前自动快照；清理失败不阻塞备份主流程）；备份文件不入 git、不算数据文件（可随时删除）。**实现细节（2026-08 实测）**：同毫秒冲突用「时间戳 +1 毫秒循环去重」（保持文件名格式契约可解析）；「有变更才备份」的 mtime 判定加 1s 容差（备份管道内 wal_checkpoint 会把 data.db mtime 刷新到备份时刻，严格 `mtime > 上次备份时刻` 会自激误判——决策 28 毫秒精度下文件名截断误差已消除，但粗粒度 mtime 文件系统（如 FAT/exFAT 2s 粒度）下容差仍是必要防御，`BACKUP_CHANGE_TOLERANCE_MS` 保留 1s）；重命名备份只改名称段（时间戳与 kind 保持，决策 29，同目录 rename 原子）。

**画布视图**：大纲中的节点通过 `relation_records` 中的关系形成有向图，支持多线推演和路径分析（参见 [`../api/tools.md`](../api/tools.md) 中的分析类工具）。画布连线通过 `relation_records` 的 `plot_edge` 类型存储（决策 10），不进入 outline.json；节点坐标与画布缩放存浏览器 localStorage（决策 10），不进任何数据文件。
