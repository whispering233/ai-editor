# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 当前任务卡（安全修复：凭据不得进文件名段）

背景（2026-09-17，用户报告）：设置页「设备名」框收到应用密码后，app 未加阻拦，把它写进本机备份文件名、上传成云端文件名、并在冲突裁决框展示；强推时又把带密码的云端文件名原样拷贝回本机。契约与口径已定稿：`design/40-cloud-sync.md` §7、`api/100-api-cloud.md`、`api/20-api-backup.md`、`design/config.md`。

- [ ] **卡 1：设备名凭据守卫（写入 400 + 读取回退）**
  - 范围：`packages/server/src/cloud/state.ts`（新增 `equalsCredential`；`configuredDeviceName` 读侧回退；`writeCloudConfig` 写侧 400）+ `cloud/state.test.ts`。
  - 验收：`pnpm --filter @whispering233/ai-editor-server test`；写侧 400 且零落盘；读侧坏值 → `configuredDeviceName() === null` 且 `currentDeviceName() === defaultDeviceName()`。
  - commit：`fix(cloud): 设备名不得等于应用密码（写侧 400 + 读侧回退 hostname）`
- [ ] **卡 2：备份标签凭据守卫（写 + 改名两入口）**
  - 范围：`packages/server/src/backup.ts`（`assertNotCredential`；`writeBackup` 与 `renameBackup` 两处调用）+ `backup.test.ts`。
  - 验收：标签 == 应用密码 → 400 且不产出/不改名；普通标签照常；trim 口径生效。
  - commit：`fix(backup): 备份标签不得等于应用密码（写/改名两入口 400）`
- [ ] **卡 3：收口（回归 + CHANGELOG + 清卡）**
  - 验收：`pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` 全绿；`CHANGELOG.md` `[Unreleased]` 登记；本文件卡片清掉。
  - commit：`docs(changelog): 登记凭据不得进文件名段的安全修复`

---

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**改桌面版主进程后额外跑打包态启动冒烟**（`build.md`，`typecheck` 绿 ≠ 打包态能起）。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
