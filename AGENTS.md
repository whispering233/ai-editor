# AGENTS.md

面向编码 agent 的协作入口。**设计文档是单一事实来源**——本文件只回答「读什么」与「怎么协作」，不重复文档内容。

## 文档即契约（阅读顺序）

`docs/design/00-master-design.md`（产品定位与设计原则）→ `architecture.md`（技术栈 + 分包与依赖方向 + pi 嵌入形态）→ 详细设计（`10-data-model.md` → `20-context.md` → `30-agent-loop.md`，只讲「为什么 + 不变式」）→ 按职责读 `docs/api/`（先 `00-api-index.md` + `api-public.md`）与 `docs/db/schema.md`（字段/端点契约的「是什么」）→ 前端改动必读 `docs/ui/DESIGN.md`（**视觉与布局唯一契约**；改样式先改它）。

- 任何改动前先读对应文档；发现文档之间或文档与代码矛盾，先停下提问，不要自行发明。
- 涉及 pi 的行为以 `node_modules` 里实际安装的 `@earendil-works/*`（0.85.1）代码/类型为准，**禁止凭记忆写接口**。
- 状态与演进：根 `CHANGELOG.md`（逐版本事实）+ `tasks.md`（当前任务卡）+ `backlog.md`（未排期遗留项与有意口径）。云端存档另见 `docs/design/40-cloud-sync.md` 与 `docs/api/100-api-cloud.md`。
- 运行/构建/发布：`build.md`；配置载体与读写边界：`config.md`；桌面版（Electron 外壳）设计：`50-desktop.md`。

## 协作流程

- 任务以 `docs/design/tasks.md` 为清单：按卡开发，垂直切片、一次一张、一卡一 commit、独立验证、卡内不做卡外顺手改动；完成后清理卡片并向用户汇报。
- 每卡「实现 fixer + 独立验证 oracle」双代理；并行卡片用临时分支 + git worktree，验证后合回 main 并清理。
- 并行派工的硬要求（2026-09 实测）：子代理必须显式 `context: "fresh"`——`worker` 默认 fork 会把父会话的**编排叙事**当成自己的进度（实测三道 fixer 全部零改动回 PASS）；每份任务需带**硬完成判据**（`git log` 必须含新 commit + `git status` 干净，无 commit 不许报 PASS）与「汇报必附 commit hash / 命令输出」条款。
- **本环境实测补充（2026-09-16）**：子代理（`worker` / `oracle` / `delegate`）**均无 shell 工具**（任务声明的能力里有 `bash`，实际调用报 `Tool bash not found`）⇒ 派工时按「**子代理只落代码与静态判读、编排者跑门禁与 commit**」安排；「独立复现」在本环境最多做到独立静态判读 + 产物阅读，命令级证据由编排者提供并在汇报里注明。
- 验证：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`（单包 `pnpm --filter <包> test`）；⚠ fresh clone 先 `pnpm -r build` 再 typecheck；UI 改动额外用浏览器核一次像素；**改桌面版主进程（依赖/import）后必须跑打包态启动冒烟**（`build.md`：`typecheck` 绿 ≠ 打包态能起）。
- 提交信息用中文，遵循 conventional commits（如 `feat(doc): ...`）。
- 日常不 push、不建 PR、不新增 CI；远端与 CI 仅服务发布链路（push `v*` tag 触发 `.github/workflows/`）。

## 版本发布

按 `docs/design/build.md`「正式发布链路」执行（当前发布面 = 5 个 npm 包：shared/db/tools/agent/server + 同一 tag 的 **Windows 安装包三资产**：`.exe` + `latest.yml` + `.exe.blockmap`）。

## 代码级硬约束（设计文档不承载实现细节，仅此处登记）

- **pi 依赖 exact pin**：`@earendil-works/*` 一律写精确版本（当前 `0.85.1`），禁止 `^`/`~`；升级 = 一个显式 commit 齐抬版本（`pi-ai`/`pi-agent-core`/`pi-coding-agent`）+ 全量测试。typebox 的 `Type`/`Static` 经 `pi-ai` 重导出，不单独装 typebox。**声明位置按 import 性质**：运行时 import 必须进 `dependencies`（`server` 曾把 `pi-ai`/`pi-coding-agent` 放进 `devDependencies`——靠 `agent` 包的传递依赖 hoist 才跑得起来，pnpm 严格布局下会解析失败）。
- **pi 配置/凭据的唯一读写入口** = `packages/server/src/model-runtime.ts` 的 `getModelRuntime()` / `getSettingsManager()`；业务代码不得直读 `~/.pi/agent/auth.json`/`settings.json`（会话 id、模型目录、凭据状态一律经 pi API）。
- **出站 HTTP**：服务启动时安装全局 undici dispatcher（`packages/server/src/http-dispatcher.ts`，与 pi CLI 同款：连接族退避 + 环境代理 + 空闲超时）。**不要在业务代码里另建 fetch/agent**——否则丢失代理与连接行为（真实故障场景见 v0.0.32 CHANGELOG）。云端存档的 WebDAV 请求同样走它。
- **云端存档（v0.0.38 定稿）**：凭据与同步状态的唯一载体 = `<创作根>/.ai-editor/cloud.json`（0600 明文；**不进项目文件 / 备份 zip / 任何 API 响应**），读写唯一入口 = `packages/server/src/cloud/state.ts`。
  - **地址语义 = 用户云盘根**；工作根 `<云盘根>/ai-editor/` 由 `createWebdavClient` **唯一一处拼接**（配置/UI 都只表达云盘根，不做「截断再拼回」）；`ensureWorkingRoot()` 幂等建「云盘根 + 工作根」。
  - **备份命名唯一格式**（写入 = 解析，`shared/utils/backup.ts` 单正则）：`<时间戳>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip`；三类旧命名**不解析**（留盘不列表），**不做重命名迁移**；打开项目时若 `.backups/` 有文件但无一可解析 → 兜底生成一份（`ensureParseableBackup`）。`device`/`stats` 恒有。
  - **三态与「有未备份改动」**：`local.backupStale` = `hasUnbackedChanges` **且** `dirty`（拉取/恢复后必为 false；`backupStale` 不随同步前移）；**自动推送的守卫用纯 `hasUnbackedChanges`**（更严格，避免推旧包上云）——两处口径不同是有意的。
  - **自动推送复用备份 tick 链**（**不得新增第二套定时器**：排程条件 = 备份频率开启 **或** `autoPush` 开启，后者按 2h 兜底）；节流基准 `lastAutoPushAt` 只由定时路径推进；失败只记 `lastAutoPushError`（清除点 = `pushBackup` 成功写）。
  - **云端写入协议**：`PUT .tmp-<名>` → `MOVE` 成正式名（同名同大小已存在则跳过上传；`MOVE` 撞 409/412 时删目标重试一次）；书目录名 `<书名>-<id>` 被云盘拒时回退 `ai-editor-<id>` → `<id>`（回退扫描认 `name === id || endsWith('-'+id)`）；清理只删可解析时间戳或 `.tmp-` 前缀，**带用户标签的永不删**。
  - **坚果云实测口径**（改 WebDAV 客户端前必读）：`PROPFIND` 对不存在的集合回 `207`+空 body（**空 multistatus = 不存在**）；`MKCOL` **不带尾斜杠**；集合删除要**尾斜杠 + `Depth: infinity`**；根目录**不可直接写文件**（探针写工作子目录）；对单段名字长度限制严（`400 IllegalArgument / sandbox name is too long`）；`MOVE` 目标已存在时**不认 `Overwrite: T`**。
  - **拉取的并集语义只对云 pull 生效**——`overwriteProjectFiles` 的合并参数默认关（restore 必须保持纯覆盖，改动需守卫测试）。
- `db` 查询层统一经 `queryDb` 取 drizzle 实例，**禁止绕过直接 `prepare`**（迁移管线除外）；JSON 列（data/changes/metadata）一律 text 模式 + 行映射防御解析，**禁用 drizzle `mode:'json'`**（坏 JSON 会打挂整表查询）。
- **对话历史唯一存储 = 项目目录 `sessions/`，文件格式与命名归 pi（session v3）**：会话 id 是**不透明值**，服务端只能经「磁盘发现 + header id 映射」解析为路径，**禁止用客户端传入值拼接路径**；旧 v1 扁平文件留在磁盘但不读取。写文件类迁移（`up(db, ctx)`）必须幂等（整文件重写），崩溃后重跑收敛。
- **项目目录内的「随包目录」（`references/`、`sessions/`）改动必须同步四处**：备份白名单、打包、变更判定（mtime）、恢复/导入的整体覆盖——漏一处就出现「备份丢数据」或「只聊天不触发自动备份」。
- **工具层**：参数 schema 用 TypeBox（放 `packages/tools`，**不放 `shared`**——client 不打包 schema）；`execute` 抛错即失败（不得把失败编码进 `content`）；工具结果超 8000 tokens 截断并显式告知；`propose_*` 的预览细节**只走 `details`**（随 `tool_execution_end` 帧下发），`content` 只给 `proposal_id` + 一句话摘要。
- **SSE 契约**：`POST /chat` 的帧集与字段以 `docs/api/80-api-chat.md` 为准（pi 事件投影，唯一实现点 = `agent/src/runtime/events.ts`）；不得回退旧事件名。
- `client` 聊天链路：SSE 解析唯一实现是 `hooks/use-sse.ts`（勿另起炉灶）；store 的 loadSeq/msgSeq 竞态、**事件级流身份守卫**（旧流迟到帧不得污染新会话/工具卡/状态提示）与「中止在途 SSE」约定改动时必须保持。
- `client` 视觉：**颜色/选中面 token 只能改 `AntdProvider.tsx`**（唯一改色入口，并同步 `docs/ui/DESIGN.md` 登记表）；守卫 `design-discipline.test.ts`（源码扫描：`lucide-import` / `hardcoded-color` / `important-class` / `ad-hoc-font-size` / `primary-bg-token` / `dropdown-menu-selectable` / `antd-root-override` / `cssvar-scope` / `no-dynamic-class` / `button-variant-color`）与 `components/antd-tokens.test.ts`（派生 token 对比度）。**不变式：深墨主色（`#37352f`）下任何由 `colorPrimary` 派生的「浅底」token 都不可信**（antd 派生的是中深灰，2.26:1 不可读）——选中面已显式覆盖，新增 antd 组件（Tree/Table 行选、Cascader、DatePicker…）时先扩 token 守卫。antd Select 浮层默认跟随触发器宽度 ⇒ 窄触发器必须 `popupMatchSelectWidth={false}`。**缩进列几何**（大纲/设定/面板树的折叠箭头 vs 无子节点占位）依赖 antd `controlHeightSM`（= 24px，占位写 `-ml-2 w-6`）——`antd-tokens.test.ts` 有该值断言，antd minor 升级报红时同步改占位宽。
- 仓库路径：`docs/`、`scripts/`、`test-project/` 在仓库根；包内路径相对 `packages/`。`test-project/` 整体不入库（含运行时生成的 `.ai-editor/config.json`：`debug` 开关 + `lastProject`）；创作根 `.ai-editor/config.json` 只属服务端（`debug` 用户手编、`lastProject` 服务端在 open 成功后合并写入，见 `config.md`）。
- **第三方图标资产只有一个**：`packages/client/public/provider-icons.svg`（供应商品牌 logo，@lobehub/icons 派生、MIT 许可头内嵌于文件）。**不要为此引入 `@lobehub/icons` 包**（9MB + peer `@lobehub/ui` 树）。
- 左栏导航入口语义（**书架 = 顶部标识、概览 = 书名按钮、一级导航无「概览」**）与 `provider-icon` 品牌图标例外见 `docs/ui/DESIGN.md`；开机直达书籍只在 `hooks/use-enter-last-book.ts` 做**首帧一次**（勿在 Dashboard / AppShell 加常驻重定向——会把「回书架」弹回去）。
- **同一路由组件的「形态」状态也是状态**（v0.0.37 实测）：`Dashboard` 的 `mode` prop 在 `#/` → `#/overview` 之间**不重挂载**（`useEnterLastBook` 自动进书只是改 prop），凡是 `if (mode !== "overview") return` 的 effect 必须把 `mode` 写进依赖数组——漏了它，effect 只会在 mount 时那次（此时 config 尚未到）跑一次，之后永不重跑：表现为阅读进度停在原始 id、大纲概览永远骨架。新增/搬动这类「路由形态 gate」的 effect 时逐个核对依赖。
- **章级锚点三件套（2026-09）**：`current_position`、变更记录触发节点（`POST /delta` 的 `node_id`）、伏笔锚点（`plants`/`advances`/`resolves` 的源端）**一律只支持 `chapter`**；写入侧三层同口径（REST 路由 / AI 提案层 / executor 兜底），`compute_state` 的 `at_node_id` 不限层级。**UI 侧三个选章下拉同步收窄为仅章**（人物页进度节点 / 通用 compute 探针 / `#/hooks/:id` 预计回收节点，统一走 `lib/outline-tree.ts` 的 `chapterNodeOptions`；`Timeline`/`create-relation-dialog` 的节点选择是自由引用，**有意保持全层级**）。**REST/工具保持泛型**是登记过的分层（不与前端同宽），别顺手收紧。
- **大纲层级（2026-09 收紧）= 章只能挂卷**：`root` 仅接纳卷（写入侧三面同口径：db `assertCanHold` 单点（创建/移动共用）/ tools 提案层与 LLM 工具描述 / client `parentOptionsForType`）；**存量根级章读容忍**（内嵌 `child: 卷|章` 类型形状与映射保留，能渲染/改名/删除/拖进卷，不能再新建或移回 root，**无迁移**）——改类型形状/映射前先读 `10-data-model.md` §2。
- **`computeState` = 章序前缀累积**（不是树父链）：状态 = 初始 `data` + 「章序 ≤ 目标进度章」的全部已确认 Delta；目标节点→进度章：章→自身、场景→所属章、卷→该卷最后一个未软删章。章序 = **文件位置序（含软删章，编号不重排）**，「当前章」退化必须取**最后一个未软删章**。
- **character 数据分层**（`docs/db/schema.md`「人物 data 分层」）：不可变（`role`/`description`）**不参与 Delta**；可变字段 + 能力面板**叶子**走点分路径（`ability_panel.火系.等级`，仅标量 `set`/`update`）。字段白名单的**单一定义 = `shared/src/constants/delta.ts`**（`SET_ONLY_FIELDS` / `REMOVED_CHARACTER_FIELDS` / `IMMUTABLE_FIELDS`），client/tools **禁止手抄**。
- **人物页是工作台**（`#/characters` master-detail，无独立列表页）：右栏 = `components/character/character-detail.tsx`（**四 tab**：人物档案可编辑 / 阅读进度只读 / 人物关系网 / 其他关联 · N——关系两块是**平级 tab**，不在字段 tab 之下；字段区 = 一个 card 内的**档案式网格**，「基础信息 / 可变数据」分区已删，阅读进度值画纯文本）；泛型 `EntityList`/`EntityDetail` 只服务 setting/location（**已冻结，不再承载新能力**）。新增 antd 组件/样式前先扩 `DESIGN.md` 与 token 守卫。
- **关系类型属性单一来源** = shared `RELATION_TYPE_META`（`Record<RelationType, { label, group, symmetric }>`，group ∈ character/structure/anchor/hook/mount/canvas）：client 标签、人物页人↔人子集、对话框排除集、tools 冲突检测的对称口径**一律派生**，禁止再手抄清单。自定义类型语法校验（`trim` 非空 / ≤32 / 禁控制字符）的单一来源 = shared 纯函数（REST schema、db `createRelation` 守卫、client 预校验共用）；AI 工具 `relation_type` 仍是预定义 `z.enum`（有意分层）。
- **db 打开只有一条管道** = `packages/server/src/middleware/project.ts` 的 `openProjectDatabase`（开机 `detectProject` 与 `POST /project/open` 共用）：迁移前快照、未来版本拒绝（不重建）、无迁移路径才重建兜底；**缺 `data.db` 的「全新空库」直接写 `SCHEMA_VERSION`**（不重置 `outline.json`）。
- **变异/探针验证**：禁止用硬链接副本 + 就地截断写（会写穿 inode 污染源仓库，真实发生过）；只能 `cp -r` 真副本或 `git worktree`，恢复后必须复跑全量回归（见 `build.md`）。
- **桌面版（`packages/desktop`）硬约束**（详见 `docs/design/50-desktop.md`）：`electron` **44.3.0 exact pin**（同 pi 纪律：升级 = 显式 commit + 三平台重打包验证）；**preload 必须 CJS**（源文件 `preload.cts`——沙箱 preload 不支持 ESM，而 `sandbox: true` 是既定基线），主进程 ESM；服务走主进程 in-process `startServer()`（**不开子进程**），退出复用 `ServerHandle.close()`；窗口加载 `http://127.0.0.1:<实际端口>` 且**端口固定优先**（3456 → 占用才 +1）——`localStorage` 按 origin 隔离，端口漂移 = 主题/面板偏好重置；应用级配置唯一载体 = `<userData>/desktop.json`（`projectRoot`），**CLI 形态永不读**；桌面包**不得依赖 `process.cwd()` / 命令行参数**；日志落 `<userData>/logs/ai-editor.log`；原生能力只经 preload 的 `pickDirectory()`，client 侧一律能力检测（浏览器形态行为不变）。
  - **打包链路不可省项**：`pnpm deploy --prod`（依赖收集）+ `npmRebuild: false`（N-API 免 rebuild）+ 显式 `linux.executableName`（scope 名里的 `@` 会被 AppImage 工具链拒收）——见 `build.md`「桌面版」。
  - **Electron 42+ 无 postinstall**（改懒下载）：`pnpm install` 不下载 electron 二进制，开发态首次 `electron .` 才下；不要在 install 阶段依赖它存在。
  - **能力检测唯一入口** = `packages/client/src/lib/desktop.ts` 的 `desktopBridge()`（浏览器形态/SSR 返回 null）；桌面版专属 UI 一律据此条件渲染，**禁止在组件里直接摸 `window.aiEditorDesktop`**（否则浏览器形态会出现半个入口或直接白屏）。
  - **workflow 不写 pnpm `version`**：版本从根 `packageManager` 读（单一事实源）；三个 workflow（release / publish / desktop）同由 push `v*` tag 触发，写死版本会导致本地与 CI 静默漂移。
  - **打包分工（2026-10 定）**：**本地只打 Linux 包**（`pnpm desktop:dist`，用于自查）；**Windows 包只由 CI 出**（`desktop.yml` 只跑 windows-latest；macOS/Linux 两项在 matrix 里注释保留）——Windows 本地交叉构建需 Wine，不往开发机装该依赖；macOS 需 mac runner。本地要验 Windows 包时用手动触发 + `gh run download`，不要重推 tag（见 `build.md`）。
  - **升级路径守卫不可回退**：`installer.nsh` 的 `customUnInstall` 开头必须保留 `${If} ${isUpdated}` / `${If} ${Silent}` 早退（升级时安装器会以 `/S /KEEP_APP_DATA --updated` 调旧卸载器；漏了这层就会在升级时弹「清除使用数据」、点了「是」即删书库与 `%APPDATA%\AI Editor`——v0.0.44 真机事故，v0.0.45 修，见 `50-desktop.md` §5.1）。
  - **卸载清理的安全约束（不可简化）**：`packages/desktop/build/installer.nsh` 删目录前**必须先验签名文件**（`<书库>/.ai-editor/library.json`，由 `writeLibraryMarker` 每次启动幂等写入）——书库目录名 `AI Editor` 是通用名，按名 `RMDir /r` 会误删用户早先自己建好的同名目录（不可恢复）。`<userData>` 的存在性检查用 `desktop.json`。改这段脚本前先读 `50-desktop.md` §5.1。
  - **自动更新（Windows 安装态，v0.0.44 起）**：`electron-updater` **6.8.9 exact pin**（与 electron-builder 26 同线；7.x 改了 `quitAndInstall` 签名与 `autoInstallEvent`，不要混用）；**该包是 CJS ⇒ 必须默认导入 + 解构**（`import electronUpdater from "electron-updater"`；具名导入在打包态直接崩、而 typecheck 不报）；只对 Windows 安装态生效（主进程 `win32` 守卫）；`autoInstallOnAppQuit = false`，**只在用户确认后**先 `await closeServer()` 再 `quitAndInstall(true, true)`；**每个 Release 必须三资产齐全**（`.exe` + `latest.yml` + `.exe.blockmap`，**缺 `latest.yml` ⇒ 所有旧版检查更新直接失败**；资产名不得含空格——磁盘名/资产名/`latest.yml` 的 url 必须逐字一致）——见 `50-desktop.md` §5.2 / `build.md`。
- 测试：各包 `test` script = `vitest run`；各包 tsconfig 已 `exclude: ["src/**/*.test.ts"]`，不要改回——**`*.test.ts` 不进 `pnpm typecheck`**，编译期断言（`satisfies` / 穷尽性检查）必须写在 src 模块里。⚠ **`.test.tsx` 仍会被 typecheck**（exclude 通配不盖 `.tsx`；client 的 SSR 测试属此列——这是**有意保留**：改测试时类型错要在 `pnpm typecheck` 期暴露，真正的隐患是误以为「测试不会被检查」而在测试里写坏类型。**改 shared/db/tools 的 `src` 后先 `pnpm -r build` 再 typecheck/下游测试**：client 的编译期断言与 server/tools 测试读的是上游 **dist**，不重建会给假绿（卡 8.3 oracle 实证）。
- 延期项：多标签页并发、undo、token 统计、跨书参考资料导入（MVP 不做，勿顺手实现）；其余遗留项与有意口径见 `docs/design/backlog.md`。
