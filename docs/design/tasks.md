# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡 20.1 — 全站 Ctrl/Cmd + S = 保存 + 本地存档（含节流）

- **背景**：`lib/save-shortcut.ts` 已有全局 Ctrl/Cmd + S 监听 + 注册栈（12 处页面/行内编辑已注册），但只保存、不生成备份；**章正文页未注册** ⇒ 在那里按 Ctrl+S 会弹浏览器原生「保存网页」。
- **契约**：`docs/ui/DESIGN.md` §设置页「快捷键」区「Ctrl/Cmd + S（全站保存 + 本地存档）」（节流、失败分流、反馈文案、`preventDefault`）；`docs/api/20-api-backup.md` §POST /project/backup（手动备份触发入口）。
- **范围**：
  - `lib/save-shortcut.ts`：导出 `SAVE_SHORTCUT_KEY`（`isSaveShortcut` 用它比较）；handler 类型放宽为 `() => void | Promise<void>`；新增「存档动作」注册（全站唯一注册者 = `AppShell`）+ 触发函数；keydown 改为「先 await 页面保存 → 成功再触发存档」且恒 `preventDefault`。
  - 新增 `lib/shortcut-archive.ts`：节流（常量 `SHORTCUT_BACKUP_THROTTLE_MINUTES`、进程内时间戳、在途标志）+ 结果三态（`archived` / `skipped` / `failed`），依赖注入以便单测。
  - 新增 `hooks/use-save-archive.ts`：`AppShell` 挂载；无项目 → 跳过；toast 文案由常量插值。
  - 12 处 `useSaveShortcut(() => void xxx(), …)` 改为返回 Promise（底层函数已全为 `async`）并在**失败分支 `return false`**（各页 catch 后 promise 会 resolve，只有该信号能把「失败」传给快捷键流程）；`pages/Manuscript.tsx` 新增注册（`saving` 期间不重发）。
- **判据**：新增/更新 `lib/shortcut-archive.test.ts`（节流窗内跳过、窗口过后存档、失败不推进节流基准、在途只跑一次）、`lib/save-shortcut.test.ts`（新返回契约 + 存档只在保存成功后触发 + `false` 信号与 rejection 两条失败路径都不存档 + 无注册者仍触发存档）；`pnpm --filter @whispering233/ai-editor-client test` / `pnpm typecheck` / `pnpm lint` 绿；浏览器核一次：章正文页 Ctrl+S 落盘且备份列表多一份、节流窗口内连按只多一份。

---

## 卡 20.2 — 设置页「快捷键」tab（清单单源 + 平台化显示）

- **背景**：用户要求设置页有说明当前快捷键的二级 tab。
- **契约**：`docs/ui/DESIGN.md` §设置页「快捷键」区（`tab-shortcuts` 形态、tab 顺序、平台化口径、清单与绑定的单源要求）。
- **范围**：新增 `lib/shortcuts.ts`（平台判定 + 组合键格式化 + 清单，键位引用卡 20.1 的 `SAVE_SHORTCUT_KEY`）；新增 `components/settings/shortcuts-section.tsx`（`SectionCard` + `TypeChip` + `caption-text`，无交互控件）；`pages/Settings.tsx` 追加末位 tab 与 `TabKey`；`pages/settings-tabs.test.tsx` 增断言。
- **判据**：新增 `lib/shortcuts.test.ts`（Apple/非 Apple 文案 + 清单键位 === `SAVE_SHORTCUT_KEY`）、`settings-tabs.test.tsx` 绿（含「快捷键」且位于「备份」之后）；`pnpm --filter @whispering233/ai-editor-client test` / `pnpm typecheck` / `pnpm lint` 绿；浏览器核一次 `#/preferences` 末位 tab 渲染（键位徽标 + 说明）。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
