# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 批次 1 · 章级锚点收窄（进行中）

> 契约来源：`docs/design/10-data-model.md` §14.7、`docs/db/schema.md`（delta / relation / project.json 三节）、`docs/api/50-api-delta.md`、`docs/api/40-api-relation.md`、`docs/api/10-api-project.md`。三张卡互相独立，可并行（不同文件面）。

- [ ] **1.1 当前位置仅章 + 大纲右键「设为当前位置」**
  - 后端：`PUT /project/config` 校验 `current_position` 指向的节点必须 `type === "chapter"`（非章/不存在/已软删 → 400 `VALIDATION_ERROR` 中文信息）；读侧保持宽松（不校验存量值）。
  - 前端：`components/outline/row-context-menu.tsx` 加「设为当前位置」（仅章节点行可见；已是当前位置 → 禁用）；复用 `OutlineDetail` 的提交实现（抽公共函数或保留两处调用同一 API）。
  - 验收：卷/场景行右键无该菜单项；章行设置成功后 InfoBar / 概览页「当前位置」联动刷新；`PUT` 传 `sc-*` → 400。
  - 测试：`packages/server/src/routes/project.test.ts` 补非章 400 用例（章级通过 + 卷/场景拒绝 + null 清除）。

- [ ] **1.2 变更记录仅章（REST + 提案层 + 大纲页入口）**
  - 后端：`POST /delta` 增加节点层级校验（非 `chapter` → 400 `VALIDATION_ERROR`）；`assertOutlineNode` 旁新增层级断言（照抄 S13.3 的「REST + 工具层双管、shared schema 不动」模式）。
  - 提案层：`packages/tools` 的 `propose_add_delta`（`proposal/delta.ts`）对 `node_id` 做同样拒绝 + 工具描述补「仅章」。
  - 前端：大纲节点详情页的「变更记录」区块（`NodeDeltaList` + `DeltaCreateForm`）仅在 `chapter` 节点渲染；卷/场景页不显示（不做只读兼容）。
  - 不改：`POST /delta/compute` 的 `at_node_id`（查询不限层级）。
  - 验收：场景/卷节点页无变更记录区；`POST /delta` 传 `sc-*` → 400；AI 传场景 id → 工具报错。
  - 测试：`packages/server/src/routes/delta*.test.ts` + `packages/tools/src/proposal/*.test.ts` 补非章拒绝用例。

- [ ] **1.3 伏笔锚点仅章（REST + 提案层 + 面板选择器 + 工具口径）**
  - 后端：`POST /relation` 对 `relation_type ∈ {plants, advances, resolves}` 且 `source_type=outline_node` 校验节点为 `chapter`（非章 → 400）。提案层 `propose_add_relation` 同步拒绝。
  - 前端：`HookPanel` 四处节点选择器（埋点 / 推进回收 / `expected_resolve_node_id` / 选择器通用件）只列章节点；`lib/hook-panel.ts` 的 `anchorNodeForAbandon` 退化分支由「树末节点」改为「**树末章**」。
  - 工具：`suggest_hook_payoff` 候选由 scene 改为 **chapter**（注释与描述同步）；`find_hook_opportunities` 输入只接受章；工具描述补「仅章」。
  - 验收：场景节点建 `plants` → 400；HookPanel 下拉无场景/卷；大纲页伏笔徽标只出现在章行；弃用伏笔在无 `current_position` 时锚到树末章。
  - 测试：`packages/server/src/routes/relation.test.ts`、`packages/tools/src/analysis/hook.test.ts`、`packages/client/src/lib/hook-panel.test.ts` 补用例。

## 批次 2 · 人物数据模型（未开工）

- [ ] 2.1 character 字段改造（+`description`/`alias`（单值假名）/`race`、−`status`、`personality` 保留）+ 摘要口径（`description` 截断 100、能力面板顶层分组名前 2）
- [ ] 2.2 `get_entity_summary` 口径（character 移除 `byStatus`；`topAbilities` 改顶层分组名）——`filters.status` 与 hook 统计**保留**
- [ ] 2.3 `007_character_ability_panel` 迁移（幂等、不覆盖已有面板）+ `SCHEMA_VERSION 6 → 7`
- [ ] 2.4 `computeState` 点分嵌套路径解析（仅标量 `set`/`update`）+ 防御（非法结构不抛错）
- [ ] 2.5 能力面板纯函数库（结构解析 / 顶层分组名 / 叶子路径枚举 / 模板深拷贝派生）+ 单测

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
