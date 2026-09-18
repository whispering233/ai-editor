# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 当前任务卡（大纲页：自动编号 + 章视图，2026-09）

契约已定稿：`ui/DESIGN.md` §数据展示（类型徽标承载层级序号 + 占位几何）与「大纲页双视图」；`design/10-data-model.md` §4（UI 展示编号 ≠ 服务端章序）。用户已确认的口径：全局连续章序、只计可见节点（删后重排）；编号只在树视图行 + 章视图行；切换按钮 = 页头「全部折叠」左侧单按钮（文案 = 目标视图，页面 state 不持久化）；章视图只支持改名与进详情。

- [ ] **卡 1：编号纯函数 `numberOutline` + 单测**
  - 范围：`packages/client/src/lib/outline-tree.ts`（导出 `OutlineNumbering` / `numberOutline(tree)`：`labels` = 节点 id → `第N卷` / `第N章`；`chapterRows` = 章视图行，含 `volumeId` / `volumeLabel` / `chapterLabel`）+ `outline-tree.test.ts`。
  - 口径：卷序 = 顶层卷文件位置序 1-based；章序 = 全书先序连续（跨卷累计，含存量直挂 root 的章，其 `volumeId` = `ROOT_NODE_ID`、`volumeLabel` = `""`）；`deleted === true` 的节点及其子树跳过；`null` 树 → 空结果；场景不入 `labels`。
  - 验收：`pnpm --filter @whispering233/ai-editor-client test`；用例如跨卷连续 / 存量根级章 / 软删跳过 / 空树。
  - commit：`feat(outline): 大纲编号纯函数（卷序 + 全局章序，展示口径）`
- [ ] **卡 2：树视图卷/章行编号徽标 + 占位几何同步**
  - 范围：`packages/client/src/pages/Outline.tsx`（卷/章行徽标内容 = `numberOutline.labels`，类名 `min-w-14 justify-center tabular-nums`；场景行不变；**摘要第二行与就地新建行的占位宽度按行类型同步**）。
  - 验收：`pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test`；浏览器像素：卷/章/场/摘要/新建行标题左缘同列，`第9章` / `第10章` 不抖。
  - commit：`feat(outline): 树视图卷/章行改用第N卷/第N章编号徽标`
- [ ] **卡 3：章视图 presenter + 页头视图切换**
  - 范围：新增 `packages/client/src/components/outline/chapter-view.tsx`（纯 presenter：行 = `第N卷` + `第N章` 徽标 + 标题 + 摘要 + 伏笔标记 + 「阅读进度」徽标；单击标题就地改名、双击行进详情；有卷无章空态）+ `chapter-view.test.tsx`（renderToString）；`Outline.tsx` 接线（`view` state、页头切换按钮 `ml-auto`、「全部折叠」章视图隐藏、空态分支）。
  - 验收：上述三命令 + 浏览器像素：切换按钮位于「全部折叠」左侧、章视图无「全部折叠」、改名落库、双击进 `#/outline/:id`、空态与暗色主题正常。
  - commit：`feat(outline): 新增章视图与视图切换按钮`

---

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**改桌面版主进程后额外跑打包态启动冒烟**（`build.md`，`typecheck` 绿 ≠ 打包态能起）。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
