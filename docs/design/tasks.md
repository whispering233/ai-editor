# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不再维护批次叙事）；未排期的遗留项进 `backlog.md`；**新发现的小项一律进 `backlog.md`，不即时插队**。

---

## 当前任务卡：云端存档（批次 1，2026-09）

契约依据：`docs/design/40-cloud-sync.md`（为什么与不变式）、`docs/api/100-api-cloud.md`（端点）、`docs/api/20-api-backup.md`（命名与备份端点）、`docs/ui/DESIGN.md` §备份与云端存档、`docs/design/config.md`（cloud.json 载体）。

**全局约束**：

- **卡序即依赖顺序**（4 → 5 → 6 → 7；卡 1、卡 2、卡 3 已完成并通过独立验证，见 `CHANGELOG.md` `Unreleased`）；同一时间只允许一张卡处于实现态（避免多写者冲突）。
- **派工硬要求**（`AGENTS.md`「并行派工的硬要求」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；改 shared/db/tools 的 `src` 后先 `pnpm -r build` 再 typecheck 与下游测试（假绿窗口见 `backlog.md`）。
- **云端的自动化验证环境**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`），测试配置指向它——单测一律 mock `fetch`，集成验证才起真服务。
- **真实云盘（坚果云）验收**：由用户人工执行（步骤清单由卡 4 交付）；**凭据不进任何自动化脚本、不入库**。
- **不改动范围外的东西**：`restore` 的覆盖语义、`project.json` 字段、SSE 契约、antd token 均不得借本批次改动（唯一例外：卡 3 的 `backup-section` 拆分）。

| 卡 | 目标 | 主要交付物 | 完成判据（硬） |
| :--- | :--- | :--- | :--- |
| **4** | **推送**（临时名 + MOVE、体积检查、目录定位、保留清理、状态更新、面板推送按钮） | `server`：`src/cloud/sync.ts` 的 push 流程、`src/cloud/state.ts` 的 `dirName` 缓存与回退扫描、`POST /cloud/push`（含 `force` 分支的下载存档）、`GET /cloud/status` 扩展 remote 段；`client`：面板内「推送」按钮 + 状态展示（推送后刷新）——**状态仍走页内 state**（跨组件共享的左栏按钮到卡 6 才上提 `stores/cloud.ts`）；刷新走 `refresh(false)`（不得重填表单草稿，与卡 3 的 E 修复同源）；设备名「首次保存把当时派生值写进 cloud.json」代价见 `DESIGN.md` | ① 推送后云端出现正式名 zip，`.tmp-*` 无残留（用本地 WebDAV 目录直接看文件）；② 体积超 500MB → 400 `CLOUD_BACKUP_TOO_LARGE`（用构造的大文件测）；③ 保留清理：第 6 份起删最旧、**带标签的份永不删**、非本程序命名的文件不动；④ 冲突时（手工往云端放新份）→ 409 `CLOUD_CONFLICT`；⑤ `cloud.json` 的 `lastPushedFileName` / `lastSyncAt` / `baseEntries` 正确更新；⑥ 单测覆盖冲突判定/清理豁免/回退扫描；⑦ typecheck/lint/test 全绿 + 新 commit |
| **5** | **状态检测 + 拉取**（三态判定、三文件覆盖 + 两目录并集 + 基线更新、面板状态区与云端份列表、拉取确认框） | `server`：`src/cloud/sync.ts` 的 pull 流程与三方比较（六种情形）、`restoreBackup`/`overwriteProjectFiles` 加显式 `mergePackedDirs` 参数（默认关，restore 行为不变）、`GET /cloud/status` 的 local 段与 `state` 判定、`POST /cloud/pull`；`client`：状态区 + 云端份列表 + `cloud-pull-confirm` 对话框 | ① 六种并集情形逐个有测试（本机新增保留 / 云端删除传播 / 本机删除不复活 / 云端新增写入）；② 拉取前本机状态落成 `.backups/` 快照；③ 本地 restore 路径行为逐字节不变（守卫测试）；④ `state` 四态判定正确（已同步 / 本地超前 / 云端超前 / 冲突）——用两套 `cloud.json` + 本地 WebDAV 模拟两台机器；⑤ 拉取后 data.db 重连、备份定时器重启、`baseEntries` 更新；⑥ typecheck/lint/test 全绿 + 新 commit |
| **6** | **冲突裁决 + 左栏「同步云端」按钮**（一键状态机 + 角标） | `client`：`components/nav/NavRail.tsx` 底部四入口、`components/settings/cloud-conflict-dialog.tsx`、`stores/cloud.ts` 一键状态机（跳设置页 / 推送 / 拉取确认 / 裁决 / 提示）；`server`：无新端点（`force` 已在卡 4） | ① 点击按钮在四种状态下行为正确（已同步提示 / 未推改动直接推 / 云端更新弹确认 / 冲突弹裁决 / 未配置跳设置页并选中云端备份）；② 角标只在「有未推改动 / 云端更新 / 冲突」时显示；③ 裁决两条路各留一份备份（用本地 WebDAV 实测：强推后云端旧份仍在本地 `.backups/`）；④ 未配置/未打开项目时按钮禁用或引导正确；⑤ 浏览器核像素一次（含角标浅/深两态）+ 新 commit |
| **7** | **自动推送**（2 小时节流 + 排除纯聊天触发 + 关闭项目尽力推 + 手动备份后立刻推） | `server`：复用现有自动备份 tick 链（不新增第二套定时器）、`cloud.json` 的 `autoPush` 生效、关闭项目路径接入推送（失败只记日志 + 状态标记）、手动备份成功后触发推送 | ① `autoPush` 关闭时任何自动路径都不推；② 打开时纯聊天（只改 `sessions/`）不触发推送，创作数据变更后到点即推；③ 节流：2 小时内的第二次变更不推（常量注入测试）；④ 关闭项目时推送一次（含聊天变更），失败不阻塞关闭且状态区标记；⑤ 手动备份成功后立即推送（不受节流限制）；⑥ typecheck/lint/test 全绿 + 新 commit |

**卡 4 开工前必读（卡 3 oracle 复核提出）**：

1. **store 上提时机**：卡 4 只加 server 端点 + 面板「推送 / 状态」两段；状态仍走**页内 state**，跨组件共享（左栏「同步云端」按钮）在卡 6 才上提 `stores/cloud.ts`——避免卡 4 提前建半成型 store。
2. **`refresh(refill)` 语义复用**：推送 / 拉取后的刷新必须 `refill = false`（不得重填表单草稿）；卡 5 加状态区与云端份列表时沿用该参数。
3. **`.tmp-*` 无残留判据要写清口径**（卡 2 oracle F4）：清理只扫**书目录**，云根那份 `.tmp-*` 不在此列——判据要么限定「书目录内无残留」，要么顺手把云根也纳入扫描。
4. **像素核对顺手一条**（把卡 3 遗留的静态判定升级为实测）：在云端面板改 url → 点「自动推送」开关 → 输入框内容仍在（草稿未被清）。
5. **`path` 语义**：`list()` 返回的 `path` 相对 **base（云盘根）**、不含所列举目录前缀，且已剔除自身条目（卡 2 修复）——回退扫描按 `name` 撞 `-<projectId>` 后缀即可。

**批次完成后的收尾**（单独一步，不占卡片）：`CHANGELOG.md` 写 Unreleased 段 → 清理本文件的任务卡 → 向用户交付坚果云人工验收步骤清单。

---

## 流程备忘（临时，不需要时删）

- 开工：`backlog.md` 选/拆项 → 写入「当前任务卡」→ 实现 → 独立验证 → 卡内行为记录进 `CHANGELOG.md` 的 `Unreleased` 段 → 清卡。
- 发布：`build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）。
