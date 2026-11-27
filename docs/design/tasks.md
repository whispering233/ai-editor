# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

本轮范围 = **P0 数据正确性 + P1 反馈可信度**（用户 2026-11 拍板）。浏览器像素核对只需卡 4 / 5 / 6。

---

## 卡 1 · 守卫闸门 hook 收口（等价重构，行为零变化）

**目标**：把「注册模块槽」与「拦浏览器后退」合成一个入口，消灭「传 `confirmDiscard` 还是 `confirmLeave`」这个同参数名不同语义的坑。

### 改动面
- 新增 `packages/client/src/hooks/use-unsaved-guard.ts`：`useUnsavedGuard(dirty, confirm)` 内部 ① 注册 `lib/leave-guard.ts` 的模块槽；② 挂后退哨兵，**handler 一律走 `confirmLeave()`**（共享在途单槽），不透传 raw confirm。
- `pages/Settings.tsx` 迁到新 hook（它本来两路都挂、后退已走 `confirmLeave`，**行为完全等价**）。
- `hooks/use-leave-guard.ts` / `use-back-guard.ts` 保留导出，注释改为「内部实现，调用点由 `useUnsavedGuard` 代理」，并登记临时白名单（`Outline.tsx` / `SettingWorkbench.tsx`，卡 2 清空）。
- `design-discipline.test.ts` 加白名单守卫：除 `hooks/use-unsaved-guard.ts` 内核与白名单外，`src` 内不得直接调旧两个 hook。

### 完成判据
- `git status` 干净 + 本卡一个 commit（中文 conventional）。
- `pnpm --filter @whispering233/ai-editor-client test` 全绿（含新增白名单守卫）。
- 手工：设置页改脏 → 左栏点击 / 浏览器后退，各弹**一个**确认框；并发（后退与点击同时）也只弹一个。

**依赖**：无 · **视觉**：无

---

## 卡 2 · 叶子自注册：7 个面 × 三路拦截

**目标**：让「谁持有脏表单，谁注册」成为结构性事实；补齐 7 个面的页内 / 左栏 / 后退三路。

### 改动面
- `pages/EntityDetail.tsx`：自注册 `useUnsavedGuard(dirty, confirm)`（`dirty` 已有 = `:234` 的 `diffData`）。
- `pages/OutlineDetail.tsx`：自注册（`dirty` 已有 = `isOutlineDetailDirty`）。
- `pages/TimelineDetail.tsx`：**新增** dirty 判定（纯函数 `isTimelineDetailDirty(baseline, form)` 放 `lib/`，配真值表测试）+ 自注册；改写 `:22` 那句「未保存离开守卫……不做（避免过度设计）」为「已撤销：机制已就位，丢稿代价 > 接线成本」。
- `pages/Outline.tsx` / `pages/SettingWorkbench.tsx`：删 `useBackGuard`，`confirmDiscard` 退化为 `confirmLeave()` 一行；`SettingWorkbench` **保留** `onDirtyChange` 供 `:174` 的 `notifyDataChanged` 抑制；`Outline` 删掉只为守卫存在的 `detailDirty` state。
- 白名单守卫收缩到「仅 `use-unsaved-guard.ts` 内核」。

### 完成判据
- 一个 commit、`git status` 干净；`pnpm typecheck` + client 全测绿。
- 真机逐面核对（7 面：大纲 / 设定 / 地点 / 伏笔 / 时间点 / 事件 / 人物之外的 5 详情 + 2 工作台）：改一个字段 → ① 点树内另一节点 ② 点左栏导航 ③ 按后退：三种各弹**一次**确认；取消后表单内容不丢。
- 详情列收起态（`SettingWorkbench`）不弹框（内层已卸载 ⇒ 无注册）。

**依赖**：卡 1 · **视觉**：无

---

## 卡 3 · 确认框在途锁

**目标**：在途关框不再让「请求还在跑、失败文案无处落」。

### 改动面
- 新增纯函数 `canCloseConfirm(submitting, next)`（`components/outline/` 或 `lib/`，配真值表测试），`ConfirmDialog` 的 `onOpenChange` 用它早退。
- 对齐既有先例 `components/shelf/export-book-dialog.tsx:177` 的写法与注释。

### 完成判据
- 一个 commit、`git status` 干净；新纯函数测试用例覆盖 `(true,false) → 不关`、`(false,false) → 关`、`(true|false,true) → 不关`。
- 手工：点「彻底删除」后立刻按 `Esc` / 点遮罩 → 框不消失；失败后错误仍在框内。

**依赖**：无（可与卡 1/2 互换顺序） · **视觉**：无

---

## 卡 4 · 在途加载计数（`active-loads`）

**目标**：刷新按钮有真实 loading 且不可连点；有数据时重载有可见线索。

### 改动面
- `stores/ui.ts`：`activeLoads` 计数（注册 / 变更 / 注销，按 token 去重）。
- 新增 `hooks/use-report-loading.ts`。
- 16 个 `useDataRefresh` 订阅点各加一行（上报各自的 `loading`）。
- `components/main-panel/MainToolbar.tsx`：刷新按钮订阅总数（`loading` + `disabled`）。
- 5 个列表 / 树面板：`loading && data !== null` 时内容区顶部 2px primary 条。

### 完成判据
- 一个 commit、`git status` 干净；client 全测绿。
- 像素核对（浅 / 深两态）：点刷新 → 按钮转圈且不可点；列表在「已有数据」时出现 2px 条，首拉仍是骨架、不叠加。

**依赖**：无 · **视觉**：有

---

## 卡 5 · 错误文案归并（`field-error` / `save-error`）

**目标**：两种错误语义各有一个 primitive，消灭 85 处手写红字；顺手修掉唯一一处「必填错误落在页尾」。

### 改动面
- 新增 `components/ui/field-error.tsx`（12px）与 `components/ui/save-error.tsx`（14px）。
- 存量站点按**语义**归并，但**只迁移字号已与落点档位一致**的站点（零观感变化）；错配站点逐条登记进 `backlog.md`（已预登记），留给第二步并单独授权。
- `pages/ReferenceDetail.tsx`：名称必填从 `:619` 页脚移到名称字段下（`FieldError`）+ 提交时聚焦该字段。

### 完成判据
- 一个 commit、`git status` 干净；client 全测绿。
- 像素核对：除 `ReferenceDetail` 那一处错误位置，**其余页面像素零差异**（重点看 `text-sm` 组是否被误迁）。

**依赖**：无 · **视觉**：仅一处

---

## 卡 6 · `SaveStatus` 扩到详情页

**目标**：5 类详情页有「我到底存过没有」。

### 改动面
- `EntityDetail`（3 路由）/ `TimelineDetail` / `character-detail`：页头说明行挂 `SaveStatus`，`state` 由 `dirty` / `saving` / 保存成功派生，`savedAt` = 本地完成时刻，进页恒 `idle`。

### 完成判据
- 一个 commit、`git status` 干净；client 全测绿。
- 像素核对（浅 / 深）：编辑 → 「编辑中…」；保存中 → 「保存中…」；成功 → 「已保存 · HH:MM」；进页 / 刷新后不显示任何保存态。

**依赖**：卡 2（`TimelineDetail` 的 dirty 由卡 2 产出）· **视觉**：有（页头说明行）

---

## 卡 7 · 长任务诚实反馈（`long-task`）

**目标**：导出 / 导入 / 备份 / 云推拉四处：点了有反应、不能点第二次、跑完知道结果对应什么。

### 改动面
- 新增 `hooks/use-elapsed-seconds.ts` + 阈值常量（`LONG_TASK_ELAPSED_HINT_MS`，只在定义处出现）。
- `Dashboard.tsx`（导出 / 导入）、`NavRail.tsx`（备份）、`stores/cloud.ts` + 其消费点（推 / 拉）：在途文案带对象名、超阈值追加已用时、在途禁连点禁关框、失败 toast 带对象名。

### 完成判据
- 一个 commit、`git status` 干净；client 全测绿。
- 像素核对：四处各跑一次（可用 `test-project` 小库），确认文案与禁用态生效；**不得出现百分比或阶段动画**。

**依赖**：无 · **视觉**：有（文案）