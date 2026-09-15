# 运行、构建、打包与部署（build）

> 本地开发/构建/发布手册（**正式发布纪律的单一事实来源**——版本号同步、tag、CI 触发条件、npmjs 前置与脚本约束）；配置项总览见 `config.md`。

## 运行环境

Node ≥ 22.12（engines 声明；CI 用 22）、**全仓 ESM**、pnpm 由根 package.json `packageManager: "pnpm@11.22.0"` 钉版本（CI `pnpm/action-setup` 同版本——两侧必须一致，不一致 publish.yml 报 Multiple versions）。pnpm-workspace.yaml `allowBuilds` 至少含 `better-sqlite3`/`esbuild`/`@google/genai`/`protobufjs`；引入新的原生/含 postinstall 的依赖时按 pnpm 安装提示补充批准项。

⚠ **fresh clone 后先 `pnpm -r build` 再 `pnpm typecheck`**——`dist/` 不入库（gitignore），`@whispering233/ai-editor-*` 的 `types`/`exports` 指向 `./dist/index.d.ts`，不先构建则 tsc 报 TS2307。

**桌面版运行时**：`electron` **44.3.0 exact pin**（内置 Node 24.18.1——同时满足 better-sqlite3 v13 的 Node-API 10 门槛（Node ≥ 22.14）与 pi 的 `engines: node >= 22.19`）；打包用 electron-builder。升级 = 一个显式 commit 抬版本 + 三平台重打包验证（同 pi 依赖纪律）。

## 本地开发

```
pnpm dev            # pnpm -r --parallel run dev
  packages/client:  Vite dev server (port 5173) → proxy /api → :3456
  packages/server:  NODE_ENV=development tsx watch src/index.ts（默认 :3456）
  shared/db/tools/agent: tsc --watch
```

- dev 态端口被占**直接报错**（不自动 +1）——Vite proxy 写死 3456，自动 +1 会造成 proxy 与实际监听不一致（与生产态行为不同）。
- Vite proxy 无需 changeOrigin（转发后 Origin/Host 端口为 5173；来源校验不校验端口，见 api-public.md）。
- 质量门：`pnpm typecheck` / `pnpm lint`（ESLint 9 flat config + typescript-eslint）/ `pnpm test`（vitest；单包 `pnpm --filter <包> test`）。
- ⚠ **跨包测试的 dist 陷阱（2026-09 实测踩坑）**：`server` 测试经 `@whispering233/ai-editor-tools` 的 **dist** 消费、`tools` 经 `db` 的 dist 消费——改了上游包的 `src` 而不重建，下游套件会**对着旧实现给出假绿灯**（曾导致一张卡的「锚点仅章」守卫在 tools 测试里绿、server 里实际 2 条 fixture 已废却未暴露）。**约定**：凡改动 shared/db/tools 的 `src`，跑下游测试前先 `pnpm --filter @whispering233/ai-editor-db build && pnpm --filter @whispering233/ai-editor-tools build`（或直接用 `pnpm test:packed` 级别的全量重建）。
- 日常联调用仓库内 `test-project/`（运行时数据不入库）。

**桌面版开发**（两步并行，与现有 dev 共存——窗口指向 Vite，HMR 照常）：

```
pnpm dev                                  # client(5173) + server(3456) + 各包 tsc --watch
pnpm --filter @whispering233/ai-editor-desktop dev   # electron：窗口加载 5173（主进程内不启 server）
```

- 桌面版 dev 态窗口指向 Vite（`http://127.0.0.1:5173`），API 经 Vite proxy 打到 3456——**不在 Electron 里另起一套 server**，否则与 dev server 争端口。
- `dev` 态必须能跑：Electron 主进程 ESM 入口 + `preload.cts`（沙箱 preload 不支持 ESM，见 `50-desktop.md` §3）。
- 用户数据（`<userData>/desktop.json` 与日志）在 dev 态落在**开发态 Electron 的 userData**（`app.getName()` 同源），与安装态隔离。

## 启动流程（生产态 / 单命令部署）

```
node packages/server/dist/index.js [projectRoot]   # 或安装态 npx ai-editor <目录>
```

- `projectRoot` = 创作根（缺省 process.cwd()）。
- `detectProject`：根自身有 `project.json` → 打开（旧单项目部署兼容）；**无 → 读 `<创作根>/.ai-editor/config.json` 的 `lastProject`**（上次 open 成功的目录绝对路径）→ 该目录仍含 `project.json` 则直接打开（「开机回到上次那本书」）；路径已被删除/移动、`project.json` 损坏不可读 → **静默回待命**（书架页）。**打开/迁移失败（含未来版本库、data.db 损坏）→ 记日志 + 回待命**（与「宁回书架也不让坏数据把服务起不起来」语义一致；未来版本另有明确文案）——**绝不静默重建/删库**。开始/显式 open 均走**同一条开放管道**（迁移前快照、无路径删库重建、未来版本拒绝三态一致）。两者皆空 → 待命（不初始化、不建任何文件，前端引导 create/open）。
- 书架模式：创建书 = `创作根/books/<书名>/` 子目录（三数据文件）；`GET /api/v1/project/list` 扫描列书（待命态可用）。
- 端口：默认 **3456**，占用时生产态自动 +1 递增（上限 20 次，3456→3475）并打开实际端口；可用环境变量 `AI_EDITOR_PORT` 覆盖（仅 bin 直接执行入口读取，测试/多实例场景用）。
- **绑定与访问**：默认绑定 `127.0.0.1`（不对外网开放）；提示 URL / 打开浏览器一律用 `127.0.0.1` 而非 `localhost`（IPv6 优先系统上 localhost 可能解析为 `::1` 导致连接被拒）。
- SPA：`defaultClientDist` 双路径（monorepo 开发态 `../../client/dist` / 打包安装态包内 `client-dist`）挂载为 fallback；单进程 Hono 同时服务 `/api/v1` 与静态文件。
- 本地看界面：`pnpm start:test-project`（= `pnpm -r build` + 生产态启动 test-project，自动打开浏览器）。
- 调试日志：创作根 `.ai-editor/config.json` 的 `debug` 段（chat/request/usage/http 四类别；纯配置文件无 env 开关），见 config.md。
- 客户端首帧：服务端已代为先打开了上次的书 → 前端首帧若落在书架路由（`#/`）则直接进该书概览（`#/overview`）；点左栏顶部「书架」本身不弹回（仅首帧判定一次）。

## 构建与打包

```
pnpm -r build       # 按依赖序：shared → db → tools → agent → server → client（vite build，独立）
pnpm pack:test      # 构建 + 5 包 pack + npm 安装到 /tmp 测试目录（AI_EDITOR_PACKS_DIR / AI_EDITOR_TEST_DIR 可覆盖）
pnpm start:test     # 启动安装态服务
pnpm test:packed    # 一键串联（backlog #8 打包安装测试：tarball 安装态冒烟）
```

### 桌面版（electron-builder）

```
pnpm --filter @whispering233/ai-editor-desktop build   # tsc：主进程 ESM + preload CJS（一个 tsconfig，.cts）
pnpm --filter @whispering233/ai-editor-desktop start   # 开发：构建后 electron .（in-process 起 server）
pnpm desktop:dist                                      # 全仓构建 + pnpm deploy --legacy + electron-builder（供 CI 用）
```

- **打包三段**：`pnpm -r build` → `pnpm --filter <desktop> deploy --prod --legacy packages/desktop/.deploy/app` → `electron-builder --config electron-builder.yml`（封装在 `packages/desktop/scripts/pack.mjs`）。`--legacy` 不可省（pnpm 11 默认拒结非 injected workspace），`electron-builder.yml` 里 `npmRebuild: false` + `linux.executableName` 不可省（原因见 `50-desktop.md` §5 实测栏）。
- **首次装 electron 二进制可能很慢**（从 GitHub 下载 ~100MB）：可临时给环境变量 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_CUSTOM_DIR='{{ version }}'`（**不写进仓库配置**——CI 与其他开发者的拉取源不应被改写）。
- **原生模块**：`asarUnpack` 放 `**/*.node`，产物在 `release/linux-unpacked/resources/app.asar.unpacked/`。
- **平台矩阵**：win-x64（nsis）/ mac-arm64 + mac-x64（dmg）/ linux-x64（AppImage）。首版**不签名**（macOS 首次需右键打开、Windows 有 SmartScreen 提示——README 写明），因此也**不做自动更新**（electron-updater 在 macOS 要求已签名）。
- **本地占用**：`.deploy/`（依赖部署，约 220MB）与 `release/`（含 AppImage ~158MB）均不入库（gitignore）；`pack.mjs` **在 finally 里清 `.deploy`**——留在 workspace 内会让 pnpm 的依赖状态检查误判（`.deploy/app` 是 workspace 外的 package.json + node_modules，之后任何 `pnpm` 脚本都会报「需重建 modules 目录」而中止）。
- **CI 影响**：`publish.yml` 的 `pnpm install --frozen-lockfile` 现会连带拉 electron 二进制（~100MB，仅 tag 触发，不阻塞日常）；桌面安装包由独立的 `desktop.yml` 出（见下）。
- **验收硬判据**（K0 已过，回归时重跑）：① 主进程能 load better-sqlite3 并建库；② 产物含 `*.node` 且能起服务；③ 打包体启得起窗口（CDP 可读 `window.aiEditorDesktop`）。

发布脚本链：`scripts/sync-version.mjs`（`pnpm release:version X.Y.Z` 同步版本，只改 version 字段）、`scripts/publish-packages.mjs`、`scripts/verify-installed.mjs`（发布后冒烟：先 `npm view` 轮询 5 包 registry 可见，再 mkdtemp 安装并断言 version/`.bin/ai-editor`/短时启动输出「服务已启动」）。

## 正式发布链路

**发布形态**：5 个包（shared/db/tools/agent/server）全部发布 npm；用户只装 `@whispering233/ai-editor-server`（bin `ai-editor`），其余 4 个包由 npm 自动拉取；`client` 保持 private 不发布（SPA 构建产物随 server 包分发）。发布链路是本仓唯一的 CI（`.github/workflows/`，仅 push `v*` tag 触发）。

**桌面版与 npm 同一 tag 发布**：`.github/workflows/desktop.yml` 与 `publish.yml` 同触发（push `v*` tag），三平台 matrix 产出安装包并挂到该 tag 的 GitHub Release；版本号与根 `version` 同源（`release:version` 一并同步 `desktop` 的 `version` 与 electron-builder 的 `buildVersion`）。⚠ tag 纪律同下（一次只推一个 tag）。

```
1. 更新根 CHANGELOG.md：把 Unreleased 条目搬运为新版本段（## [vX.Y.Z] - <日期>）
2. pnpm release:version X.Y.Z（--dry-run 预览）——同步 5 个发布包 + client + 根 package.json 版本
3. git add -A && git commit -m "chore(release): bump version to vX.Y.Z"
4. git tag -a vX.Y.Z -m "vX.Y.Z"（手动 annotated tag，轻量 tag 不触发发布规范）
5. git push origin main && git push origin vX.Y.Z
   ⤷ 纪律：tag 永远单独一条 push 命令，**不要攒着补推**（`--tags` / `--follow-tags` 一次新建 >3 个 tag
     时 GitHub 丢弃 tag 事件 → workflow 静默不跑，tag 本身却推上去了；详见「发布管道坑记录」）
   ⤷ 自检（返回 0 = 事件被吞，按「发布管道坑记录」删 tag 后再单独推恢复）：
     gh api "repos/whispering233/ai-editor/actions/runs?head_sha=$(git rev-parse vX.Y.Z)" --jq .total_count
→ CI（.github/workflows/）：release.yml 从 CHANGELOG.md 按 tag 建 GitHub Release；
  publish.yml 5 包 npm 发布（OIDC Trusted Publisher）+ verify-installed 安装态冒烟
```

脚本约束（`scripts/publish-packages.mjs`）：依赖序硬编码 shared → db → tools → agent → server；每包先 `npm view <name>@<version>` 判重（**仅 E404 视为未发布**，网络错误直接中止）——重跑幂等安全；`npm pack` 后 `tar -xOf` 断言包内 package.json 无 `workspace:` 残留；`GITHUB_REF=refs/tags/vX.Y.Z` 时校验 tag 与包版本一致（不一致中止，防漂移误发）。本地验证链路（pack 安装冒烟）见上节 `pnpm pack:test` / `pnpm test:packed`。

前置（一次性，npmjs）：账号开 2FA；5 个发布包各配置 Trusted Publisher（GitHub Actions / whispering233/ai-editor 仓库 / publish.yml 工作流）。**token 能力边界（2026-09-11 实测修订）**：本仓 granular token **可以执行 `npm deprecate`**（实测 10 条成功、无需 OTP）；被拒的是账号/组织/设置类操作（`npm profile get` → 403，npm 2026-07-31 起限制 bypass-2FA token 的设置类操作）。`unpublish` 未实测（不可逆）——官方文档仍列为需 2FA 的敏感操作，真要 unpublish 请备好 `--otp`。2027-01 起 bypass-2FA token 将失去直接发布能力，本仓已用 OIDC Trusted Publisher 不受影响。

## 变异/探针验证的安全姿势（2026-09 实测踩坑）

验证代理（oracle）常需“改坏代码看测试是否咬人”，**禁止在仓库内做硬链接副本后用就地截断写**：

- `/tmp` 与仓库常不在同一文件系统 → `cp -al` 会产生**空副本**；
- 改用同文件系统的硬链接副本后，Python `open(path,"w")` / 多数脚本的**就地截断写会写穿 hardlink**（同一 inode）→ **污染源仓库**（真实发生：一次变异把 `if (false && …)` 写进了 `packages/tools/src/proposal/delta.ts`，靠 `git checkout --` 恢复）。

**安全姿势（择一）**：① `cp -r` 真副本 + 软链 `node_modules`；② `git worktree add /tmp/... <ref>`（然后装依赖/软链）；③ 只把待变异文件复制到 `/tmp` 后用 `git stash` 手段对照。变异后恢复必须**复跑全量回归**再报告结论。

## 发布管道坑记录（供后续发布参考）

- npm 12 publish 在 postpack 恢复后生成 registry manifest → prepack 替换只影响 tarball（manifest 残留 `workspace:*`，`npm install` 报 EUNSUPPORTEDPROTOCOL）→ 发布前主动替换 + `--ignore-scripts`
- CI node 22 自带 npm 10.9.8 **不支持 OIDC 发布认证** → CI `npm install -g npm@latest`
- npm 12 发布自动生成 sigstore provenance，npmjs 校验 manifest `repository.url` 一致（E422）→ 各包补 `repository` 字段
- setup-node 注入占位 `NODE_AUTH_TOKEN` 优先于 OIDC → 发布前 `delete process.env.NODE_AUTH_TOKEN`
- registry 文档缓存传播延迟（dist-tags 即时、`npm view`/install 短暂 404/ETARGET）→ verify-installed 先 `npm view` 轮询 5 包可见（20×30s = 10 分钟窗口）再 install
- **一次 push 新建 tag >3 个 → GitHub 丢弃 tag 事件**（官方文档 push 事件：「Events will not be created for tags when more than three tags are pushed at once.」；`create` / `delete` 事件同限）。2026-09-15 实证：`git push --tags` 补推积压的 4 个 tag → 远端 tag 全在、Actions 零 run、npm 无版本（删除其中 v0.0.38 后单独重推，Publish + Release 立即触发并发布成功）。**纪律**：发布只走 `git push origin main && git push origin vX.Y.Z`，tag 不积压、不用 `--tags`/`--follow-tags` 批量补。**恢复**：远端已有的 tag 重推是 no-op（不产生事件），必须先删再推，且一个 tag 一条命令——删 tag 不占「新建」额度、只删不建也不会触发：

  ```bash
  git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z   # 分两条命令最稳
  gh api "repos/whispering233/ai-editor/actions/runs?head_sha=$(git rev-parse vX.Y.Z)" --jq .total_count  # >0 = 已触发
  ```

- 发布方式细节：发布前主动执行 copy-client-dist（server 的 SPA 随包）+ prepare 替换 workspace:*，然后 `npm publish --access public --ignore-scripts`（跳过 prepack/postpack 钩子），发布后 finally 主动 restore 恢复
