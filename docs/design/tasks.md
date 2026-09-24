# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡：大纲页一键清除推演标记（2026-09-24）

**目标**：大纲页页头新增「清除推演标记」按钮，一键清空当前项目全部推演节点标记（`deduction_nodes` 全量写 `[]`）。

**契约依据**：`docs/design/10-data-model.md` §15、`docs/api/10-api-project.md`（`PUT /project/config` 的 `deduction_nodes`，`[]` = 清空）、`docs/ui/DESIGN.md`（§大纲页双视图 / `推演节点` 徽标）。

**改动范围**（严格，不做卡外顺手改动）：

1. `packages/client/src/lib/deduction.ts`：新增 `clearDeductionMarks()`——`updateConfig({ deduction_nodes: [] })`；成功 toast「已清除全部推演节点标记」，失败 toast「清除失败，请重试」。**不复用** `submitDeductionMarks`（其失败文案「该节点可能已删除或不可见」对清空是假话）。注释写明为何写 `[]` 而不是可见标记数组（`[]` 是全量替换下唯一能同时收敛盘上失效 id 的写法，§15 不变式 6）。
2. `packages/client/src/pages/Outline.tsx`：页头 `controls` 包一层 `<div className="ml-auto flex items-center gap-3">`，`ml-auto` 从视图切换按钮挪到该容器（否则清除按钮不渲染时右对齐塌掉）；组内顺序 = 清除按钮（`deduction.marks.length > 0` 才渲染）→ 视图切换 → 全部折叠 → +新建卷。按钮 = 普通 `Button`，无 `disabled`、无危险色、无二次确认。
3. `docs/ui/DESIGN.md`：§「大纲页双视图」把「视图切换 = 页头控件行最右组的第一个」改为右端组口径（`[清除推演标记（有可见标记时）] [视图切换] [全部折叠（仅树视图）] [+新建卷]`，`ml-auto` 挂右端组容器）；§「`推演节点` 徽标」补「一键清空入口」段（页头、两视图共用、无可见标记不渲染、点击即清 + toast、无二次确认）。
4. `docs/design/10-data-model.md` §15：补一句写入入口口径（行级切换 + 页头一键清空，均为 `PUT /project/config` 全量替换）。
5. `packages/client/src/pages/outline.test.tsx`：SSR 断言——有标记 → 页面含「清除推演标记」；无标记 → 不含（既有「无标记：整页不出现推演徽标」用例须保持绿）。`clearDeductionMarks` 碰 store/请求、仓内无 jsdom ⇒ 不进单测，交 oracle 浏览器实测。

**零改动**：服务端 / shared / tools / api 契约（`[]` 已文档化）；清空后悬浮「问 AI」焦点由现成 `deductionVisible` 派生自动收敛，不写新代码。

**已知接受项**：标记全部失效（章被 purge）时按钮不出现，盘上失效 id 无人清——三处过滤后无用户可见影响（§15 不变式 6「不自动清理」）。

**不做**：一键标记全部章 / 章视图行内清空 / 节点详情页清空入口 / 二次确认弹窗。

**硬完成判据**：`git log` 含本卡新 commit（非空改动）+ `git status` 干净；`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test` 全绿。汇报必附 commit hash 与命令输出。

**oracle 验收**：独立复核上述判据 + 浏览器实测（启动 dev 服务）——有标记时按钮出现、点击后全部徽标消失且 toast 正确、无标记时按钮不出现、章视图同样可用。

---

## 当前无进行中任务卡（其余）

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
