# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

当前批次：**A 组 · UI/UX 交互修复**（契约已进 `docs/ui/DESIGN.md` / `docs/api/80-api-chat.md`）。顺序 A4（A1 / A3 / A2 已交付），一卡一 commit，串行单写者（本机 worktree 无 `node_modules`，不并行）。

---

## 卡 A4 · 设置页离开守卫

**为什么**：设置页有七处手写保存的草稿，离开页面（左栏导航 / 浏览器后退）全部静默丢弃；`useBackGuard` 目前只挂在大纲与设定页。

#### 改动面
- 新增 `packages/client/src/lib/leave-guard.ts`（纯逻辑：注册 / 注销 / `confirmLeave()`，**同一时刻只允许一个在途确认**）+ `hooks/use-leave-guard.ts`（dirty → 注册）。
- `pages/Settings.tsx`：`LeaveGuardContext` + 聚合任一 dirty + `useBackGuard(anyDirty, confirmLeave)`（后退与导航共享同一个 confirm ⇒ 不弹两次）。
- 七处草稿源各加 `useRegisterDirty(dirty)`：`project-rules-section`（文本与已加载值不同）、`config-file-editor`（**`Object.values(files).some(fileDirty)`**，不是当前槽位）、`search-key-panel`、`pi-dir-panel`、`runtime-params-panel`、`cloud-backup-panel`、`llm-section`（任一 `keyDrafts` 非空）。
- `components/nav/NavRail.tsx` 四处出口统一 `if (!(await confirmLeave())) return;`：品牌 `<a href="#/">`（需 `preventDefault`）、`navigate("/overview")`、Menu `navigate(key)`、`navigate("/preferences")`。

**完成判据（硬）**：本卡新 commit + `git status` 干净 + `pnpm --filter @whispering233/ai-editor-client test` 绿（`lib/leave-guard.test.ts` 新增用例：注册/注销、无守卫时直接放行、在途确认不重入）。

**验证（逐项打勾）**：七个草稿源各改一笔 → 点左栏四个出口任一 + 浏览器后退 → 都弹**一次**确认（取消留页、确认离开）；无改动时直接离开不弹。

**风险 / 边界**：七处漏一处 = 静默丢稿，验收清单逐项打勾。**不覆盖**关窗 / 刷新（与桌面 flush 握手冲突）与「通用 → 更改书库位置」（直接重启进程），两类进 `backlog.md`。
