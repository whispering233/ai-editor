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
  charCount: number;          // 正文字数（content_text 长度；从未写过 = 0）
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

// Res: 400（content 缺失 / 非法 JSON / 不是数组）
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
| 副作用 | 保存正文**不产生 Delta、不推进 `current_position`**、不进关系表（内容不是状态事实） |
| 版本戳 | 每次写入更新 `updated_at`；多标签页/多窗口共用同一章时靠 `base_updated_at` 拦截覆盖 |
| 并发 | 同项目单进程写；无需乐观锁之外的保护（多标签页为已登记延期项，此处只做防覆盖） |

### 与大纲接口的关系

`GET /api/v1/outline?with_metadata=true`（见 [60-api-outline.md](./60-api-outline.md)）的章节点 `metadata` 增 `textLength`（= `document_records.content_text` 长度；无文档 = 0）——大纲页/章视图据此显示「已写 / 字数」，**不读取正文全文**。

### 导入导出（无端点）

正文的导入导出是**纯客户端功能**，沿用现有读写端点，不新增 API：

- **导出**：块 JSON（无损，可再导入）/ markdown（**有损**：颜色/对齐/嵌套/媒体在 md 中无表达，导出前必须提示用户）；
- **导入**：块 JSON（浅校验后覆盖）/ markdown（先解析再与原文比对，**存在无法导入的结构时必须提示**并让用户确认，不静默丢弃）。

同款能力对参考资料正文同样可用（见 [30-api-entity.md](./30-api-entity.md)）。
