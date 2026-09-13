# 开发遗留项（Backlog）

**性质**：已知但**未排期**的遗留项与有意保留的口径。不是承诺清单，不排优先级；需要时按「最小修法 / 升级路径」评估成卡（进 `tasks.md`）再动手。

- 纪律：**新发现的小项先进本文件，不即时插队**当前批次；卡内不做卡外顺手改动。
- 每条尽量给：现状 → 影响 → 触发条件（什么时候才值得做）→ 最小修法 / 升级路径。
- 「有意保留（非待办）」小节 = 已登记的设计口径，**不要**当 bug 去"修"。

---

## 数据与契约

- **executor 未接不可变字段白名单**（`role` / `description`；卡 5.6 oracle 实测）
  - 现状：不可变字段拦截落在**前端字段下拉** + **AI 提案层**（`propose_add_delta` 对 character 拒绝 `role`/`description`）；`executeAddDelta`（确认落库侧）未复检。
  - 影响：理论可写出「同一人物两个值」（`computeState` 算出另一个角色定位）。可达性低——提案仓为进程内 TTL Map，仅手工构造 proposal 可触达，且确认路由不重跑语义校验。
  - 触发条件：新增任何"非提案层"的 Delta 写入入口时（那会把可达性抬高）。
  - 最小修法：3–5 行，复用 shared `IMMUTABLE_FIELDS`，在 `executeAddDelta` 加一次调用。
- **自定义关系类型**
  - 现状：`RELATION_TYPES` 是 shared 常量 + `z.enum` 校验，加类型要动存储校验与工具契约。
  - 触发条件：出现「预定义 17 类装不下」的真实语义需求。
  - 升级路径：新增类型走迁移 + schema 版本抬升；临时需要额外语义先用 `relation.metadata`。
- **`status` 字段的服务端彻底清理**（character 侧已删，属有意保留的一部分）
  - 现状：`filters.status` 保留给 hook 生命周期（有意保留）；character 的 `status` 已从表单/列表/AI 摘要与 data 契约删除，旧残留由 `.passthrough()` 容错。
  - 触发条件：无（仅在整体清理查询参数面时顺带处理）。

## 前端 / UI

- **人物字段清单缺 schema 一致性断言**（client）
  - 现状：`CHARACTER_DETAIL_FIELD_KEYS`（+ 新建弹窗的两段键集）手写；`delta-create` 侧有编译期强制，这个列表没有。
  - 影响：schema 新增可变字段时可能**漏渲染**，且无测试报警。
  - 最小修法：加一条断言「字段清单 + 能力面板 + `custom_fields` = schema 键集」。
- **`EntityList` 的配置表死键**
  - 现状：`SUMMARY_COLUMNS` / `CREATE_FIRST_FIELD` / `TYPE_LABEL` 仍含 `character`（兜底键，已注明）与 `hook` / `event` / `timepoint`（这些类型已由 `HookPanel` / `Timeline` 承接，键已死）。
  - 触发条件：再次触碰泛型列表页时。
  - 升级路径：收窄 `ListableEntityType` 为 `setting | location`，连带清掉查表与空态文案（属独立小重构）。
- **合并行删除提示**（卡 3.6 打磨残留）
  - 现状：对称关系（`ally`/`rival`/`family`）合并行删除只删方向边（out）那一条，确认文案已声明"只删其中一条"。
  - 最小修法：删除成功后的 toast 补一句「另一方向的关系仍在」。
- **关系星形图**（纯展示）
  - 现状：关系只用列表呈现。
  - 触发条件：作者真的需要"一眼看关系网"时。
  - 升级路径：手写 SVG（零依赖），**不引入**布局库。
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
