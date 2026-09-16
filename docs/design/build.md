# 运行、构建、打包与部署（build）

> 本地开发/构建/发布手册（**正式发布纪律的单一事实来源**——版本号同步、tag、CI 触发条件、npmjs 前置与脚本约束）；配置项总览见 `config.md`。

## 运行环境

Node ≥ 22.12（engines 声明；CI 用 22）、**全仓 ESM**、pnpm 由根 package.json `packageManager: "pnpm@12.4.2"` 钉版本（CI `pnpm/action-setup` 读同一字段——两侧天然一致）。pnpm-workspace.yaml `allowBuilds` 至少含 `better-sqlite3`/`esbuild`/`@google/genai`/`protobufjs`；引入新的原生/含 postinstall 的依赖时按 pnpm 安装提示补充批准项。

⚠ **fresh clone 后先 `pnpm -r build` 再 `pnpm typecheck`**——`dist/` 不入库（gitignore），`@whispering233/ai-editor-*` 的 `types`/`exports` 指向 `./dist/index.d.ts`，不先构建则 tsc 报 TS2307。

**桌面版运行时**：`electron` **44.3.0 exact pin**（内置 Node 24.18.1——同时满足 better-sqlite3 v13 的 Node-API 10 门槛（Node ≥ 22.14）与 pi 的 `engines: node >= 22.19`）；打包用 electron-builder。升级 = 一个显式 commit 抬版本 + 重打包验证（本地 Linux 包 + CI Windows 包）+ 全量测试（同 pi 依赖纪律）。

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
pnpm --filter ai-editor-desktop dev   # electron：窗口加载 5173（主进程内不启 server）
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
pnpm --filter ai-editor-desktop build   # tsc：主进程 ESM + preload CJS（一个 tsconfig，.cts）
pnpm --filter ai-editor-desktop start   # 开发：构建后 electron .（in-process 起 server）
pnpm desktop:dist                                      # 全仓构建 + pnpm deploy + electron-builder（**当前平台**）
```

- **分工（2026-10 定）**：**本地只打 Linux 包做测试**（`pnpm desktop:dist` → `packages/desktop/release/`）；**Windows 包由 CI 出**（`desktop.yml` 的 windows-latest）。原因：electron-builder 在 Linux/WSL 交叉构建 Windows 目标需 **Wine**（官方口径：`--win nsis` 与 portable 都要，exe 元数据/图标写入要跑 Windows 工具），本仓不为打包往开发机装 1GB 级依赖；macOS 同理必须 mac runner。
- **本地拿 Windows 包验**（不推 tag、不碰 Release）：手动触发 workflow → 下载 CI artifact：

  ```bash
  gh workflow run desktop.yml --ref main -f release_tag=vX.Y.Z   # 手动触发（release_tag 仅决定资产挂到哪个 Release）
  gh run download <run-id> -n desktop-windows-latest -D /tmp/win-pkg
  ```

- **CI 出包范围（2026-10 起）**：只出 **Windows** 包；macOS/Linux 的 matrix 项**注释保留**，将来有真实用户需求再取消注释恢复三平台（GitHub runner 侧无额外成本，只是每次发版多跑两个 job）。`workflow_dispatch`（输入 `release_tag`）既是补包入口、也是手动出包入口。**每版的 Windows 资产 = 三件套**：`.exe` + `latest.yml` + `.exe.blockmap`（自动更新用；三样的各自作用见下一条）。

- **打包三段**：`pnpm -r build` → `pnpm --filter <desktop> deploy --prod packages/desktop/.deploy/app` → `electron-builder --config electron-builder.yml`（封装在 `packages/desktop/scripts/pack.mjs`）。`electron-builder.yml` 里 `npmRebuild: false` + `linux.executableName` 不可省（原因见 `50-desktop.md` §5 实测栏）。
- **自动更新的元数据（三资产缺一不可，2026-10）**：`electron-builder.yml` 的 `publish` 段（provider github + owner/repo）是两份元数据的前提——包内 `resources/app-update.yml`（更新器读它定位更新源，本地 `pnpm desktop:dist` 后可断言存在）与 Release 资产 `latest.yml`（版本 + sha512，**旧版靠它才知道有新版本**）；`.exe.blockmap` 供差分下载。`pack.mjs` 对 electron-builder 显式传 `--publish never`：**上传唯一路径 = `softprops/action-gh-release`**（两条上传路径会打架，且 CI 没有 GH_TOKEN 可交给 electron-builder）。验收口径：本地打包断言 `app-update.yml` 存在且含 owner/repo 与 `updaterCacheDirName: ai-editor-desktop-updater`；CI 包断言三资产齐全且 `latest.yml` 里的 `url` 与资产名一致（GitHub 资产名会把空格换成点：`AI.Editor-x.y.z-win-x64.exe`）。
- **真机更新验证（两版闭环，只能人工）**：发 vX（首个带更新能力的版本）→ 真机装 `AI.Editor-vX-win-x64.exe` → 发 vX+1（确认三资产已挂在 Release）→ 启动 vX：应弹「新版本 vX+1 已下载」→ 点「立即重启安装」→ 重启后 菜单 → 帮助 里的版本号应为 vX+1。⚠ **老版本（无更新器）不可能自动升上来**，这一跳必须手动装一次；日志看 `<userData>\logs\ai-editor.log`。
- **Electron 二进制不再随 install 下载**（Electron 42+ 移除 postinstall，改懒下载）：`pnpm install` 不碰二进制；开发态首次 `pnpm --filter <desktop> start` 会打印 `Downloading Electron binary...` 并下载（此时才需要 `ELECTRON_MIRROR`）；打包时 electron-builder 自行下载所需二进制。`ELECTRON_SKIP_BINARY_DOWNLOAD` 已失效，手动预下载用 `pnpm --filter <desktop> exec install-electron --no`。
- **首次装 electron 二进制可能很慢**（从 GitHub 下载 ~100MB）：可临时给环境变量 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_CUSTOM_DIR='{{ version }}'`（**不写进仓库配置**——CI 与其他开发者的拉取源不应被改写）；该变量只在开发态首次启动（懒下载）与 `install-electron` 手动预下载时生效。
- **原生模块**：`asarUnpack` 放 `**/*.node`，产物在 `release/linux-unpacked/resources/app.asar.unpacked/`。
- **平台矩阵**：win-x64（nsis，`oneClick: false` 让用户能选安装目录）/ mac-{arm64,x64}（dmg）/ linux-x64（AppImage）。**不签名**（macOS 首次需右键打开、Windows 有 SmartScreen 提示——README 写明）：`mac.identity: null` 显式关签名，否则 CI 在 macOS runner 上会尝试签名而失败。**Windows 自动更新不受此影响**（更新器在 `publisherName` 为空时跳过 Authenticode 校验，见 `50-desktop.md` §5.2）；macOS 自动更新才以签名/公证为硬前置。
- **本地占用**：`.deploy/`（依赖部署，约 220MB）与 `release/`（含 AppImage ~158MB）均不入库（gitignore）；`pack.mjs` **在 finally 里清 `.deploy`**——留在 workspace 内会让 pnpm 的依赖状态检查误判（`.deploy/app` 是 workspace 外的 package.json + node_modules，之后任何 `pnpm` 脚本都会报「需重建 modules 目录」而中止）。
- **CI 影响**：`publish.yml` 的 `pnpm install --frozen-lockfile` 现会连带拉 electron 二进制（~100MB，仅 tag 触发，不阻塞日常）；桌面安装包由独立的 `desktop.yml` 出（见下）。
- **验收硬判据**（K0 已过，回归时重跑）：① 主进程能 load better-sqlite3 并建库；② 产物含 `*.node` 且能起服务；③ 打包体启得起窗口（CDP 可读 `window.aiEditorDesktop`）。

发布脚本链：`scripts/sync-version.mjs`（`pnpm release:version X.Y.Z` 同步版本，只改 version 字段）、`scripts/publish-packages.mjs`、`scripts/verify-installed.mjs`（发布后冒烟：先 `npm view` 轮询 5 包 registry 可见，再 mkdtemp 安装并断言 version/`.bin/ai-editor`/短时启动输出「服务已启动」）。

## 正式发布链路

**发布形态**：5 个包（shared/db/tools/agent/server）全部发布 npm；用户只装 `@whispering233/ai-editor-server`（bin `ai-editor`），其余 4 个包由 npm 自动拉取；`client` 保持 private 不发布（SPA 构建产物随 server 包分发）。发布链路是本仓唯一的 CI（`.github/workflows/`，仅 push `v*` tag 触发）。

**桌面版与 npm 同一 tag 发布**：`.github/workflows/desktop.yml` 与 `publish.yml` / `release.yml` 同触发（push `v*` tag），**当前只跑 windows-latest**（`pnpm -r build` + `node packages/desktop/scripts/pack.mjs --win nsis`），产物经 `softprops/action-gh-release` 挂到该 tag 的 Release（Release 通常已由 `release.yml` 建好，此 action 只挂资产），并额外上传 CI artifact（`desktop-windows-latest`）供本地下载验。挂的资产是**三件套**（`.exe` + `latest.yml` + `.exe.blockmap`）——**缺 `latest.yml` ⇒ 所有旧版的检查更新直接失败**，缺 blockmap 只损失差分带宽；用 `workflow_dispatch` 手动补包时同样必须补齐三样（同名资产会覆盖）。**workflow 一律不写 pnpm `version`**——版本从根 `package.json` 的 `packageManager` 读（单一事实源；写死会在升级时静默漂移：2026-10 升 pnpm 12.4.2 时 `publish.yml` 实际残留 `11.22.0`，已改）。⚠ tag 纪律同下（一次只推一个 tag）。

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

## 桌面版打包坑记录（v0.0.40 起实测）

- **`updaterCacheDirName` 派生自包名且不可配置**（`app-builder-lib/out/appInfo.js` 只有 getter：`sanitizeFileName(name).toLowerCase() + "-updater"`）：带 scope 的包名会在 `%LOCALAPPDATA%` 下生成 `@whispering233ai-editor-desktop-updater\` 这种拼音式目录名——要名字干净只能改 package.json 的 `name`（desktop 包因此**有意不带 scope**）。另：NSIS 默认卸载器**不删**这个目录（electron-builder#9505，约 130MB 安装包副本），本项目在 `installer.nsh` 里无条件清理（属程序文件，非用户数据）。
- **`nsis.include` 路径相对 buildResources 目录**（默认 `<projectDir>/build`），**不是**相对 projectDir：`app-builder-lib` 的 `getResource()` 先查 build 目录的文件清单、再 `path.resolve(buildResourcesDir, custom)`。写 `include: build/installer.nsh` 会被解析成 `build/build/installer.nsh` 而报错——**正确写法 = `installer.nsh`**（`50-desktop.md` §5.1 的自定义卸载脚本靠它加载）。
- **NSIS 脚本可本地先验证语法**（不必推 CI 才发现）：`apt install nsis` 后用 `makensis` 编译一个最小包装工程（`Unicode true` + `!include "installer.nsh"` + 在 Uninstall section 里 `!insertmacro customUnInstall`）即可；只有一个 `WriteUninstaller` 的预期警告。
- **桌面包缺 SPA ⇒ 能启动但界面是 404 JSON**。server 的 SPA 走「`<server>/client-dist`」兜底路径（`server/src/index.ts` 的 `resolveClientDist`），而该目录**只在 server 包 prepack 时生成**（`scripts/copy-client-dist.mjs`）；桌面打包走 `pnpm deploy`，**CI 上那个目录从未生成** → 包内无 SPA，窗口只显示 `client/dist 未构建` 的 JSON。⚠ **本机测试会骗你**：开发机常常残留着旧日 `packages/server/client-dist`，于是本地包能跑、CI 包不能——v0.0.40 的 Windows 包就是这样发出去的。现 `pack.mjs` 在 deploy **之前**先跑同一个 copy 脚本，并在 deploy **之后**断言 `client-dist/index.html` 存在（宁可在打包阶段红）。
- **Windows：pnpm 必须经 shell 调**。Windows 上 pnpm 是 `.cmd` 包装脚本，而 Node 20+（CVE-2024-27980 修补）**禁止直接 spawn `.bat`/`.cmd`**：不带 shell 是 `spawnSync pnpm ENOENT`，指定 `pnpm.cmd` 是 `spawnSync pnpm.cmd EINVAL`（两种写法各失败一次）；正解 = `execFileSync(..., { shell: true })`（仅 Windows 开，官方解法见 nodejs/node#52681）。**副作用**：`shell: true` 不会自动给参数加引号 ⇒ 参数不得含空格（当前参数集满足）；将来若出现含空格路径，改用 cross-spawn 或显式引号。
- **Windows：`executableName` 必须显式设**，与 linux 同因——不设会用含 scope 的包名推导出非法可执行名（`@`）。
- **补包入口（不要重推 tag）**：某平台在 tag 运行时失败（如 v0.0.40 的 Windows），**不要** `git push :refs/tags/X && git push origin X`（会把 tag 指向改到修复后的 commit）；`desktop.yml` 有 `workflow_dispatch`（输入 `release_tag`）——从当前 ref 构建、资产挂到指定 Release（同名资产覆盖）。npm 包的对应处理：`publish-packages.mjs` 本身幂等（已存在版本跳过）。
- **同一个 tag 的三个 workflow 互不阻塞**：`release.yml`（建 Release）→ `publish.yml`（npm 5 包）+ `desktop.yml`（Windows 安装包）；`release.yml` 通常是第一个完成的（十几秒）。
