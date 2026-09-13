# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 当前任务卡

- [ ] **5.1 延期项速清·机械项（口径/死代码/文案/格式化）**
  - (a) `packages/db/src/queries/delta.ts` 的 `listDeltasByNodes` JSDoc 补一句「**调用方负责传章 id**（层级收窄不在本函数；传场景 id 会照实返回）」。
  - (b) `packages/tools/src/index.ts` 的 `search_entities` 描述：把「status 精确匹配 data.status」改为「仅伏笔（hook）生命周期有意义（character 已无该字段）」。
  - (c) `packages/tools/src/executor/hook.test.ts` 用例标题「delta 记 status → progressing（**from=当前状态**）」改为 `op=set` 口径（断言本身已正确）。
  - (d) 删除 client 侧 `lib/hook-panel.ts` 的 `currentHookStatus`（卡 1.9 后已无生产消费者）+ 其单测引用。
  - (e) 删除 `lib/panel-tree.ts` 的 `siblingDropIndex`（无生产调用者；若确认仅测试引用则连同用例调整）。
  - (f) `packages/db/src/queries/migration.ts`：`hasMigrationPath` JSDoc 折行修复（被并成一行且丢字）+ `ensureSchemaCompatible` JSDoc 三态列表缩进为子项。
  - (g) `packages/client/src/pages/Outline.tsx` 跑一次 prettier（**该文件改动前就不符合 prettier，无格式化门**）——单独确认 diff 纯格式、无逻辑变化。
  - (h) 补一条测试：新建人物弹窗**校验失败时不调用 `createEntity`**（注入/替身断言），把现有"结构保证"升级为测试保证。
  - 纪律：不改行为（除删除死代码）；跑全仓 `typecheck` / `lint` / 相关包测试。

- [ ] **5.2 延期项速清·契约收口（杜绝违规写入面）**
  - (a) **反向伏笔关系收口**：`POST /relation` 与 `propose_add_relation` 对 `relation_type ∈ {plants, advances, resolves}` **无条件要求源端为 `chapter` 大纲节点**（即「源=实体、目标=大纲节点」的反向组合也拒绝）——现在该组合能 201 落库但无任何消费者（数据卫生问题）。
  - (b) **AI 不可变字段白名单**：`propose_add_delta` 对 **character 目标**拒绝 `field ∈ {role, description}`（与前端白名单同源）；补工具描述一句。
  - (c) **通用「+ 新建变更」表单对 hook 的 `status`**：字段选项收窄为仅 `set` 语义（避免手动路径造出 `update` 的假冲突）——口径二选一（仅留 set / 或从下拉移除），在报告说明。
  - 测试：三处各补边界用例 + 既有用例全绿。

## 延期项（远期，未排期）

- **能力面板模板库**（跨书复用/命名管理）：现只有「内置 3 套模板 + 从角色复制结构」；升级路径 = 把派生函数的"源"从角色记录换成模板记录（零返工）。
- **自定义关系类型**：`RELATION_TYPES` 是前后端共享常量 + `z.enum` 校验，加类型要动存储校验与工具契约；需要额外语义先用 `metadata`。
- **面板相关 AI 一致性规则**（如"等级不得下降"）：自由结构硬编码规则会大量误报，YAGNI。
- **人物页 Delta 时间线**（该角色跨章节的变更记录列表）：现由 AI 的 `get_delta_history` 覆盖。
- **关系星形图**（纯展示 SVG，零依赖）：需要时再加，不引入布局库。
- **人物页 vs 泛型详情页抽公共层**（`entity-fields.tsx`）：当前口径 = 泛型页冻结、人物页独立演化；批次 4 再评估。
- **卡 3.6 视觉打磨**：其他关联收起态卡片体为空（仅标题 + 条数）；合并行删除后可选 toast 补一句「另一方向的关系仍在」。
- `status` 字段的服务端彻底清理：character 侧已删（`filters.status` 保留给 hook 生命周期，属有意保留）。
