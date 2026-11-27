# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

契约来源：`docs/ui/DESIGN.md` §Components `ref-chip` / `skeleton-block`（本轮已写入）。**契约文档不写卡号**，下文的「卡 N」只在清单内有效。

## 并行 / 串行判定

- **只剩一张卡**（在 main 单写者执行，不开 worktree——本机 worktree 无 `node_modules` / `dist`，`pnpm -r exec` 会拒跑）。
- 依据：前一卡与它共享 `EntityDetail.tsx` / `TimelineDetail.tsx` / `design-discipline.test.ts`，冲突点全在「同类串的第 N 份复制」上，最容易合出错。

---

## 卡 3 · 5 处「假按钮」改回 `Button href`

**目标**：修掉 5 处 `<a className="rounded-md border border-border px-4 py-1.5 …">`——它们与旁边真正的 antd `Button` 并列，高度 / hover / 焦点环 / 禁用态全不同，而 `DESIGN.md` 早已规定导航型操作用 `Button href`（仓内已有 10+ 处正确写法）。

**涉及文件**

- `components/blocknote/manuscript-states.tsx:17`
- `components/character/character-detail.tsx:907`
- `pages/EntityDetail.tsx:395`
- `pages/TimelineDetail.tsx:304`
- `pages/Outline.tsx:373`（带 `whitespace-nowrap`）

**改动范围**：只把「去回收站」那个 `<a>` 换成 `<Button href="#/trash">去回收站</Button>`。**不动**旁边的「返回列表」按钮，不动文案，不动空态布局。

**不变式**

- 不借机改空态文案 / 按钮顺序。
- 不顺手把 6 处墨色链接（`text-primary hover:underline`）一起改——那需要先在 `index.css` 补 `--color-link`，已单独登记 backlog。

**验收**

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 全绿
- [ ] 像素：5 个空态页各看一次「去回收站 + 返回列表」两个按钮是否**同高、同 hover 面、同焦点环**（整页重载）
- [ ] `git status` 干净 + `git log` 含本卡 commit

**回滚**：单 commit revert。
