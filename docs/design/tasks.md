# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 批次 1 · 章级锚点收窄（进行中）

> 契约来源：`docs/design/10-data-model.md` §14.7、`docs/db/schema.md`（delta / relation / project.json 三节）、`docs/api/50-api-delta.md`、`docs/api/40-api-relation.md`、`docs/api/10-api-project.md`。三张卡互相独立，可并行（不同文件面）。

- [ ] **1.2 变更记录仅章（REST + 提案层 + 大纲页入口）**
  - 后端：`POST /delta` 增加节点层级校验（非 `chapter` → 400 `VALIDATION_ERROR`）；`assertOutlineNode` 旁新增层级断言（照抄 S13.3 的「REST + 工具层双管、shared schema 不动」模式）。
  - 提案层：`packages/tools` 的 `propose_add_delta`（`proposal/delta.ts`）对 `node_id` 做同样拒绝 + 工具描述补「仅章」。
  - 前端：大纲节点详情页的「变更记录」区块（`NodeDeltaList` + `DeltaCreateForm`）仅在 `chapter` 节点渲染；卷/场景页**不显示也不留可点击的「+ 新建变更」入口**（不做只读兼容——不留"必定 400"的入口，同卡片 1.1 的收窄口径）。
  - 不改：`POST /delta/compute` 的 `at_node_id`（查询不限层级）。
  - 验收：场景/卷节点页无变更记录区且无新建按钮；`POST /delta` 传 `sc-*`/`vol-*` → 400；AI 传场景 id → 工具报错。
  - 测试：`packages/server/src/routes/delta*.test.ts` + `packages/tools/src/proposal/*.test.ts` 补非章拒绝用例。

- [ ] **1.3 伏笔锚点仅章（REST + 提案层 + 面板选择器 + 工具口径）**
  - 后端：`POST /relation` 对 `relation_type ∈ {plants, advances, resolves}` 且 `source_type=outline_node` 校验节点为 `chapter`（非章 → 400）。提案层 `propose_add_relation` 同步拒绝。
  - 前端：`HookPanel` 四处节点选择器（埋点 / 推进回收 / `expected_resolve_node_id` / 选择器通用件）只列章节点；`lib/hook-panel.ts` 的 `anchorNodeForAbandon` 退化分支由「树末节点」改为「**树末章**」。
  - 工具：`suggest_hook_payoff` 候选由 scene 改为 **chapter**（注释与描述同步）；`find_hook_opportunities` 输入只接受章；工具描述补「仅章」。
  - **提案层补齐（卡片 1.2 过渡态遗留，oracle 复核为阻塞级）**：`client/src/lib/hook-panel.ts` 的 `runLifecycleWrite` 直连 `POST /delta`、node_id 来自全层级选择器 → 选场景/卷现在直接 400（用户可见回归）；`runAbandonWrite` 在未设 `current_position` 时退回树末节点（多为场景）→ 同样 400。`propose_advance_hook` / `propose_resolve_hook`（`tools/src/proposal/hook.ts`）与 executor（`executor/hook.ts`）锚点同样需保证为章——executor 直写 db **绕过 REST 校验**，必须在提案层拒绝非章。
  - 验收：场景节点建 `plants` → 400；HookPanel 下拉无场景/卷；大纲页伏笔徽标只出现在章行；弃用伏笔在无 `current_position` 时锚到树末章；推进/回收/废弃三条路径均不产生非章锚点 Delta（含无当前位置、无埋点节点的退化分支）。
  - 测试：`packages/server/src/routes/relation.test.ts`、`packages/tools/src/analysis/hook.test.ts`、`packages/client/src/lib/hook-panel.test.ts` 补用例。

- [ ] **1.4 computeState 章序前缀累积（语义修订 A，批次 2/3 前置）**
  - 背景：锚点仅章后父链至多含一章 → 跨章累积失效（`compute-state.ts:114/123`），双视图会退化为"初始值 + 当前章"。契约已改为章序前缀（`docs/design/10-data-model.md` §4、`docs/api/50-api-delta.md`、`docs/db/schema.md`）。
  - 后端：`packages/db/src/queries/compute-state.ts` 收集口径由「父链」改为「**章序前缀**」——复用 `deriveChapterOrder`（`packages/db/src/queries/outline-ops.ts:369`）求全局章序；目标节点 → 进度章映射（章→自身 / 场景→所属章 / 卷→该卷最后一个未软删章 / root→初始值）；应用序 = （章序, `order`）。
  - **不得改变**：四 op 语义、`update` 的 `from` 校验 + `skipped`/`conflicts` 标注、软删可见性规则、`plot_edge` 不参与。
  - 测试（验收硬项）：`compute-state.test.ts` 既有「卷锚点累积」用例改写为新口径 + 新增跨章累积用例（`ch-10` 与 `ch-20` 的 Delta 在 `ch-30` 查询**可见**）+ 场景/卷/root 映射用例；`packages/server/src/routes/delta.test.ts:577` 的「父链唯一：兄弟章的 Delta 不参与计算」用例**必须语义反转**；`packages/tools/src/executor/hook.test.ts` 的注释与 `appliedDeltas` 断言（现写「只累积挂在其树路径上的 delta」、`atNodeId=ch-2`）**一并改为新口径**。
  - 风险登记：`appliedDeltas` 随进度增长（前面所有章的 Delta 均在列表），依赖现有截断机制。

- [ ] **1.5 tools 口径对齐 + delta executor 兜底校验（卡 1.2/1.3 同族缺口 + 卡 1.4 oracle 建议）**
  - `packages/tools/src/executor/delta.ts` 的 `executeAddDelta` 改走 `requireChapterNode`（存在 + 未软删 + `chapter`）——executor **直写 db 绕过 REST**，手工构造的 proposal 仍可写非章锚点；且卡 1.4 后这些锚点**静默不参与累积**（「写了但永远不算」，比报错更难排查）。
  - **LLM 提示词/注释口径同步**（卡 1.4 后仍写旧口径，会塑造模型推断）：`packages/tools/src/index.ts:113-115`（`compute_state` 描述写「只沿大纲树父链累积」）、`packages/tools/src/schemas/delta.ts:31`、`packages/tools/src/query/delta.ts:5/22-23`、`packages/shared/src/types/entity.ts:213`、`packages/shared/src/types/api.ts:587`（后两处仅注释）→ 全部改为「章序前缀累积」。
  - 测试：`executor/index.test.ts:129` 与 `executor/delta.test.ts:88-89` 的 `sc-1` 锚点改 `ch-1` + 新增非章拒绝用例。
  - 验收：executor 层非章锚点 → 抛错；全仓无「父链累积」旧口径残留（`rg "父链"` 只剩设计文档里的历史说明）。

- [ ] **1.6 建立关联对话框按源端类型过滤伏笔关系（卡 1.3 新发现的死胡同）**
  - `packages/client/src/components/entity/create-relation-dialog.tsx` 的 `DIALOG_RELATION_TYPES` 现无条件含 `plants/advances/resolves`，而 `pages/Outline.tsx` 的右键菜单对所有层级行挂对话框、`OutlineDetail.tsx` 节点详情也走同一对话框 → **卷/场景行可选必定 400 的组合**（收窄前是 201）。
  - 修法：源端为大纲节点且非章 → 关系类型下拉排除伏笔三类（源端类型可从 project store 的 outline 树或调用点传入的节点类型获得）；列表模式（自由选源）保持现状。
  - 验收：场景/卷节点行「建立关联」的下拉无伏笔三类；章节点行仍可选；其他关系类型不受影响。

- [ ] **1.7 埋设机会 R3/R4 章级 reason 补计数（卡 1.3 oracle 建议）**
  - `packages/tools/src/analysis/hook.ts` 的 R3/R4（章级聚合后）reason 补「命中计数 + 最典型场景名」，避免「本章 3/6 个场景含外部冲突，最典型：场景二」这类信息全丢；不引入阈值魔数（口径已登记在 `docs/api/tool-calling.md`）。
  - 测试：`analysis/hook.test.ts` 断言 reason 含计数与场景名。

## 批次 2 · 人物数据模型（未开工）

- [ ] 2.1 character 字段改造（+`description`/`alias`（单值假名）/`race`、−`status`、`personality` 保留）+ 摘要口径（`description` 截断 100、能力面板顶层分组名前 2）
- [ ] 2.2 `get_entity_summary` 口径（character 移除 `byStatus`；`topAbilities` 改顶层分组名）——`filters.status` 与 hook 统计**保留**
- [ ] 2.3 `007_character_ability_panel` 迁移（幂等、不覆盖已有面板）+ `SCHEMA_VERSION 6 → 7`
- [ ] 2.4 `computeState` 点分嵌套路径解析（仅标量 `set`/`update`）+ 防御（非法结构不抛错）
- [ ] 2.5 能力面板纯函数库（结构解析 / 顶层分组名 / 叶子路径枚举 / 模板深拷贝派生）+ 单测
- [ ] 2.6 delta 查询批量化（卡 1.4 oracle 实测：300 章 / 300 条 delta → `computeState` **219ms**，因每章一次 `readOutlineFile`；批次 3 人物页 tab 2 每次切换都会调）——改一次性查询（`node_id IN 前缀章集合` 或内部传已读 tree），目标回到个位数毫秒

## 批次 3 · 人物页 UI（未开工）

- [ ] 3.1 master-detail 宿主 + 左栏列表（搜索 / 排序 / 选中 / 空态 / 自动选首个 / 窄屏两级）
- [ ] 3.2 双视图 tab（初始化数据 / 当前位置数据；tab 2 只读；`ComputePreview` 归并入 tab 2，保留手动选节点；`conflicts` 标注照搬）
- [ ] 3.3 字段三分渲染（不可变 / 可变分区；`description` 必填校验；详情页表单）
- [ ] 3.4 `panel-tree` 控件（结构编辑 + 叶子值 + 拖拽 + 只读态）
- [ ] 3.5 新建人物弹窗（必填 姓名 / 角色定位 / 描述；重名软提示；面板「空白 / 内置模板 / 从角色复制」；提交后自动选中）
- [ ] 3.6 关系网 + 其他关联分区（分组 + 对称去重 + 建边入口收窄 + 折叠区）

## 批次 4 · 收尾（未开工）

- [ ] 4.1 全量验证（`pnpm typecheck` / `pnpm lint` / `pnpm -r test` / 浏览器核像素）+ `CHANGELOG.md` 版本段

## 延期项（本批不做）

- 自定义关系类型（`RELATION_TYPES` 为共享常量 + `z.enum` 校验）；跨书能力面板模板库；面板相关 AI 一致性规则；人物页 Delta 时间线；关系星形图（纯展示 SVG）；`status` 字段的服务端彻底清理（已完成字段删除，`filters.status` 保留给 hook）。
