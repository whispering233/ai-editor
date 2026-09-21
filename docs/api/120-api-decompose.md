# 拆解小说（导入式批量管线）

> 拆解小说的端点契约。设计语义与不变式见 [`../design/60-decompose.md`](../design/60-decompose.md)；数据表见 [`../db/schema.md`](../db/schema.md)；视觉见 [`../ui/DESIGN.md`](../ui/DESIGN.md) §拆解小说。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`。

**传输约定（本模块特有，登记进 [api-public.md](./api-public.md) 的显式例外）**：`analyze` 与 `start` 的请求体是**小说文件的原始字节**（`Content-Type: application/octet-stream`），文件名与其余参数走 query string。理由：编码探测（UTF-8 → GB18030 回退）与切分必须由服务端单一实现，客户端不做解码；走原始字节避免 base64 膨胀。体积上限 = `DECOMPOSE_MAX_FILE_BYTES`，超限 400 `DECOMPOSE_FILE_TOO_LARGE`。

**状态机**：`pending → running → (paused | done | failed)`。job 绑定项目（一项目**至多一个活跃 job**；历史 job 全保留，进度面只显最新）。拆解有两类入口：**首次拆解**（`analyze` / `start`，基于文件新建项目）与**续拆**（`plan` / `continue`，同一项目内开新 job）。

### POST /api/v1/decompose/analyze

解析小说文件并返回**切分预览**（不落库、不建项目、无状态）。

```typescript
// Query
{
  file_name: string;          // 原始文件名（仅用于展示与默认书名派生）
  scope_start?: number;       // 起始章序（1-based，文件位置序）；缺省 = 1
  scope_end?: number;         // 结束章序；缺省 = 全部章
}

// Body: 小说文件原始字节（application/octet-stream）

// Res: 200
{
  encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030";  // 探测结果
  totalChars: number;
  chapters: Array<{
    index: number;            // 1-based 文件位置序
    title: string;            // 已清洗（去编号前缀与前导全角空格）
    charCount: number;
    volumeIndex: number;       // 所属卷序号（单卷兜底 = 0；永不为 null）
  }>;
  volumes: Array<{ index: number; title: string }>;  // 无卷标记 → 单卷「全书」
  stats: { min: number; median: number; max: number };  // 章字数分布
  warnings: Array<{ code: string; message: string }>;   // 见下表
  estimate: {
    batchCount: number;
    llmCalls: number;         // batchCount + 2（归并 + 报告）
    inputTokensApprox: number;
    outputTokensApprox: number;
    costApprox: number | null; // 费率来自 pi 模型目录；未配置模型/凭据 → null
  };
  defaultName: string;        // 默认书名（文件名去扩展名）
}

// Res: 400（体积超限 / 解码失败 / 空文本）
{ error: { code: "DECOMPOSE_FILE_TOO_LARGE" | "DECOMPOSE_FILE_INVALID" } }
```

**语义**：

- **无状态、可重复调用**：预览不缓存文件。用户改范围时客户端重传原始字节（本地 HTTP，成本可忽略）——服务端不引入临时文件或 token。
- **章列表全量返回**（含标题与字数）：数百章量级的 JSON 在本地传输无压力；预览页据此渲染列表。
- **范围只影响 `estimate`**（以及后续 job 的分析范围），**不影响正文导入**——正文始终全量导入。
- **范围为空**（`scope_start > scope_end`、或越界落空）⇒ `batchCount = 0`、`llmCalls = 2`（归并 + 报告照计），**不报 400**（范围越界属夹取语义；`scope_end` 超章数等同全量）。
- `warnings[].code` 取值（消息文案由服务端给，客户端不映射）：

| code | 触发 |
| :--- | :--- |
| `NUMBERING_RESTART` | 检测到编号重启（疑似多卷） |
| `LONG_BLOCK` | 超长块（疑似合并章），附章序号 |
| `DUPLICATE_MERGED` | 相邻重复标题被合并的次数 |
| `TOC_DROPPED` | 卷首目录页启发式丢弃的段数 |
| `FALLBACK_EQUAL_SPLIT` | 未检测到章节结构，已按字数等分 |

### POST /api/v1/decompose/start

创建项目 → 导入正文 → 落批规划 → 启动 job。

```typescript
// Query
{
  file_name: string;
  name: string;               // 书名（默认取 file_name 去扩展名，客户端可改；校验复用书名校验）
  scope_start?: number;
  scope_end?: number;
}

// Body: 小说文件原始字节（application/octet-stream）

// Res: 200
{
  projectId: string;
  projectPath: string;        // <创作根>/books/<书名>/
  name: string;
  jobId: string;
  status: "pending" | "running";
  batchCount: number;
}

// Res: 400 / 409（错误码见下）
```

**语义**：

- 服务端**重新切分一次**（与 `analyze` 同一实现，确定性）——不依赖客户端回传的预览结果。
- **副作用**：创建并**打开**该项目（等价 `POST /project/open` 的切换语义：释放旧项目运行时、暂停旧项目上的 job、写创作根 `.ai-editor/config.json` 的 `lastProject`）。
- **S1 同步完成后再返回**：建项目、建大纲（卷/章）、逐章导入正文（段落块）、落 `decompose_batches` 行——这一段不调 LLM，秒级；`Res` 返回时 job 已进入 `running`，客户端跳 `#/decompose` 看进度。
- 同项目重复 start 不可达（start 总是新建项目）；书名冲突 → 409 `PROJECT_ALREADY_EXISTS`。
- 模型/凭据缺失 → 400 `LLM_API_KEY_MISSING`（在创建项目**之前**校验，避免留下半成品项目）。

### GET /api/v1/decompose/plan

续拆预览（**不吃文件字节**：章与正文已在库）。不落库、无状态。

```typescript
// Query
{
  scope_start?: number;        // 缺省 = 未拆章最小覆盖区间的起点
  scope_end?: number;          // 缺省 = 未拆章最小覆盖区间的终点
}

// Res: 200
{
  scopeStart: number;          // 实际生效范围（无未拆章时为 0）
  scopeEnd: number;
  defaulted: boolean;          // true = 用了缺省范围
  remainingCount: number;      // 未拆章总数（全书口径）
  decomposedInScope: number;   // 范围内已拆章数（将重拆）
  chapters: Array<{
    index: number;
    title: string;
    charCount: number;
    volumeIndex: number;
    decomposed: boolean;       // 已拆（历史 job 的 done 批覆盖）
  }>;
  stats: { min: number; median: number; max: number };
  estimate: {
    batchCount: number;
    llmCalls: number;          // batchCount + 2（归并 + 报告）
    inputTokensApprox: number;
    outputTokensApprox: number;
    costApprox: number | null;
  };
}

// Res: 400 VALIDATION_ERROR（范围参数非整数 / start > end）
// Res: 404 DECOMPOSE_NO_CHAPTERS（项目里没有章）
```

**语义**：

- **已拆判定** = 历史上所有 job 的 `done` 批覆盖的章并集；缺省范围 = 未拆章的**最小覆盖区间**（设计 §7.1）。
- 显式范围包含已拆章 = **有意重拆**（归并按跨轮口径复用已有实体，不重复、不误删）。
- 估算与 `analyze` **同一实现**（`buildEstimate` / `statsOf` 同源，只换输入章集），但**不保证同值**：`plan` 的章字数取库内 `content_text` 投影长（= 真正喂模型的口径），`analyze` 取源切片 trim 长 ⇒ 同一范围的批数可能差 1（不保留源文件所致，见设计 §7.1）。不创建 job、不写任何状态。

### POST /api/v1/decompose/continue

续拆：在**当前项目**内开新 job（S1' 只落 job 与批规划，不建项目、不导正文）。

```typescript
// Query
{
  scope_start?: number;        // 缺省同 plan
  scope_end?: number;
}

// Res: 200
{
  jobId: string;
  scopeStart: number;
  scopeEnd: number;
  status: "running";
  batchCount: number;
}

// Res: 400 LLM_API_KEY_MISSING（模型/凭据缺失——在建 job 之前校验）
// Res: 400 DECOMPOSE_NOTHING_TO_DO（范围里一章都没有；缺省且无未拆章）
// Res: 409 DECOMPOSE_JOB_STATE（已有 running / paused job）
```

**语义**：

- **不吃文件字节**：S1 已把全书正文导入（设计 §3），续拆无需源文件、也不需要用户再导一次。
- **旧 job 全留**（行与批结果都在 `data.db`）：进度面只显最新 job；更早的过程靠会话记录回看。
- **先开会话再跑**：为新 job 建一枚 `decompose-<jobId>` 会话（创建前按 `DECOMPOSE_KEPT_SESSIONS` 清理超出的旧记录，见设计 §7.2）。

### GET /api/v1/decompose/job

当前项目的 job 状态（进度页与概览卡片轮询用）。

```typescript
// Res: 200
{
  jobId: string;
  status: "pending" | "running" | "paused" | "done" | "failed";
  stage: "ingest" | "extract" | "merge" | "report" | "done";  // 阶段条高亮用
  scopeStart: number;
  scopeEnd: number;
  createdAt: string;
  updatedAt: string;
  progress: { done: number; failed: number; total: number };
  batches: Array<{
    seq: number;              // 1-based 批序号
    chapterIndexes: number[];// 覆盖的章序（文件位置序）
    chapterTitles: string[];  // 行标题展示用（与 chapterIndexes 同序）
    charCount: number;
    status: "pending" | "running" | "done" | "failed";
    attempts: number;
    error: string | null;
  }>;
  error: string | null;       // job 级失败摘要
  report: { entityId: string; name: string } | null;  // 完成后指向拆解报告
}

// Res: 404（当前项目没有 job）
{ error: { code: "DECOMPOSE_JOB_NOT_FOUND" } }
```

**语义**：**不含批结果正文**（数百批 × 每条千级 token 会撑爆响应）；展开某批时另取 `GET /decompose/job/batches/:seq`。

### GET /api/v1/decompose/job/batches/:seq

单批抽取结果（进度页展开行时按需拉取）。

```typescript
// Res: 200
{
  seq: number;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  error: string | null;
  result: {
    chapters: Array<{
      chapterIndex: number;
      chapterTitle: string;
      summary: string;
      characters: Array<{ name: string; role?: string; description?: string; alias?: string }>;
      settings: Array<{ name: string; description?: string; tags?: string[] }>;
      locations: Array<{ name: string; type?: string; description?: string }>;
      relations: Array<{ source: string; target: string; type: string; evidence?: string }>;
    }>;
  } | null;                   // 未完成 → null
}

// Res: 404（批序号越界）
{ error: { code: "DECOMPOSE_BATCH_NOT_FOUND" } }
```

### GET /api/v1/decompose/job/log

拆解过程时间线（读拆解会话里的 `custom` 过程条目；进度页展示）。

```typescript
// Res: 200
{
  sessionId: string;           // decompose-<jobId>
  entries: Array<{
    id: string;                // 会话文件里的 entry id
    at: string;                // ISO 8601
    kind: string;              // 过程条目类型（见设计 §8）
    text: string;              // 单行可读文案（服务端渲染，客户端直接展示）
    batchSeq?: number;         // 批相关条目
  }>;
}

// Res: 404 DECOMPOSE_JOB_NOT_FOUND（当前项目没有 job）
```

**语义**：只记**批表里没有的**信息（每次尝试的时间与失败原因、模型与用量、归并/报告明细、快照组成）；批状态与批结果不重复记（`GET /decompose/job` + `/job/batches/:seq` 是唯一真相）。会话记录被用户删除时 `entries` 为空数组（不回 404）。

### POST /api/v1/decompose/job/pause

中止当前 job（当前批跑完即停，结果不浪费）。

```typescript
// Res: 200
{ status: "paused" }

// Res: 409（状态不允许：已 done / 已 paused / 已 failed；`pending` 与 `running` 放行——`pending` 实际不可达，S1 同步置 `running` 后才返回）
{ error: { code: "DECOMPOSE_JOB_STATE" } }
```

### POST /api/v1/decompose/job/resume

从第一个未完成批续拆（跳过 `done` 的批）。

```typescript
// Res: 200
{ status: "running" }

// Res: 409（状态不允许：非 paused）；400（模型/凭据缺失）
{ error: { code: "DECOMPOSE_JOB_STATE" | "LLM_API_KEY_MISSING" } }
```

### POST /api/v1/decompose/job/batches/:seq/rerun

重跑单批：重算该批抽取结果 → **重建归并与报告**（`done` 与 `failed` 都可重跑）。

```typescript
// Res: 200
{ status: "running", seq: number }

// Res: 404（批序号越界）；409（job 正在 running / paused，需先续拆或等待）；400 `LLM_API_KEY_MISSING`（模型/凭据缺失——与 resume 同口径；**前置拦下可避免「缺凭据重跑先把已完成批的 result 清空」的数据损失路径**）
{ error: { code: "DECOMPOSE_BATCH_NOT_FOUND" | "DECOMPOSE_JOB_STATE" | "LLM_API_KEY_MISSING" } }
```

**语义**：重跑前先校验模型/凭据（缺失 → 400，且该批 `result` 与 job 状态均不变——`failBatch` 会把 `result` 置 NULL，不前置会烧掉一批已付 token 的产物）。重跑后 job 回到 `running`，阶段先回到 `extract` 再走 `merge`/`report`；已完成的批**不会**被重跑（只有该批与归并/报告重算）。归并按 `decompose_jobs.merge_written` 三路比对做幂等（见 [`../design/60-decompose.md`](../design/60-decompose.md) §6.1）。

## 错误码

| code | HTTP | 说明 |
| :--- | :--- | :--- |
| `DECOMPOSE_FILE_TOO_LARGE` | 400 | 文件超体积上限（`DECOMPOSE_MAX_FILE_BYTES`） |
| `DECOMPOSE_FILE_INVALID` | 400 | 解码失败或文本为空 |
| `DECOMPOSE_JOB_NOT_FOUND` | 404 | 当前项目没有 job |
| `DECOMPOSE_BATCH_NOT_FOUND` | 404 | 批序号越界 |
| `DECOMPOSE_JOB_STATE` | 409 | 当前 job 状态不允许该操作（pause/resume/rerun 的状态前置；`continue` 也用它——已有 running/paused job 时不给开新 job） |
| `DECOMPOSE_NO_CHAPTERS` | 404 | 续拆预览：项目里没有章（没有可拆的正文） |
| `DECOMPOSE_NOTHING_TO_DO` | 400 | 续拆启动：范围里一章都没有（缺省且无未拆章） |
| `SESSION_READONLY` | 409 | `POST /chat` 的 `session_id` 指向拆解会话（`decompose-` 前缀）：拆解会话只读，不可续聊（见 [80-api-chat.md](./80-api-chat.md)） |
| `DECOMPOSE_JOB_RUNNING` | 409 | 删除会话被拒：该 `decompose-` 会话所属 job 仍在跑（见 [80-api-chat.md](./80-api-chat.md)） |
| `PROJECT_ALREADY_EXISTS` | 409 | 书名对应目录已存在（服务端扩展码，复用） |
| `LLM_API_KEY_MISSING` | 400 | 当前模型所属 provider 未配置凭据（服务端扩展码，复用） |
| `INVALID_PROJECT_PATH` | 400 | 项目路径校验失败（服务端扩展码，复用） |

## 与其他链路的关系

| 项 | 口径 |
| :--- | :--- |
| chat | 拆解 job **不占** chat 的在途流（独立运行通道），拆解期间对话照常可用；切书会暂停 job（`setCurrentProject` 单点）。拆解会话与 chat 会话**同目录**：chat 面板可见，但**只读**（`POST /chat` 拒 `decompose-*`），有在途 job 时禁删 |
| 提案 | 拆解**不走提案仓**——写操作由服务端确定性代码完成，用户通过「单批重跑」而非逐条确认修正 |
| 备份 / 导出 / 云 | job 状态与批结果都在 `data.db`（`decompose_jobs` / `decompose_batches`），拆解会话在 `sessions/`——两者都随备份/导出/云自动携带；项目目录不新增任何目录 |
| 大纲 / 正文 / 实体 | 走既有表与文件（`outline.json` / `document_records` / `entities` / `relation_records`），**不新增写端点**；AI 工具面不变（无文档写工具） |
