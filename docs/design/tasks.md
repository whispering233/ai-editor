# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### 卡：提案历史只读卡（会话消息重建）

**范围**

- `packages/client/src/stores/chat.ts`：`ProposalCard` 增可选 `toolCallId?: string`；`tool_execution_end` 追加提案时写入同一帧的 `toolCallId`（仅客户端字段，不进 API）。
- `packages/client/src/components/chat/ChatPanel.tsx`：新增并导出 `HistoricalProposalCard`（接收 `propose_*` 调用数组；头部「历史提案 · N 条（只读）」；行 = 类型中文名 + 摘要首行，点行展开完整参数摘要；无状态、无按钮、不发 `resolveNames`）；`MessageItem` 增可选 `liveProposalToolCallIds`，在正文之后渲染历史卡并过滤同 `toolCallId` 的 live 行；`MessageList` 从 `proposals` 派生该集合后传给每条消息。
- 测试：`chat-panel.test.tsx` 直渲染历史卡（折叠/展开、多条、无按钮、非提案工具不渲染、live id 过滤、无 live 时全量）；`chat.test.ts` 断言 `tool_execution_end` 写入 `toolCallId`。
- 文档已在 `docs/ui/DESIGN.md`（`proposal-card` 历史形态）与 `docs/design/30-agent-loop.md` §2（只读历史口径）登记。

**验收**

- 一条 assistant 消息含 2 个 `propose_*` 调用 → 一张历史卡、2 行；普通工具调用不产生历史卡。
- 历史卡无「确认/拒绝」按钮、无状态文案；展开行显示 `summarizePreview` 的参数摘要（id 原样，不解析名称），无摘要时显示原始 JSON。
- live 组卡存在时，按 `toolCallId` 隐藏对应历史行；不同消息/不同轮次不受「尾条」位置影响，不重复。
- 刷新/切会话后 `proposals` 为空，历史卡仍从消息 `toolCalls` 渲染。
- `pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test` 全绿；SSR 渲染测试覆盖折叠/展开。

**不做**

- 不新增表/API/服务端字段；不持久化确认/拒绝状态；不解析名称；不改 live 组卡、批量、YOLO；不做独立历史面板/分页。

**硬完成判据**

- `git log` 含本卡新 commit + `git status` 干净；无 commit 不许报 PASS；汇报必附 commit hash 与验证命令输出。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
