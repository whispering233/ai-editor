# 开发遗留项（Backlog）

**性质**：已知但**未排期**的遗留项与有意保留的口径。不是承诺清单，不排优先级；需要时按「最小修法 / 升级路径」评估成卡（进 `tasks.md`）再动手。

- 纪律：**新发现的小项先进本文件，不即时插队**当前批次；卡内不做卡外顺手改动。
- 每条尽量给：现状 → 影响 → 触发条件（什么时候才值得做）→ 最小修法 / 升级路径。
- 「有意保留（非待办）」小节 = 已登记的设计口径，**不要**当 bug 去"修"。

---

## 数据与契约

- **关系类型 R2 互斥对仍是字面量**（tools `analysis/conflict.ts`；卡 8.1 oracle 登记）
  - 现状：不对称性（`symmetric`）已收进 shared 注册表，但「互斥对」`MUTUALLY_EXCLUSIVE_PAIRS = [["ally","rival"]]` 仍是本文件字面量——互斥是**类型对**语义，不是单类型属性，未纳入注册表。
  - 触发条件：出现第二对互斥关系（或想在前端表达互斥提示）时。
  - 升级路径：注册表加一个 `mutuallyExclusiveWith?: string[]` 字段（或单独的 pair 常量表）；目前一对，不值得。
- **`db.createRelation` 只校验不归一**（卡 8.2 oracle 登记）
  - 现状：`relation_type` 的 `trim` 归一只发生在 REST schema 层；db 守卫仅校验语法。现有直接 db 写入路径全部传字面量或 AI 枚举 ⇒ 无实际脏值路径。
  - 触发条件：出现「直接调 db 层自由输入」的新调用方。
  - 最小修法：db 守卫内改用 shared 的归一函数（一行）。
- **非字符串 `relation_type` 的报错文案是英文**（卡 8.2 oracle 登记，低）
  - 现状：`z.string()` 先失败 → zod 默认英文消息；UI/AI 两条路径都不可达（UI 传字符串，AI 枚举）。
  - 触发条件：REST 直接被外部调用方以非字符串调用时。
- **执行/构建产物新鲜度**（卡 8.3 oracle 登记）
  - 现状：client 的编译期断言（人物字段清单、`delta-create` 字段名）绑定 shared 的 **dist** 类型；改了 `shared/src` 不重建 ⇒ `pnpm typecheck` 静默通过（假绿窗口）。
  - 已采取：AGENTS.md 测试条写明「改上游 src 后先 `pnpm -r build`」；**不加**前置构建（会拖慢每一次 typecheck）。

- **executor 未接不可变字段白名单**（`role` / `description`；卡 5.6 oracle 实测）
  - 现状：不可变字段拦截落在**前端字段下拉** + **AI 提案层**（`propose_add_delta` 对 character 拒绝 `role`/`description`）；`executeAddDelta`（确认落库侧）未复检。
  - 影响：理论可写出「同一人物两个值」（`computeState` 算出另一个角色定位）。可达性低——提案仓为进程内 TTL Map，仅手工构造 proposal 可触达，且确认路由不重跑语义校验。
  - 触发条件：新增任何"非提案层"的 Delta 写入入口时（那会把可达性抬高）。
  - 最小修法：3–5 行，复用 shared `IMMUTABLE_FIELDS`，在 `executeAddDelta` 加一次调用。
- **自定义关系类型改名/合并**
  - 现状（2026-09 起）：作者可在建立关联时自由输入新类型（`trim` 非空 / ≤ 32 字符 / 禁控制字符），类型**只活在 `relation_records.relation_type` 里**，下拉从「预定义 ∪ 本项目已用类型」派生——**无中心记录 ⇒ 无改名/合并入口**（打错字会一直留在下拉里，直到相关关系被删光）。
  - 触发条件：真实出现 typo/近义类型疼痛（想统一两个近义类型，或类型名与设定不符）。
  - 升级路径：把派生集合换成项目级关系类型表（新增表 + 增删改名 UI，即完整档）；届时按表改名存量值。
  - 注：原「新增类型走迁移 + schema 版本抬升」说法已废——`relation_type` 无 CHECK，新增/自定义类型从不需要迁移（属文档错误修正）。
- **`status` 字段的服务端彻底清理**（character 侧已删，属有意保留的一部分）
  - 现状：`filters.status` 保留给 hook 生命周期（有意保留）；character 的 `status` 已从表单/列表/AI 摘要与 data 契约删除，旧残留由 `.passthrough()` 容错。
  - 触发条件：无（仅在整体清理查询参数面时顺带处理）。

## 前端 / UI

- **关联对话框其余下拉的浮层宽度**（卡 8.2 oracle 登记，既有）
  - 现状：`select-free-input`（关系类型）已加 `popupMatchSelectWidth={false}`；同弹窗另 4 个 `Select` 与通用关联页两个过滤 `Select` 仍跟触发器宽度（长实体名会截断）。
  - 触发条件：再次触碰这两个文件时。
  - 最小修法：逐个补 `popupMatchSelectWidth={false}`（与人物页排序下拉同口径）。
- **关联对话框每次打开拉一次全量关系**（卡 8.2；性能边界）
  - 现状：为派生「已用自定义类型」，`CreateRelationDialog` 挂载时拉一次 `GET /relation?depth=1`（全量）。
  - 触发条件：大项目（数千条关系）下对话框打开变慢时。
  - 升级路径：给端点加一个 `distinct relation_type` 轻量接口，或把已用类型提升到 store 缓存（失效策略需设计）。
- **`EntityList` 的配置表死键**
  - 现状：`SUMMARY_COLUMNS` / `CREATE_FIRST_FIELD` / `TYPE_LABEL` 仍含 `character`（兜底键，已注明）与 `hook` / `event` / `timepoint`（这些类型已由 `HookPanel` / `Timeline` 承接，键已死）。
  - 触发条件：再次触碰泛型列表页时。
  - 升级路径：收窄 `ListableEntityType` 为 `setting | location`，连带清掉查表与空态文案（属独立小重构）。
- **合并行删除提示**（卡 3.6 打磨残留）
  - 现状：对称关系（`ally`/`rival`/`family`）合并行删除只删方向边（out）那一条，确认文案已声明"只删其中一条"。
  - 最小修法：删除成功后的 toast 补一句「另一方向的关系仍在」。
- **`OutlineNodeSelect` 有三份实现**（`HookPanel` / `EntityDetail` / `Timeline`）
  - 现状：新建/编辑弹窗、详情页表单、时间轴各自实现同款"选大纲节点"下拉；卡 7.1/7.2 的口径漂移（进度节点与预计回收节点一度全层级可选的根因）正是这种重复。
  - 触发条件：第四次需要同款控件，或再次出现口径漂移。
  - 升级路径：抽一个公共 `OutlineNodeSelect`（选项派生由调用方给定：章-only 用 `chapterNodeOptions`，自由引用用 `flattenTree`），配一条源码守卫防回退。
- **伏笔关系类型在通用"新建关联"弹窗里可能造出必 400 的入口**（未验证可达性）
  - 现状：`create-relation-dialog` 的端点选择器是全层级（关系端点本就是泛型），但伏笔关系 `plants`/`advances`/`resolves` 的源端服务端**硬校验章**（400）。
  - 待确认：从该弹窗能否为 hook 源端选到场景/卷；若可达 → 收窄该场景的关系类型/端点选项。
- **人物页 vs 泛型详情页抽公共层**（`entity-fields.tsx` 之类）
  - 现状口径（有意）：泛型 `EntityList`/`EntityDetail` **已冻结**只服务 setting/location，人物页独立演化；`FieldControl` / `TagsEditor` / `CustomFieldsEditor` 因此有近似两份实现。
  - 触发条件：第三处页面也要这套字段控件时（两处不值得）。
  - 升级路径：把字段控件与标签编辑器上提为独立组件，泛型页与人物页同时改用它。

## AI / 产品能力

- **能力面板模板库**（跨书复用 / 命名管理）
  - 现状：只有「内置 3 套 + 从角色复制结构」。
  - 升级路径：把派生函数的"源"从**角色记录**换成**模板记录**（零返工）。
- **面板相关 AI 一致性规则**（如"等级不得下降"）
  - 现状：不做。
  - 结论：自由结构下硬编码规则会大量误报，YAGNI。
- **人物页 Delta 时间线**（该角色跨章节的变更记录列表）
  - 现状：由 AI 的 `get_delta_history` 覆盖（页面不给时间线 UI）。
  - 触发条件：作者频繁需要"逐条回看这个角色改过什么"。

## MVP 明确不做（勿顺手实现）

多标签页并发、undo、token 统计、跨书参考资料导入——为 MVP 边界，实现前需先改产品口径（见 `00-master-design.md`）。

## 有意保留（非待办，仅登记）

- **REST 保持泛型**：直连 API 仍可为 `hook.status` 写 `op=update`、为 character 写已移除字段。收窄落在前端 + AI 提案层 + executor；这是**分层口径**，不是漏改（已在 `10-data-model.md` §14 不变式 1 登记）。
- **`filters.status`**：保留给 hook 生命周期查询，character 侧不再消费。
- **数据/接口字段名 `current_position` 不改**：前端显示为「阅读进度」（UI 文案与字段名分离，见 `../ui/DESIGN.md` `character-workbench` 与 `../api/10-api-project.md`）。
- **延期项≠技术债记录**：真正"必须做但没做"的项请写进本文件的相应小节，并在触发条件写清"何时必须做"。
