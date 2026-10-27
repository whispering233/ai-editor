# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前进行中任务卡

### 卡 B2：自动推送随备份频率生效

**目标**：删掉「备份频率关闭时按 2 小时兜底排程自动推送」这条在任何有意义的时刻都不会真推的分支；设置页改正那句会误导的说明并新增条件提示。文档已在本卡开工前改完（`40-cloud-sync.md` §5、`100-api-cloud.md`、`DESIGN.md`、`backlog.md`、`CHANGELOG.md`）——**代码必须与文档一致，不得回改口径**。

**改动范围**
1. `packages/server/src/middleware/project.ts`：`setProjectTick({...})` 删掉 `fallbackIntervalMs` 字段与 `AUTO_PUSH_THROTTLE_MS` 导入；块注释改为「排程条件 = 自动备份频率开启」。
2. `packages/server/src/backup.ts`：`ProjectTickHooks` 删掉 `fallbackIntervalMs` 字段；`scheduleNext` 改为 `freq === null → 不排程`（删除回落分支）；同步文件头注释（第 13 行附近「频率关闭时回落……2h 排程」）、`startAutoBackup` 与 `scheduleNext` 的注释。
3. `packages/server/src/cloud/auto-push.ts`：只改头注释里的排程口径（删「不需要 2h 排程」之类的反述）；**`maybeAutoPush` 内部的 `hasUnbackedChanges` 守卫保留不动**（频率开启时仍要防「改在两次备份之间」）。
4. `packages/client/src/components/settings/cloud-backup-panel.tsx`：说明行把「自动备份频率关闭时按 2 小时排程，不会静默失效」改成「随自动备份频率触发：备份频率关闭时不会自动推送」；在开关下新增条件提示行——条件 = `status.autoPush === true && useProjectStore config?.backupFrequencyMinutes === null`，文案 = 「当前自动备份频率为「关闭」→ 自动推送不会触发（至少选一个备份频率）」，样式 = `text-xs text-muted-foreground`，**不弹窗、不禁用开关**（`DESIGN.md` 已登记）。
5. 测试：`packages/server/src/cloud/auto-push.test.ts` —— 删掉「备份频率关闭 + 兜底间隔注入 → 仍排程」「备份频率关闭 + 兜底为 null → 不排程」「生产装配……2h tick 真的推一次」三个用例；保留「备份频率开启 → 按频率排程」但去掉 `fallbackIntervalMs` 字段；补 1 个「备份频率关闭 → 不排程（`onTick` 零调用）」。客户端补 1 个条件提示的渲染断言（开/关两态；按现有组件测试的 mock 方式）。

**硬完成判据**（无 commit 不许报 PASS）
- `git log` 含一个新 commit，`git status` 干净。
- `pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm --filter @whispering233/ai-editor-server test` → `pnpm --filter @whispering233/ai-editor-client test` 全部绿。
- `grep -rn "fallbackIntervalMs" packages/*/src` 必须零命中（`dist/` 不算）；`grep -rn "不会静默失效" packages docs` 必须零命中。
- 汇报必附 commit hash + 上述每条命令的输出尾部。

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **测试环境前提**（端口占用会打挂一条环境性用例）：见 `build.md`「本地开发」最后一条。
