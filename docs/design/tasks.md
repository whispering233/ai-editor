# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 当前任务卡

（无进行中任务卡。最近完成：批次 1 章级锚点收窄（1.1–1.9）→ 批次 2 人物数据模型与能力面板（2.1–2.9）→ 批次 3 人物页工作台（3.1–3.6 + 两轮修复）→ 批次 4 全量验证与发布（`CHANGELOG v0.0.34`）→ 批次 5 延期项速清（5.1–5.6）→ 批次 6 人物页信息架构与文案（6.1 全站「阅读进度」文案 / 6.2 档案式字段网格 + 只读纯文本值 / 6.3 四平级 tab）。**新发现的小项一律进下方远期清单，不即时插队。**）

## 延期项（远期，未排期）

- **executor 未接不可变字段白名单**（`role`/`description`，卡 5.6 oracle 实测）：可达性低（提案仓为进程内 TTL Map + 提案层已拦 + 确认路由不重跑语义校验；仅手工构造 proposal 可触达）；影响 = 理论上可写出「同一人物两个值」；修法 3–5 行（复用 shared `IMMUTABLE_FIELDS`，在 `executeAddDelta` 加一次调用）。
- **`EntityList` 的配置表死键**：`SUMMARY_COLUMNS`/`CREATE_FIRST_FIELD`/`TYPE_LABEL` 仍含 `character`（兜底键，已注明）与 `hook`/`event`/`timepoint`（这些类型已由 HookPanel/Timeline 承接，键已死）——收窄 `ListableEntityType` 为 `setting | location` 可一并清掉，但会波及查表与空态文案，属独立小重构。
- **人物字段清单缺 schema 一致性断言**（client）——schema 新增可变字段时可能漏渲染（`delta-create` 侧有编译期强制，这个列表没有）；最小修法 = 加「字段清单 + 面板 + custom_fields = schema 键集」断言。
- **能力面板模板库**（跨书复用/命名管理）：现只有「内置 3 套 + 从角色复制结构」；升级路径 = 把派生函数的"源"从角色记录换成模板记录（零返工）。
- **自定义关系类型**：`RELATION_TYPES` 是共享常量 + `z.enum` 校验，加类型要动存储校验与工具契约；需要额外语义先用 `metadata`。
- **面板相关 AI 一致性规则**（如"等级不得下降"）：自由结构硬编码规则会大量误报，YAGNI。
- **人物页 Delta 时间线**（该角色跨章节的变更记录列表）：现由 AI 的 `get_delta_history` 覆盖。
- **关系星形图**（纯展示 SVG，零依赖）：需要时再加，不引入布局库。
- **人物页 vs 泛型详情页抽公共层**（`entity-fields.tsx`）：当前口径 = 泛型页冻结、人物页独立演化。
- **合并行删除提示**（卡 3.6 打磨残留）：对称关系合并行删除后可补一句「另一方向的关系仍在」；原「其他关联收起态卡片体为空」已随卡 6.3 去折叠失效。
- **REST 泛型保持（有意口径，非待办）**：直连 API 仍可为 hook.status 写 `op=update`、为 character 写已移除字段；收窄落在前端 + AI 提案层 + executor（`docs/design/10-data-model.md` §14 不变式 1 已登记）。
- **`status` 字段的服务端彻底清理**：character 侧已删（`filters.status` 保留给 hook 生命周期，属有意保留）。
