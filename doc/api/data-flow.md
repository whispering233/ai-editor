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
| Delta 累积计算 | `computeState` 通过 `getNodePathIds` 获取从根到目标节点的路径，收集路径上所有节点的 Delta 并依次应用 |
| 数据库持久化 | 每个 API 调用直接操作 `better-sqlite3` 的同步 API，写入即时落盘（WAL 模式） |
