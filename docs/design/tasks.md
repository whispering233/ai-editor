# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡 18.1 — 参考资料「分类」统一走 `TypeChip`（列表列 + 详情页头）

- **背景**：分类既没进 `TagChip`（对，它不是用户标签）也没进 `TypeChip`——列表分类列是裸文字（批次十二 R3 有意去徽标，`f7e2529`），详情页头是自绘 `rounded-md border-border bg-muted` span（与类型徽标形态不一致，旧 `backlog.md` 卡 10.4 待办）。
- **契约**：`docs/ui/DESIGN.md` §Components「准入规则」（分类 = 类型徽标 → `TypeChip` 描边式）。
- **范围**：`lib/reference.ts` 增 `TYPE_LABELS` 单一来源（原两个页面各手抄一份）；`ReferenceList.tsx` 分类列改 `TypeChip`；`ReferenceDetail.tsx` 页头改 `TypeChip`（筛选下拉 / 表单输入 / `datalist` 不动）。删 `backlog.md` 已兑现项。
- **判据**：列表分类列渲染出 `border-type-badge-border` + `bg-accent` 的 chip；详情页头同形；两页不再各有一份 `TYPE_LABELS`；`lib/reference.test.ts` 有映射断言（`material` → 素材摘抄）；`pnpm --filter @whispering233/ai-editor-client test` 绿。

## 卡 18.2 — 章视图「写正文」改图标按钮（`EditOutlined`）

- **背景**：`chapter-view.tsx` 行尾是下划线文字链接，与页内其余行尾控件（大纲树 = `icon-button`）不同形。
- **契约**：`docs/ui/DESIGN.md` §Components `icon-button`（新增「导航型 = antd `Button` 传 `href` ⇒ 渲染 `<a>`」口径）。
- **范围**：`chapter-view.tsx` 行尾「写正文」改 antd `Button`（`color="default" variant="text" size="small"` + `href={\`#/manuscript/${node.id}\`}` + `icon={<EditOutlined/>}` + `title`/`aria-label="写正文"`）；`chapter-view.test.tsx` 断言改 `aria-label` 计数。**不动**「本视图无 `<button`」否定断言（`href` ⇒ 渲染 `<a>`，断言必须继续绿）。
- **判据**：渲染 HTML 无 `<button`、有 `aria-label="写正文"` 与 `href="#/manuscript/…"`、无下划线文字链接；测试绿。

## 卡 18.3 — 大纲页视图选择持久化（`ai-editor:outline-view`）

- **背景**：`#/outline` 视图是 `useState`，跳走 / 刷新就回落大纲树——写作期把章视图当常驻形态时每次都要重选。
- **契约**：`docs/ui/DESIGN.md` §Components「大纲页双视图」（已改口径）、`config.md` / `10-data-model.md` §1 的 key 清单。
- **范围**：新增 `hooks/use-outline-view.ts`（key 常量 + 纯函数 `parseOutlineView` + 安全读 / 写，唯一实现）；`pages/Outline.tsx` 初值改为读取、切换与 `startCreate` 时写回；**只记视图，不记 `collapsed`**。
- **判据**：`use-outline-view.test.ts` 绿（坏值 / 未知值 / 空 → `tree`，`chapters` 往返）；浏览器走查：切章视图 → 跳详情 → 回大纲页仍是章视图；doc 四处无「三个 key」「不持久化」残留。

---

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：见根 `AGENTS.md`「协作流程」的验证条（含单包测试 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
