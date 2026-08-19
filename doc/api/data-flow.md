# 数据流说明

## 用户 CRUD 操作（同步 request-response）

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

## AI 对话（Agent 循环 + 工具调用）

```
Browser                  Server                   agent               ai              DeepSeek
  │                        │                        │                   │                 │
  │ POST /chat             │                        │                   │                 │
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
  │                        │         ◄──────────────│                   │                 │
  │        ◄───────────────│                        │                   │                 │
  │  SSE 流式响应           │                        │                   │                 │
```

## 项目规则数据流（决策 41，2026-08 批次十）

项目规则（system prompt「## 项目设定」段）的唯一事实源从 project.json `prompt` 字段改为项目目录 `AGENTS.md` 文件：

```
Browser (设置页)              Server (Hono)              项目目录
      │                            │                        │
      │  GET /project/agents       │                        │
      │───────────────────────────▶│  readFile(AGENTS.md)   │
      │                            │───────────────────────▶│
      │        ◀───────────────────│                        │
      │  {content, exists, updatedAt}                       │
      │                            │                        │
      │  PUT /project/agents       │                        │
      │  {content}                 │  writeFile(AGENTS.md)  │
      │───────────────────────────▶│  （原子写，决策 11）    │
      │                            │───────────────────────▶│
      │        ◀───────────────────│                        │
      │  {saved, updatedAt}        │                        │
```

**注入链路（数据源变更）**：server chat 路由读取 AGENTS.md 文件内容 → 传入 runAgent → buildContext（`projectPrompt` 参数）→ buildSystemBase 拼装「## 项目设定」段（`PROJECT_PROMPT_TITLE`，空内容跳过）→ 喂给模型。**注入逻辑与段标题不变**（决策 41：注入逻辑保留，数据源从 project.json `prompt` 改为 AGENTS.md 文件内容）。

**自动迁移**：打开项目时若 project.json `prompt` 存在且无 AGENTS.md → 自动迁移写入 AGENTS.md（内容原样，一次性；迁移后 prompt 不再使用）。

**外部修改检测**：web 读取时比对文件 mtime（`GET /project/agents` 返回 `updatedAt`），外部修改后提示刷新/重新加载。

## 关键数据流特性

| 特性 | 说明 |
|------|------|
| 服务端状态持有 | Server 在内存中持有一个 `currentProject`，所有 API 调用共享此引用。关闭项目时释放数据库连接并 `saveDatabase` 落盘 |
| JSON 树读写 | 大纲操作直接读写 `outline.json` 文件，整树加载/保存（不涉及数据库） |
| outline.json 原子写 | 保存走「写临时文件 → fsync → rename 覆盖」，崩溃/断电时旧文件完好（决策 11） |
| 软删 + 回收站 | 软删实体/节点时其关联的关系与 Delta **一并软删**（relation_records / delta_records 标 `deleted_at`），常规查询默认过滤；restore **级联还原**（本体 + 关系 + Delta）；purge 才物理清除。**手动删关系 = 物理删**（不进入回收站，决策 12 修订）；关系可见性**联动端点状态**（source/target 任一软删即不可见，端点还原后自动可见） |
| Delta 累积计算 | `computeState` 通过 `getNodePathIds` 获取从根到目标节点的树路径（严格三层，无游离节点，决策 19），收集路径上所有 Delta，**节点间按树路径顺序、同一节点内按 `order`** 双层排序应用（决策 9） |
| 数据库持久化 | 每个 API 调用直接操作 `better-sqlite3` 的同步 API，写入即时落盘（WAL 模式 + `synchronous=FULL`） |
| SSE 全链路取消 | 浏览器刷新/断网导致 SSE 断开时，AbortController 终止 agent 循环并中止 DeepSeek fetch；未确认提案按会话作废；写操作顺序固定「先 DB 后 JSON」，不一致由**启动一致性校验**兜底补标（以大纲节点软删为准补标关联记录，决策 16 修订）。断开检测三路并用（决策 20）：`stream.onAbort` + `c.req.raw` close/error 监听 + 心跳写失败（SSE 每 15-30s 发 `ping` 事件探活） |
| 对话历史持久化 | 会话消息写入 data.db 的 `chat_messages` 表（session_id / project_id / role / content / tool_calls / tool_call_id，决策 18 修订），服务重启后同 session_id 可继续对话；历史按 `assistant.tool_calls[].id` ↔ `tool.tool_call_id` 成对重组喂回模型，滑动窗口裁剪必须成对；会话列表走 `GET /api/v1/chat/sessions`；滑动窗口裁剪与摘要压缩在 agent/session.ts 运行时完成 |
| 项目规则数据流（决策 41） | 项目规则唯一事实源 = 项目目录 `AGENTS.md` 文件（取代 project.json `prompt`，不再读写）；打开项目时 prompt 存在且无 AGENTS.md → 自动迁移写入（原样，一次性）；system prompt「## 项目设定」段注入逻辑保留，数据源从 project.json `prompt` 改为 AGENTS.md 文件内容（server chat 路由读取 → runAgent → buildContext 传入 `projectPrompt`）；web 读取比对文件 mtime 检测外部修改 |
