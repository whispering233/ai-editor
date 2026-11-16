# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡 1 · 项目规则随包搬运 + 变更判定归一（server/shared）

- 目标：`AGENTS.md` 存在时进备份 / 导出 / 云端包；恢复类操作严格镜像（包内无条目 → 删本机规则）；备份 tick / 云端「有未备份改动」/ 自动推送共用同一把尺子（三文件 + `data.db-wal` + `AGENTS.md`，容差只给 `data.db`/`-wal`）。
- 范围：
  - `packages/shared/src/types/api.ts`：新增 `AGENTS_FILE_NAME` 与可选条目清单（紧邻 `PROJECT_EXPORT_FILE_NAMES`，注释写明「必需」/「可选」两组）。
  - `packages/db/src/storage/project.ts`、`packages/agent/src/runtime/paths.ts`：常量改为从 shared re-export（值不变）。
  - `packages/server/src/backup.ts`：`createBackupZip` 存在才追加条目（ENOENT 跳过）；`isAllowedBackupEntry` 放行；`validateBackupPackage` 的文案与检查（三文件齐全 + 规则可选、不校验内容）；`writeProjectFilesFromBackup` 有则原子写、无则 `unlink`（ENOENT 容忍）、日志含规则；`hasFileChangesSince` 改为委托 `hasChangesSince(project, since, { extraFiles: [AGENTS_FILE_NAME] })`，删除 `hasLocalEditsSince` / `hasAuthoringChangesSince`，`hasUnbackedChanges` 同步改调用。
  - `packages/server/src/cloud/sync.ts`、`packages/server/src/cloud/auto-push.ts`：改调用 `hasFileChangesSince`，并把「两档判定」的注释与 JSDoc 改成一把尺子（`auto-push.ts` 文件头、`sync.ts` 的 `computeCloudSync` 注释）。
  - `packages/server/src/routes/cloud.ts`：`importSyncBaseline` 纳入规则文件 mtime（存在才取）。
  - 测试：`packages/server/src/backup.test.ts`、`cloud/sync.test.ts`、`cloud/auto-push.test.ts`、`routes/cloud-remote-books.test.ts`——覆盖有/无规则往返、旧包删规则、含规则包恢复、判定含规则、导入基准含规则、白名单放行。
- 硬完成判据：`pnpm -r build` + `pnpm typecheck` + 上述测试文件 `vitest run` 全绿；新 commit 存在；`git status` 干净；汇报附 commit hash 与命令输出。

### 卡 2 · 客户端文案与 JSDoc 对齐事实（client）

- 目标：界面与注释不再声称「聊天记录会一起上云」，覆盖/导出说明与包内容一致。
- 范围：
  - `packages/client/src/components/settings/cloud-backup-panel.tsx`：自动推送说明删掉「聊天记录会随下一次创作变更一起上云」，写明创作数据 = 三文件 + 项目规则、聊天记录不进包；覆盖说明补项目规则。
  - `packages/client/src/components/settings/cloud-pull-confirm.tsx`：后果声明补「项目规则随覆盖替换（包内没有则本机规则被清除）」。
  - `packages/client/src/components/shelf/export-book-dialog.tsx`：说明行改「三文件 + 项目规则（若有）」；对应测试断言同步。
  - `packages/client/src/lib/api.ts`：相关 JSDoc 补项目规则。
- 硬完成判据：`pnpm --filter @whispering233/ai-editor-client test` 绿 + `pnpm typecheck`；新 commit 存在；`git status` 干净；汇报附 commit hash 与命令输出。

### 卡 3 · 「云端有更新」不再计入非备份文件（B1）

- 目标：云端文件集合只计可解析备份名，`.tmp-*` 等残留不再造成永久 `remote-ahead`。
- 范围：`packages/server/src/cloud/sync.ts` 的 `cloudFileSet` 过滤（`parseBackupFileName` 命中才保留）；`packages/server/src/cloud/sync.test.ts` 补用例（`.tmp-*`/杂项文件不参与集合、不触发 `remote-ahead`）。
- 硬完成判据：`pnpm --filter @whispering233/ai-editor-server test` 绿 + `pnpm typecheck`；新 commit 存在；`git status` 干净；汇报附 commit hash 与命令输出。

### 卡 4 · 角标只在需要用户动手时亮（B2）

- 目标：自动推送开启时「有未推改动」不点亮角标（该改动会被自动处理）。
- 范围：`packages/client/src/stores/cloud.ts` 的 `cloudBadgeTone` 增加 `autoPush` 判断（`local-ahead` 仅在 `!status.autoPush` 时 warning）；`packages/client/src/stores/cloud.test.ts` 补两态断言。
- 硬完成判据：`pnpm --filter @whispering233/ai-editor-client test` 绿 + `pnpm typecheck`；新 commit 存在；`git status` 干净；汇报附 commit hash 与命令输出。
