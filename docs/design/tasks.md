# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不再维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前任务卡：云端存档（批次 1，2026-09）

契约依据：`docs/design/40-cloud-sync.md`（为什么与不变式）、`docs/api/100-api-cloud.md`（端点）、`docs/api/20-api-backup.md`（命名与备份端点）、`docs/ui/DESIGN.md` §备份与云端存档、`docs/design/config.md`（cloud.json 载体）。

**全局约束**：

- **卡序即依赖顺序**（6 → 7；卡 1-卡 5 已完成并通过独立验证，见 `CHANGELOG.md` `Unreleased`）；同一时间只允许一张卡处于实现态（避免多写者冲突）。
- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；改 shared/db/tools 的 `src` 后先 `pnpm -r build` 再 typecheck 与下游测试（假绿窗口见 `backlog.md`）。
- **云端的自动化验证环境**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`），测试配置指向它——单测一律 mock `fetch`，集成验证才起真服务。
- **真实云盘（坚果云）验收**：由用户人工执行（步骤清单由卡 4 交付）；**凭据不进任何自动化脚本、不入库**。
- **不改动范围外的东西**：`restore` 的覆盖语义、`project.json` 字段、SSE 契约、antd token 均不得借本批次改动（唯一例外：卡 3 的 `backup-section` 拆分）。

| 卡 | 目标 | 主要交付物 | 完成判据（硬） |
| :--- | :--- | :--- | :--- |
| **6** | **冲突裁决 + 左栏「同步云端」按钮**（一键状态机 + 角标） | `client`：`components/nav/NavRail.tsx` 底部四入口、`components/settings/cloud-conflict-dialog.tsx`、`stores/cloud.ts` 一键状态机（跳设置页 / 推送 / 拉取确认 / 裁决 / 提示）；`server`：无新端点（`force` 已在卡 4） | ① 点击按钮在四种状态下行为正确（已同步提示 / 未推改动直接推 / 云端更新弹确认 / 冲突弹裁决 / 未配置跳设置页并选中云端备份）；② 角标只在「有未推改动 / 云端更新 / 冲突」时显示；③ 裁决两条路各留一份备份（用本地 WebDAV 实测：强推后云端旧份仍在本地 `.backups/`）；④ 未配置/未打开项目时按钮禁用或引导正确；⑤ 浏览器核像素一次（含角标浅/深两态）+ 新 commit |
| **7** | **自动推送**（2 小时节流 + 排除纯聊天触发 + 关闭项目尽力推 + 手动备份后立刻推） | `server`：复用现有自动备份 tick 链（不新增第二套定时器）、`cloud.json` 的 `autoPush` 生效、关闭项目路径接入推送（失败只记日志 + 状态标记）、手动备份成功后触发推送 | ① `autoPush` 关闭时任何自动路径都不推；② 打开时纯聊天（只改 `sessions/`）不触发推送，创作数据变更后到点即推；③ 节流：2 小时内的第二次变更不推（常量注入测试）；④ 关闭项目时推送一次（含聊天变更），失败不阻塞关闭且状态区标记；⑤ 手动备份成功后立即推送（不受节流限制）；⑥ typecheck/lint/test 全绿 + 新 commit |

**卡 6 开工前必读（卡 5 oracle 复核提出的九条债务）**：

1. **本地 restore 之后必然出现 `conflict / dirty=true`**（整体覆盖让本机偏离云端同步点；卡 5 实测 B11）→ 一键状态机要把它当**正常态**处理（提示推送或裁决），不是异常。
2. **`force` 不改变 head 定义**：云端存在时间戳更晚的他机份时，强推后再次推送仍会判冲突 → 裁决后必须**允许再次强推**（不是一次性动作）。
3. **`/status` 每次 2–3 次 PROPFIND**（无书目录 1 / 缓存命中 2 / 回退扫描 3，已实测）→ 按钮与角标**不得轮询**；store 上提须带节流或缓存（云盘配额 600 次/30 分钟）。
4. **`unreachable` 只做轻提示**（角标不常亮、不弹窗）——离线可用是底线（设计文档不变式 9）。
5. **裁决两条路都要回显「留档」文件名**（强推用 `push` 响应的 `snapshot.fileName`、保留云端用 `pull` 响应的 `snapshot.fileName`；服务端字段已备齐）。
6. **拉取失败（坏包 / 版本过高）也会留下覆盖前快照**（`restoreBackup` 先快照后校验）→ 失败文案**不要承诺「无副作用」**。
7. **「未配置 → 跳设置页并选中云端备份」需要跨页的选中意图**（`backup-pane` 的选中态目前是页内 node state，见 `DESIGN.md` §534）→ store 要能下传该意图。
8. **client 侧 API 唯一入口仍是 `lib/api.ts`**（面板现在是页内 state + 直调 API）→ 上提 store 时保持 400/502 中文文案透传口径，不要另起 fetch。
9. **删除传播提示**（`DESIGN.md` §550：删除会话/参考资料后 toast 补一句「推送到云端后另一台也会同步删除」）本卡与卡 7 的 UI 义务，别漏。

**批次完成后的收尾**（单独一步，不占卡片）：`CHANGELOG.md` 写 Unreleased 段 → 清理本文件的任务卡 → 向用户交付坚果云人工验收步骤清单。

---

## 流程备忘（临时，不需要时删）

- 开工：`backlog.md` 选/拆项 → 写入「当前任务卡」→ 实现 → 独立验证 → 卡内行为记录进 `CHANGELOG.md` 的 `Unreleased` 段 → 清卡。
- 发布：`build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
