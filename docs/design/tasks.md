# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不再维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前任务卡：云端存档（批次 1，2026-09）

契约依据：`docs/design/40-cloud-sync.md`（为什么与不变式）、`docs/api/100-api-cloud.md`（端点）、`docs/api/20-api-backup.md`（命名与备份端点）、`docs/ui/DESIGN.md` §备份与云端存档、`docs/design/config.md`（cloud.json 载体）。

**批次状态（2026-09-15）**：云端存档 7 张卡全部完成并通过各自独立 oracle 验证（逐卡事实见根 `CHANGELOG.md` `Unreleased`）。

**批次 2（云端收口，2026-09-15）已完成**：卡 A 备份命名唯一化（`13f1d2b` + 收口 `3256108`）、卡 B 旧包上传诚实化（`e43869e`）——两张卡各自通过独立 oracle 验证（A = 有条件 PASS → 文档收口；B = 有条件 PASS → 三处文本/注释收口），逐卡事实见根 `CHANGELOG.md` 的 `Unreleased` 段。

**待排（用户未定）**：`backlog.md` 里「云端收口小项」那批（失败文案去「未执行」断言、`refresh()` 的 busy 归属、冲突框带 `fileName`、`getProjectBackups` 失败区分、AggregateError 取码、`/cloud/test` 可写不可删降级、URL 校验不回显 raw、shared 注释镜像、status 复查宿主上移、`DESIGN.md §544` 口径）——`clearStatus()` 清对话框状态已在卡 B 顺带完成。

> 上一轮 oracle 复核列出的「云端收口小项」（失败文案去「未执行」断言、`refresh()` 的 busy 归属、`clearStatus()` 清对话框状态、冲突框带 fileName、`getProjectBackups` 失败区分、AggregateError 取码、`/cloud/test` 可写不可删降级、URL 校验不回显 raw、shared 注释镜像、status 复查宿主上移、`§544` 口径）待卡 A/B 落地后另排。

| 卡 | 目标 | 主要交付物 | 完成判据（硬） |
| :--- | :--- | :--- | :--- |

**全局约束**：

- **卡序即依赖顺序**（本批次 7 张卡已走完）；同一时间只允许一张卡处于实现态（避免多写者冲突）。
- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；改 shared/db/tools 的 `src` 后先 `pnpm -r build` 再 typecheck 与下游测试（假绿窗口见 `backlog.md`）。
- **云端的自动化验证环境**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`），测试配置指向它——单测一律 mock `fetch`，集成验证才起真服务。
- **真实云盘（坚果云）验收**：由用户人工执行（步骤清单由卡 4 交付）；**凭据不进任何自动化脚本、不入库**。
- **不改动范围外的东西**：`restore` 的覆盖语义、`project.json` 字段、SSE 契约、antd token 均不得借本批次改动（唯一例外：卡 3 的 `backup-section` 拆分）。

| 卡 | 目标 | 主要交付物 | 完成判据（硬） |
| :--- | :--- | :--- | :--- |

**批次完成后的收尾**（单独一步，不占卡片）：`CHANGELOG.md` 写 Unreleased 段 → 清理本文件的任务卡 → 向用户交付坚果云人工验收步骤清单。

---

## 流程备忘（临时，不需要时删）

- 开工：`backlog.md` 选/拆项 → 写入「当前任务卡」→ 实现 → 独立验证 → 卡内行为记录进 `CHANGELOG.md` 的 `Unreleased` 段 → 清卡。
- 发布：`build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
