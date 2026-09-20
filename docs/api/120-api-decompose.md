# 拆解小说（导入式批量管线）

> 拆解小说的端点契约。设计语义与不变式见 [`../design/60-decompose.md`](../design/60-decompose.md)；数据表见 [`../db/schema.md`](../db/schema.md)；视觉见 [`../ui/DESIGN.md`](../ui/DESIGN.md) §拆解小说。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`。

**传输约定（本模块特有，登记进 [api-public.md](./api-public.md) 的显式例外）**：`analyze` 与 `start` 的请求体是**小说文件的原始字节**（`Content-Type: application/octet-stream`），文件名与其余参数走 query string。理由：编码探测（UTF-8 → GB18030 回退）与切分必须由服务端单一实现，客户端不做解码；走原始字节避免 base64 膨胀。体积上限 = `DECOMPOSE_MAX_FILE_BYTES`，超限 400 `DECOMPOSE_FILE_TOO_LARGE`。

**状态机**：`pending → running → (paused | done | failed)`。job 绑定项目（一项目一 job；拆解入口总是新建项目）。

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
    volumeIndex: number | null; // 所属卷序号（单卷兜底 = 0）
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

### POST /api/v1/decompose/job/pause

中止当前 job（当前批跑完即停，结果不浪费）。

```typescript
// Res: 200
{ status: "paused" }

// Res: 409（状态不允许：已 done / 已 paused / 已 failed）
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

// Res: 404（批序号越界）；409（job 正在 running / paused，需先续拆或等待）
{ error: { code: "DECOMPOSE_BATCH_NOT_FOUND" | "DECOMPOSE_JOB_STATE" } }
```

**语义**：重跑后 job 回到 `running`，阶段先回到 `extract` 再走 `merge`/`report`；已完成的批**不会**被重跑（只有该批与归并/报告重算）。归并按 `decompose_jobs.merge_written` 三路比对做幂等（见 [`../design/60-decompose.md`](../design/60-decompose.md) §6.1）。

## 错误码

| code | HTTP | 说明 |
| :--- | :--- | :--- |
| `DECOMPOSE_FILE_TOO_LARGE` | 400 | 文件超体积上限（`DECOMPOSE_MAX_FILE_BYTES`） |
| `DECOMPOSE_FILE_INVALID` | 400 | 解码失败或文本为空 |
| `DECOMPOSE_JOB_NOT_FOUND` | 404 | 当前项目没有 job |
| `DECOMPOSE_BATCH_NOT_FOUND` | 404 | 批序号越界 |
| `DECOMPOSE_JOB_STATE` | 409 | 当前 job 状态不允许该操作（pause/resume/rerun 的状态前置） |
| `PROJECT_ALREADY_EXISTS` | 409 | 书名对应目录已存在（服务端扩展码，复用） |
| `LLM_API_KEY_MISSING` | 400 | 当前模型所属 provider 未配置凭据（服务端扩展码，复用） |
| `INVALID_PROJECT_PATH` | 400 | 项目路径校验失败（服务端扩展码，复用） |

## 与其他链路的关系

| 项 | 口径 |
| :--- | :--- |
| chat | 拆解 job **不占** chat 的在途流（独立运行通道），拆解期间对话照常可用；切书会暂停 job（`setCurrentProject` 单点） |
| 提案 | 拆解**不走提案仓**——写操作由服务端确定性代码完成，用户通过「单批重跑」而非逐条确认修正 |
| 备份 / 导出 / 云 | job 状态与批结果都在 `data.db`（`decompose_jobs` / `decompose_batches`），随备份/导出/云自动携带；项目目录不新增任何目录 |
| 大纲 / 正文 / 实体 | 走既有表与文件（`outline.json` / `document_records` / `entities` / `relation_records`），**不新增写端点**；AI 工具面不变（无文档写工具） |
