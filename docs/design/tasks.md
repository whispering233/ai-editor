# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 文风仿写练习 · 批次 0（地基）

> 契约依据：`docs/design/60-practice.md`、`docs/design/00-master-design.md`（工作区抽象）、`docs/design/architecture.md`（kind 与能力收窄）、`docs/db/schema.md`（两张练习表）、`docs/api/120-api-practice.md`、`docs/ui/DESIGN.md`（根首页分区 / 文风练习区）。**契约已先行更新——卡内不再自行发明口径，发现矛盾先停下提问。**

## 批次 1（练习业务面）

- [ ] **卡 7 · 点评链路（`/chat` 注入 + 卡片下发 + 落库）**
  - 范围：`chatRequestSchema.context.practice_sample_id`；服务端现读目标名 + `observation` 注入本轮（**不接受客户端传入观察文本**）；样本不存在静默省略；卡片随 `tool_execution_end` 的 `details` 下发（**本卡不含 UI**：前端即时渲染与刷新从 `GET /practice/samples/:id` 读归卡 10）。
  - 依赖：卡 5、6。
  - 硬完成判据：**SSE 帧集零新增**（与 `docs/api/80-api-chat.md` 一致）；一轮后 `feedback` 已落库；重载后卡片仍在（服务端口径：`GET /practice/samples/:id` 回该卡；渲染归卡 10）；注入文本含目标名与观察、**不含范文/稿件全文**（断言）。
  - 承接事实（卡 4 oracle 登记）：注入段**只给事实**（目标名 / `observation` / 样本 id），「必须提交点评卡」这类指令语义留在**练习内核提示词常量**里——两处各写一份口径 = 第二事实源。
  - 承接事实（卡 5 oracle 登记）：`feedback` 在响应里**原样透传**（内层 snake_case 不转换、合法 JSON 对象连 `{}` 也照发）——`practiceSampleDetailResSchema` **只作类型用，禁止对它调 `.parse()`**（`{}` 会被必填字段判失败、未知键会被剥）。

## 批次 2（UI）

- [ ] **卡 8 · 根首页分区 + 新建弹窗 kind + 左栏按 kind**
  - 范围：`#/` 两分区（小说 / 文风练习，空分区给引导文案）；新建弹窗加 kind；NavRail 按 kind 渲染项集与顶部标识文案（练习 = 顶部「文风练习」+ 一级导航「文风练习」+ 无回收站）；练习工作区下 novel 页面路由不可达。
  - 依赖：卡 1。
  - 硬完成判据：浏览器像素核对（`ui-verifier` 子代理）：两个分区可见、当前工作区高亮按 id、练习工作区左栏无八项导航、无控制台报错。
- [ ] **卡 9 · 练习列表页（`#/practice`）**
  - 范围：目标分组 + 样本行（来源说明 / 状态徽标 / 相对时间）+ 新建目标 / 新建样本弹窗 + 空态；页头常驻模板。
  - 依赖：卡 5、8。
  - 硬完成判据：浏览器核对：建目标 → 建样本 → 列表出现且状态徽标随稿/点评变化；空态文案可见。
- [ ] **卡 10 · 练习页（`#/practice/:sampleId`）**
  - 范围：范文（只读）→ 我的稿（`TextArea`，间接引用 `--writing-*`，不引 `--paper-bg`）→ 点评卡；保存按钮 + `Ctrl/Cmd+S`（接入既有注册栈，失败 `return false`）；「让 AI 点评」按钮（`POST /chat` + `context.practice_sample_id`）。
  - 点评卡的数据面：**消费 `tool_execution_end` 帧的 `details`**（`submit_style_feedback` 的写库结果，AUTO 工具的唯一非提案例外）即时刷新；**刷新/重载从 `GET /practice/samples/:id` 读卡体**（帧里只有写库结果，没有卡体）。
  - 依赖：卡 7、9。
  - 硬完成判据：浏览器核对：三段几何（页头常驻、正文区可滚）；`Ctrl+S` 触发保存（失败路径阻断存档）；点评后卡片即时出现且重载仍在；窄幅下不溢出。

## 批次 3（收尾）

- [ ] **卡 11 · 导出 / 删除 / 备份在练习工作区上的口径 + 冒烟**
  - 范围：根首页导出弹窗按 kind 隐藏「小说文档」项（服务端已有 `KIND_MISMATCH`）；删练习工作区走既有 `/project/delete`（含云前置推送与目录约束）；确认备份文件名统计段在练习工作区自然为 `0-0-0`（`getBackupStats` 空库口径）且不做特殊分支；启动冒烟；**同步 `README.md` 的根首页 / 左栏描述 + 工具条数复述**（README 描述产品当前状态，不提前改；「37 个 LLM 可见工具」已不等于 registry 实数）。
  - 依赖：卡 3、8。
  - 硬完成判据：练习工作区导出三文件包成功、`export-novel` → 400；删练习工作区后书架/根首页刷新正确；练习工作区自动备份产出的文件名可被解析（格式未变）；`pnpm -r test` 全绿。

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
