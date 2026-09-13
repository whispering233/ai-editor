# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 批次 2 补 · 数据安全修复（待开工）

- [ ] **2.9 无 `data.db` 的书不得被「删库重建 + 重置 outline.json」（卡 2.8 oracle 发现，既存语义）**
  - 现象：书目录有 `project.json` + `outline.json` 但**缺 `data.db`** 时，新建的空库 `user_version=0` 且 `MIGRATIONS` 无 `0→1` 条目 → 走「无迁移路径 → 删库重建兜底」，**同步把 `outline.json` 重置为空树**（原件进 `.bak`）。实测开机直达也会触发（此前需用户显式 open，故暴露面变小但未被注意）。
  - 危害：用户视角"开机后大纲空了"（数据虽在 `.bak`，但属**不必要的数据损失面**）。
  - 修法（择一，报告说明）：`ensureSchemaCompatible` 对**全新建的空库**（`user_version===0` 且无用户表数据）直接 `setUserVersion(SCHEMA_VERSION)` 而非重建；或在文档明确登记该语义与恢复方式。
  - 验收：缺 `data.db` 的书被打开后 **`outline.json` 原样保留**、`data.db` 以当前版本新建；真正的 v0 旧库（表结构不符）仍走既有重建兜底；补测试。

## 批次 4 · 收尾（未开工）

- [ ] 4.1 全量验证（`pnpm typecheck` / `pnpm lint` / `pnpm -r test` / 浏览器核像素）+ `CHANGELOG.md` 版本段

## 延期项（本批不做）

- 自定义关系类型（`RELATION_TYPES` 为共享常量 + `z.enum` 校验）；跨书能力面板模板库；面板相关 AI 一致性规则；人物页 Delta 时间线；关系星形图（纯展示 SVG）；`status` 字段的服务端彻底清理（字段已删，`filters.status` 保留给 hook）。
- **反向伏笔关系**（源=实体、目标=大纲节点、类型 `plants`/`advances`/`resolves`）：服务端守卫只在 `source_type === "outline_node"` 时生效，该组合可 201 落库但无任何消费者（分析层只认 outline_node→hook）——属数据卫生问题（不产生 400），先登记；要收口就是「无条件要求源端为章」。
- `packages/client/src/pages/Outline.tsx` 的 prettier 漂移（改动前即存在，非某张卡引入）；如要修，单独一次格式化提交，避免污染卡片 diff。
- `packages/client/src/lib/hook-panel.ts` 中「软删场景上的 plants/appears_in 不参与 R1/R2」用例属**口径锁**（当前分支不可观测，防未来绕过 `listRelations` 端点过滤），可在下次路过时在用例名/注释里标注。
- **`currentHookStatus` 在 client 侧已无生产消费者**（卡 1.9 删了 `fromStatus` 后仅其单测在用）——要么后续删掉（含单测），要么明确保留理由。
- **通用「+ 新建变更」表单仍可为 hook 的 `status` 造 `op=update`**（`lib/delta-create.ts`）：手动路径会产生 CAS 假冲突，属「手动编辑 data 不产生 Delta 属正常」的对偶情形；如需彻底闭环则收窄字段白名单，暂接受。
- **AI 通道未收窄不可变字段**：`propose_add_delta`（`tools/src/proposal/delta.ts`）无字段白名单 → 理论上 AI 可对 character 的 `role`/`description` 立 Delta，使 tab 2 与 tab 1 不一致（违反 §14 不变式 2 的展示预期）。收口方式 = 对 character 目标拒绝这两个 field（与前端白名单同源）；暂登记（无实际危害前先不做）。
- `lib/panel-tree.ts` 的 `siblingDropIndex` 已无生产调用者（仅单测引用）——保留为导出 API 或下次清理；卡 3.4 oracle 已确认不影响行为。
- `listDeltasByNodes` 的 JSDoc 可补一句「调用方负责传章 id（层级收窄不在本函数）」——它是通用原语，传场景 id 也会照实返回（当前唯一调用点正确）。
- `search_entities` 工具描述仍泛写「status 精确匹配 data.status」；character 已无该字段（文档已注明仅 hook 有意义），下次路过时补一句。
- **人物页与泛型详情页的分化口径（卡 3.2 oracle 提出）**：`CharacterDetail`（904 行）自带一份字段渲染/关系列表实现（`TagsEditor`/`CustomFieldsEditor` 等），与泛型 `EntityDetail` 的私有实现是两份。**登记口径：泛型详情页冻结（只服务 setting/location/hook/timepoint，不再承载新能力），人物页独立演化**；若将来要修泛型页的字段渲染 bug，需评估是否同步人物页；批次 4 再评估是否抽 `components/entity/entity-fields.tsx` 公共层。
- `packages/tools/src/executor/hook.test.ts` 有一条用例标题仍写「delta 记 status → progressing（**from=当前状态**）」，与 `op=set` 形态不符（断言本身正确）——下次路过时改标题。
