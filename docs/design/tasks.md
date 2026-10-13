# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前进行中任务卡

> 契约依据：`docs/api/20-api-backup.md`（restore 流程 + 错误码）、`docs/api/100-api-cloud.md`（pull）、`docs/api/10-api-project.md`（import 覆盖恢复分支）、`docs/api/error-code.md`（`KIND_MISMATCH` 两种情形）、`docs/design/60-practice.md`（周边管道）、根 `AGENTS.md`。**契约已先行更新——卡内不得自行发明口径。**

- [ ] **卡 12 · 覆盖类写包入口的工作区类型校验（d 裁定）**
  - 范围：**两处**（只有这两处会把包写进已存在的工作区）：
    ① `restoreBackup`（`packages/server/src/backup.ts`，`POST /project/backup/restore` 与 `POST /cloud/pull` 共用）——目标 kind = `project.config.kind`；
    ② `POST /project/import` 的 **id 命中覆盖恢复**分支（`packages/server/src/routes/project.ts` 的两个子分支：命中当前打开的书 / 命中未打开的书）——目标 kind = 已拿到的 `dirKind`。
  - 规则：写盘前比较包内 `kind`（`validateBackupPackage` **已返回**该字段，经 shared `resolveWorkspaceKind` 兜底：缺失/未知 → `novel`）与目标 kind；不等 → **400 `KIND_MISMATCH`**（文案「备份包的工作区类型（X）与当前工作区（Y）不符」）且**不写任何三文件**；相等 → 照旧（写回目标 kind）。
  - 依赖：无。
  - 硬完成判据：
    1. **restore**：包内 kind ≠ 当前 kind → 400 `KIND_MISMATCH`，三文件**字节不变**（`sha256` 比对）、练习数据行数不变；
    2. **cloud pull** 同口径（同一函数，至少一条用例，可 mock WebDAV）；
    3. **import id 命中**：两个子分支（命中当前打开 / 命中未打开）各一条 400 用例；相等 → 照旧覆盖且 kind 归一到目标目录；
    4. **旧包（缺 kind）**：→ 小说工作区正常恢复，且盘上**被补写** `kind: "novel"`；→ 练习工作区 → 400；
    5. **新建入口不受影响**：practice 包 → `practice/`；缺 kind → `books/`（既有用例仍绿）；
    6. 命令全绿（先 `pnpm -r build`）：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-server test`、`pnpm -r test`。

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
