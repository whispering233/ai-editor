# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

**当前批次：桌面版界面缩放（整站）** — 设计与口径已定稿，见 `50-desktop.md` §4.1（档位表 = 契约）、`config.md` 的 `desktop.json` 行、`DESIGN.md` §设置页「快捷键」区与 Known Gaps。**文档先于代码落地，卡内不再改设计口径**；若发现文档与实现矛盾，先停下提问。

## 卡 Z1 — 缩放阶梯纯函数（`packages/desktop/src/zoom.ts`）

- **依赖**：无；**可与 Z4 并行**
- **交付**：新建 `zoom.ts` 与 `zoom.test.ts`，**不改任何既有文件**
- **API（固定，不得改名/改形）**：
  - `ZOOM_FACTORS: readonly number[]`（`as const`）= 80/90/100/110/125/150/175/200 的因子
  - `ZOOM_EPSILON = 0.001`（Chromium `page_zoom` 同值口径）
  - `isZoomFactor(value: unknown): value is number` — 数值且落在阶梯上（epsilon 容差）
  - `nextZoomFactor(current: number, direction: 1 | -1): number` — **严格**上/下下一个阶梯值；未知档位（如 1.37）→ 放大给 1.5、缩小给 1.25；两端夹住
  - `zoomPercent(factor: number): number` = `Math.round(factor * 100)`
- **测试**：阶梯字面值（= `50-desktop.md` §4.1 表，改档位必须同步那张表）；端点夹住；1.37 双向；`getZoomFactor()` 读回的 `1.0999999999999999` 视为 1.1
- **验收**：`pnpm --filter ai-editor-desktop test` + `pnpm typecheck`
- **完成判据**：`git log` 含本卡新 commit 且 `git status` 干净；无 commit 不许报 PASS

## 卡 Z2 — `desktop.json` 增加必填 `zoom`（行为不变）

- **依赖**：Z1
- **交付**：`packages/desktop/src/config.ts` 的 `DesktopConfig.zoom: number` 必填；`parseDesktopConfig` 用 `isZoomFactor` 校验，缺失 / 坏类型 / 不在阶梯 → `1`（未知键仍忽略）。`main.ts` 两处 `writeDesktopConfig` 调用点带上**盘上的真实值**（`resolveLibraryRoot` 用已读到的 `saved.zoom`；`change-library-root` 重新 `readDesktopConfig` 取，读不到才回落 `1`）——**本卡不得接键位或菜单**，但也不得写成常量 `1`（那会让换书库/启动自愈静默重置缩放）。
- **测试**：`config.test.ts` 补「缺 `zoom` → 1」「`zoom` 不在阶梯 → 1」「写后读回保留 `zoom`」，并同步既有往返用例
- **验收**：`pnpm --filter ai-editor-desktop test` + `pnpm typecheck` + `pnpm lint`
- **完成判据**：同 Z1

## 卡 Z3 — 主进程接线（键位 / 应用时机 / 视图菜单）

- **依赖**：Z1、Z2
- **交付**（全部在 `packages/desktop/src/main.ts`）：
  1. `before-input-event`：`input.type === "keyDown"`、`(control || meta) && !alt`；`input.key` ∈ `=` `+` `-` `0`，小键盘按 `input.code`（`NumpadAdd` / `NumpadSubtract` / `Numpad0`）兜住；命中即 `event.preventDefault()` 并走档位函数（端点值未变则直接返回，**不写盘**）
  2. `applyZoom(next)`：内存值 → `webContents.setZoomFactor` → 原子写 `desktop.json`（失败只 `console.warn`，不影响本次生效）→ 重建菜单
  3. 应用时机：建窗后 `loadURL` 前设一次，`did-finish-load` 幂等重放一次
  4. 菜单：新增「视图」三项 `放大` / `缩小` / `实际大小 · N%`（第三项标签带百分比，端点 `enabled: false`）；`installMenu` 加第 5 个参数（形如 `{ percent, step, reset }`，**参数总数不得超过 5**）
  5. `resolveLibraryRoot` 返回缩放值（或在调用处分派）使启动自愈写入带上真实 `zoom`，不再恒为 1
- **硬约束**：不挂菜单 `accelerator`（会与 `before-input-event` 双触发）；不新增 preload 通道；不动 `preload.cts`；浏览器形态零改动
- **验收**：`pnpm typecheck` + `pnpm lint` + `pnpm --filter ai-editor-desktop test`；打包态冒烟 `node packages/desktop/scripts/smoke.mjs`（先 `pnpm --filter ai-editor-desktop pack.mjs` 或仓内等价脚本），日志确认启动后 `zoomFactor` = 盘上值
- **真机手测（留给主会话，不要求子代理）**：Ctrl/Cmd+= / - / 0、小键盘、连按到端点的置灰、重启保留、换书库不重置、150% 翻窄屏
- **完成判据**：同 Z1

## 卡 Z4 — 客户端快捷键清单（仅桌面形态显示）

- **依赖**：无；**可与 Z1 并行**
- **交付**：`packages/client/src/lib/shortcuts.ts` 的 `ShortcutEntry` 加 `desktopOnly?: boolean`，清单追加三条（`key` = `=` / `-` / `0`，描述「放大界面」「缩小界面」「界面缩放恢复 100%」）；`components/settings/shortcuts-section.tsx` 按 `desktopBridge() !== null` 过滤 `desktopOnly` 条目（与「通用」tab 同口径）
- **测试**：`shortcuts.test.ts` 断言三条存在、标记正确、顺序在整栏快捷键之后
- **验收**：`pnpm --filter @whispering233/ai-editor-client test` + `pnpm typecheck` + `pnpm lint`
- **完成判据**：同 Z1

## 收尾（主会话，不派工）

Z1–Z4 合并后：`CHANGELOG.md` 的 `[Unreleased] / Added` 写一条事实条目 → 清空本文件 → 全量回归（`pnpm typecheck` / `pnpm lint` / `pnpm -r test`）+ 真机手测汇报。