# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### 卡：大纲提案父容器快照误判修复

**范围**

- `packages/tools/src/proposal/types.ts`：`ProposalReference` 增加可选 `check?: "version" | "exists"`（缺省 `version`，语义不变）；新增 `refOutlineNodeExists(node)`（`check: "exists"`，仍带 `updated_at` 供诊断，确认时忽略）。
- `packages/tools/src/proposal/outline.ts`：`buildProposeOutlineNode` 的父引用、`buildProposeMoveNode` 的目标父引用改用 `refOutlineNodeExists`；被移动节点自身仍用 `refOutlineNode`；删除节点仍用版本引用。
- `packages/server/src/routes/proposal.ts`：`assertReferenceFresh` 的 `outline_node` 分支对 `check === "exists"` 只校验节点存在且未软删，不比对 `updated_at`；其余引用/其余 kind 保持原样。
- 测试：`packages/tools/src/proposal/outline.test.ts` 更新精确引用断言；`packages/tools/src/proposal/types.test.ts` 补 helper 断言；`packages/server/src/routes/proposal.test.ts` 补误判回归。

**验收**

- 同父下两个新建提案顺序确认均 200（同卷两章 / 同章两场景至少覆盖一种，并覆盖父节点 `updated_at` 已被第一个确认推进）。
- `check: "exists"` 的父引用在父仅 `updated_at` 变化时仍 200；父被软删/不存在时仍 409 `PROPOSAL_STALE`。
- 移动提案：目标父用存在性引用（父版本变化仍 200）；被移动节点自身版本变化仍 409。
- 现有版本引用（Delta / 实体 / 关系 / 删除节点）的 409 用例不回退。
- `pnpm typecheck`、`pnpm lint`、`pnpm -r build` 后相关包测试全绿。

**不做**

- 不改客户端组卡/批量/YOLO；不改提案 TTL、一次性消费、项目绑定；不放松删除/Delta/实体/关系的版本校验；不新增 API。

**硬完成判据**

- `git log` 含本卡新 commit + `git status` 干净；无 commit 不许报 PASS；汇报必附 commit hash 与验证命令输出。

---

> 未排期遗留项进 `backlog.md`。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
