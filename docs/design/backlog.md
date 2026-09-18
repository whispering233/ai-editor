# 开发遗留项（Backlog）

**性质**：已知但**未排期**的遗留项与有意保留的口径。不是承诺清单，不排优先级；需要时按「最小修法 / 升级路径」评估成卡（进 `tasks.md`）再动手。

- 纪律：**新发现的小项先进本文件，不即时插队**当前批次；卡内不做卡外顺手改动。
- 每条尽量给：现状 → 影响 → 触发条件（什么时候才值得做）→ 最小修法 / 升级路径。
- 「有意保留（非待办）」小节 = 已登记的设计口径，**不要**当 bug 去"修"。

---

## 数据与契约

- **关系类型 R2 互斥对仍是字面量**（tools `analysis/conflict.ts`；卡 8.1 oracle 登记）
  - 现状：不对称性（`symmetric`）已收进 shared 注册表，但「互斥对」`MUTUALLY_EXCLUSIVE_PAIRS = [["ally","rival"]]` 仍是本文件字面量——互斥是**类型对**语义，不是单类型属性，未纳入注册表。
  - 触发条件：出现第二对互斥关系（或想在前端表达互斥提示）时。
  - 升级路径：注册表加一个 `mutuallyExclusiveWith?: string[]` 字段（或单独的 pair 常量表）；目前一对，不值得。
- **`db.createRelation` 只校验不归一**（卡 8.2 oracle 登记）
  - 现状：`relation_type` 的 `trim` 归一只发生在 REST schema 层；db 守卫仅校验语法。现有直接 db 写入路径全部传字面量或 AI 枚举 ⇒ 无实际脏值路径。
  - 触发条件：出现「直接调 db 层自由输入」的新调用方。
  - 最小修法：db 守卫内改用 shared 的归一函数（一行）。
- **非字符串 `relation_type` 的报错文案是英文**（卡 8.2 oracle 登记，低）
  - 现状：`z.string()` 先失败 → zod 默认英文消息；UI/AI 两条路径都不可达（UI 传字符串，AI 枚举）。
  - 触发条件：REST 直接被外部调用方以非字符串调用时。
- **执行/构建产物新鲜度**（卡 8.3 oracle 登记）
  - 现状：client 的编译期断言（人物字段清单、`delta-create` 字段名）绑定 shared 的 **dist** 类型；改了 `shared/src` 不重建 ⇒ `pnpm typecheck` 静默通过（假绿窗口）。
  - 已采取：AGENTS.md 测试条写明「改上游 src 后先 `pnpm -r build`」；**不加**前置构建（会拖慢每一次 typecheck）。

- **executor 未接不可变字段白名单**（`role` / `description`；卡 5.6 oracle 实测）
  - 现状：不可变字段拦截落在**前端字段下拉** + **AI 提案层**（`propose_add_delta` 对 character 拒绝 `role`/`description`）；`executeAddDelta`（确认落库侧）未复检。
  - 影响：理论可写出「同一人物两个值」（`computeState` 算出另一个角色定位）。可达性低——提案仓为进程内 TTL Map，仅手工构造 proposal 可触达，且确认路由不重跑语义校验。
  - 触发条件：新增任何"非提案层"的 Delta 写入入口时（那会把可达性抬高）。
  - 最小修法：3–5 行，复用 shared `IMMUTABLE_FIELDS`，在 `executeAddDelta` 加一次调用。
- **自定义关系类型改名/合并**
  - 现状（2026-09 起）：作者可在建立关联时自由输入新类型（`trim` 非空 / ≤ 32 字符 / 禁控制字符），类型**只活在 `relation_records.relation_type` 里**，下拉从「预定义 ∪ 本项目已用类型」派生——**无中心记录 ⇒ 无改名/合并入口**（打错字会一直留在下拉里，直到相关关系被删光）。
  - 触发条件：真实出现 typo/近义类型疼痛（想统一两个近义类型，或类型名与设定不符）。
  - 升级路径：把派生集合换成项目级关系类型表（新增表 + 增删改名 UI，即完整档）；届时按表改名存量值。
  - 注：原「新增类型走迁移 + schema 版本抬升」说法已废——`relation_type` 无 CHECK，新增/自定义类型从不需要迁移（属文档错误修正）。
- **`status` 字段的服务端彻底清理**（character 侧已删，属有意保留的一部分）
  - 现状：`filters.status` 保留给 hook 生命周期（有意保留）；character 的 `status` 已从表单/列表/AI 摘要与 data 契约删除，旧残留由 `.passthrough()` 容错。
  - 触发条件：无（仅在整体清理查询参数面时顺带处理）。

- **书名校验两份实现**（2026-09 发布前审计发现）
  - 现状：`client/src/lib/book-name.ts` 与 `server/src/routes/project.ts` 各有一份同正则 + 同中文文案的校验（`grep -rn "书名不能包含" packages` → server 1 处 + client 1 处 + 客户端测试夹住）。文案/规则已经开始分叉的风险点。
  - 触发条件：下次改书名规则或文案时。
  - 最小修法：提 shared 纯函数 + 文案常量（REST schema、路由校验、客户端预校验共用）。

- **视觉守卫的两处盲区**（卡 3 oracle 复核登记）
  - 现状：`design-discipline.test.ts` 的 `antd-root-override` 只扫 `className`（不扫内联 `style={{}}`），且 `ANTD_GUARDED_COMPONENTS` 只覆盖 `Button` / `Input`（`Select` / `Input.Password` 根元素未覆盖）。既有 3 处内联宽度（`auto-backup-panel.tsx` 的频率下拉 `minWidth`、备份名与重命名输入框 `width`）因此长期存在。
  - 触发条件：新增 antd 组件到守卫清单时，或再遇到「antd 无层 CSS 压掉 Tailwind 类」的实际故障。
  - 最小修法：守卫加内联 style 扫描 + 扩组件清单；存量 3 处宽度迁移到 antd 的 `size`/`style` 之外的既有档（需先确认不被无层 CSS 压掉）。

- **备份响应 schema 未收敛到 shared**（卡 1 oracle 验证登记）
  - 现状：`docs/api/*.md` 声明「响应 schema 单一来源 = shared `types/api.ts`」，但备份响应类型实际在 `client/src/lib/api.ts`（`BackupEntry`）与 `packages/server/src/backup.ts`（`BackupFileInfo`）**各写一份**（请求侧两个 zod schema 确在 shared）。
  - 触发条件：云端批次（卡 2-7）要给备份响应加字段时——那会让第三份手抄出现。
  - 最小修法：把备份条目响应 schema（`backups` / `backup`）提到 shared，client 与 server 共用；顺带修正 `docs/api/20-api-backup.md` 首行「响应 schema 单一来源」的表述。

- **URL 校验的错路回显用户输入**（卡 2 oracle 复核残留 1）
  - 现状：`routes/cloud.ts` 的 `normalizeWebdavUrl` 两条**先于** userinfo 检查的分支仍原样回显输入（`不是合法 URL：${raw}` / `只接受 http/https：${raw}`）——`ftp://u:pw@host/dav`、`https://u:pw@`（无 host）这类串会把刚键入的整串回显进 400 body。不新增泄露面（HttpError 分支不打日志、hono logger 只打 method/path/status ⇒ 只回到同一客户端），故按小项登记。
  - 最小修法：两条分支只回显 `parsed.protocol` 或固定文案，不回显 `raw`。
- **`shared/src/types/api.ts` 的 cloud 注释镜像未同步**（卡 2 oracle 复核残留 4）
  - 现状：该注释块只写「url/username 空串 = 清空」「password 缺省或空串 = 不修改」，未写「url+username 皆空 ⇒ password 一并丢弃」与「userinfo 拒绝」。权威在 `docs/api/100-api-cloud.md`（已同步），类型文件是契约镜像。
  - 最小修法：下次触碰该文件时补 2 行注释。
- **`webdav.ts` 两处已知边界（接受口径，非待办）**（卡 2 oracle 复核残留 2/3）
  - 反代把 href 重写成与请求前缀不一致的形态 → 不剥离前缀（避免误剔），代价是该形态下根自身条目回到列表（`list` 的「不含自身」保证只在 href 前缀一致时成立）。
  - href 段解码出 `/`（`%2F`）时 `path` 的段往返错位 → 不剥离、`path` 非 base 相对（极端文件名，接受）；根治需 `parsePropfind` 直接返回段数组。

- **`PUT /cloud/config` 省略 `device`（undefined）的 REST 层断言缺失**（设备名预填修正的 oracle 登记）
  - 现状：「省略 = 不修改配置值」的语义只在 `state.test.ts` 间接覆盖（「清除凭据但设备名非空 → 保留设备名」），REST 层没有显式用例。
  - 触发条件：改动 `writeCloudConfig` 的 device 分支时先补这条断言。
- **`client/src/stores/cloud.test.ts` 的 `status()` 夹具缺 `deviceConfigured`**（同上登记）
  - 因为用 `} as CloudStatus` 断言绕过类型检查，新字段在 store 侧无守卫；下次改该夹具时顺带补上。
- **面板说明行的派生值兜底用 `??` 而非 `||`**（同上登记，nit）
  - `status?.device ?? "（读取中）"` 挡不住空串（仅当 `hostname()` 派生为空才可能，极边缘）。

- **`refresh()` 在途时点「同步云端」会静默早退**（卡 C oracle 登记，可选）
  - 现状：`syncNow` 首行 `if (get().busy !== null) return;`——状态检查在途时（打开项目后那几秒）用户点按钮没有 toast、没有排队，表现为「点了没反应」。
  - 最小修法：早退时给一句中性 toast（「正在读取云端状态…」）或把点击排到 `inFlight` 之后。
- **DELETE 受限的云盘上保留清理/临时文件清理静默失效**（卡 C oracle 登记）
  - 现状：`pruneCloudBackups` 与 `.tmp-*` 清理都只 `console.error` 并放行（清理失败不阻塞推送）⇒ 份数可能堆到配额上限、临时文件残留。
  - 已登记在 `40-cloud-sync.md` §9「可写不可删」条目；触发条件 = 遇到这类云盘时。

- **备份 zip 生成期间的改动有检测窗口**（卡 B oracle 登记）
  - 现状：`writeBackup` 先读文件打包、后取文件名时间戳；落在 `[读文件时刻, 文件名时刻]` 的编辑既不在该份 zip 内，也不会被判「有改动未进最新备份」（`data.db` 的 1s 容差同理）→ 要等下一次编辑+备份才补上。
  - 影响：自动推送活性（那一段改动晚一次上云），非数据丢失（本地数据在盘上）；触发条件是「正好在打包那几十毫秒里保存」。
- **零备份 + `local-ahead` 时旧包确认框的「上传旧备份」会 404**（卡 B oracle 登记，UX 洞）
  - 现状：没有任何本地备份时 `hasUnbackedChanges` 恒真 ⇒ 点「同步云端」弹旧包框，其中「上传旧备份」未禁用，点了走 `pushBackup` 404「没有可推送的备份」，文案落到框内。
  - 最小修法：该框在「本机无备份」时把「上传旧备份」禁用，并照 `DESIGN.md:550` 的口径提示先「立即备份」（另一半「立即手动备份并推送」仍可用）。
- **卡 B 的两条测试用未来 mtime 造 stale**（卡 B oracle 登记，测试诚实性）
  - `Date.now() + 1000` 能确认式地造出 stale，但没覆盖现实序（备份后 0-1s 内编辑的容差边界）；另 `auto-push.test.ts` 的 2h tick 跳过用例里留了一句自问自答的困惑注释。
  - 何时必须做：若要动 `BACKUP_CHANGE_TOLERANCE_MS` 或 `hasUnbackedChanges` 的基准口径时，先补这两条边界用例。
- **restore / 云 pull 之后 `backupStale` 会短暂为真**（卡 B oracle 未验证项）
  - 覆盖前快照的时间戳早于覆盖时刻 ⇒ 覆盖后 `hasUnbackedChanges` 可能判真 → 自动推送暂停到下一次备份（面板会显示提示行）。
  - 影响：自动路径延迟一次（提示行是诚实的），未验证是否有更糟的交互。

- **旧命名备份文件永远不清、用户也不可见不可删**（卡 A oracle 登记，有意口径）
  - 现状：`pruneBackups` 只对**可解析**（唯一格式）的份计数/清理 ⇒ 旧命名残留份永不被清、也不出现在列表，用户无法经 UI 删除；数量有限（历史开发期产物）但会永久占盘。
  - 有意口径：不删用户文件（与「非本程序命名的文件一律不碰」一致）；若日后需要，再加「清理不可解析残留」的显式入口。
- **卡 A 未验证两条**（oracle 复核）
  - `POST /project/open` 端到端：`.backups/` 只剩旧命名 → 200 且列表含新格式份（现有用例是直调 `ensureParseableBackup`）。
  - `.backups/` 只读（chmod 555）时 open 仍 200（仅代码层推断：`writeBackup` 抛错被外层 catch 吞掉）。
  - `.backups/` 里放任意非本程序文件（`notes.txt` / `.DS_Store`）会被判为「全不可解析」→ 多补一份备份（一次性，不循环）。

- **「备份频率关闭 + `autoPush` 开启」形态下推的是旧包**（卡 7 oracle 反例 6，用户感知风险最高）
  - 现状：`maybeAutoBackup` 在频率关闭时直接返回 false ⇒ 永不产生新备份；而自动推送（定时/关闭项目/手动备份后之外的路径）推的是**最新一份本地备份**（可能很旧）。更糟：`pushBackup` 成功会把 `lastSyncAt` 推到 now，于是面板显示「本机无改动」而云端内容落后于本机最新创作。
  - 口径上不违约（§5 表格已登记「推的内容 = 最新一份本地备份」），但卡 7 新开的这条路让它从边角变成常态。
  - 候选修法：① 自动路径发现「无新备份」时按需 `writeBackup`（代价：绕过用户的「关掉自动备份」意图）；② 面板提示「云端为旧份，先立即备份」；③ 保持现状 + UI 明说。
- **并发推送未串行化**（卡 7 oracle 反例 8，未验证）
  - close 的 fire-and-forget 与 tick / 手动备份触发的推送可能同时在途，两路对同一 `dirName` 走 `PUT .tmp-<名> → MOVE` 并各自清理 `.tmp-` 前缀；极端情况互清临时文件导致一次失败（会被记成 `lastAutoPushError`）。
  - 建议：真实故障出现前不加锁（反例 9 同类：失败无退避 —— 云盘不可达时每个 tick 重试并重写 `cloud.json`）。
- **自动路径撞冲突时缺行动指引**（卡 7 oracle 反例 7，已部分收口）
  - 自动路径不传 `force`，换机 / `cloud.json` 丢失 / 另一台推过时三条自动路径一律记 `CLOUD_CONFLICT`；面板那行现补了指引文案（卡 7 收口），但「自动推送长期失败」的用户可见体验（是否需要角标/更强提示）未定。

- **卡 6 复核遗留（8 条中未处理者，卡 7 未覆盖）**
  - **status 刷新/清理只挂 `NavRail`**：左栏收起时 NavRail 不挂载 → 无人复查；自动推送已改服务端状态，需要事件点刷新或把宿主上移 `AppShell`。
  - **`refresh()` 的 `busy` 归属**：`finally { set({ busy: null }) }` 会清掉 `push`/`pull` 刚设的 `busy`（窗口落在一个微任务内，现网点不到）→ 改成「谁设的谁清」或引用计数。
  - **`clearStatus()` 未清 `conflictOpen`/`pullTarget`/`pendingSettingsPane`**：关闭项目/切书后旧对话框状态残留（模态遮罩挡住入口，可达性低）。
  - **失败文案的「未执行」断言**：网络超时可能服务端**已执行**（`无法连接服务，推送/拉取未执行`）→ 去掉断言、只说「未确认」。
  - **冲突框「保留云端」应带上框里展示的那份 `fileName`**（当前 `pull()` 无参 = 服务端当下 head）。
  - **`DESIGN.md` §544 失败态口径与代码不一致**（文档写「错误文案 + 重试按钮；未配置 empty-state」，代码是纯文案）→ 改文档或补按钮。
  - **`getProjectBackups()` 失败与「真的没有备份」不可区分**（`.catch(() => null)` → 冲突框禁用强推并说「本机还没有备份」，可能不实）。
- **真云盘（坚果云）人工验收清单**（自动化环境只到「本地 WebDAV + mock fetch」；真实云盘的认证/配额/时区三项无法在 CI 覆盖）
  1. 坚果云网页端 → 安全选项 → **添加应用密码**（不是账号主密码）；在设置页「备份 → 云端备份」填**云盘根** `https://dav.jianguoyun.com/dav` + 注册邮箱 + 应用密码 → **保存** → **测试连接**（期望 toast「连接成功，已写入并删除测试文件」；应用会在其下自动建立并使用 `ai-editor/` 工作目录）。
  2. 点「立即备份」→ 点「推送到云端」：坚果云网页端应出现 `ai-editor/书名-<完整 projectId>/…-手动-<设备>-人物N-设定N-章N.zip`（工作根 `ai-editor/` 由应用自动创建；书目录名带 id，不是只按书名；名字过长被云盘拒时会回退为 `ai-editor-<id>` 或纯 `<id>`）。
  3. 另一台机器（或换一个创作根模拟）：同样的 WebDAV 配置 + 同一本书 → 打开项目 → 点左栏「同步云端」：若云端有份而本机无记录 → 期望弹**裁决框**；选「保留云端」后本机三文件与 `references/`、`sessions/` 按并集合并（本机独有对话/资料不丢），覆盖前状态进 `.backups/`。
  4. 在本机改一处创作数据 → 关掉自动备份频率（把频率设为「关闭」）但**保持自动推送开启** → 等 2 小时（或临时把系统时间前移）→ 期望云端出现新一份（这就是「关掉自动备份 ≠ 关掉自动推送」的 (B) 口径；若没出现，检查 `cloud.json` 的 `books.<id>.lastAutoPushAt` 与面板失败行）。
  5. 制造失败：把 WebDAV 地址改成不可达 → 点「同步云端」→ 期望只 toast「云端不可达（…），本地功能不受影响」、**角标不亮**；恢复地址后点一次推送 → 面板失败行应消失（`lastAutoPushError` 的唯一清除点 = 任何一次推送成功）。
  6. 配额/时区：坚果云免费账户有 1GB/月上传流量；跨时区两台机器的份按**文件集合**判定（不看时间戳），不应误报「已同步」。上传超 500MB 的包会被拒绝（`CLOUD_BACKUP_TOO_LARGE`，本机体积上限提示）。
  7. 凭据核对：`<创作根>/.ai-editor/cloud.json` 权限应为 `600`；`project.json` / 备份 zip / 任何 API 响应里都不应出现密码。

- **不可达文案在 AggregateError 形态下拿不到 `cause.code`**（卡 5 oracle 复核登记）
  - 现状：`webdav.ts` 的不可达分支读 `err.cause.code`；当底层抛的是 `AggregateError`（多地址尝试失败，如 `ECONNREFUSED` 被聚合）时 `cause.code` 为 undefined → 文案退回 `fetch failed`（CHANGELOG 卡 2 条目宣称「带上底层错误码」在此时不成立）。
  - 触发条件：用户看到「无法连接云盘（PROPFIND）：fetch failed」这类无信息量提示时。
  - 最小修法：`cause` 为 AggregateError 时遍历 `cause.errors` 取首个带 `code` 的（或取 `cause.errors.map(e => e.code)`）。

- **云根不存在时推送的报错文案误导**（卡 4 oracle 验证登记）
  - 现状：`pushBackup` 只 `MKCOL` **书目录**；若配置的 WebDAV 根路径本身不存在（从未跑过 `/cloud/test`、也没建根），`MKCOL` 会因父目录缺失返回 409 → 映射成 `CLOUD_UNREACHABLE`（「无法连接云盘」），而真实原因是「根目录不存在」。
  - 触发条件：卡 5 打开项目时的后台检查路径（同样先 `PROPFIND` 云根）。
  - 最小修法：书目录 `MKCOL` 之前补一次根 `MKCOL`（幂等），或把 409 单独映射为「云盘根目录不存在」的文案。

- **`head` 改为元数据驱动（CAS）**（卡 4 oracle 验证的反例 1/2 的升级路径）
  - 现状：`head = 文件名时间戳最大者`——跨机器时钟偏差会造成「漏报云端有更新」；`force` 也不能让本机份成为 head（详见 `40-cloud-sync.md` §3「已知边界」）。
  - 触发条件：真实出现「两台机器时钟差导致状态判定长期失真」的反馈。
  - 升级路径：在书目录放一份 `manifest.json`（记录最近一次推送的文件名 + 推送者设备 + 时间），以它作 head；代价是多一个写序（先写包再写 manifest）与「manifest 与包不一致」的容错。

- **云根目录的 `.tmp-` 探测文件永不被清 + DELETE 不可用时 `/cloud/test` 误报认证失败**（卡 2 oracle 验证 F4）
  - 现状：`POST /cloud/test` 会在**云盘根目录**写 `.tmp-ai-editor-writetest` 再删；若服务器允许写但禁止删（DELETE 403），该文件残留，且端点报 502 `CLOUD_AUTH_FAILED`（凭据其实正常）。
  - 影响：卡 4 的保留清理只扫**书目录**，云根这份不会被回收；「`.tmp-*` 无残留」判据的口径需写明范围。
  - **卡 4 已落地：口径定为「只扫书目录」，云根维持现状（接受）**；本条的剩余部分 = DELETE 不可用时 `/cloud/test` 误报 `AUTH_FAILED`（触发条件：真实遇到「可写不可删」的云盘时）。
  - 最小修法：`/test` 的 DELETE 失败降级为「连接可用 + 提示残留」而不是 502；或推送清理扫一遍云根 `.tmp-*`。

## 云端存档（2026-09，MVP 已发布后的遗留项）

- **云端书架**（列云端全部书的目录、一键拉取到本机）
  - 现状（有意）：MVP 只做当前打开的书；第二台机器首次获取走「云盘网页下载 zip → 导入备份」（按 `project.id` 分流：匹配 → 覆盖恢复，不匹配 → 导入新书）。
  - 触发条件：真实用到第三台机器 / 换机频繁，手工下载导入开始痛。
  - 升级路径：`PROPFIND` 云端根列全部 `<书名>-<projectId>` 目录 + 一个新的列表端点 + 一个 UI 区块（拉取后按 id 分流复用现有 import 逻辑）。
- **文件级增量上传**（避免每次全量 `PUT` 整个 zip）
  - 现状（有意）：整包上传（云端文件 = 本地备份文件逐字节拷贝）——实现简单、无格式转换。包体积主要来自 `sessions/`（聊天历史累积）与正文（`data.db` 内的 `document_records`/`（md 文档）。
  - 触发条件：单次推送体积/耗时可感知地变差（或云盘配额被反复烧穿）。
  - 升级路径：云端布局改为「一文件一对象」（`data.db` / `outline.json` / `sessions/**` 分别上传，只传变化项），拉取时本地重新打包成 zip 走现有校验管道；代价是冲突检测与保留策略的粒度全部重做。
- **内建端到端加密**
  - 现状（有意）：明文上传（用户主动选择上传即已把信任边界延伸到云盘厂商；半吊子加密只会制造“以为安全”的错觉）。需要 E2E 的用户用 `rclone serve webdav` + `rclone crypt` 自建桥接（加密在用户侧完成，本仓零代码）。
  - 触发条件：用户群体明确要求「云盘厂商不得看到内容」。
  - 升级路径：上传前 AES-GCM + 密钥管理（密钥放本机 → 新机器解不开；放云端 → 等于没加密）——这也是为什么暂不做（与多设备续写核心体验直接冲突）。
- **云端保留策略的按时间分层（GFS）**
  - 现状（有意）：云端只保留最近 5 份 + 带标签永不清理（主历史在本地 20 份，云端是异地副本而非历史归档）。
  - 触发条件：自动推送频繁到 5 个槽位在一小时内耗尽，且用户确实需要云端更长的回溯窗口。
  - 升级路径：按「每小时最多 1 份 / 每天最多 1 份」分层收敛（rsync 式 GFS）。
- **同一会话在两台机器各自续聊**（并集的已知边界）
  - 现状：并集按「同名 → 云端取胜」，本机那段进覆盖前快照（不静默丢，但用户得知道去 `.backups/` 找）。
  - 升级路径：按会话文件最后一条 entry 的 timestamp 比较（append-only JSONL 语义）；需要解析而不只是列条目，优先级低。

## 前端 / UI

- **大纲页交互无自动化守卫（浏览器像素走查是唯一防线）**（UX 批次 oracle 登记）
  - 现状：本仓无 jsdom，SSR 断言只覆盖「有 presenter 拆分」的组件（如 `CharacterDetailView`）；大纲页/设定树/PanelTree 的页面级交互（场行不渲染新建按钮、根级新建行只建卷且无切换按钮、阅读进度徽标走 `TypeChip`、角标在删除左侧）本轮只经像素量测确认，**未入库为测试**。
  - 影响：下次改动只靠人眼复查（本轮已量测的具体数字见 CHANGELOG）。
  - 触发条件：再改这三处行结构/行尾操作区时。
  - 最小修法：把 Outline 的页头/行操作区拆成 presenter 组件后补 `renderToString` 断言（与人物页同款）；**代价 = 一次真实拆分**，不要在页面里塞测试钩子。
  - **2026-09 局部兑现**：章视图已拆为 presenter（`components/outline/chapter-view.tsx`）+ `chapter-view.test.tsx`（renderToString：两枚编号徽标 / 命名态输入框 / 空态 / **否定契约**——不断言 `<button` 与 `draggable`，钉住「不搬删除·新建·拖拽进来」）；**大纲树行仍未拆**（本次只改徽标内容与占位几何，未动交互语义）——下次改树行操作区时仍按上一条拆。
- **章视图不做结构编辑**（2026-09 大纲页双视图）
  - 现状：章视图只有「改标题 + 进详情」，删除 / 新建场 / 拖拽排序全在大纲树。
  - 触发条件：用户反馈要在章视图里直接排序或新建章。
  - 最小修法：把树行渲染（现闭在 `Outline.tsx` 的 `renderNodes` 内）抽成可复用 presenter 后给章视图接同行能力；**拖拽需先定义跨卷语义**（平铺列表里卷序不是锚点）。
- **编号未扩散到其他位置**（2026-09）
  - 现状：`第N卷` / `第N章` 只在大纲页两个视图；章详情页标题 / 顶栏阅读进度 / 选章下拉 / 关系与伏笔面板仍是标题原文。
  - 触发条件：用户要求在详情页或下拉里看到章号。
  - 最小修法：详情页与顶栏可直接复用 `lib/outline-tree.ts` 的 `numberOutline`（已有树即可算）；下拉则要改全站公共的 `chapterNodeOptions`（影响人物页/伏笔/时间轴多个调用点），代价最高。
- **antd 是 caret 依赖（`^6.6.2`），而缩进对齐依赖其 `controlHeightSM`**（UX 批次 oracle 登记）
  - 现状：无子节点行占位用 `-ml-2 w-6`（24px）与 antd icon-only `size="small"` 按钮同几何——24 来自 `controlHeight(32) × 0.75`；已在 `components/antd-tokens.test.ts` 加一条「`controlHeightSM === 24`」断言兜底（上游 minor 改动会报红而不是静默错位）。
  - 触发条件：antd minor 升级时（测试会提醒，届时对齐 `w-6` 或改成 token 驱动的宽度）。

- **客户端 `SettingTreeNode.category` 是死键**（2026-09 发布前审计发现）
  - 现状：`client/src/lib/setting-tree.ts` 的树节点带 `category`，只写不读（旧分类徐标残留；`components/entity/setting-tree.tsx:769` 注释已说明改用 tags）；注意 **`EntitySummary.summary.category` 仍是活字段**（`parent-setting-select.tsx` 在渲染），不能一并删。
  - 触发条件：下次触碰设定树数据派生时。
  - 最小修法：删 `SettingTreeNode.category` + 输入映射 + `setting-tree.test.ts` 对应断言。

- **参考资料页「分类徽标」形态与类型徽标不一致**（卡 10.4 登记）
  - 现状：`pages/ReferenceDetail.tsx:354` 的分类徽标已是中性色，但形态是**描边徽标**（`border border-border rounded-md`），与 `TypeChip`（**描边式**：1px `type-badge-border` + `surface-muted` 底 + `rounded-sm`）仍有差异——圆角档不同，且它同时是页头右侧的元信息位（不是行内徽标）。
  - 触发条件：再次调整参考资料页头部布局时。
  - 最小修法：换 `TypeChip`（一行），代价是页头那一块视觉微变（圆角 `rounded-md` → `rounded-sm`、边框色 `border-border` → `type-badge-border`）。
- **关联页端点类型徽标的中文名（卡 5 已修，残留见下）**（卡 10.5 发现 → 2026-09 卡 5 修复）
  - 现状：**已修**——`components/entity/relations-view.tsx` 的 `ENDPOINT_TYPE_LABEL` 改为派生 shared `ENTITY_TYPE_LABELS` + `outline_node`（原先手抄的四类表让 `timepoint`/`event`/`reference` 直接漏英文），过滤下拉同源；单测守住「新增实体类型不再漏中文名」。
  - 残留：「类型→中文名」仍是**三份表**（shared `ENTITY_TYPE_LABELS` / `pages/Trash.tsx` 的 `ENTITY_TYPE_LABEL` / `lib/entity-list.ts` 的列表标签）——三者值已一致，但新增实体类型时要记得同步。
  - 触发条件：再次新增实体类型，或统一类型标签来源时。
  - 升级路径：Trash 与 entity-list 的内联表改派生 shared（各一行 import）。
- **关联对话框其余下拉的浮层宽度**（卡 8.2 oracle 登记，既有）
  - 现状：`select-free-input`（关系类型）已加 `popupMatchSelectWidth={false}`；同弹窗另 4 个 `Select` 与通用关联页两个过滤 `Select` 仍跟触发器宽度（长实体名会截断）。
  - 触发条件：再次触碰这两个文件时。
  - 最小修法：逐个补 `popupMatchSelectWidth={false}`（与人物页排序下拉同口径）。
- **关联对话框每次打开拉一次全量关系**（卡 8.2；性能边界）
  - 现状：为派生「已用自定义类型」，`CreateRelationDialog` 挂载时拉一次 `GET /relation?depth=1`（全量）。
  - 触发条件：大项目（数千条关系）下对话框打开变慢时。
  - 升级路径：给端点加一个 `distinct relation_type` 轻量接口，或把已用类型提升到 store 缓存（失效策略需设计）。
- **`EntityList` 的配置表死键**
  - 现状：`SUMMARY_COLUMNS` / `CREATE_FIRST_FIELD` / `TYPE_LABEL` 仍含 `character`（兜底键，已注明）与 `hook` / `event` / `timepoint`（这些类型已由 `HookPanel` / `Timeline` 承接，键已死）。
  - 触发条件：再次触碰泛型列表页时。
  - 升级路径：收窄 `ListableEntityType` 为 `setting | location`，连带清掉查表与空态文案（属独立小重构）。
- **合并行删除提示**（卡 3.6 打磨残留）
  - 现状：对称关系（`ally`/`rival`/`family`）合并行删除只删方向边（out）那一条，确认文案已声明"只删其中一条"。
  - 最小修法：删除成功后的 toast 补一句「另一方向的关系仍在」。
- **`OutlineNodeSelect` 有三份实现**（`HookPanel` / `EntityDetail` / `Timeline`）
  - 现状：新建/编辑弹窗、详情页表单、时间轴各自实现同款"选大纲节点"下拉；卡 7.1/7.2 的口径漂移（进度节点与预计回收节点一度全层级可选的根因）正是这种重复。
  - 现状补充（2026-09 卡 9.3）：人物页进度节点下拉已加 `showSearch`（`optionFilterProp="label"`），其余同款下拉无搜索——搜索口径也开始分叉。
  - 触发条件：第四次需要同款控件，或再次出现口径漂移。
  - 升级路径：抽一个公共 `OutlineNodeSelect`（选项派生由调用方给定：章-only 用 `chapterNodeOptions`，自由引用用 `flattenTree`），配一条源码守卫防回退。
- **伏笔关系类型在通用"新建关联"弹窗里可能造出必 400 的入口**（未验证可达性）
  - 现状：`create-relation-dialog` 的端点选择器是全层级（关系端点本就是泛型），但伏笔关系 `plants`/`advances`/`resolves` 的源端服务端**硬校验章**（400）。
  - 待确认：从该弹窗能否为 hook 源端选到场景/卷；若可达 → 收窄该场景的关系类型/端点选项。
- **人物页 vs 泛型详情页抽公共层**（`entity-fields.tsx` 之类）
  - 现状口径（有意）：泛型 `EntityList`/`EntityDetail` **已冻结**只服务 setting/location，人物页独立演化；`FieldControl` / `TagsEditor` / `CustomFieldsEditor` 因此有近似两份实现。
  - 触发条件：第三处页面也要这套字段控件时（两处不值得）。
  - 升级路径：把字段控件与标签编辑器上提为独立组件，泛型页与人物页同时改用它。

## AI / 产品能力

- **能力面板模板库**（跨书复用 / 命名管理）
  - 现状：只有「内置 3 套 + 从角色复制结构」。
  - 升级路径：把派生函数的"源"从**角色记录**换成**模板记录**（零返工）。
- **面板相关 AI 一致性规则**（如"等级不得下降"）
  - 现状：不做。
  - 结论：自由结构下硬编码规则会大量误报，YAGNI。
- **人物页 Delta 时间线**（该角色跨章节的变更记录列表）
  - 现状：由 AI 的 `get_delta_history` 覆盖（页面不给时间线 UI）。
  - 触发条件：作者频繁需要"逐条回看这个角色改过什么"。

## 桌面版（v0.0.40 已交付主功能）

> 已交付部分（书库位置 / 目录选择闭环 / 菜单与日志 / 安全与导航 / 设置页通用 tab / Windows 打包 workflow）见根 `CHANGELOG.md` 的 `## [v0.0.40]` 与 `## [v0.0.41]`；设计契约见 `docs/design/50-desktop.md`。下列是**仍未做**的顺延项与待验证项：

- **`log.ts` 只接管 `console.log/warn/error`（未接管 `info`/`debug`）** — 现状：桌面版日志落盘的唯一实现只替换这三个方法（`console.info !== console.log`，实测），任何用 `console.info`/`console.debug` 输出的库都不落盘；当前靠调用方显式接 logger 绕过（2026-10 更新器即如此：`autoUpdater.logger = { info: (m) => console.log(m), … }`）。影响：真机排障时库的 info 级上下文丢失（只留 error/warn）。触发条件：下一次某个依赖的 info/debug 输出成为排障必需。最小修法：`log.ts` 的 levels 表加 `["info", "info"]` / `["debug", "debug"]`；**副作用要先想清楚**——Chromium/依赖的 debug 噪声会进水，可能需要按前缀过滤或另开 verbose 开关。
- **窗口尺寸/位置记忆** — 现状：每次启动回默认尺寸。触发条件：有用户抱怨布局丢失（与 `localStorage` 面板偏好丢失同源体验问题，一起做）。最小修法：写进 `desktop.json`（一个 `window` 字段），窗口 `resize`/`move` 防抖写入。
- **Windows 代码签名 + macOS 公证** — 现状：不签名（Windows 有 SmartScreen 提示、macOS 首次需右键打开）。**不再是自动更新的前置**：Windows 更新已在未签名下跑通，代价是信任锚仅为「GitHub Releases + sha512」且 SmartScreen 提示不消（安全边界见 `50-desktop.md` §5.2）。触发条件：SmartScreen/安全提示成为反馈主题，或分发规模需要用户侧验签。升级路径：Windows 代码签名证书（或 Azure Trusted Signing）→ `electron-builder` 的 `signtool` / `win.publisherName`（写上后会**自动启用**更新包的 Authenticode 校验）；macOS 另需 Apple Developer（$99/年）+ `notarize` 配置。
- **手动检查在慢网下会先弹一个「正在后台下载…」框（两个框的观感）**（2026-09-16 真机）— 现状：v0.0.45+ 已修「已下完还说正在下载」的假话（下载秒回时只弹安装框），但下载确实耗时（>1.2s 判定窗口）时仍会先弹「正在后台下载…」、用户关闭后再弹「已下载」——两句都是真话但观感啰嗦。触发条件：用户反馈这一点。最小修法：去掉中间框（代价：慢网下点菜单后长时间无任何回应）；或做非模态进度（要 client UI，见「设置页内嵌更新面板」条）。

- **设置页内嵌更新面板**（显示版本 / 手动检查 / 下载进度）— 现状：v0.0.44 起更新走主进程原生对话框 + 菜单「帮助 → 检查更新…」，client 侧零改动（`50-desktop.md` §5.2）。触发条件：用户反馈找不到检查入口、或要看下载进度。最小修法：扩 `DesktopBridge`（invoke + 状态推送）+ 设置页「通用」一行，更新逻辑不动。
- **非打包态（win32 开发机）点「检查更新…」会显示「已是最新版本」**（`50-desktop.md` §5.2 的守卫只管 win32，dev 态 electron-updater 直接不检查）— 现状：有回应但信息是假的（oracle 复核登记）。触发条件：dev 态被这条误导过。最小修法：`isUpdateSupported()` 里补 `&& app.isPackaged`（一处改动同时让菜单项消失，符合 main.ts「onCheckUpdates 为 null = 没有更新能力」原则）；**不要**只在 `checkForUpdatesManually` 里加分支（那会留下一个点了就撒谎的菜单项）。
- **`await closeServer()` 之后 `quitAndInstall` 失败的窗口期**（应用活着但后端已关）— 现状：同步失败只可能在 `installerPath == null`（与 `update-downloaded` 事件矛盾，几乎不可达）；真实失败是 spawn 的**异步**错误（EACCES/ENOENT，杀软拦截同列），那时应用照常退出、只是没装上，兜底也拦不到。触发条件：真机日志出现 `Cannot run installer: error code: …`。最小修法：`quitAndInstall` 前 `autoUpdater.once("error", …)` 弹一次错误框（3 行）；当前不做（YAGNI）。
- **更新灰度 / 预发布通道** — 现状：所有安装态都从 `/releases/latest` 拿最新正式版。触发条件：需要先给部分人验版本。**口径（必须遵守）**：将来若发 `vX.Y.Z-beta.1` 这类 tag，Release **必须勾 prerelease**——否则 `/releases/latest` 会把 beta 推给所有正式用户（`50-desktop.md` §5.2）。
- **macOS / Linux 自动更新** — 现状：更新器有 win32 守卫，只对 Windows 安装态生效。触发条件：相应平台恢复出包（macOS 另需签名/公证——那是 electron-updater 的硬前置）。
- **端口 +1 时的偏好丢失** — 现状：3456 被别的程序占用时落到 3457，`localStorage` 按 origin 隔离 → 主题/面板偏好重置（一次）。触发条件：真实反馈重复出现。升级路径：自定义协议 `app://` + protocol handler 反代 `/api/*`（需验证 SSE 流透传）；或偏好转经服务端配置持久化。
- **Linux deb/rpm 包** — 现状：只有 AppImage。触发条件：Linux 用户量起来。
- **开机自启** — 现状：不做。触发条件：用户要求（与「自动备份需要进程活着的」的期待相关）。
- **`pnpm deploy` 失效时的 esbuild 兜底** — 现状：主路径未验证通过前不预先实现兜底。触发条件：打包主路径（`pnpm deploy` + electron-builder）被实测证伪（collect 不到 workspace 依赖或原生模块 load 失败）。
- **Windows 包的真实安装验收（只能人工/真机）** — 现状：`desktop.yml` 已在 v0.0.40 跑通三平台、随后收窄为只出 Windows；包能构建、能下载，但**「装得上、启得开、选书库、建库、导入备份」全链路未在真实 Windows 上逐项验过**（本仓开发机是 WSL，Windows 交叉构建需 Wine 故不做）。触发条件：发版后拿到 exe 的人实测。最小验证：安装 → 首次启动直达书架 → 新建一本 → 导入一个备份（书名应取自备份而非 zip 文件名）。
- **自动检查失败对网络不稳的用户完全不可见** — 现状：启动检查失败只落日志（设计如此，避免网络抖动打扰创作）；实测真机直连 GitHub 不稳时会出现 `net::ERR_CONNECTION_TIMED_OUT`，用户**既看不到失败也永远收不到更新**（手动点检查才会看到提示）。触发条件：出现「版本一直不更新」类反馈。最小修法：连续 N 次自动检查失败后在菜单「帮助 → 检查更新…」旁或启动时提示一次；或给菜单项加状态标识。

- **卸载器「清除使用数据」的删除分支 + 签名门禁负向用例（只能真机）** — 现状：卸载流程本身**未实测过**（2026-09-16 那次数据消失是用户手工删的，不是卸载器干的）。触发条件：下次在真机卸载时。最小验证：卸载选「是」→ 带签名文件（`.ai-editor/library.json`）的书库与 `%APPDATA%\AI Editor` 应被清；事先手工建一个**无签名**的同名目录 `<文档>\AI Editor` → 卸载选「是」后它**必须仍在**（防误删的负向用例）；选「否」则全部保留。
- **安装器缓存副本是否真被卸载清掉（真机）** — 现状：`installer.nsh` 在用户主动卸载时 `RMDir /r "$LOCALAPPDATA\ai-editor-desktop-updater"`，但未在真机确认过。触发条件：下次卸载时。最小验证：卸载后 `%LOCALAPPDATA%` 下不应再有 `ai-editor-desktop-updater\`（安装时会新建）；带 scope 的旧名残留也应被清。
- **macOS 的两处菜单行为（无 mac 环境可验）** — 现状：Edit 角色菜单（Cmd+C/V）与「打开书库/日志目录」的 `shell.openPath` 均未在 macOS 上验证。触发条件：有 mac 环境时。
- **撤 `latest.yml` 的负向用例（低优先级，只能真机）** — 现状：手动检查在云端元数据缺失时应弹「检查更新失败」而不是假「已是最新」（自动路径的静默失败已在真机验过：网络超时只落 `[error]`）。触发条件：顺手能验时。

- **GitHub Actions 的 Node 20 弃用告警（v0.0.44 首现）** — 现状：Desktop workflow 报 `actions/upload-artifact@v4` 与 `softprops/action-gh-release@v2` 被强制跑在 Node 24（`Node.js 20 is deprecated`），**仅告警、任务成功**。触发条件：上游改成硬报错，或两个 action 各抬一个 major（`upload-artifact@v5` / `action-gh-release@v3`）时。最小修法：两个 action 各抬一个 major，其余 `actions/*` 一并核对（三个 workflow 共用）。

- **CI 侧打包态启动冒烟（缺失的护栏）** — 现状：卡 A1/A2 验收里的「打包后起一次」只在本地人工做过（v0.0.44 的 `electron-updater` ESM 具名导入就是这样被捉到的：typecheck/lint/单测全绿，打包态直接启动失败），CI 只验证「包能构建、三资产齐全」，**不验证「包能起来」**。触发条件：下一次主进程依赖/import 变动导致同类回归（很便宜就能重现）。最小修法：`desktop.yml` 在 electron-builder 后加一步：解压/使用 `release/win-unpacked/ai-editor.exe --user-data-dir=<tmp>`，等几秒后断言日志里有「菜单已就绪」且无 `SyntaxError`/`Uncaught Exception`（Windows runner 需要处理无交互会话下的窗口创建，可能要 `--no-sandbox` 或改为断言「主进程跑到了 server 启动行」）。

- **Windows 自动更新的真机闭环** — ✅ **已完成（2026-09-16/17，连续五跳：0.0.44→0.45→0.46→0.47→0.48）**：差分下载（每跳 1~2%）、静默安装（`--updated,/S,--force-run`）、自动拉起、版本号确实变化、v0.0.45 起全程无清除数据框；明细与「代码新旧指纹」见 `50-desktop.md` §5.2「验证状态」。**残留两个未专门观测的小项**：升级时是否弹 UAC（预期不弹，per-user）、安装对话框的 Esc/Enter 是否都走「稍后」。
- **macOS / Linux 安装包的恢复** — 现状：matrix 里两项已注释（无真实用户需求 + 无 mac 环境可验）。触发条件：出现相应平台的真实用户。（Linux 包本机可随时出；macOS 需 mac runner。）
- **原生文件对话框的真实桌面验收（只能人工）** — 现状：WSLg 下 GTK 文件对话框挂起，开发机无法断言其可见性与交互（最小 Electron 对照实验同样挂起 → 环境问题，非本仓代码）。影响：首次启动选目录、书架页「浏览…」、设置页「更改书库位置」三处的真实体验未验证。触发条件：有 macOS / Windows / 真实 Linux 桌面环境可用时。最小验证：首次启动点一次选目录 + 选完确认重启后是否直达该书库。

## 块文档与正文（2026-10，批 12 交付后的遗留项）

- **块文档格式选型的历史论证（已否决方案，勿重提）** — 2026-10 决策：正文/参考资料真相 = `document_records.content`（BlockNote 块数组 JSON，随 `data.db`）。**已否决**：① 项目目录 `manuscript/<章id>.md` 为真相（md↔块为**双向有损**转换，每次「打开→保存」都可能静默丢颜色/对齐/嵌套，且要额外维护备份四处同步 + `.trash/` + mtime 台账）；② `references/` 目录继续作真相（同上，且参考资料要改为受限 schema）。触发条件：只有在「必须能被 Obsidian 等外部编辑器直接改写正文」成为硬需求时才重新评估——届时升级路径 = 反向导出（块 JSON → md 落盘）+ 明确主从（导出物只读）。详细对比见本文件历史与批 12 的讨论记录。
- **全书正文导出** — 现状：只能逐章导出（页头「导出」）。触发条件：作者要交给外部工具/自留稿。最小修法：client 侧逐章 `GET /manuscript/:id` + `blocksToMarkdownLossy` 打包 zip（无新端点；注意 md 有损提示）。
- **正文检索工具 `search_manuscript`** — 现状：AI 只能逐章读（`get_chapter_text`）。触发条件：章节数上来后 AI 常找不到「哪章写过灵脉」。最小修法：`content_text` LIKE + 命中片段（与 `search_references` 同风格）；注意工具越多每轮工具列表越贵——先验证真实使用频率。
- **AI 建议落库（章级批注）** — 现状：AI 对正文的建议只活在对话里（L1）。触发条件：用户反复问「刚才那条建议呢」。升级路径：新表（章级 suggestion：锚点可为块 id/纯章级）+ 采纳/忽略状态 + 正文页侧栏列表；**不得**演进为「AI 直写正文」。
- **正文只读/专注模式** — 现状：WYSIWYG 打开即编辑（无模式切换）。触发条件：需要纯净阅读/打印体验。最小修法：同一个编辑器 `editable={false}` + 隐藏工具栏。
- **桌面版「另存为」原生对话框** — 现状：导入导出走标准 `<input type=file>` / `<a download>`（桌面版会落在默认下载目录）。触发条件：用户抱怨找不到导出文件。最小修法：preload 新增 `saveTextFile()`（必须走 `desktopBridge()` 能力检测，浏览器形态不变）。
- **正文级搜索/全文统计（UI 侧）** — 现状：只有大纲/章视图的 `metadata.textLength` 与参考资料列表摘要。触发条件：全书搜索需求落地时（与 `search_manuscript` 同批考虑，复用 `content_text`）。
- **块编辑器升级纪律的执行细则** — 现状：`@blocknote/*` exact pin，升级 = 显式 commit + 全量测 + 像素核对（同 pi）。触发条件：每次升级时要核对的清单（`blockSpecs`/`--bn-*` 变量名/ariakit 变体行为）——目前只有原则，无 checklist。
- **md 导入的有损提示误报（卡 12.6 oracle 登记，安全侧放大）** — 现状：判定 = `blocksToMarkdownLossy(tryParseMarkdownToBlocks(原文))` 与归一化后的原文比对；**外部编辑器的合法写法会被判「有损」并弹确认**（实测：`-` 列表→`*`、`1)`→`1.`、`---`→`***`、`<br>`、无语言围栏的代码块→`text`、md 表格补对齐空格、行首全角空格）。自产 md 再导入不误报（校定 canonical），所以不是死循环；代价是用户多点一次确认。触发条件：实际导入外部草稿的用户抱怨频繁。收紧路径：改为比较「块级文本内容集合」而非 md 串（需写一个 md→文本片段的轻量抽取器，或直接比较两次 parse 的块 JSON 文本）。
- **`sanitizeDocumentFileName` 的两处小缺陷（卡 12.6 oracle 登记，低危）** — ① docstring 声称「去首尾点」但 `../../etc/passwd` → `.. etc passwd`（首点残留；单段下载名，浏览器会平坦化，无穿越风险）；② 未处理 Windows 保留名（`CON`/`NUL`/`COM1`…）。触发条件：有用户报告下载失败或名字怪异。最小修法：点清理改为「去全部前导点」+ 加保留名后缀。
- **导入路径的三个缺口（卡 12.6 oracle 与 fixer 登记）** — ① JSON 导入无二次确认（契约只要求 md 有损时确认）；② 含未知块类型的 JSON 能过浅校验、可能在挂载时被错误边界接管（与 REST 浅校验同宽）；③ 无文件体积上限。触发条件：真实用户误导入或大文件卡顿。最小修法：共用一次「覆盖前确认」、体积上限常量 + 提示。
- **参考资料正文没有覆盖保护（12.8 卡实测登记）** — 现状：章正文的 `PUT /manuscript/:id` 支持 `base_updated_at` → 409 `DOCUMENT_STALE`；而参考资料走实体泛型 `PUT /entity/reference/:id`，请求 schema 是 `.strict()`（只有 name/data），**无版本戳**，两窗口同时编辑 = 后写覆盖。与其它实体（人物/设定/地点/伏笔/事件/时间点）行为一致，「多标签页并发」本就是 MVP 不做的延期项；真正的保护是**自动保存失败可见 + 重试**（不静默丢改动）。
  - 触发条件：出现真实的多窗口/多设备同时改同一篇笔记并丢内容的疼痛。
  - 升级路径（**先定口径再动手**）：`entityUpdateReqSchema` 加可选 `base_updated_at`；**比较对象必须是 `document_records.updated_at`（正文时间戳）而不是 `entities.updated_at`**——后者在改标签/分类时也会推进，会让「另一窗口只改了标签」造成本地正文保存误报冲突；同时要想清「不带 content 的元数据 PUT 是否需要校验」（倾向不需要）。需要一张独立卡 + oracle。
  - 已知残差（有意接受）：客户端「先 GET 比对再 PUT」的预检方案不可靠（GET→PUT 之间正好是真竞态窗口，且每次自动保存多一次请求），**不要用**。
- **块编辑器接线无自动化回归钉（卡 12.12/12.5 修复轮登记）** — 现状：`initialContent: []` 崩页与 `dictionary: zh` 两个缺陷都只有浏览器走查证据；仓内无 jsdom，组件不参与单测。触发条件：重现「改一行传参把编辑器搞崩」。可选最小修法：按 `design-discipline.test.ts` 的源码扫描风格加一条断言（如 `document-editor.tsx` 必须包含 `dictionary: zh` 且不得出现 `initialContent: []`），或引入 jsdom 只测封装组件的挂载。
- **`document_records` 的两份 DDL 文本差一行行尾注释**（卡 12.2 oracle 登记，P3 无功能影响） — 现状：`packages/db/src/tables.ts` 的声明 DDL 在 `PRIMARY KEY (owner_kind, owner_id)` 后带 `-- 一 owner 一行（…）` 注释，`migrations/008_document_records.ts` 的迁移 DDL 无该注释；去注释后逐字相等。唯一消费该文本的是「v0 空库结构快照」（只对 `user_version === 0` 生效，已到 v8 的库不参与）。触发条件：有人想加「迁移 DDL 文本 == 声明 DDL 文本」的断言时。最小修法：把注释挪到行首或去掉（同步改两处）。

## MVP 明确不做（勿顺手实现）

多标签页并发、undo、token 统计、跨书参考资料导入——为 MVP 边界，实现前需先改产品口径（见 `00-master-design.md`）。**正文侧的「多标签页并发」已有局部防守**：块文档保存携带 `base_updated_at`，不一致回 409 `DOCUMENT_STALE`（防覆盖，不做协同合并）。

## 有意保留（非待办，仅登记）

- **REST 保持泛型**：直连 API 仍可为 `hook.status` 写 `op=update`、为 character 写已移除字段。收窄落在前端 + AI 提案层 + executor；这是**分层口径**，不是漏改（已在 `10-data-model.md` §14 不变式 1 登记）。
- **`filters.status`**：保留给 hook 生命周期查询，character 侧不再消费。
- **数据/接口字段名 `current_position` 不改**：前端显示为「阅读进度」（UI 文案与字段名分离，见 `../ui/DESIGN.md` `character-workbench` 与 `../api/10-api-project.md`）。
- **延期项≠技术债记录**：真正"必须做但没做"的项请写进本文件的相应小节，并在触发条件写清"何时必须做"。
- **大纲页 / 设定页不迁移 antd `Tree`（2026-09 考察结论）**
  - 结论：保持自绘缩进行。成本 = `Outline.tsx` / `setting-tree.tsx` 两处视图层重写（纯逻辑 `lib/outline-tree.ts` / `lib/setting-tree.ts` 与单测可留）；**语义冲突在拖拽**——rc-tree 用鼠标水平位置（`dropLevelOffset`）决定落层级，与现有「行上下半 = 同级前后 / 行中段 = 成为子级 / 空白区 = 排根末尾」·三套语义不对应，且**空片区落点 rc-tree 无对应**；antd `Tree.js` 把 `dropIndicatorRender` 写在 props 展开之后（**不可注入**），指示线只能改 CSS。
  - 收益只有两项：键盘导航（↑↓ `activeKey` / ←→ 折叠）、大树虚拟滚动（`virtual` 默认 true）——但**触发条件：单本项目大纲节点数百且展开卡顿，或明确需要键盘无障碍时**⇒ **按需单点补**（默认只展开卷 / 只给大纲页加虚拟列表 / rc-tree 直接接管），不换引擎。
  - 可用 token（日后真要迁）：`indentSize` / `titleHeight`（默认 = `controlHeightSM` 24，可按层级覆盖）、`nodeSelectedBg`；v6 语义槽 `classNames.item|itemTitle|itemSwitcher|itemIcon`。
  - **已失效的旧理由（不要再用）**：`DESIGN.md` 曾写「antd Tree 选中面派生 token 不可信」——`controlItemBgActive` 已在 `AntdProvider` 全局覆盖为 `{colors.surface-muted}`，并有 `antd-tokens.test.ts` 对比度守卫；真理由是行为集与拖拽语义。
