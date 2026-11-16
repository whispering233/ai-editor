# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡 1 — 备份命名双形态：shared 层 + 机械类型适配

**目标**：`shared` 能解析/生成小说与练习区两种备份名；`stats` 变可选。契约见 `docs/api/20-api-backup.md`「命名」与 `docs/db/schema.md`「自动备份目录」。

**改动**
- `packages/shared/src/utils/backup.ts`：`BACKUP_FILE_NAME_PATTERN` 拆成小说形态（尾部 `-人物N-设定N-章N`）与练习区形态（`<设备>[-<标签>]` 到 `.zip`）；解析先小说、再练习区；`ParsedBackupFileName.stats?: BackupStats`；`formatBackupFileName` 的 `opts.stats?` 缺省时不拼统计段；注释同步。
- `packages/shared/src/constants/backup.ts`：`BackupStats` 注释收窄为「小说工作区」。
- `packages/shared/src/types/api.ts`（备份响应 schema）与 `packages/shared/src/types/cloud.ts`（`CloudBackupEntry`）：`stats` 改 `.optional()` / `stats?`。
- 机械类型适配：`packages/server/src/backup.ts`、`packages/server/src/cloud/sync.ts`、`packages/client/src/lib/api.ts` 中因 `stats` 可选而报错的位置（不改变行为）。
- 测试：`packages/shared/src/utils/backup.test.ts`（现有用例 + 练习区解析/生成、标签含 `-`、标签形如 `人物1-设定2-章3` 的歧义仍按小说解析、缺设备/短名不误判）。

**完成判据**
- 小说旧文件名解析结果逐字段不变（`stats` 仍在）。
- 练习区新文件名解析成功且 `stats === undefined`；生成往返一致。
- `pnpm --filter @whispering233/ai-editor-shared build` → `test`；`pnpm typecheck` 绿。
- 一个 commit；`git status` 干净；汇报附 commit hash 与命令输出。

### 卡 2 — 服务端：按工作区 kind 写入/重命名备份

**目标**：练习区写新形态（无统计段），小说保持原形态；存量练习旧名被重命名时收敛为新形态。

**改动**
- `packages/server/src/backup.ts`：
  - `writeBackup`：按 `resolveWorkspaceKind(project.config.kind)` 分支；练习区不调 `getBackupStats`、不拼统计段；小说路径不变。
  - `uniqueBackupFileName` / `renameBackup`：`stats` 可选；练习区 `nextStats = undefined`（重命名顺带去存量旧名的统计段）；小说沿用原统计。
  - `BackupFileInfo.stats?`；`assertBackupFileNameFormat` 等错误文案改为「两种形态」。
- 测试：`packages/server/src/backup.test.ts`（练习区备份文件名无统计段、可列出/可恢复；小说文件名不变；练习区旧名重命名后去掉 `-人物0-设定0-章0`；恢复练习区旧名仍可用）。

**完成判据**
- 练习区 `POST /project/backup` 生成 `<ts>-手动-<设备>[-<标签>].zip`；`GET /project/backups` 该条无 `stats`。
- 小说路径回归不变（现有测试全绿）。
- `pnpm -r build` → `pnpm --filter @whispering233/ai-editor-server test` → `pnpm typecheck` 绿。
- 一个 commit；`git status` 干净；汇报附 commit hash 与命令输出。

### 卡 3 — 客户端：备份展示按 kind 门控 + 文案

**目标**：练习区备份元信息只显示设备；小说不变；「跟随书籍」改为「跟随当前工作区」。

**改动**
- `packages/client/src/lib/backup.ts`：`formatBackupMeta` / `formatSyncRow` 增加 `workspaceKind`（或等价参数）；练习区或 `stats` 缺失 → 只拼设备（不显示「人物0 · 设定0 · 章0」）。
- 调用点传 `config.kind`：`components/settings/auto-backup-panel.tsx`、`cloud-backup-panel.tsx`、`cloud-conflict-dialog.tsx`、`cloud-pull-confirm.tsx`。
- `auto-backup-panel.tsx` 文案「跟随书籍：…本项目独立」→「跟随当前工作区：…当前工作区独立」。
- `client/src/lib/api.ts` 的 `BackupEntry.stats?` 已由卡 1 处理；本卡只消费。
- 测试：`packages/client/src/lib/backup.test.ts`（小说不变；练习区只设备；`stats` 缺失只设备）。

**完成判据**
- 练习区备份列表/云端面板/拉取确认/冲突框都不出现「人物0 · 设定0 · 章0」。
- 小说显示不变。
- `pnpm --filter @whispering233/ai-editor-client test` + `pnpm typecheck` 绿；`ui-verifier` 实测 ≤3 条（练习区备份列表、云端面板、小说对照）通过。
- 一个 commit；`git status` 干净；汇报附 commit hash 与命令输出。

### 卡 4 — CHANGELOG + 全站残留扫尾

**目标**：记录契约变更，清除文档/代码注释里「唯一命名格式 = 必带统计段」的残留。

**改动**
- `CHANGELOG.md` `[Unreleased]` → `### Changed`：练习区备份命名不再带人物/设定/章统计段；`stats` 变可选；存量旧名不迁移、重命名时收敛。
- `grep -rn "人物N\|唯一命名格式"` 全站逐条核对：文档/注释改口径；合法的**小说**示例保留。
- `docs/design/tasks.md` 清空已完成卡片。

**完成判据**
- `CHANGELOG.md` 变更描述与实际行为一致；无残留的「练习区统计段」说法。
- `pnpm typecheck` / `pnpm lint` 绿；`git status` 干净；汇报附 commit hash。
