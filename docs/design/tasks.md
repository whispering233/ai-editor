# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 批次：数据安全收口（A）

四张卡彼此无文件重叠，可并行 worktree；`backlog.md` 与 `CHANGELOG.md` 由主会话在合并后统一改，**卡内不要碰这两个文件**。

---

## C1 · 桌面关窗前落盘（flush 通道）

- **目标**：点窗口 X / 菜单退出时，尚未到空闲落盘窗口（`AUTOSAVE_DELAY_MS`）的正文不丢。
- **口径（已定稿）**
  1. 主进程 `win.on("close")` 拦一次：`preventDefault()` → `webContents.send("desktop:flush-request")` → 等渲染侧 `desktop:flush-done(ok)` 回执，上限 `FLUSH_TIMEOUT_MS = 3000`。
  2. 渲染侧 flush = **栈顶保存动作**：`await triggerSaveShortcut()`（`shared` 之外的既有注册栈，唯一实现 = `client/src/lib/save-shortcut.ts`）。`null` / `undefined` / `true` = 成功；`false` 或 reject = 失败。
  3. 失败或超时 → **一次**原生确认框（`type: "warning"`，按钮 `["留在这里", "仍要退出"]`，`defaultId: 0` 且 `cancelId: 0`）：选「留在这里」不关窗并落日志；选「仍要退出」照关并落日志。
  4. 成功 → 直接关。`closing` 标志防重入：等待期间的第二次 close 只 `preventDefault()`，不再发请求。
  5. 退出链不变：`window-all-closed → app.quit()`、`before-quit → closeServer()`——flush 已在关窗前收口，届时服务端仍活着。
- **触点**：`packages/desktop/src/main.ts`、`packages/desktop/src/preload.cts`、`packages/client/src/lib/desktop.ts`、client 壳组件（注册存档的 `AppShell`，路径以仓库为准）；「flush 结果 → ok」的判定抽成 `client/src/lib/` 下的纯函数并配 `.test.ts`（仓内无 jsdom，组件不参与单测）。
- **文档**：`docs/design/50-desktop.md`（preload 能力面 + 新小节「退出前的未保存内容」）；`AGENTS.md` 桌面版节加一行硬约束——退出必须经 flush 通道，不得在 `before-quit` 里抢跑 `closeServer()`。
- **不做的**：浏览器形态 `pagehide` 兜底、崩溃/断电恢复、自动保存窗口调参——前两条由主会话登记 backlog。
- **完成判据（硬）**：`pnpm typecheck` 绿 + `pnpm lint` 绿 + `pnpm --filter @whispering233/ai-editor-client test` 绿 + `pnpm --filter ai-editor-desktop test` 绿；`git log` 含本卡新 commit；`git status` 干净。汇报必须附 commit hash 与上述命令输出。
- **真机项（用户侧，卡内只登记不复现）**：长章点 X 内容仍在；注入保存失败点 X 弹框且「留在这里」不关窗；连点两次 X 不重入。

---

## C2 · 大纲页 / 设定页的后退守卫

- **目标**：详情表单 dirty 时按浏览器后退，不再静默丢弃修改。
- **口径（已定稿）**
  1. **哨兵占位**：dirty 期间 `history.pushState` 一条同 URL 条目（`popstate` 到达时 URL 不变）。
  2. `popstate` → `confirmDiscard()`（两页壳已有 `detailDirty` + `confirmDiscard`，**不要重造**）。
  3. 取消 → 重新 push 一条哨兵复位（URL 全程未变）；确认 → `history.back()` 真正后退。
  4. 自己触发的那次 `history.back()` 不得再弹框 → 一次性抑制标志。
  5. 覆盖面**只到这两页**：其余页面的「无未保存守卫」是另一个更大缺陷，不在本卡内。
- **触点**：新增 `packages/client/src/lib/back-guard.ts`（纯逻辑 + `.test.ts` 真值表）与 `packages/client/src/hooks/use-back-guard.ts`（接线）；`pages/Outline.tsx`、`pages/SettingWorkbench.tsx` 各接一行。
- **文档**：`docs/ui/DESIGN.md` 的 `outline-page` / `setting-page` 守卫口径补「浏览器后退」。
- **卡内第一步（先做）**：确认 hash 路由下 `popstate` 与 `hashchange` 的触发次序（`hooks/use-route.ts` 只听 `hashchange`）。若次序会让哨兵导航被 `useHashRoute` 误判，先停下报告，不要自行改造路由。
- **完成判据（硬）**：`pnpm typecheck` 绿 + `pnpm lint` 绿 + `pnpm --filter @whispering233/ai-editor-client test` 绿；`git log` 含本卡新 commit；`git status` 干净。汇报附 commit hash 与命令输出 + 次序实测结论。
- **真机项（用户侧）**：「详情 → 树 → 书架」后退链；取消后连按后退；确认后前进条目行为。

---

## C3 · 两处小修（dev 态更新假话 + 构建产物清理）

- **口径**
  1. `packages/desktop/src/updater.ts` 的 `isUpdateSupported()` 加 `&& app.isPackaged`（菜单项随之消失，符合「`onCheckUpdates` 为 null = 没有更新能力」的既有原则）。不要在 `checkForUpdatesManually` 里加分支。
  2. 六个包（`shared` / `tools` / `server` / `agent` / `db` / `desktop`）的 `build` 前置清 `dist`：`node -e "require('fs').rmSync('dist',{recursive:true,force:true})"`（**不加** `rimraf` 依赖；`client` 由 vite `emptyOutDir` 负责，**不要动**）。
- **文档**：`docs/design/build.md` 构建一节补一句「各包 build 先清 `dist`」。
- **完成判据（硬）**：`pnpm -r build` 后 `packages/server/dist/decompose` 不存在；`pnpm typecheck` 绿 + `pnpm lint` 绿 + `pnpm --filter ai-editor-desktop test` 绿；`git log` 含本卡新 commit；`git status` 干净。汇报附 commit hash 与命令输出。

---

## C4 · CI 打包态启动冒烟

- **目标**：发布链路上验证「包能起来」，不只「包能构建」。
- **口径**：`.github/workflows/desktop.yml` 在 `pack.mjs` 之后加一步（Windows runner）：以 `--user-data-dir=<tmp>` 起 `release/win-unpacked/ai-editor.exe`，等待上限内断言 `<tmp>/logs/ai-editor.log` 含「菜单已就绪」且不含 `SyntaxError` / `Uncaught Exception`，随后 kill。
- **退路（必须写进卡内注释）**：若 runner 无交互会话导致窗口/菜单创建失败，退化为断言「主进程跑到 server 启动行」，并在汇报里写明实际走的是哪条。
- **完成判据（硬）**：`git log` 含本卡新 commit；`git status` 干净；YAML 通过编辑器/`node -e` 语法核；**真实验证只能经 `workflow_dispatch`（日常不 push）——汇报要明确写「未在 CI 实跑」，不得声称已验证**。