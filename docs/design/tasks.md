# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 当前任务卡

批次 6：人物页信息架构与文案（2026-09，依据 `docs/ui/DESIGN.md` `character-workbench` / `panel-tree` 与 `docs/design/10-data-model.md` §14）。

### 卡 6.1 全站「阅读进度」文案统一（人物页之外）

- [ ] 文案面：`InfoBar` 阅读进度；概览页 dt；大纲页行尾徽标 + 菜单项「设为阅读进度」；大纲详情页按钮/标记/元信息行 + 提示「仅章节点可设为阅读进度（卷/场景不可标记）」；`HookPanel`「章节点（默认阅读进度）」；`compute-preview`「未设置阅读进度，请手动选择进度节点」
- [ ] 内部命名不动（`current_position` / `lib/current-position.ts` / `isCurrentPositionHost` 保留）；仅改用户可见字面与邻近注释
- [ ] 受影响测试断言同步
- [ ] 验证 oracle：`rg "当前位置" packages/client/src --glob '!*.test.*'` 只剩内部命名/注释；UI 字面零残留

### 卡 6.2 人物档案 tab：档案式字段网格 + 只读值列

- [ ] 删「基础信息」/「可变数据」两个 `SectionCard` → 单 `card` 内网格（label 左置 64px `{colors.secondary}`；单行字段 ≥`md` 两列；描述 / 性格 / 动机 整行）
- [ ] `lib/character-detail.ts`：删 `CHARACTER_SECTION_BASICS/MUTABLE` 与组 `title`，立**单一字段顺序清单**；`create-character-dialog` 自持段标题（不动）
- [ ] 只读（阅读进度 tab）值画纯文本（`readOnlyFieldValue`，空值 `—`）；`panel-tree` 只读形态 = 缩进「名称 + 值文本」（无输入框/工具条/行操作）→ 删 `disabled` 贯穿；叶子空值去掉 `placeholder="—"`
- [ ] 测试：`character-detail.test.tsx` 分区断言 → 字段顺序/两列网格断言；`lib/character-detail.test.ts` 同步
- [ ] 验证 oracle：SSR 走查 + 浏览器像素对照两 tab（字段位置逐一致）

### 卡 6.3 人物页四 tab 改造

- [ ] tab 集合 = `人物档案` / `阅读进度` / `人物关系网` / `其他关联`（标签带 `其他关联 · N`）；默认 tab 判据不变；失效提示仍在 tab 行上方
- [ ] `CharacterRelations` 拆为两个 tab 内容；其他关联**去折叠**（tab 即收起），非空态给「+ 添加关联」/关系网给「+ 添加人物关系」
- [ ] 人物页文案随新词：`进度节点（到达该节点时的累积状态）`、`未设置阅读进度，显示人物档案初始值`、`阅读进度已失效（节点已删除），显示人物档案初始值`、`暂无变更记录——当前状态即人物档案初始值`
- [ ] 测试：`character-relations.test.tsx`（去折叠）、`character-detail.test.tsx` tab 断言
- [ ] `README.md` §当前能力 人物页描述段随 6.2/6.3 刷新（4 tab、档案网格、关系两块入 tab）
- [ ] 验证 oracle：四 tab 切换 + 默认落位 + 条数常显

## 延期项（远期，未排期）

- **executor 未接不可变字段白名单**（`role`/`description`，卡 5.6 oracle 实测）：可达性低（提案仓为进程内 TTL Map + 提案层已拦 + 确认路由不重跑语义校验；仅手工构造 proposal 可触达）；影响 = 理论上可写出「同一人物两个值」；修法 3–5 行（复用 shared `IMMUTABLE_FIELDS`，在 `executeAddDelta` 加一次调用）。
- **`EntityList` 的配置表死键**：`SUMMARY_COLUMNS`/`CREATE_FIRST_FIELD`/`TYPE_LABEL` 仍含 `character`（兜底键，已注明）与 `hook`/`event`/`timepoint`（这些类型已由 HookPanel/Timeline 承接，键已死）——收窄 `ListableEntityType` 为 `setting | location` 可一并清掉，但会波及查表与空态文案，属独立小重构。
- **人物字段渲染清单缺 schema 一致性断言**（client）——schema 新增可变字段时可能漏渲染（`delta-create` 侧有编译期强制，这个列表没有）；最小修法 = 加「字段清单 + 面板 + custom_fields = schema 键集」断言。
- **能力面板模板库**（跨书复用/命名管理）：现只有「内置 3 套 + 从角色复制结构」；升级路径 = 把派生函数的"源"从角色记录换成模板记录（零返工）。
- **自定义关系类型**：`RELATION_TYPES` 是共享常量 + `z.enum` 校验，加类型要动存储校验与工具契约；需要额外语义先用 `metadata`。
- **面板相关 AI 一致性规则**（如"等级不得下降"）：自由结构硬编码规则会大量误报，YAGNI。
- **人物页 Delta 时间线**（该角色跨章节的变更记录列表）：现由 AI 的 `get_delta_history` 覆盖。
- **关系星形图**（纯展示 SVG，零依赖）：需要时再加，不引入布局库。
- **人物页 vs 泛型详情页抽公共层**（`entity-fields.tsx`）：当前口径 = 泛型页冻结、人物页独立演化。
- **卡 3.6 视觉打磨**：其他关联收起态卡片体为空；合并行删除后可补一句「另一方向的关系仍在」。
- **REST 泛型保持（有意口径，非待办）**：直连 API 仍可为 hook.status 写 `op=update`、为 character 写已移除字段；收窄落在前端 + AI 提案层 + executor（`docs/design/10-data-model.md` §14 不变式 1 已登记）。
- **`status` 字段的服务端彻底清理**：character 侧已删（`filters.status` 保留给 hook 生命周期，属有意保留）。
