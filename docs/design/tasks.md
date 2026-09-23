# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡 1：角色优先级——数据与契约层（实现完成，待 oracle 验证）

**实现**：commit `d99056b`（含 supervisor 批准的范围追加：`IMMUTABLE_FIELDS` 与 client 字段注册耦合——只加常量会让 client 穷尽断言与新建弹窗硬红，故 card 内一并落 `FieldControl` 的 `select` 分支、`isSingleLineField` 纳入 select、character 字段行与 `CHARACTER_DETAIL_FIELD_KEYS` 登记，避免渲染成文本框的坏中间态）。

**已交付**：`CHARACTER_PRIORITIES`（4 档有序）+ 标签映射 + rank 派生、`characterDataSchema.priority`、`IMMUTABLE_FIELDS.character += priority`、`entityListQuerySchema.sort += priority`、db `listEntities` 的 `priority` 排序档（JSON 提取 + 常量派生 CASE、未分级/脏值沉底、固定升序）、detail 字段行与 select 控件分支。

**待验证（oracle）**：单源无第二份表 / 排序四条语义（已分级、未分级与脏值沉底、同级 updated_at 降序、非 character 不报错）/ 清空走 `null` 且 `""` 被 400 / 卡内无越界改动 / 全套命令真跑过。

## 卡 2：角色优先级——rail 默认排序档

**依赖**：卡 1（服务端排序就绪）。

- **client**：`RAIL_SORT_OPTIONS` 加「角色优先级」（`priority:asc`）并置**默认档**；`RAIL_DEFAULT_SORT` / `resolveRailSort` 脏值回落随第一项；旧三档（最近更新 / 名称 / 创建时间）保留、手动切档行为不变；不新增排序持久化。
- **验收**：单测（默认档值、resolveRailSort 映射、旧档仍在）+ 浏览器核对默认排序表现（主角在前、未分级沉底）；证据 = commit hash + 命令输出摘录 + `git status` 干净。

## 卡 3：角色优先级——AI 工具说明（单源插值）

**依赖**：卡 1（常量就位）。

- **tools**：`propose_create_entity` / `propose_update_entity` 的参数说明按 shared 常量**插值**列出档位取值与「未分级 = 省略或 `null`」（**禁止在 description 里复述字面量**）。
- **验收**：单测断言 description 的档位文案与常量同值（改常量 → 测试即时报红）；证据同上。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
