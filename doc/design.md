# 核心设计理念与关键决策

## 产品定位

AI Editor 是一个面向小说创作者的辅助工具。核心命题：**AI 是创作顾问，不是代笔。**

- AI 帮助作者管理创作要素、探索剧情可能性、发现设定矛盾
- AI **不生成正文**——正文永远是作者的事
- 角色类比：AI 像是坐在你身边的资深编辑，帮你推演可能性、提出挑战性问题，但笔始终在你手里

---

## 四大核心设计原则

### 1. 本地优先，数据主权归用户

所有创作数据存储在本地文件系统（`project.json` + `data.db` + `outline.json`），不上传云端。AI 对话时仅将必要上下文发送给模型 API，对话历史在本地保存。用户可以随时导出完整项目数据，不被任何平台锁定。

### 2. AI 作为思考增强，而非内容生成

与市面上「一键生成小说」的工具不同，AI Editor 的 AI 角色是**参谋**而非**写手**。这体现在三个交互模式上：

| 模式 | 交互 | 示例 |
|------|------|------|
| **问答式** | 用户主动向 AI 提问 | 「这个魔法体系有什么漏洞？」 |
| **反诘式** | AI 读取设定后主动抛出挑战 | 「如果灵脉会枯竭，底层平民为什么还留在那里？」 |
| **路径推演** | AI 基于已有节点推演可能的剧情线 | 「从『被逐出师门』到『修仙界至尊』有三条路径…」 |

### 3. 创作要素的结构化管理

长篇写作的核心痛点是「写到后面忘了前面」。解决方案是将四类创作要素统一建模：

```
人物 (Character) ─┐
设定 (Setting)  ──┼── 通用关系表 ── 大纲节点 (Plot Node)
地点 (Location) ──┘
```

四要素之间通过一张**通用关系表**互相关联，支持紧邻查询、k 跳查询、全量回溯。从任意一个实体出发，可以找到所有与之相关的创作要素。

### 4. 结构体先行，AI 填入

所有创作要素都有预定义的结构（人物档案模板、设定分类树、大纲层级），用户先在结构框架中填写内容，AI 在已有结构基础上做语义分析和建议。这避免了 AI 自由发挥导致的失控。

---

## 关键架构决策

### 决策 1：节点即大纲（统一模型）

大纲的树状结构和剧情探索的图状结构共享同一数据中心。

```
大纲视图（树）         画布视图（图）
 卷1                       🎯 结局(游离)
 ├ 第1章              ┌────┘
 │ ├ 场景A ←──────────┤ 同一数据
 │ └ 场景B            └────┐
 └ 第2章                   路径A ─→ 路径B
```

- 在大纲里拖拽重排 → 画布上的连线自动更新
- 在画布上把游离节点拖入卷 → 大纲里自动归位
- 两个视图不是「同步」关系，而是同一数据的两种**投影**

### 决策 2：通用关系表

不走「人物关系表 + 设定关系表 + 地点关系表」的分表路线，而是用一张表统一管理所有跨实体关系：

```
relation_records
├── (人物, char-3) ──[所属]──→ (设定, set-7)
├── (人物, char-3) ──[出现于]──→ (大纲节点, sc-1)
├── (设定, set-7) ──[总部]──→ (地点, loc-1)
└── (大纲节点, sc-37) ──[属性变化]──→ (人物, char-3)
```

**理由**：
- 新增关系类型不需要改表结构（只需扩展常量）
- AI 分析时一次查询拿到全图，不需要 JOIN 多张表
- 从任意实体出发的「查找所有关联」是一个查询

### 决策 3：Delta 变更追踪

人物/设定的属性不是静态的——第 47 章主角黑化了，战力从 100 涨到 850。如何表达这种变化？

**不采用版本快照**（每个节点存储完整状态 → 冗余，看不到因果）。

**采用事件驱动 Delta**：大纲节点记录自己**引发了什么变化**。

```
sc-37(获得断剑认可) → Delta: 张三.战力 +50
sc-52(被挚友背叛)   → Delta: 张三.性格 善良→多疑
```

到达任意节点的状态 = 初始值 + 从根节点到该节点路径上所有 Delta 的累积。Delta 挂载在通用关系表中（`relation_type = 'attribute_change'`），不侵入大纲的 JSON 结构。

### 决策 4：双轮驱动（人物 ↔ 剧情）

不存在「先捏人再推剧情」或「先定剧情再补人物」的主从关系。两个方向并行，互相喂养：

```
         ┌──────────────┐
         │   人物系统    │
         │  角色库       │
         └──┬────────┬──┘
            │        │
   性格决定   │        │  场景需要
   剧情走向   │        │  角色补位
            │        │
         ┌──┴────────┴──┐
         │   剧情探索    │
         │  画布+AI推演  │
         └──────────────┘
```

用户可以从任何方向启动，另一方自动响应——比如在画布上加一个新场景，AI 会分析缺少什么角色；在人物系统里新增一个角色，AI 会提示该角色可以出现在哪些已规划的剧情节点中。

### 决策 5：大纲用 JSON，实体用 SQLite

| 数据 | 格式 | 理由 |
|------|------|------|
| 大纲树 | JSON 文件（`outline.json`） | 天然树形结构，整树读写，无需拼接 |
| 实体/关系/Delta | SQLite（`data.db`） | 结构化查询、关联追踪、Delta 累积计算 |

**不采用全 SQLite 或全 JSON 的统一方案**——大纲的树形结构与关系表的查询需求对存储格式的要求天然不同，强行统一反而增加复杂度。

### 决策 6：AI 通过 Tool Calling 操作数据

AI 不能直接读写本地文件。通过 OpenAI Function Calling 协议，AI 发出结构化的 JSON 指令，由本地 Tool Executor 执行：

```
用户提问 → 上下文组装 → Prompt + Tools → DeepSeek
                                              ↓
                    文本回复 ← 对话循环 ← 工具调用结果
```

工具分为三级权限：

| 级别 | 示例 | 行为 |
|------|------|------|
| 自动 | `get_entity`, `query_relationships` | 无需用户确认 |
| 确认 | `create_entity`, `add_delta` | 展示 diff，用户确认 |
| 二次确认 | `delete_entity` | 弹窗二次确认 |

### 决策 7：分层上下文策略

DeepSeek 有 64K token 上下文窗口，但不能每次把整个世界发给 AI。采用四级分层：

```
系统指令 (~500 tokens)       # 固定：AI 角色定义 + 行为规范
聚焦上下文 (~3000 tokens)    # 动态：当前视图中的实体 + 紧邻关系
扩展上下文 (按需查询)        # AI 通过工具调用主动拉取
对话历史 (~6000 tokens)      # 滑动窗口 + 超限压缩摘要
```

### 决策 8：提示词三层注入

System Prompt 不是一成不变的，而是可编辑的分层结构：

```
最终 Prompt = 内核提示词(代码固定) + 项目提示词(用户可编辑) + 临时指令(即时输入)
```

| 层 | 编辑者 | 持久化 | 示例 |
|----|--------|--------|------|
| 内核 | 开发者 | `agent/prompts.ts` | 「你是创作顾问，不生成正文」 |
| 项目 | 用户 | `project.json` | 「力量体系：练气→筑基→金丹」 |
| 临时 | 用户 | 不持久化 | 「今天只讨论第三卷」 |

---

## 数据模型总览

### 项目文件结构

```
项目文件夹/
├── project.json       # 项目元信息 + 用户提示词
├── outline.json       # 大纲树（卷 → 章 → 场景）
└── data.db            # SQLite
    ├── entities       # 人物 / 设定 / 地点
    ├── relation_records  # 通用关系表
    └── delta_records    # 属性变更记录
```

### 核心表结构

#### entities — 实体表

```sql
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',  -- JSON: 人物/设定/地点的专属字段
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

#### relation_records — 通用关系表

```sql
CREATE TABLE relation_records (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,    -- 'character'|'setting'|'outline_node'|'location'
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,    -- 'belongs_to'|'appears_in'|'located_at'|...
  metadata      TEXT,             -- JSON 扩展元数据
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

预定义关系类型：`belongs_to` / `owns` / `masters` / `ally` / `rival` / `mentor` / `family` / `kills` / `appears_in` / `occurs_at` / `attribute_change` 等。

#### delta_records — 属性变更表

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

### outline.json — 大纲树

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

---

## 核心 API 端点设计

所有 API 遵循 REST 风格，由 Hono 框架实现，前端通过 Vite proxy 转发 `/api` 请求到 `localhost:3456`。

### 项目管理

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/v1/project/create` | 创建项目，body: `{path, config}` |
| `POST` | `/api/v1/project/open`   | 打开项目，body: `{path}` |
| `POST` | `/api/v1/project/close`  | 关闭项目 |
| `GET`  | `/api/v1/project/config` | 获取项目配置 |
| `PUT`  | `/api/v1/project/config` | 更新项目配置（名称/类型/提示词） |

### 实体 CRUD

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET`    | `/api/v1/entity/:type`         | 列出实体（`:type` = character/setting/location） |
| `GET`    | `/api/v1/entity/:type?q=关键词` | 搜索实体 |
| `GET`    | `/api/v1/entity/:type/:id`      | 获取实体详情 |
| `POST`   | `/api/v1/entity/:type`          | 创建实体，body: `{name, data}` |
| `PUT`    | `/api/v1/entity/:type/:id`      | 更新实体，body: `{patches}` |
| `DELETE` | `/api/v1/entity/:type/:id`      | 删除实体（级联删除关联关系和 Delta） |

### 关系管理

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET`    | `/api/v1/relation?type=&id=&depth=`      | 查询关系（depth=1 紧邻 / 2 k跳 / 3 全量） |
| `POST`   | `/api/v1/relation`                       | 建立关系 |
| `DELETE` | `/api/v1/relation/:id`                    | 删除关系 |

### Delta 变更追踪

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/v1/delta`                  | 追加变更记录 |
| `GET`  | `/api/v1/delta/node/:nodeId`      | 获取某节点触发的所有 Delta |
| `POST` | `/api/v1/delta/compute`           | 计算实体到达某节点时的状态，body: `{ref, nodeId, pathIds}` |

### 大纲操作

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET`    | `/api/v1/outline`               | 获取完整大纲树 |
| `POST`   | `/api/v1/outline`               | 创建节点，body: `{type, title, parent_id?}` |
| `PUT`    | `/api/v1/outline/:nodeId`       | 更新节点（title/summary） |
| `PUT`    | `/api/v1/outline/:nodeId/move`  | 移动节点，body: `{parentId, order}` |
| `DELETE` | `/api/v1/outline/:nodeId`       | 删除节点（级联删除子节点） |
| `GET`    | `/api/v1/outline/:nodeId/path`  | 获取从根到该节点的路径 ID 列表 |

---

## 数据流说明

### 用户 CRUD 操作（同步 request-response）

```
Browser (React)                  Server (Hono)               data/graph/outline
      │                               │                            │
      │  POST /api/v1/entity/character│                            │
      │  {name: "张三", data: {...}}  │                            │
      │──────────────────────────────▶│                            │
      │                               │ createEntity(db, ...)     │
      │                               │──────────────────────────▶│ INSERT INTO entities
      │                               │           ◀───────────────│ {id: "char-9", ...}
      │        ◀──────────────────────│                            │
      │  {id: "char-9", ...}         │                            │
```

### AI 对话（Agent 循环 + 工具调用）

```
Browser                  Server                   agent               ai              DeepSeek
  │                        │                        │                   │                 │
  │ POST /chat             │                        │                   │                 │
  │ (暂未实现，占位)        │ agent.run(msg, proj)   │                   │                 │
  │───────────────────────▶│───────────────────────▶│                   │                 │
  │                        │                        │ buildContext()    │                 │
  │                        │                        │ → graph/outline   │                 │
  │                        │                        │ ◄── 上下文数据      │                 │
  │                        │                        │ client.chat()     │                 │
  │                        │                        │──────────────────▶│                 │
  │                        │                        │       ◄──────────│ 文本/工具调用    │
  │                        │                        │                   │                 │
  │                        │                        │ 如果有 tool_call:   │                 │
  │                        │                        │ executor.run()    │                 │
  │                        │                        │ → graph/outline/data                │
  │                        │                        │ ◄── 执行结果       │                 │
  │                        │                        │ 喂回 DeepSeek     │                 │
  │                        │                        │ ...循环到返回文本  │                 │
  │                        │         ◄──────────────│                   │                 │
  │        ◄───────────────│                        │                   │                 │
  │  SSE 流式响应           │                        │                   │                 │
```

### 关键数据流特性

| 特性 | 说明 |
|------|------|
| 服务端状态持有 | Server 在内存中持有一个 `currentProject`，所有 API 调用共享此引用。关闭项目时释放数据库连接并 `saveDatabase` 落盘 |
| JSON 树读写 | 大纲操作直接读写 `outline.json` 文件，整树加载/保存（不涉及数据库） |
| Delta 累积计算 | `computeState` 通过 `getNodePathIds` 获取从根到目标节点的路径，收集路径上所有节点的 Delta 并依次应用 |
| 数据库持久化 | 每个 API 调用直接操作 `better-sqlite3` 的同步 API，写入即时落盘（WAL 模式） |

---

## 竞品对比中的差异化

| 维度 | 竞品现状 | AI Editor |
|------|---------|-----------|
| 数据主权 | 云端或平台绑定 | 本地优先，文件系统 |
| AI 角色 | 生成正文为主 | 推演 + 反诘，不生成正文 |
| 关系管理 | 各自独立的关系表 | 通用关系表，k 跳查询 |
| 变化追踪 | 无或手动记录 | Delta 累积自动回溯 |
| 人物-剧情 | 单向（人物驱动或剧情驱动） | 双轮驱动，互相喂养 |
| 平台绑定 | 阅文、橙瓜等绑定发布平台 | 完全不绑定 |
