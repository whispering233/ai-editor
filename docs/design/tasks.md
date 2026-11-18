# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡片 2：「全部折叠 / 全部展开」改用树节点图标

- **先读**：`docs/ui/DESIGN.md` 的 `outline-page` / `setting-page` rail header 条目（本次已改为 `NodeCollapseOutlined` / `NodeExpandOutlined`）。
- **替换**：`pages/Outline.tsx` 与 `components/entity/setting-rail.tsx` 的 `MenuFoldOutlined` / `MenuUnfoldOutlined` → `NodeCollapseOutlined` / `NodeExpandOutlined`（含 import）。文案 `全部折叠 / 全部展开` 不变。
- **测试同步**：`pages/setting.test.tsx` 的 `anticon-menu-fold` → `anticon-node-collapse`；`pages/outline.test.tsx` 如有相关断言一并同步。
- **不做**：面板开关、树行折叠箭头（仍 `RightOutlined` + `rotate-90`）、`MenuFold/Unfold` 的禁用条款。
- **完成判据**：同上三条命令全绿；代码中不再有 `MenuFoldOutlined` / `MenuUnfoldOutlined`；删除本卡；commit（`fix(client): 全部折叠改用树节点图标`）；`git log -1` 含该 commit 且 `git status` 干净。

