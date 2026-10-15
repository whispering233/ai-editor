# 作家文风练习（Practice）

> 预置作家素材、范文样本、自由练习篇与风格说明素材包的读写。设计（工作区单位 / 素材包 / 点评卡 / AI 边界 / 注入）见 [`../design/60-practice.md`](../design/60-practice.md)；公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。
> **点评与出题不在本模块**：触发走 `POST /api/v1/chat`（携带 `context.practice_sample_id` 或 `context.practice_free_piece_id`），见 [80-api-chat.md](./80-api-chat.md)。

**前置条件**：全部端点要求当前工作区 `kind = "practice"`（小说工作区访问 → 400 `KIND_MISMATCH`；反向同理，小说语义端点由练习工作区访问同样 400）**且** `project.json` 的 `author_id` 能解析到预置作家（shared `AUTHOR_CATALOG`）；缺失 / 未知 → 400 `VALIDATION_ERROR`（文案「练习工作区未关联预置作家」）。无当前工作区 → 409 `NO_PROJECT_OPEN`。

**作家素材（作家介绍 / 作品清单 / 作家风格说明的预置文本）没有端点**：客户端直读 shared 常量，服务端 AI 侧读同一份常量。只有**风格说明的用户覆盖**走本模块端点。

**请求字段 snake_case、响应字段 camelCase**（全站约定，同 `project` 模块）——**例外**：嵌套对象内部字段按公共约定原样透传（点评卡内层恒 snake_case，见 [api-public.md](./api-public.md)「命名约定」）。

**404 文案**：样本端点 → 「练习样本不存在」；自由练习篇端点 → 「自由练习不存在」；码同为 `PRACTICE_NOT_FOUND`。

**长度上限**一律取 shared 常量（`MAX_PRACTICE_SAMPLE_CHARS` / `MAX_PRACTICE_EXCERPT_LABEL_CHARS` / `MAX_PRACTICE_TOPIC_CHARS` / `MAX_PRACTICE_BRIEF_CHARS` / `MAX_PRACTICE_DRAFT_CHARS` / `MAX_PRACTICE_STYLE_PACK_CHARS`）——UI 提示与 REST schema 同源，超限 → 400 `VALIDATION_ERROR`。

## 范文样本

### GET /api/v1/practice/samples

本工作区全部范文样本（按 `updatedAt` 倒序；同值按 `id` 升序作稳定次序）。**列表不回正文与卡体**。

```typescript
// Query: (none)

// Res: 200
{
  samples: Array<{
    id: string;
    workId: string | null;        // 关联作品 id（预置作品清单内的稳定 slug；null = 「其他」）
    excerptLabel: string;         // 片段说明（空串 = 未填）
    charCount: number;            // 范文快照字符数（列表展示用；不返回正文）
    hasDraft: boolean;            // 是否已写稿
    hasFeedback: boolean;         // 是否已有点评卡
    createdAt: string;            // ISO 8601
    updatedAt: string;
  }>;
}
```

> **作品名不在响应里**：客户端持有同一份 `AUTHOR_CATALOG`，按 `workId` 查名（null / 未知 id → 共享的「其他」文案）。服务端不复制一份作品名（第二事实源）。

### POST /api/v1/practice/samples

新建范文样本（粘贴或导入文本均走这里——导入只是客户端把文件读进输入框，不新增传输形态）。

```typescript
// Req
{
  work_id?: string | null;      // 关联作品：省略 / null = 「其他」；给了必须在预置作品清单内（否则 400 VALIDATION_ERROR）
  excerpt_label?: string;       // 片段说明：可省略（空串 = 未填）；上限 MAX_PRACTICE_EXCERPT_LABEL_CHARS
  text: string;                 // 必填：范文快照（trim 非空，上限 MAX_PRACTICE_SAMPLE_CHARS）
}

// Res: 200 —— 同 GET /practice/samples/:id 的响应（draft 为空串、feedback 为 null）
```

### GET /api/v1/practice/samples/:id

样本详情（**唯一返回范文全文与点评卡的读端点**）。

```typescript
// Query: (none)

// Res: 200
{
  id: string;
  workId: string | null;        // null = 「其他」
  excerptLabel: string;         // 空串 = 未填
  text: string;                 // 范文快照全文
  draft: string;                // 用户仿写稿（未写 = 空串）
  feedback: FeedbackCard | null; // 点评卡（未点评 = null）；**读取侧只防「非对象」**：非法 JSON / 数组 / 字符串 / null → null，
                                 // 合法 JSON 对象一律透传（`{}` 也照原样返回）；**卡内形状校验在写入侧**（提交点评工具的 schema）
  createdAt: string;
  updatedAt: string;
}

// FeedbackCard（点评卡；两形态同形，写入侧形状见 ../design/60-practice.md §6）
// **卡内层字段遵循公共约定的嵌套透传（snake_case）**——camelCase 映射只作用于 API 顶层字段
{
  dimensions: Array<{
    name: string;
    sample_trait: string;        // 依据侧特征（仿写 = 范文；自由练习 = 风格说明）
    draft_trait: string;
    sample_quotes: string[];     // 证据引用（写入侧已校验：仿写 ⊆ 范文、自由练习 ⊆ 风格说明；空串 / 纯空白视为不匹配 → 丢弃）
    draft_quotes: string[];      // 证据引用（写入侧已校验 ⊆ 稿件）
    advice: string;
  }>;
  summary?: string;
}
// Res: 404 PRACTICE_NOT_FOUND
```

### PUT /api/v1/practice/samples/:id

保存仿写稿——**唯一的用户写稿入口**（AI 工具面无写稿工具）。

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

## 作家风格说明素材包

风格说明的**预置文本**来自 shared 常量（无端点）；下面三个端点读写**当前工作区作者的**用户覆盖（`practice_style_packs` 单行）。

### GET /api/v1/practice/style-pack

```typescript
// Query: (none)

// Res: 200
{
  authorId: string;             // 当前工作区的预置作家 id
  content: string;              // 生效内容 = 用户覆盖 ?? 预置（恒非空）
  customized: boolean;          // 是否有用户覆盖
  updatedAt: string | null;     // 用户覆盖的写入时刻；无覆盖 = null
}
```

### PUT /api/v1/practice/style-pack

写入用户覆盖（新建或覆盖）。

```typescript
// Req（strict）
{
  content: string;              // trim 非空（清空请用 DELETE——空覆盖会让生效内容为空，语义上等于恢复预置）；上限 MAX_PRACTICE_STYLE_PACK_CHARS
}

// Res: 200
{ authorId: string; content: string; customized: true; updatedAt: string; }
```

### DELETE /api/v1/practice/style-pack

**恢复预置**：删除用户覆盖（幂等——没有覆盖也返回 200）。

```typescript
// Req: (none)

// Res: 200
{ authorId: string; content: string; customized: false; updatedAt: null; }   // content = 预置文本
```

## 自由练习

### GET /api/v1/practice/free

本工作区全部自由练习篇（按 `updatedAt` 倒序；同值按 `id` 升序作稳定次序）。**列表不回稿件与卡体**。

```typescript
// Query: (none)

// Res: 200
{
  pieces: Array<{
    id: string;
    topic: string;              // 题目（空串 = 待出题）
    brief: string;              // 写作要求（空串 = 无）
    topicSource: "user" | "ai";
    charCount: number;          // 稿件字符数
    hasDraft: boolean;
    hasFeedback: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

### POST /api/v1/practice/free

新建自由练习篇。

```typescript
// Req
{
  topic_source: "user" | "ai";  // 必填：用户自拟题 / 让 AI 出题
  topic?: string;               // topic_source = "user" 时必填（trim 非空，上限 MAX_PRACTICE_TOPIC_CHARS）；
                                // = "ai" 时必须省略或为空串（建「待出题」空题行，题目由 submit_practice_topic 工具写入）
  brief?: string;               // 写作要求：可省略（空串 = 无）；上限 MAX_PRACTICE_BRIEF_CHARS
}

// Res: 200 —— 同 GET /practice/free/:id 的响应（draft 为空串、feedback 为 null）
```

### GET /api/v1/practice/free/:id

自由练习详情（**唯一返回稿件全文与点评卡的读端点**）。

```typescript
// Query: (none)

// Res: 200
{
  id: string;
  topic: string;                // 空串 = 待出题
  brief: string;
  topicSource: "user" | "ai";
  draft: string;
  feedback: FeedbackCard | null; // 形状同上（`sample_*` = 风格说明侧特征与引用）
  createdAt: string;
  updatedAt: string;
}
// Res: 404 PRACTICE_NOT_FOUND
```

### PUT /api/v1/practice/free/:id

保存自由练习稿——与仿写稿同一口径（唯一用户写稿入口、后写覆盖）。

```typescript
// Req（strict）
{
  draft: string;                // 允许空串；上限 MAX_PRACTICE_DRAFT_CHARS
}

// Res: 200
{ updatedAt: string; }
// Res: 404 PRACTICE_NOT_FOUND
```

### DELETE /api/v1/practice/free/:id

删除自由练习篇（物理删；删掉不满意的 AI 出题 = 删这篇再新建）。

```typescript
// Req: (none)

// Res: 200
{ deleted: true; }
// Res: 404 PRACTICE_NOT_FOUND
```

## 点评 / 出题链路（跨模块）

| 步 | 契约 |
| :--- | :--- |
| 仿写点评触发 | `POST /api/v1/chat`，`context.practice_sample_id = <ps-*>`，`message` = 用户可见的触发文案（如「请点评我的仿写稿」） |
| 自由练习点评触发 | `POST /api/v1/chat`，`context.practice_free_piece_id = <pf-*>`，`message` = 如「请点评我的自由练习稿」 |
| 自由练习出题触发 | `POST /api/v1/chat`，`context.practice_free_piece_id = <pf-*>`（该篇为**空题行**），`message` = 如「请出一道练习题目」 |
| 服务端注入 | **现读**样本 / 篇 + 作家名注入本轮，**只给事实**；「必须提交点评卡 / 出题要给写作要求」这类指令语义唯一出处 = 练习内核提示词常量（注入段不复述）；范文 / 稿件 / 风格说明**不进 prompt**，由只读工具分页拉取 |
| AI 产出 | 点评经 `submit_style_feedback` / `submit_free_feedback` 写 `feedback`（引用逐条校验子串，不匹配即丢弃；空串 / 纯空白同口径）；出题经 `submit_practice_topic` 写 `topic` / `brief`（题目非空 → 抛错拒写） |
| 前端 | `tool_execution_end` 帧的 `details`（写库结果：点评 = `{ saved, dimension_count, dropped_quotes }`；出题 = `{ saved, piece_id }`）= **即时刷新信号**；卡体与题目从 `GET /practice/samples/:id` / `GET /practice/free/:id` 读（刷新/重载同此——帧里没有卡体与题目） |
| 留痕 | 触发消息与整轮对话落在该工作区的 `sessions/`（点评与出题可回溯、可追问） |