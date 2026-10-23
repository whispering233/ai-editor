# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 卡 2：pi-durable 评估结论落档（backlog 一条，结论 = 不采纳）

**落档位置**：`docs/design/backlog.md` 的 `## AI / 产品能力` 段末尾（若判定更像「有意保留」则进 `## 有意保留`，须在汇报里说明选择理由）。

**条目须包含**（≤ 8 行，沿用 backlog 现有 `- **标题（日期 + 结论）** — 现状：… 触发条件：…` 形状）：

1. `@earendil-works/pi-durable` 是 pi 同线的**平行内核**（Harness / Conversation / Entry / Commit / Task / Storage；依赖 `chord` + `pi-ai` + `pi-codemode` + `pi-telemetry`，**不依赖 `pi-coding-agent`**），README 自述 Experimental（API 随发布变）。
2. 本仓会话 = pi session v3 文件；历史面板 / `message-projection.ts` / `events.ts` / `usage.ts` / `speed.ts` 全长在 `AgentSessionEvent` 上 ⇒ 换内核 = 上述全部重写 + `packages/tools` 装配换一套，并重新引入 pi-coding-agent 1.2.0 已移除的 `chord`。
3. 收益错配：durable 的核心价值是「进程死掉从 checkpoint 继续」，而本仓数据都在 `data.db`、AI 产出是带 TTL 的提案、会话丢失代价 = 重发一句话。
4. **保留事实**：`ModelRuntime implements Models` 且 `HarnessOptions.models: Models` ⇒ 将来接入时凭据/配置唯一入口不必重做。
5. **重新评估触发条件**：出现「后台长任务」（定时批量分析、跨会话编排、进程可被驱逐的托管形态）且现有备份 tick 链 / 提案机制无法承载时。

**禁止**：写「如果换了会怎样」的假设性迁移方案；抄 README；把结论写成待办。
**验收**：条目不含卡号/批次号；引用的路径真实存在（逐个 `ls` 核实）；`git log` 含新 commit；`git status` 干净。

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **测试环境前提**（端口占用会打挂一条环境性用例）：见 `build.md`「本地开发」最后一条。
