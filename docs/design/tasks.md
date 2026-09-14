# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不再维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前任务卡：云端存档（批次 1，2026-09）

契约依据：`docs/design/40-cloud-sync.md`（为什么与不变式）、`docs/api/100-api-cloud.md`（端点）、`docs/api/20-api-backup.md`（命名与备份端点）、`docs/ui/DESIGN.md` §备份与云端存档、`docs/design/config.md`（cloud.json 载体）。

**批次状态（2026-09-15）**：云端存档 7 张卡全部完成并通过各自独立 oracle 验证（逐卡事实见根 `CHANGELOG.md` `Unreleased`）。

**当前任务卡：云端收口批次 2（2026-09-15）** —— 用户已拍两条口径：

- **卡 A：备份命名唯一化**（砍掉旧格式兼容层）：写入 = 解析 = 唯一格式；旧命名文件留盘不识别；**开项目兜底备份**（`.backups/` 有文件但无一可解析 → 立即生成一份新格式备份，不重命名旧份——旧份无设备/统计信息，硬补会谎报）。
- **卡 B：旧包上传诚实化（职责分离，(ii) 口径）**：**云端永不创建备份**（自动路径不做按需备份）；自动路径（2h 定时 / 关闭项目）在「本机有改动未进最新备份」时**跳过不推**并只在状态里标注；用户主动点「同步云端」时弹 `cloud-stale-backup-dialog` 让其选「立即手动备份并推送」/「上传旧备份」；状态行提示「云端将上传旧份（<时间>），先『立即备份』」。

> 上一轮 oracle 复核列出的「云端收口小项」（失败文案去「未执行」断言、`refresh()` 的 busy 归属、`clearStatus()` 清对话框状态、冲突框带 fileName、`getProjectBackups` 失败区分、AggregateError 取码、`/cloud/test` 可写不可删降级、URL 校验不回显 raw、shared 注释镜像、status 复查宿主上移、`§544` 口径）待卡 A/B 落地后另排。

| 卡 | 目标 | 主要交付物 | 完成判据（硬） |
| :--- | :--- | :--- | :--- |
| **A** | **备份命名唯一化**（写入 = 解析，砍兼容层） | `shared/utils/backup.ts`：删 3 个旧正则与 `formatBackupFileName` 的旧形态输出分支，`parseBackupFileName` 只认当前格式、`device`/`stats` 变必填；`server/backup.ts`：`renameBackup` 删旧形态分支、新增 `ensureParseableBackup(project)`（`.backups/` 有文件但无一可解析 → `writeBackup({kind:"auto"})`）并在 `middleware/project.ts` 的 `setCurrentProject(project)` 里调用（best-effort 记日志）；契约收敛（`shared/types/api.ts` + client `lib/api.ts` 的 `BackupEntry.device`/`stats` 必填）；client 删「旧格式未记录 / 整行省略」死分支（`lib/backup.ts` 的 `formatBackupMeta` 返回 string、`auto-backup-panel.tsx`、`cloud-conflict-dialog.tsx`、`cloud-backup-panel.tsx`）；测试：删旧形状用例 + 新增「旧形状一律 null」与「开项目兜底备份」用例 | ① `parseBackupFileName` 对三类旧命名一律返回 null，且当前格式仍全绿；② `formatBackupFileName` 只产唯一格式（旧形态输出分支已删）；③ 开项目时「有旧文件但无可解析份」→ 生成一份新格式备份（且已有可解析份时不重复备份）；④ API 契约里 `device`/`stats` 必填，client 无「旧格式」分支；⑤ typecheck/lint/test 全绿 + 新 commit |
| **B** | **旧包上传诚实化**（职责分离，(ii)） | `shared`：`GET /cloud/status` 的 `local` 段新增「本机有改动未进最新备份」状态位（如 `backupStale: boolean`）；`server/cloud/auto-push.ts`：定时与关闭项目路径在该状态下**跳过**（不推、不写 `lastAutoPushError`，可记中性状态）；`client`：面板状态行提示「云端将上传旧份（<时间>），先『立即备份』」+ 新增 `cloud-stale-backup-dialog`（两个等权 `button-default`：`[立即手动备份并推送]`（先 `POST /project/backup` 再 push）/ `[上传旧备份]`）+ store 的 `syncNow` 在该状态弹出该对话框 | ① 自动路径（2h 定时 / 关闭项目）在该状态下零网络请求且不写 `lastAutoPushError`；② 手动备份后的路径不受影响（刚生成的份必定最新）；③ 点「同步云端」在该状态下弹对话框，两个选项分别走「先备份再推」与「照推旧包」；④ 无该状态时行为与现状一致；⑤ 文档（`40-cloud-sync.md` §5 / `DESIGN.md` §538、§540 / `100-api-cloud.md`）同步；⑥ typecheck/lint/test 全绿 + 像素核对一次 + 新 commit |

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
