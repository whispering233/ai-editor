# 运行、构建、打包与部署（build）

> 本地开发/构建/发布手册。正式发布纪律（版本号同步、tag、CI 触发条件、npmjs 前置）以根 `AGENTS.md`「版本发布流程」为准；配置项总览见 `config.md`。

## 运行环境

Node ≥ 22.12（engines 声明；CI 用 22）、**全仓 ESM**、pnpm 由根 package.json `packageManager: "pnpm@11.22.0"` 钉版本（CI `pnpm/action-setup` 同版本——两侧必须一致，不一致 publish.yml 报 Multiple versions）。pnpm-workspace.yaml `allowBuilds` 需含 4 键：`better-sqlite3`/`esbuild`/`'@google/genai'`/`protobufjs`。

⚠ **fresh clone 后先 `pnpm -r build` 再 `pnpm typecheck`**——`dist/` 不入库（gitignore），`@whispering233/ai-editor-*` 的 `types`/`exports` 指向 `./dist/index.d.ts`，不先构建则 tsc 报 TS2307。

## 本地开发

```
pnpm dev            # pnpm -r --parallel run dev
  packages/client:  Vite dev server (port 5173) → proxy /api → :3456
  packages/server:  NODE_ENV=development tsx watch src/index.ts（默认 :3456）
  shared/llm/db/tools/agent: tsc --watch
```

- dev 态端口被占**直接报错**（不自动 +1）——Vite proxy 写死 3456，自动 +1 会造成 proxy 与实际监听不一致（与生产态行为不同）。
- Vite proxy 无需 changeOrigin（转发后 Origin/Host 端口为 5173；来源校验不校验端口，见 api-public.md）。
- 质量门：`pnpm typecheck` / `pnpm lint`（ESLint 9 flat config + typescript-eslint）/ `pnpm test`（vitest；单包 `pnpm --filter <包> test`）。
- 日常联调用仓库内 `test-project/`（运行时数据不入库）。

## 启动流程（生产态 / 单命令部署）

```
node packages/server/dist/index.js [projectRoot]   # 或安装态 npx ai-editor <目录>
```

- `projectRoot` = 创作根（缺省 process.cwd()）。
- `detectProject`：根自身有 `project.json` → 打开（旧单项目部署兼容）；**无 → 待命**（不初始化、不建任何文件，前端引导 create/open）。
- 书架模式：创建书 = `创作根/books/<书名>/` 子目录（三数据文件）；`GET /api/v1/project/list` 扫描列书（待命态可用）。
- 端口：默认 **3456**，占用时生产态自动 +1 递增（上限 20 次，3456→3475）并打开实际端口；可用环境变量 `AI_EDITOR_PORT` 覆盖（仅 bin 直接执行入口读取，测试/多实例场景用）。
- **绑定与访问**：默认绑定 `127.0.0.1`（不对外网开放）；提示 URL / 打开浏览器一律用 `127.0.0.1` 而非 `localhost`（IPv6 优先系统上 localhost 可能解析为 `::1` 导致连接被拒）。
- SPA：`defaultClientDist` 双路径（monorepo 开发态 `../../client/dist` / 打包安装态包内 `client-dist`）挂载为 fallback；单进程 Hono 同时服务 `/api/v1` 与静态文件。
- 本地看界面：`pnpm start:test-project`（= `pnpm -r build` + 生产态启动 test-project，自动打开浏览器）。
- 调试日志：创作根 `.ai-editor/config.json` 的 `debug` 段（chat/request/stream/usage/http 五类别；纯配置文件无 env 开关），见 config.md。

## 构建与打包

```
pnpm -r build       # 按依赖序：shared → llm → db → tools → agent → server → client（vite build，独立）
pnpm pack:test      # 构建 + 6 包 pack + npm 安装到 /tmp 测试目录（AI_EDITOR_PACKS_DIR / AI_EDITOR_TEST_DIR 可覆盖）
pnpm start:test     # 启动安装态服务
pnpm test:packed    # 一键串联（backlog #8 打包安装测试：tarball 安装态冒烟）
```

发布脚本链：`scripts/sync-version.mjs`（`pnpm release:version X.Y.Z` 同步版本）、`scripts/publish-packages.mjs`、`scripts/verify-installed.mjs`。

## 正式发布链路

```
pnpm release:version X.Y.Z（--dry-run 预览）
git add -A && git commit -m "chore(release): bump version to vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"（手动 annotated tag，轻量 tag 不触发发布规范）
git push origin main && git push origin vX.Y.Z
→ CI（.github/workflows/）：release.yml 从 CHANGELOG.md 按 tag 建 GitHub Release；
  publish.yml 6 包 npm 发布（OIDC Trusted Publisher）+ verify-installed 安装态冒烟
```

前置（一次性，npmjs）：账号开 2FA；6 个发布包各配置 Trusted Publisher（GitHub Actions / whispering233/ai-editor 仓库 / publish.yml 工作流）。**token 能力边界（2026-09-11 实测修订）**：本仓 granular token **可以执行 `npm deprecate`**（实测 10 条成功、无需 OTP）；被拒的是账号/组织/设置类操作（`npm profile get` → 403，npm 2026-07-31 起限制 bypass-2FA token 的设置类操作）。`unpublish` 未实测（不可逆）——官方文档仍列为需 2FA 的敏感操作，真要 unpublish 请备好 `--otp`。2027-01 起 bypass-2FA token 将失去直接发布能力，本仓已用 OIDC Trusted Publisher 不受影响。

## 发布管道坑记录（供后续发布参考）

- npm 12 publish 在 postpack 恢复后生成 registry manifest → prepack 替换只影响 tarball（manifest 残留 `workspace:*`，`npm install` 报 EUNSUPPORTEDPROTOCOL）→ 发布前主动替换 + `--ignore-scripts`
- CI node 22 自带 npm 10.9.8 **不支持 OIDC 发布认证** → CI `npm install -g npm@latest`
- npm 12 发布自动生成 sigstore provenance，npmjs 校验 manifest `repository.url` 一致（E422）→ 各包补 `repository` 字段
- setup-node 注入占位 `NODE_AUTH_TOKEN` 优先于 OIDC → 发布前 `delete process.env.NODE_AUTH_TOKEN`
- registry 文档缓存传播延迟（dist-tags 即时、`npm view`/install 短暂 404/ETARGET）→ verify-installed 先 `npm view` 轮询 6 包可见（20×30s = 10 分钟窗口）再 install
- 发布方式细节：发布前主动执行 copy-client-dist（server 的 SPA 随包）+ prepare 替换 workspace:*，然后 `npm publish --access public --ignore-scripts`（跳过 prepack/postpack 钩子），发布后 finally 主动 restore 恢复
