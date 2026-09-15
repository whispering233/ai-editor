# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**；本文件不维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前批次：UX/UI 样式优化（2026-09）

契约已先落文档（本批次卡 0）：`docs/ui/DESIGN.md`（行级新建按钮 / 缩进列对齐 / 大纲页页头「+ 新建卷」/ `panel-tree` 只读空值 / `type-badge` 准入）、`docs/design/10-data-model.md` §2（章只挂卷）、`docs/api/60-api-outline.md`、`docs/db/schema.md`、`docs/design/backlog.md`（antd Tree 不迁移）。

- [x] **卡 0 文档口径先行**（不改代码）：DESIGN.md 四处 + 10-data-model §2 + api/60 + schema.md + backlog（Tree 考察结论）+ 本文件卡片。commit: 待填
- [ ] **卡 2b 契约：章只挂卷**（db `assertCanHold` 单点 + tools 提案/工具描述 + client `parentOptionsForType` + 测试翻转；改 `db`/`tools` 的 `src` ⇒ 先 `pnpm -r build`）
- [ ] **卡 2a 大纲页页头「+ 新建卷」**（去卷/章切换 + 就地新建行补 `TypeChip 卷` + 缩进对齐标题列）
- [ ] **卡 1 大纲页缩进列对齐**（折叠箭头 24px ↔ 占位同几何：`-ml-2 w-6`；行内类型徽标/标题/摘要/就地新建行四处同列）
- [ ] **卡 3 大纲页行级新建**（卷 → 新建章、章 → 新建场；`PlusOutlined` icon-button，插在删除左侧；场无按钮）
- [ ] **卡 4 设定页行级新建**（任意设定行 → 新建子设定；同位置规则）
- [ ] **卡 5 关联页端点类型中文**（`ENDPOINT_TYPE_LABEL` → shared `ENTITY_TYPE_LABELS` + `outline_node`；同处过滤下拉一并修）
- [ ] **卡 6 人物页只读面板空值无占位**（`PanelReadOnlyRows` 空值不渲染 `—`；单测补一条）
- [ ] **卡 7 阅读进度徽标 → `TypeChip`**（大纲行 + 节点详情页）
- [ ] **卡 8 考察结论归档**（Tree 评估已写进 `backlog.md` + DESIGN.md 旧理由修正；无代码、随卡 0 一并交付）

**本批次验收**：`pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test`；UI 四张卡（2a/1/3/4/6/7）额外用浏览器核一次像素（子代理）。一卡一 commit，卡内不做卡外顺手改动。

## 卡的分工与验收（沿用）

- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
