# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

> 执行顺序：A → B → C → D。A/B 有依赖（B 复用 A 的批量路径）；C/D 无依赖，默认串行。
> 每卡硬完成判据：`git log` 含本卡新 commit + `git status` 干净；无 commit 不许报 PASS，汇报必附 commit hash 与验证命令输出。

### 卡 A：提案组卡 + 批量确认/拒绝（client）

- **范围**：`packages/client/src/components/chat/ChatPanel.tsx` 的 `ProposalCardView` 改为组卡；`packages/client/src/stores/chat.ts` 增批量动作（串行复用 `runProposalAction`，逐条记账、失败继续、成功只 `notifyDataChanged()` 一次、一次汇总 toast）；补齐 `PROPOSAL_TYPE_LABELS` 到全部 `propose_*`。
- **验收**：单条也渲染组卡；仅 pending 时「全部确认/全部拒绝」可用；点行展开预览；逐条按钮仍可用；部分失败后其余继续且汇总正确；404 移除、stale 标记。
- **验证**：`pnpm typecheck`；`pnpm --filter @whispering233/ai-editor-client test`；`chat-panel.test.tsx` / `chat.test.ts` 覆盖批量成功、部分失败、404。
- **不做**：服务端批量端点、提案持久化、组卡之外的视觉改版。

### 卡 B：YOLO 自动确认（client，依赖 A）

- **范围**：新增 `packages/client/src/hooks/use-yolo.ts`（`ai-editor:yolo`，防御式读写，默认关）；`ChatPanel.tsx` 配置行右端 `Switch` +「自动确认」；`chat.ts` 的 `agent_end` 分支在**无 `stopReason`（正常结束）**且开关开时调用 A 的批量确认，`error`/`aborted` 不触发。
- **验收**：正常结束自动确认全部 pending（含删除类）；错误/中止不确认；开关关不确认；自动确认与用户手点并发不重复执行；只刷新一次数据。
- **验证**：`pnpm typecheck`；client 测试覆盖上述四种分支。
- **不做**：服务端改动、危险类型豁免、per-session 开关。

### 卡 C：三个详情页改上下布局（client）

- **范围**：`pages/OutlineDetail.tsx:344`、`pages/TimelineDetail.tsx:381`（骨架 `:354`）、`pages/EntityDetail.tsx:568`（骨架 `:541`）的 `grid md:grid-cols-2` → `flex flex-col`；信息/表单在上、关联/层级在下。
- **验收**：三页均为单列；展开表单不再改变关联块高度；窄中栏下两块都占满宽度；骨架同步。
- **验证**：`pnpm typecheck`；浏览器逐页检查三页（含展开/折叠关联）。
- **不做**：人物页 master-detail、参考资料详情、内容重排/字段调整。

### 卡 D：设定树描述显示开关（client）

- **范围**：新增 `packages/client/src/hooks/use-setting-desc.ts`（`ai-editor:setting-desc`，默认显示，防御式读写）；`components/entity/setting-tree.tsx` 控件行「排序」后加 `Switch size="small"` +「描述」；`:844` 描述摘要行按开关条件渲染。
- **验收**：默认显示；关闭后所有行的描述摘要立即隐藏，标题/标签/操作不受影响；刷新后保持；坏值/隐私模式回落默认。
- **验证**：`pnpm typecheck`；client 测试或浏览器检查（开启/关闭、展开/折叠、有/无描述）。
- **不做**：详情页描述字段、其他实体列表、服务端改动。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
