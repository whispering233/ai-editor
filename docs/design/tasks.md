# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 批次 1 补 · 语义修订（进行中）

- [ ] **1.9 hook 状态 Delta 改 `op=set`（语义修订 B，用户裁决 a）**
  - 契约：`docs/design/10-data-model.md` §4「物化事实字段不用 CAS」、`docs/db/schema.md`（状态机字段用 `set`）、`docs/api/tool-calling.md`（advance_hook 复合写注释）。
  - 改：`packages/tools/src/executor/hook.ts` 的 `executeHookTransition` —— changes 改 `{ field:"status", op:"set", to: toStatus }`（去掉 `from`）；`packages/client/src/lib/hook-panel.ts` 的 `buildStatusDeltaChange` 同步改（含 `LifecycleWriteInput.fromStatus` / `AbandonWriteInput.fromStatus` 的清理）+ `HookPanel.tsx` 调用点。
  - 不改：`data.status` 同步（终态守卫/列表/AI 依然读它）、幂等判重（`findExistingStatusDeltaId` 仍是 `field=status && to=...`）、四 op 的通用语义（`update` 对其他字段照旧）。
  - 测试：`tools/src/executor/hook.test.ts`（去掉「首条重放冲突」类断言，改为**重放无冲突**）、`hook-panel.test.ts`（payload 形状）、必要时 server 侧 smoke。
  - 验收：推进/回收/废弃后，`compute_state(hook, 任意章 ≥ 首次转移)` 无 `conflicts` 且 status 正确；面板分组、终态守卫、AI `hookStatuses` 行为不变。

## 批次 2 · 人物数据模型（进行中）

- [ ] **2.1 character 字段改造（+`description`/`alias`（单值假名）/`race`、−`status`、`personality` 保留）+ 摘要口径**
  - 契约：`docs/db/schema.md`「人物 data 分层」、`docs/api/30-api-entity.md`（character 字段清单与摘要口径）。
  - 改：`shared/src/types/api.ts` 的 `characterDataSchema`（+`description`/`alias`/`race`；−`status`；`personality` 保留）；`db/src/queries/entity.ts` 的 `toSummary` character 分支（移除 `summary.status`；新增 `description` 截断 100；能力摘要取面板**顶层分组名前 2**，此点依赖 2.5 的面板解析纯函数——若 2.5 未落地，可先留 TODO 并在报告中说明顺序调整）；`client/src/lib/entity-detail.ts` 的 `detailFieldsForType("character")`（未变字段保持不变，新增字段先登记后由批次 3 接 UI）。
  - 不改：`filters.status` / `matchDataFilters` / hook 侧 `byStatus`（hook 生命周期依赖）。
  - 测试：schema 用例（新字段通过、`status` 不再写出）、`toSummary` 用例（character 摘要不再含 `status`，含 `description` 截断）。

- [ ] **2.2 `get_entity_summary` 口径（character 移除 `byStatus`；`topAbilities` 改顶层分组名）**
  - 契约：`docs/api/tool-calling.md`（`get_entity_summary` character 口径段）。
  - 改：`db/src/queries/entity.ts` 的 `getEntitySummary` character 分支 + `topAbilityCounts`（改读面板顶层分组名）+ `packages/tools` 相关描述。
  - 保留：hook 的 `byStatus` / `byPayoffTiming`；`filters.status`。
  - 依赖：2.5（面板解析纯函数）。

- [ ] **2.3 `007_character_ability_panel` 迁移（幂等、不覆盖已有面板）+ `SCHEMA_VERSION 6 → 7`**
  - 契约：`docs/db/schema.md`（`status` 移除与 `abilities` 迁移段）。
  - 改：新增 `db/src/migrations/007_character_ability_panel.ts`（无 DDL，仅 data JSON 变换：`abilities[]` → 顶层分组「能力」下每个标签一个叶子；幂等；已含 `ability_panel` 的行不动）+ `db/src/schema.ts` 的 `SCHEMA_VERSION` + `migrations/index.ts` 聚合 + 迁移用例。
  - 验收：旧库 open 自动迁移；重复执行不产生重复叶子；有面板的角色不被动过。

- [ ] **2.4 `computeState` 点分嵌套路径解析（仅标量 `set`/`update`）+ 防御**
  - 契约：`docs/design/10-data-model.md` §4（字段路径）、`docs/db/schema.md`（delta 节）、`docs/api/50-api-delta.md`。
  - 改：`db/src/queries/compute-state.ts` 的 `applyChange` 支持 `a.b.c` 逐层下钻（仅标量 `set`/`update`；`add`/`remove` 仍仅顶层）；非法结构/中间节点不存在 → 不抛错（按防御跳过或安全创建，口径写进报告）。
  - 不得改变：四 op 语义、`from` 校验与 `skipped`/`conflicts`、软删可见性。
  - 测试：面板叶子 Delta 累积用例（跨章）+ 结构非法防御用例。

- [ ] **2.5 能力面板纯函数库（结构解析 / 顶层分组名 / 叶子路径枚举 / 模板深拷贝派生）+ 单测**
  - 契约：`docs/db/schema.md`「人物 data 分层」（结构不变式：有 children = 分支不可赋值；无 children = 叶子可赋值；叶子 `value: string | number`；顺序 = 数组顺序）。
  - 改：新增 shared 或 db 侧纯函数模块（位置由依赖方向决定，禁止 client 打包 schema）——含防御解析（非法结构 → 空面板）、顶层分组名提取（2.1/2.2 消费）、叶子路径枚举、结构深拷贝派生（模板/从角色复制，值作为默认值）。
  - 测试：结构不变式、防御、派生快照独立性。

- [ ] **2.6 delta 查询批量化（性能）**
  - 契约：`docs/design/10-data-model.md` §4 代价登记；卡 1.4 oracle 实测：300 章 / 300 条 delta → `computeState` **219ms**（每章一次 `readOutlineFile`）。
  - 改：`db/src/queries/compute-state.ts` 的收集改为一次性查询（`node_id IN 前缀章集合`）或内部传已读 tree 的变体；目标个位数毫秒。
  - 测试：既有用例全绿 + 一条「不再逐章读文件」的可观测断言（如读文件次数 spy 或耗时下限放宽的批量化用例）。

- [ ] **2.7 章序可见性口径（卡 1.8 oracle 发现的既存缺口）**
  - 现状：`deriveChapterOrder`（`db/src/queries/outline-ops.ts:369`）**不过滤软删章**，章号是"文件位置序"；`ChapterIndex.currentChapter` 的退化分支因此可能返回**已软删末章**的章号——实测：末章软删后 `currentChapter = 2`（被删章）而 `chapterOf(sc-1) = 1`。该值直接喂给 `analyze_hook_health.current_chapter`、伏笔 `age`/`dormancy`、孤儿诊断的"当前最新章"基准 → **删尾部章节会虚报写作进度一章**，指标随之偏移。
  - 改：`ChapterIndex` 的当前章退化分支取**最后一个未软删章**（或与 `chapterOf` 语义对齐）；`deriveChapterOrder` 是否计入软删章需在 `docs/db/schema.md` / `docs/design/10-data-model.md` 明确口径（当前是隐式"位置序"，全链自洽但与"可见"不同义）。
  - 测试：末章软删 → 退化到最后一个可见章；伏笔/孤儿指标随之为基准的用例。

## 批次 3 · 人物页 UI（未开工）

- [ ] 3.1 master-detail 宿主 + 左栏列表（搜索 / 排序 / 选中 / 空态 / 自动选首个 / 窄屏两级）
- [ ] 3.2 双视图 tab（初始化数据 / 当前位置数据；tab 2 只读；`ComputePreview` 归并入 tab 2，保留手动选节点；`conflicts` 标注照搬）
- [ ] 3.3 字段三分渲染（不可变 / 可变分区；`description` 必填校验；详情页表单）
- [ ] 3.4 `panel-tree` 控件（结构编辑 + 叶子值 + 拖拽 + 只读态 + 模板/复制入口）
- [ ] 3.5 新建人物弹窗（必填 姓名 / 角色定位 / 描述；重名软提示；面板「空白 / 内置模板 / 从角色复制」；提交后自动选中）
- [ ] 3.6 关系网 + 其他关联分区（分组 + 对称去重 + 建边入口收窄 + 折叠区）

## 批次 4 · 收尾（未开工）

- [ ] 4.1 全量验证（`pnpm typecheck` / `pnpm lint` / `pnpm -r test` / 浏览器核像素）+ `CHANGELOG.md` 版本段

## 延期项（本批不做）

- 自定义关系类型（`RELATION_TYPES` 为共享常量 + `z.enum` 校验）；跨书能力面板模板库；面板相关 AI 一致性规则；人物页 Delta 时间线；关系星形图（纯展示 SVG）；`status` 字段的服务端彻底清理（字段已删，`filters.status` 保留给 hook）。
- **反向伏笔关系**（源=实体、目标=大纲节点、类型 `plants`/`advances`/`resolves`）：服务端守卫只在 `source_type === "outline_node"` 时生效，该组合可 201 落库但无任何消费者（分析层只认 outline_node→hook）——属数据卫生问题（不产生 400），先登记；要收口就是「无条件要求源端为章」。
- `packages/client/src/pages/Outline.tsx` 的 prettier 漂移（改动前即存在，非某张卡引入）；如要修，单独一次格式化提交，避免污染卡片 diff。
- `packages/tools/src/analysis/hook.test.ts` 中「软删场景上的 plants/appears_in 不参与 R1/R2」用例属**口径锁**（当前分支不可观测，防未来绕过 `listRelations` 端点过滤），可在下次路过时在用例名/注释里标注。
