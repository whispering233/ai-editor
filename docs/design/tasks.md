# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡片 3：「全部折叠 / 全部展开」改用方框加减图标

- **先读**：`docs/ui/DESIGN.md` 的 `outline-page` / `setting-page` rail header 条目（本次已改为 `MinusSquareOutlined` / `PlusSquareOutlined`）。
- **替换**：`pages/Outline.tsx` 与 `components/entity/setting-rail.tsx` 的 `NodeCollapseOutlined` / `NodeExpandOutlined` → `MinusSquareOutlined` / `PlusSquareOutlined`（含 import）；分支 = `collapsed.size > 0 ? PlusSquare : MinusSquare`（setting 为 `collapsedIds.size > 0`），`className="text-sm"` / `aria-label` / onClick / 按钮顺序不变。
- **测试同步**：`pages/setting.test.tsx:67` `anticon-node-collapse` → `anticon-minus-square`；`pages/outline.test.tsx` 初始态补 `expect(html).toContain("anticon-minus-square")`（reviewer P2）。
- **不做**：面板开关、树行折叠箭头、`MenuFold/Unfold` 禁用条款。
- **完成判据**：client test / lint / typecheck / diff-check 全绿；代码中不再有 `NodeCollapseOutlined` / `NodeExpandOutlined`；删除本卡；commit `fix(client): 全部折叠改用方框加减图标`；`git log -1` 含该 commit 且 `git status` 干净。

