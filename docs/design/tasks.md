# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 本轮：桌面「界面缩放」可见性 + 设置页控件（2026-12）

契约见 `50-desktop.md` §4.1（可见性 / 设置页控制 / 通道三行）与 `../ui/DESIGN.md` 的 `zoom-panel`。

- [ ] **卡 1 · 契约文档先行**：`50-desktop.md`（§3 preload 能力面、§4 原生能力表、§4.1 三行新增 + 「不做」改写、§6 客户端契约增量）、`../ui/DESIGN.md`（`zoom-panel` 条目 + `library-location` 改第二项 + toast 同槽位使用方 + 快捷键段不显示比例）、`config.md`、`AGENTS.md`、`CHANGELOG.md`。
  - 判据：`grep` 无「preload 新增缩放通道」「设置页缩放控件」残留旧口径；四处互相一致。
- [ ] **卡 2 · desktop 通道**：`zoom.ts` 加 `zoomStateFrom(factor)`；`main.ts` 加 `zoomState()` / `pushZoomState()` / 三个 handler（注册点前移到 `loadURL` 之前）/ `applyZoom` 末尾推送 / `installMenu` 改用 `zoomStateFrom`；`preload.cts` 加三方法；`zoom.test.ts` 补端点用例。
  - 判据：`pnpm --filter ai-editor-desktop test` 绿 + `pnpm typecheck` 绿。
- [ ] **卡 3 · client 设置卡**：`lib/desktop.ts` 类型 + `components/settings/zoom-panel.tsx` + `pages/Settings.tsx` 通用 tab 接线（缩放在书库位置之上）+ `zoom-panel.test.tsx`。
  - 判据：`pnpm --filter @whispering233/ai-editor-client test` 绿 + typecheck 绿 + 无桥形态不渲染。
- [ ] **卡 4 · client 变化提示**：`AppShell` 订阅 `onZoomChanged` → `showToast("界面缩放 N%", "info", "zoom")`。
  - 判据：同上；无桥形态零副作用。
- [ ] **卡 5 · 真机核验**：`pnpm --filter ai-editor-desktop start` 逐项核对（100% → `+`×2 → 卡上 125% + toast → `Ctrl+0` → 卡上回 100% + toast；端点置灰；「恢复 100%」在 100% 时置灰）。
  - 判据：五项逐条勾 + 截图或日志。
