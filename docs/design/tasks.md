# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 卡：服务端口分段隔离（web 生产 / web 开发 / 桌面端互不相交）

**目标**：三形态各自独占端口窗口，任何形态被占用后的 +1 兜底都出不了自己窗口（消除「Vite proxy 静默打到桌面端 server」的串数据路径）；桌面端分段刻意不动（偏好锚）。

**改动范围**

- `shared`：新增 `constants/ports.ts`（`PORT_RANGES` = 三段 base + attempts，唯一定义）+ 聚合出口 + 守卫测试（窗口两两不相交、落在合法端口区间）
- `server`：删 `DEFAULT_PORT` / `MAX_PORT_ATTEMPTS` 字面量 → 由 `PORT_RANGES` 派生（dev 段 = 严格单端口，保持既有「dev 不 +1」）；`StartServerOptions` 新增 `maxAttempts`
- `client`：`vite.config.ts` 的 proxy 目标由 `PORT_RANGES.dev.base` 派生
- `desktop`：显式传 desktop 段的 `port` / `maxAttempts` + `dev: false`（防 shell 的 `NODE_ENV` 误判为 dev 严格模式）；新增 shared 依赖
- `scripts`：`start-test-install.mjs` 文案去掉写死的端口号

**文档**：`build.md`（本地开发 + 端口策略表）/ `50-desktop.md` §1 / `config.md` / `api-public.md` / `README.md` / `AGENTS.md` / `CHANGELOG.md` / `backlog.md`

**硬完成判据**：`pnpm -r build` → `typecheck` → `lint` → `-r test` 全绿；dev 态占用仍直接报错、生产态仍在**自身窗口内** +1；`pnpm dev` 与桌面端可同时起且端口互不干扰；独立 oracle（fresh）复验并附命令输出。

- [ ] 文档同步（已完成）
- [ ] 实现
- [ ] 独立验证（fresh oracle）

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
