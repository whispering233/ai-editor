# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 文风仿写练习 · 批次 0（地基）

> 契约依据：`docs/design/60-practice.md`、`docs/design/00-master-design.md`（工作区抽象）、`docs/design/architecture.md`（kind 与能力收窄）、`docs/db/schema.md`（两张练习表）、`docs/api/120-api-practice.md`、`docs/ui/DESIGN.md`（根首页分区 / 文风练习区）。**契约已先行更新——卡内不再自行发明口径，发现矛盾先停下提问。**

## 批次 1（练习业务面）

## 批次 2（UI）

## 批次 3（收尾）

- [ ] **卡 11 · 导出 / 删除 / 备份在练习工作区上的口径 + 冒烟**
  - 范围：根首页导出弹窗按 kind 隐藏「小说文档」项（服务端已有 `KIND_MISMATCH`）；删练习工作区走既有 `/project/delete`（含云前置推送与目录约束）；确认备份文件名统计段在练习工作区自然为 `0-0-0`（`getBackupStats` 空库口径）且不做特殊分支；启动冒烟；**同步 `README.md` 的根首页 / 左栏描述 + 工具条数复述**（README 描述产品当前状态，不提前改；「37 个 LLM 可见工具」已不等于 registry 实数）。
  - 依赖：卡 3、8。
  - 硬完成判据：练习工作区导出三文件包成功、`export-novel` → 400；删练习工作区后书架/根首页刷新正确；练习工作区自动备份产出的文件名可被解析（格式未变）；`pnpm -r test` 全绿。

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
