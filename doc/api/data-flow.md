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

## 关键数据流特性

| 特性 | 说明 |
|------|------|
| 服务端状态持有 | Server 在内存中持有一个 `currentProject`，所有 API 调用共享此引用。关闭项目时释放数据库连接并 `saveDatabase` 落盘 |
| JSON 树读写 | 大纲操作直接读写 `outline.json` 文件，整树加载/保存（不涉及数据库） |
| outline.json 原子写 | 保存走「写临时文件 → fsync → rename 覆盖」，崩溃/断电时旧文件完好（决策 11） |
| 软删 + 回收站 | 软删实体/节点时其关联的关系与 Delta **一并软删**（relation_records / delta_records 标 `deleted_at`），常规查询默认过滤；restore **级联还原**（本体 + 关系 + Delta）；purge 才物理清除（决策 12 修订） |
| Delta 累积计算 | `computeState` 通过 `getNodePathIds` 获取从根到目标节点的路径，收集路径上所有节点的 Delta 并依次应用 |
| 数据库持久化 | 每个 API 调用直接操作 `better-sqlite3` 的同步 API，写入即时落盘（WAL 模式） |
| SSE 全链路取消 | 浏览器刷新/断网导致 SSE 断开时，AbortController 终止 agent 循环并中止 DeepSeek fetch；未确认提案作废；写操作顺序固定「先 DB 后 JSON」，两存储间不一致由 `find_orphan_elements` 兜底修复（决策 16 修订） |
| 对话历史持久化 | 会话消息写入 data.db 的 `chat_messages` 表（session_id / role / content / tool_calls），服务重启后同 session_id 可继续对话；滑动窗口裁剪与摘要压缩在 agent/session.ts 运行时完成（决策 18） |
