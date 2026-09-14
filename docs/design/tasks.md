# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不再维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前任务卡：云端存档（批次 1，2026-09）

契约依据：`docs/design/40-cloud-sync.md`（为什么与不变式）、`docs/api/100-api-cloud.md`（端点）、`docs/api/20-api-backup.md`（命名与备份端点）、`docs/ui/DESIGN.md` §备份与云端存档、`docs/design/config.md`（cloud.json 载体）。

**全局约束**：

- **卡序即依赖顺序**（7；卡 1-卡 6 已完成并通过独立验证，见 `CHANGELOG.md` `Unreleased`）；同一时间只允许一张卡处于实现态（避免多写者冲突）。
- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；改 shared/db/tools 的 `src` 后先 `pnpm -r build` 再 typecheck 与下游测试（假绿窗口见 `backlog.md`）。
- **云端的自动化验证环境**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`），测试配置指向它——单测一律 mock `fetch`，集成验证才起真服务。
- **真实云盘（坚果云）验收**：由用户人工执行（步骤清单由卡 4 交付）；**凭据不进任何自动化脚本、不入库**。
- **不改动范围外的东西**：`restore` 的覆盖语义、`project.json` 字段、SSE 契约、antd token 均不得借本批次改动（唯一例外：卡 3 的 `backup-section` 拆分）。

| 卡 | 目标 | 主要交付物 | 完成判据（硬） |
| :--- | :--- | :--- | :--- |
| **7** | **自动推送**（2 小时节流 + 排除纯聊天触发 + 关闭项目尽力推 + 手动备份后立刻推） | `server`：复用现有自动备份 tick 链（不新增第二套定时器）、`cloud.json` 的 `autoPush` 生效、关闭项目路径接入推送（失败只记日志 + 状态标记）、手动备份成功后触发推送 | ① `autoPush` 关闭时任何自动路径都不推；② 打开时纯聊天（只改 `sessions/`）不触发推送，创作数据变更后到点即推；③ 节流：2 小时内的第二次变更不推（常量注入测试）；④ 关闭项目时推送一次（含聊天变更），失败不阻塞关闭且状态区标记；⑤ 手动备份成功后立即推送（不受节流限制）；⑥ typecheck/lint/test 全绿 + 新 commit |

**卡 7 开工前必读（卡 6 oracle 复核提出的八条债务）**：

1. **删除传播提示已完成**（卡 6 收口：会话 / 参考资料删除 toast 已补「推送到云端后，另一台也会同步删除」）——卡 7 只需保证「自动推送」也能传播这类删除（变更判定若只看创作数据、排除 `sessions/`，会话删除就得靠关闭项目或手动推送那次；`references/` 删除属创作数据、自动推送会带上）。
2. **status 刷新/清理现在挂在 `NavRail`**（左栏收起时 NavRail 不挂载 → 无人复查）——卡 7 的自动推送会改服务端同步状态，届时要有别的复查点（事件点刷新或把宿主上移到 `AppShell`）。
3. **`refresh()` 的 `busy` 归属**：`finally { set({ busy: null }) }` 会清掉 `push`/`pull` 刚设的 `busy` —— 卡 7 会新增更多并发动作，先把它明确化（谁设的谁清，或改成引用计数）。
4. **`clearStatus()` 未清 `conflictOpen`/`pullTarget`/`pendingSettingsPane`**：关闭项目/切书后旧对话框状态残留（模态遮罩挡住入口，现网可达性低）。
5. **失败文案去掉「未执行」的断言**（网络超时可能服务端**已执行**）——与「失败文案不要承诺无副作用」同类。
6. **冲突框「保留云端」应带上方才展示的那份 `fileName`**（当前 `pull()` 无参 = 服务端 head，极端情况下 ≠ 框里那份）。
7. **`DESIGN.md` §544 失败态口径与代码不一致**（文档写「错误文案 + 重试按钮；未配置 empty-state」，代码是纯文案）：改文档或补按钮，卡 7 收口时一并定。
8. **`getProjectBackups()` 失败与「真的没有备份」不可区分**（`.catch(() => null)` → 冲突框禁用强推并说「本机还没有备份」，可能不实）。

**批次完成后的收尾**（单独一步，不占卡片）：`CHANGELOG.md` 写 Unreleased 段 → 清理本文件的任务卡 → 向用户交付坚果云人工验收步骤清单。

---

## 流程备忘（临时，不需要时删）

- 开工：`backlog.md` 选/拆项 → 写入「当前任务卡」→ 实现 → 独立验证 → 卡内行为记录进 `CHANGELOG.md` 的 `Unreleased` 段 → 清卡。
- 发布：`build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
