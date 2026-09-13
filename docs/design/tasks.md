# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（历史在 `CHANGELOG.md`，未排期的遗留项在 `backlog.md`）。**新发现的小项一律进 `backlog.md`，不即时插队。**

---

## 当前任务卡

**批次 8（2026-09，人物页关系区与数据清单收口）** —— 并行道：**道 A = 8.1 → 8.2**（同 worktree 串行）；**道 B = 8.3**；**道 C = 8.4**。三道的文件不重叠，可并行开发；每卡一 commit。

### 卡 8.1 关系类型属性注册表 + 对称性口径统一（无新能力）

- [ ] shared `constants/entity.ts`：新增 `RELATION_TYPE_META: Record<RelationType, { label; group; symmetric? }>`（group ∈ `character` / `structure` / `anchor` / `hook` / `mount` / `canvas`）；`RELATION_TYPES` 仍是顺序单一来源；`HOOK_RELATION_TYPES` / `PLOT_EDGE_TYPE` 不动
- [ ] client `lib/entity-detail.ts`：删手写 `RELATION_TYPE_LABEL`（17 行），`relationTypeLabel` 改读注册表（未知值仍回退原文）
- [ ] client `lib/character-relations.ts`：`INTER_CHARACTER_RELATION_TYPES` = `group === "character"` 派生；`SYMMETRIC_CHARACTER_RELATION_TYPES` = `symmetric` 派生（禁止手抄）
- [ ] client `lib/relation-types.ts`：对话框排除集（现排 `occurs_at`）改 = `group === "mount"` 派生；伏笔仅章过滤保持
- [ ] tools `analysis/conflict.ts`：对称类型改注册表派生 ⇒ **rival 纳入**（行为变化：单向 rival 从此报矛盾）
- [ ] 测试：shared 注册表完整性（`RELATION_TYPES` 每项都有属性 + label 非空）；`entity-detail.test.ts` 改注册表驱动（不再手抄 17 项中文）；conflict 测试补「单向 rival → 报矛盾」
- [ ] 文档：`docs/db/schema.md` 对称说明 + `CHANGELOG.md` 工具行为变化条目
- [ ] 验证 oracle：`pnpm typecheck` / `pnpm -r test`；确认仓库内已无第二处手写关系类型中文清单

### 卡 8.2 自定义关系类型（轻：自由输入 + 已用类型派生；依赖 8.1）

- [ ] shared `utils/relation-type.ts`（新）：语法校验 + 归一纯函数（`trim` 后非空 / ≤ 32 / 禁控制字符），**不引 zod 依赖**
- [ ] shared `types/api.ts`：`relationCreateReqSchema.relation_type` 由 `z.enum(RELATION_TYPES)` 改 `z.string()` + 语法校验（复用上条）；tools 工具 schema 仍 enum（**不动**）
- [ ] db `queries/relation.ts` 守卫：`RELATION_TYPES.includes` → 语法函数（同一来源）
- [ ] client `components/entity/create-relation-dialog.tsx`：关系类型控件改 `select-free-input`（antd `AutoComplete`，**显式传 `filterOption`**、`onChange` 的 `undefined` 兜底为 `""`）；选项 = 调用方子集 ∪「本项目已用类型（带条数）」；无匹配给「将新建『X』」提示
- [ ] client 已用类型派生 helper（`GET /relation?depth=1` distinct + 计数）——对话框打开时拉一次；`relations-view.tsx` 过滤下拉复用同一 helper
- [ ] client 提交前预校验（复用 shared 函数）：非法值内联报错且不发请求
- [ ] 测试：语法函数边界（空/空白/33 字/控制字符/中文/合法）；派生 helper（distinct + 计数 + 稳定序）
- [ ] 验证 oracle：浏览器建一条自定义类型（如「宿敌」）→ 下拉出现「宿敌 · 1」、列表与过滤可见；AI 提案通道仍拒自定义类型；全量回归

### 卡 8.3 人物字段清单 schema 一致性断言

- [ ] client `lib/character-detail.ts`：`CHARACTER_MUTABLE_DATA_KEYS` / `CHARACTER_DETAIL_FIELD_KEYS` 改 `as const satisfies readonly EntityDataKey<"character">[]`（type-only import `ENTITY_DATA_SCHEMAS`，不打包 zod）
- [ ] 同文件加穷尽性编译期断言：`Exclude<schema 键, 详情键 ∪ {"ability_panel", "custom_fields"}> extends never`
- [ ] `character-detail.test.ts`：`BASICS ∪ MUTABLE === DETAIL` 集合相等；保留 `BASICS === IMMUTABLE_FIELDS.character`
- [ ] 验证 oracle：临时在 shared schema 加一个键 → `pnpm typecheck` 必报错（随后还原）；全量回归

### 卡 8.4 人物关系星形图（纯展示，手写 SVG）

- [ ] client `lib/relation-star.ts`（新，纯函数）：输入 = 去重后关系网行，输出 = 中心/叶子坐标 + 标签锚点 + 方向（极坐标，半径随叶子数自适应）+ 三个判据（< 4 行不渲染 / > 24 叶子不画名字 / 自环剔除）
- [ ] client `components/character/relation-star-graph.tsx`（新）：手写 SVG（零依赖）；中心点 + 姓名；叶子点 + 8 字截断名；有向箭头（out 朝外 / in 朝内），对称合并行不画箭头；叶子可点 = 切该角色（与列表行同行为）
- [ ] client `components/character/character-relations.tsx`：图渲染在操作行与分组列表之间（仅 `pane === "network"` 且达阈值）
- [ ] 测试：坐标均匀分布 / 半径自适应 / 阈值与标签隐藏判据 / 自环剔除
- [ ] 验证 oracle：浏览器看像素（3 行不出图、4+ 行出图；点叶子切角色）；全量回归

---

最近完成：批次 1 章级锚点收窄（1.1–1.9）→ 批次 2 人物数据模型与能力面板（2.1–2.9）→ 批次 3 人物页工作台（3.1–3.6 + 两轮修复）→ 批次 4 全量验证与发布（`CHANGELOG v0.0.34`）→ 批次 5 延期项速清（5.1–5.6）→ 批次 6 人物页信息架构与文案（6.1–6.3）→ 卡 7.1 进度节点选择器收窄为仅章 → 卡 7.2 伏笔「预计回收节点」选择器口径统一。
