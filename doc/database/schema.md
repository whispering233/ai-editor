# 数据库 Schema

## 项目文件结构

```
项目文件夹/
├── project.json       # 项目元信息 + 用户提示词
├── outline.json       # 大纲树（卷 → 章 → 场景）
└── data.db            # SQLite
    ├── entities       # 人物 / 设定 / 地点 / 伏笔
    ├── relation_records  # 通用关系表
    └── delta_records    # 属性变更记录
```

## entities — 实体表

```sql
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',  -- JSON: 各类型的专属字段
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`data` 列按 `type` 存储不同的 JSON 结构：

| type | data 关键字段 |
|------|-------------|
| `character` | `role`, `gender`, `age`, `personality[]`, `motivation`, `abilities[]`, `status`, `custom_fields` |
| `setting` | `category`, `parent_id`, `description`, `rules[]`, `custom_fields` |
| `location` | `type`, `parent_id`, `description`, `custom_fields` |
| `hook` | 详见 [hooks.md](./hooks.md) |

## relation_records — 通用关系表

```sql
CREATE TABLE relation_records (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata      TEXT,             -- JSON 扩展元数据
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

预定义关系类型：

| 关系类型 | 说明 | 示例 |
|---------|------|------|
| `belongs_to` | 所属 | 人物→设定 |
| `owns` | 拥有 | 人物→物品 |
| `masters` | 掌握 | 人物→能力 |
| `ally` / `rival` / `mentor` / `family` | 人物间关系 | 人物→人物 |
| `kills` | 击杀 | 人物→人物 |
| `appears_in` | 出现于大纲节点 | 实体→大纲节点 |
| `occurs_at` | 发生在地点 | 大纲节点→地点 |
| `attribute_change` | Delta 变更 | 大纲节点→实体 |
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
  "order"     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## outline.json — 大纲树

大纲树是纯 JSON 文件，不与 SQLite 混合。

```json
{
  "id": "root", "type": "root",
  "children": [
    {
      "id": "vol-1", "type": "volume", "title": "第一卷",
      "children": [
        { "id": "ch-1", "type": "chapter", "title": "第一章",
          "children": [
            { "id": "sc-1", "type": "scene", "title": "灵根测试失败" }
          ]
        }
      ]
    }
  ],
  "orphan_nodes": [
    { "id": "sc-99", "type": "scene", "title": "结局·仙界至尊" }
  ]
}
```

**理由**：大纲的树形结构与实体关系表对存储格式的要求天然不同——大纲需要整树读写、拖拽重排，JSON 文件更合适。

**画布视图**：大纲中的节点通过 `relation_records` 中的关系形成有向图，支持多线推演和路径分析（参见 [`../api/tools.md`](../api/tools.md) 中的分析类工具）。
