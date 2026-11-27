# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

当前批次：**A 组 · UI/UX 交互修复**（契约已进 `docs/ui/DESIGN.md` / `docs/api/80-api-chat.md`）。顺序 A2 → A4（A1 / A3 已交付），一卡一 commit，串行单写者（本机 worktree 无 `node_modules`，不并行）。

---

## 卡 A2 · 切模型 / 思考强度失败回滚

**为什么**：`ChatPanel.tsx` 的 `changeModel` / `changeThinking` 乐观更新后 `.catch(() => {})`；注释自称「下拉回后端实际值」，但 `getSettingsLlm` 只在挂载时跑一次 ⇒ 失败后永不回读，用户以为换了模型，下一轮仍用旧配置。

**改动面**：`ChatPanel.tsx` 的 `ComposerConfigRow` 内合并为 `persistLlm(patch, field)`：
- 乐观 `setSettings` → `updateSettingsLlm(patch)`；
- 失败：**每次都 toast**（`showToast(msg, "error")`）+ `getSettingsLlm()` 回读，**只写回该次失败请求的字段**（`model` 变更写回 `provider` + `model`；`thinking` 变更写回 `thinkingLevel`）；
- `useRef` 记每字段最新请求序号，回读落地前比对：该字段已有更新请求则放弃写回（不得盖掉用户新选择）。

**完成判据（硬）**：本卡新 commit + `git status` 干净 + `pnpm --filter @whispering233/ai-editor-client test` 绿（若抽出纯函数则须有单测）。

**验证**：浏览器拦截 `PUT /settings/llm` 返回 500 → 下拉回弹到旧值 + 错误 toast；连点两次（先失败后成功）→ 终态 = 成功那次的值，不因失败回滚被覆盖。本仓无 jsdom，异步点击无法入库为测试 ⇒ 浏览器实测记录贴进汇报。

**风险 / 边界**：成功路径不加 toast（下拉本身就是反馈）；不要把回读结果整体 `setSettings`（会盖掉另一字段在途的成功值）。

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
