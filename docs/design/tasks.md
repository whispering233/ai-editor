# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 批次 2 补 · 启动路径修复（待开工）

- [ ] **2.8 开机自动打开的书必须走版本检测/迁移（卡 3.2 发现，既存缺口）**
  - 现状：`detectProject`（`packages/server/src/middleware/project.ts:95` 附近）直接 `openDatabase`，而 `ensureSchemaCompatible` 只在 `POST /project/open`（`routes/project.ts`）跑 → **开机直达上次打开的书时跳过迁移**。实测：test-project 启动后 `user_version` 仍为 6、`abilities` 未迁；显式 open 后才 6→7。
  - 危害：任何 **DDL 迁移**在开机路径会被跳过（读不存在的列 → 运行时错误）；卡 2.3 的「旧库 open 自动迁移」验收只在显式 open 路径成立。
  - 修法：把开机路径的 db 打开收敛到与 `POST /project/open` 同一条管道（复用同一个 open/migrate 函数），**不要**在 `detectProject` 里另起一套；补测试（开机路径跑迁移 + 版本不匹配时的三态分流）。
  - 验收：开机直达的书与显式 open 的书的 `user_version`/迁移产物一致；`PROJECT_VERSION_NEWER` 拒绝路径在开机态同样生效（不得静默重建）。

## 批次 3 · 人物页 UI（进行中）

- [ ] 3.1 master-detail 宿主 + 左栏列表（搜索 / 排序 / 选中 / 空态 / 自动选首个 / 窄屏两级）
- [ ] 3.2 双视图 tab（初始化数据 / 当前位置数据；tab 2 只读；`ComputePreview` 归并入 tab 2，保留手动选节点；`conflicts` 标注照搬）
- [ ] 3.3 字段三分渲染（不可变 / 可变分区；`description` 必填校验；详情页表单）
  - 分区标题：**「基础信息」（不可变：姓名 / 角色定位 / 描述）/「可变数据」（可变：假名 / 性别 / 年龄 / 种族 / 动机 / 性格 + 能力面板宿主）**——各自 `card` 容器 + `section-title`；关系网 / 其他关联在 tab **之下**（不在 tab 内），由 3.6 重构。
  - **`description` 必填校验**（仅前端：保存时非空 + 内联错误；服务端不硬校验——见 `docs/db/schema.md`）；tab 2 只读态同样呈现两个分区。
  - **卡 3.2 oracle 追加两条**：① `current_position` 指向已软删/不存在节点（`resolveCurrentAtNode` 返回空）→ **回落 tab 1** 或给「当前位置已失效，请重设」提示；② `config` 尚未加载时不得瞬时误判为「未设置当前位置」（到位后再判）。
- [ ] **3.3 修复轮（oracle 发现的三条 UI 打磨）**
  - 「描述」为空的历史角色在补齐前**保存不了任何修改**（硬必填的必然结果）→ 基础信息区给「描述」旁一行 caption（如「描述为空，保存前需填写」），避免用户以为保存坏了。
  - tab 2 在 `outlineLoaded=false` 且位置有效时短暂展示初始值而无位置提示 → 并入既有「大纲加载中…」文案。
  - `readOnlyFieldValue` 对对象值输出 `[object Object]`（`custom_fields` 嵌套值会在 tab 2 可读列表出现）→ 改 JSON 序列化或统一显示 `—`。
  - 验收：三条各有 SSR/单测断言 + 一次像素核验（截图）。

- [ ] **3.4 修复轮（oracle 三条交互缺陷 + 一条改法）**
  - ① **误报 toast**：`panel-tree.tsx` 拖拽处理先取 `movePanelNode(...)` 结果，`null`（防环/非法）→ **直接 return 且不弹任何 toast**；只有真正 commit 成功后才提示「原字段值已清除」。
  - ② **非法落点不得有反馈**：拖到**自身子树**行时不得显示 `before/on/after` 高亮与插入线（`DESIGN.md` 口径：非法落点无反馈即「不可放」）——hover 时判断目标是否在 `from` 子树内，非法则不设 `dropTarget`。
  - ③ **「带值叶子」策略统一**：现「新增子级」拒绝（提示先清值）而「拖成子级」允许并丢值 → **统一为拒绝 + 提示**（不丢用户数据，最保守）。
  - ④ 若 `buildDeltaChange` 的 numeric 路径能安全复用 `coerceAbilityValue`（非数字不报错），则把面板叶子两条写入路径的**类型判定对齐**；不能则保持 `docs/db/schema.md` 的已知边界登记（在报告说明）。
  - 测试：三条各补单测/SSR 断言；既有 client 测试全绿（728 基线）。

- [ ] 3.4 `panel-tree` 控件（结构编辑 + 叶子值 + 拖拽 + 只读态 + 模板/复制入口）
  - **含**：把面板**叶子路径**接入「+ 新建变更」字段下拉（`lib/delta-create.ts` 现以 `NON_DELTA_FIELDS` 排除整树，需按当前实体的面板结构动态展开叶子路径，用 shared `abilityPanelFieldPath` 拼前缀）；结构编辑需内联提示「名字含 `.` 不可寻址 / 同层重名」（口径见 `docs/db/schema.md`）。
- [ ] 3.5 新建人物弹窗（必填 姓名 / 角色定位 / 描述；重名软提示；面板「空白 / 内置模板 / 从角色复制」；提交后自动选中）
- [ ] 3.6 关系网 + 其他关联分区（分组 + 对称去重 + 建边入口收窄 + 折叠区）

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
