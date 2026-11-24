# 章正文（块文档）

> 章级正文的读写端点。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。
> 设计语义与不变式见 [`../design/10-data-model.md`](../design/10-data-model.md) §13。

**载荷**：`content` = 块编辑器原生文档（块数组）的 **JSON 字符串**，真相存 `data.db` 的 `document_records`（`owner_kind='chapter'`，`owner_id` = 章节点 id）。服务端另存 `content_text`（**server 派生的轻量 md 投影**，供 AI 读取/摘要/字数）：

- **投影只能由服务端生成**：读写端点都不接受、不信任客户端提交的投影文本；写入时按块数组重算（派生失败不阻断保存，最坏退化为尽力抽取的文本）。
- **正文不进 `outline.json`**、不落项目目录文件；备份/导出/云端随 `data.db` 一起走（客户端无额外路径）。

### GET /api/v1/manuscript/:chapterNodeId

读取某章正文（含版本戳，供保存时的冲突判定）。

```typescript
// Path
chapterNodeId: string;

// Res: 200
{
  chapterNodeId: string;
  content: string;            // 块数组 JSON 字符串；从未写过 = ""（客户端按空文档处理）
  updatedAt: string | null;   // 版本戳（ISO 8601）；从未写过 = null
  charCount: number;          // 正文字数 = content_text 的 **JS 字符串长度**（UTF-16 code unit，与端点同源口径）；从未写过 = 0
}

// Res: 400（节点类型不是章）
{ error: { code: "VALIDATION_ERROR", message: "正文只能挂在章节点上: sc-9" } }

// Res: 404（节点不存在 / 已软删）
{ error: { code: "OUTLINE_NODE_NOT_FOUND" } }
```

### PUT /api/v1/manuscript/:chapterNodeId

保存某章正文（整篇覆盖；客户端把编辑器文档序列化为块数组 JSON 字符串提交）。

```typescript
// Path
chapterNodeId: string;

// Req
{
  content: string;              // 块数组 JSON 字符串（服务端浅校验：JSON.parse 后必须是数组，否则 400）
  base_updated_at?: string;     // 保存前读到的版本戳；提供时不一致 → 409 DOCUMENT_STALE
                                // 省略 = 不做冲突检查（「覆盖保存」与导入路径显式使用）
}

// Res: 200
{
  updated: true;
  updatedAt: string;            // 本次写入后的新版本戳
  charCount: number;            // 重算后的字数
}

// Res: 400（两条路径，状态码/错误码相同）
// ① schema 层：content 缺失/非字符串/含未知字段（请求体 .strict）→ Zod 默认消息 + fields:["content"]
//   例：{ error: { code: "VALIDATION_ERROR", message: "Invalid input: expected string, received undefined", fields: ["content"] } }
// ② 路由层：content 不是合法块数组 JSON（解析失败 / 解析后非数组）
{ error: { code: "VALIDATION_ERROR", message: "content 必须是块数组 JSON 字符串" } }

// Res: 404（节点不存在 / 已软删）
{ error: { code: "OUTLINE_NODE_NOT_FOUND" } }

// Res: 409（版本戳不一致：另一标签页/窗口写过）
{ error: { code: "DOCUMENT_STALE", message: "正文已被其他窗口修改" } }
```

**语义**：

| 项 | 口径 |
| :--- | :--- |
| 层级 | **仅 `chapter`**——卷/场景 → 400（与 `current_position`、Delta 锚点、伏笔锚点的章级口径一致） |
| 生命周期 | 行随章存在：章软删 → 端点 404（正文行保留，还原后原样回来）；章 purge → 正文行一并物理删 |
| 副作用 | 保存正文**不产生 Delta、不推进 `current_position`**、不进关系表（内容不是状态事实）；**唯一附加副作用 = 码字日统计**（见下） |
| 版本戳 | 每次写入更新 `updated_at`；多标签页/多窗口共用同一章时靠 `base_updated_at` 拦截覆盖 |
| 并发 | 同项目单进程写；无需乐观锁之外的保护（多标签页为已登记延期项，此处只做防覆盖） |

### 与大纲接口的关系

`GET /api/v1/outline?with_metadata=true`（见 [60-api-outline.md](./60-api-outline.md)）的章节点 `metadata` 增 `textLength`（= `document_records.content_text` 长度；无文档 = 0）与 `documentUpdatedAt`（= `document_records.updated_at`；无文档 = 字段缺省）——大纲树与写作页卷章导航栏据此显示「已写 / 字数」，写作页在最近打开失效时据此回退解析最近编辑的章，**不读取正文全文**。

**与写作页「最近导航」的关系**：`#/writing` 先读 localStorage `ai-editor:writing-last-opened`（per-book 最近打开），命中不了才回退到 `documentUpdatedAt` 最大值。`PUT` 返回的 `updatedAt`（本次写入后的 `document_records.updated_at`）同时是 `documentUpdatedAt` 的取值；客户端保存成功后用它更新本地大纲镜像，回退指针因此立即生效（不重拉大纲树）。

### 导入导出（无端点）

正文的导入导出是**纯客户端功能**，沿用现有读写端点，不新增 API：

- **导出**：块 JSON（无损，可再导入）/ markdown（**有损**：颜色/对齐/嵌套/媒体在 md 中无表达，导出前必须提示用户）/ 纯文本 TXT（**有损**：只保留 `content_text` 文本；两种排版——保真 = 段间空行、不缩进；网文 = 段首两个全角空格、段间不空行。**纯客户端、无端点、不可再导入**；正文第一行 = `第M章 章名`，文件名 = `{章名}.txt` / `{章名}-网文.txt`（章名空 → `正文.txt` / `正文-网文.txt`））；
- **TXT 的正文来源**：编辑器最新块 JSON（`latestRef`，**含未保存改动**）→ shared `blocksToPlainMd`（与 `content_text` 同源）→ shared `buildNovelTxt`；不读服务端、不新增端点、不新增依赖。章名空 → `第M章`；编号取不到 → 只用章名；都空 → `正文`。
- **导入**：块 JSON（浅校验后覆盖）/ markdown（先解析再与原文比对，**存在无法导入的结构时必须提示**并让用户确认，不静默丢弃）。

同款能力对参考资料正文同样可用（见 [30-api-entity.md](./30-api-entity.md)）。

### 码字统计（无独立写端点）

每次 **PUT** 都按保存前后的 `content_text.length` 做差：**只有正差**（本章变长了多少）累加到服务端本地日的 `writing_stats_daily` 行（见 [130-api-writing-stats.md](./130-api-writing-stats.md)）。删除 / 回退 / 覆盖为空**不扣减**；粘贴与文件导入经同一保存路径的正差照常计入。

- **不新增请求字段**：日期、增量都由服务端计算，客户端不能提交；
- **best-effort**：统计写失败不回滚正文、不改变本端点的 200；最坏少记当天一次（正文主数据优先）；
- **无独立写 / 删端点**：不允许人工改统计，也不做历史重算；
- 统计行随 `data.db` 进入备份 / 导出 / 云端 / 恢复 / 导入；恢复旧包会把统计一并回退。
### 章级历史（快照 + 恢复）

保存正文时**服务端自动**把「被覆盖的旧内容」压一份快照（用于误操作找回），客户端保存后无需任何额外调用；历史随 `data.db` 进备份 / 云端 / 导入导出。表与不变式见 [`../db/schema.md`](../db/schema.md)「document_snapshots」。

- **三个数值的单一定义** = shared `constants/snapshot.ts`：`CHAPTER_SNAPSHOT_MIN_INTERVAL_MS`（同一章两份快照的最小间隔）/ `MAX_SNAPSHOTS_PER_DOCUMENT`（单章份数上限）/ `SNAPSHOT_BUDGET_MULTIPLIER`（全书预算 = 该书正文总量 × 该倍数）。节流、去重与裁剪**全在服务端**（同一份 `data.db` 跨标签页天然一致）。
- **节流**：距该章最新一份快照不足最小间隔 → 本次保存不压快照。
- **去重**：内容与旧值相同（没有「被覆盖的旧内容」）不压；最新一份快照内容与待压内容相同也不压。
- **裁剪**：两份上限都**从最旧删**（唯一排序键 = 自增 `seq`，与 `created_at` 无关——同秒多次保存也不会打乱顺序）。
- **不做自动 `VACUUM`**：上限管的是活跃数据量，不是库文件大小。

#### GET /api/v1/manuscript/:chapterNodeId/snapshots

该章历史列表（**`seq` 降序 = 新→旧**，不带正文）。

```typescript
// Res: 200
{
  snapshots: Array<{
    seq: number;        // 快照 id（自增序号，恢复与单份读取都用它）
    createdAt: string;  // 该快照写入时刻（ISO 8601）
    charCount: number;  // 该快照的正文字数（与当前正文的 charCount 之差 = 「多/少 N 字」）
  }>;
}

// Res: 400（节点类型不是章）；Res: 404（节点不存在 / 已软删）
```

#### GET /api/v1/manuscript/:chapterNodeId/snapshots/:seq

单份快照正文（只读预览；恢复前用它与当前正文比对）。

```typescript
// Res: 200
{
  seq: number;
  createdAt: string;
  charCount: number;
  content: string;   // 块数组 JSON 字符串（与 GET 正文同形，可直喂块编辑器只读渲染）
}

// Res: 400（节点不是章 / seq 非正整数）
// Res: 404（该章没有这个 seq）
{ error: { code: "SNAPSHOT_NOT_FOUND" } }
```

#### POST /api/v1/manuscript/:chapterNodeId/restore

恢复到某份历史快照。**复用保存核心**（与 `PUT` 同一条写入路径），因此 `updated_at` 推进、码字统计按正差累加（同 PUT 口径）。

```typescript
// Req（.strict）
{ snapshot_id: number }   // 目标快照的 seq（列表端点返回的自增值）

// Res: 200（与 PUT 同形）
{ updated: true; updatedAt: string; charCount: number }

// Res: 400（snapshot_id 缺失/非正整数/含未知字段；节点不是章）
// Res: 404（节点不存在 / 已软删；快照不属于该章）
{ error: { code: "SNAPSHOT_NOT_FOUND" } }
```

**语义**：

| 项 | 口径 |
| :--- | :--- |
| 恢复前先压当前内容 | **强制**压一份（绕过节流，去重照旧）——因此恢复完还能退回「恢复前那一版」；恢复链可反复 |
| 幂等 | 当前内容与目标快照相同 → 直接返回当前状态：不写库、不产生无意义快照、`updated_at` 不动 |
| 恢复不带版本戳 | 服务端主动动作，不做 `base_updated_at` 冲突判定（客户端恢复前若需防覆盖，先 `GET` 正文自行确认） |
| 快照存什么 | 只存块 JSON + 字数；`content_text` 恢复时由服务端用 shared `blocksToPlainMd` 重算（不做第二份投影） |