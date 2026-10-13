# 文风仿写练习（Practice）

> 文风目标与练习样本的读写。设计（流程 / 点评卡 / AI 边界 / 注入）见 [`../design/60-practice.md`](../design/60-practice.md)；公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。
> **点评不在本模块**：触发点评走 `POST /api/v1/chat`（携带 `context.practice_sample_id`），见 [80-api-chat.md](./80-api-chat.md)。

**前置条件**：全部端点要求当前工作区 `kind = "practice"`（小说工作区访问 → 400 `KIND_MISMATCH`；反向同理，小说语义端点由练习工作区访问同样 400）。无当前工作区 → 409 `NO_PROJECT_OPEN`。

**请求字段 snake_case、响应字段 camelCase**（全站约定，同 `project` 模块）——**例外**：嵌套对象内部字段按公共约定原样透传（点评卡内层恒 snake_case，见 [api-public.md](./api-public.md)「命名约定」）。

**404 文案按端点语义**：目标端点（目标不存在）→ 「文风目标不存在」；样本详情（需目标信息才能成形，样本行在而目标行缺失的孤儿行同样）→ 「练习样本不存在」；码同为 `PRACTICE_NOT_FOUND`。**改稿 / 删样本不查目标行**（行存在即可改/删，不因目标缺失而 404）。

**长度上限**一律取 shared 常量（`MAX_PRACTICE_TARGET_NAME_CHARS` / `MAX_PRACTICE_OBSERVATION_CHARS` / `MAX_PRACTICE_SOURCE_LABEL_CHARS` / `MAX_PRACTICE_SAMPLE_CHARS` / `MAX_PRACTICE_DRAFT_CHARS`）——UI 提示与 REST schema 同源，超限 → 400 `VALIDATION_ERROR`。

### GET /api/v1/practice/targets

文风目标列表（按 `updatedAt` 倒序；同值按 `id` 升序作稳定次序）。

```typescript
// Query: (none)

// Res: 200
{
  targets: Array<{
    id: string;
    name: string;
    observation: string | null;   // 用户自己观察到的文风特点（未写 = null）
    sampleCount: number;          // 该目标下的样本数（未软删概念：练习数据物理删）
    createdAt: string;            // ISO 8601
    updatedAt: string;
  }>;
}
```

### POST /api/v1/practice/targets

新建文风目标。

```typescript
// Req
{
  name: string;                 // 必填，trim 非空 + 长度上限 = 常量 MAX_PRACTICE_TARGET_NAME_CHARS
  observation?: string;         // 可选：用户自己观察到的文风特点
}

// Res: 200 —— 与列表项**同形**（含 `sampleCount`，新建目标下恒为 0）
{ id: string; name: string; observation: string | null; sampleCount: 0; createdAt: string; updatedAt: string; }
```

### PUT /api/v1/practice/targets/:id

改名 / 改观察（部分更新）。

```typescript
// Req（至少给一项）
{
  name?: string;                // 省略 = 不动（给了则 trim 非空 + 上限同 POST）
  observation?: string;         // 省略 = 不动；空串 = 清空（写 null）
}

// Res: 200 —— 同 GET /practice/targets 的单项目形态
// Res: 404 PRACTICE_NOT_FOUND —— 目标不存在
```

### DELETE /api/v1/practice/targets/:id

删除目标（**物理删 + 级联删该目标下全部样本**；练习数据无回收站，UI 需二次确认）。

```typescript
// Req: (none)

// Res: 200
{ deleted: true; deletedSamples: number; }
// Res: 404 PRACTICE_NOT_FOUND
```

### GET /api/v1/practice/targets/:id/samples

某目标下的样本列表（按 `updatedAt` 倒序；同值按 `id` 升序作稳定次序）。

```typescript
// Query: (none)

// Res: 200
{
  samples: Array<{
    id: string;
    sourceKind: "paste";          // MVP 唯一值（跨工作区快照导入为升级路径）
    sourceLabel: string;          // 快照来源说明（用户手填）
    charCount: number;            // 范文快照字符数（列表展示用；不返回正文）
    hasDraft: boolean;            // 是否已写稿
    hasFeedback: boolean;         // 是否已有点评卡
    createdAt: string;
    updatedAt: string;
  }>;
}
// Res: 404 PRACTICE_NOT_FOUND —— 目标不存在
```

### POST /api/v1/practice/targets/:id/samples

新建练习样本（粘贴范文）。

```typescript
// Req
{
  source_kind?: "paste";        // 省略 = "paste"
  source_label: string;         // 必填：来源说明（如「汪曾祺《受戒》节选」；trim 非空）
  text: string;                 // 必填：范文快照（trim 非空，上限 MAX_PRACTICE_SAMPLE_CHARS）
}

// Res: 200 —— 同 GET /practice/samples/:id 的响应（draft 为空串、feedback 为 null）
// Res: 404 PRACTICE_NOT_FOUND —— 目标不存在
```

### GET /api/v1/practice/samples/:id

样本详情（**唯一返回范文全文与点评卡的读端点**）。

```typescript
// Query: (none)

// Res: 200
{
  id: string;
  targetId: string;
  targetName: string;           // 便于页面标题（少一次请求）
  observation: string | null;   // 目标的用户观察（同屏展示）
  sourceKind: "paste";
  sourceLabel: string;
  text: string;                 // 范文快照全文
  draft: string;                // 用户仿写稿（未写 = 空串）
  feedback: FeedbackCard | null; // 点评卡（未点评 = null）；**读取侧只防「非对象」**：非法 JSON / 数组 / 字符串 / null → null，
                                 // 合法 JSON 对象一律透传（`{}` 也照原样返回）；**卡内形状校验在写入侧**（提交点评工具的 schema）
  createdAt: string;
  updatedAt: string;
}

// FeedbackCard（点评卡；写入侧形状见 ../design/60-practice.md §4）
// **卡内层字段遵循公共约定的嵌套透传（snake_case）**——camelCase 映射只作用于 API 顶层字段
{
  dimensions: Array<{
    name: string;
    sample_trait: string;
    draft_trait: string;
    sample_quotes: string[];    // 证据引用（写入侧已校验：必为范文或稿件的子串；空串 / 纯空白视为不匹配 → 丢弃）
    draft_quotes: string[];
    advice: string;
  }>;
  summary?: string;
}
// Res: 404 PRACTICE_NOT_FOUND
```

### PUT /api/v1/practice/samples/:id

保存仿写稿——**全系统唯一的用户写稿入口**（AI 工具面无写稿工具）。

```typescript
// Req（strict：不接受其他字段）
{
  draft: string;                // 允许空串（清空稿件）；上限 MAX_PRACTICE_DRAFT_CHARS
}

// Res: 200
{ updatedAt: string; }          // 版本戳（客户端可据此判断保存结果）

// Res: 404 PRACTICE_NOT_FOUND
```

**并发口径**：后写覆盖（**不带版本戳**，与结构化数据/参考资料现状一致；多标签页防覆盖是已登记的延期项）。

### DELETE /api/v1/practice/samples/:id

删除样本（物理删）。

```typescript
// Req: (none)

// Res: 200
{ deleted: true; }
// Res: 404 PRACTICE_NOT_FOUND
```

## 点评链路（跨模块）

| 步 | 契约 |
| :--- | :--- |
| 触发 | `POST /api/v1/chat`，`context.practice_sample_id = <ps-*>`，`message` = 用户可见的触发文案（如「请点评我的仿写稿」） |
| 服务端 | 现读目标名与 `observation` 注入本轮；范文与稿件**不进 prompt**，由只读工具分页拉取 |
| AI 产出 | 经提交工具写 `practice_samples.feedback`（引用逐条校验子串，不匹配即丢弃；空串 / 纯空白同口径） |
| 前端 | 卡片随 `tool_execution_end` 帧的 `details` 即时渲染；刷新/重载从 `GET /practice/samples/:id` 读 |
| 留痕 | 触发消息与整轮对话落在该工作区的 `sessions/`（点评可回溯、可追问） |
