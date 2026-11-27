# 开发遗留项（Backlog）

**性质**：已知但**未排期**的遗留项与有意保留的口径。不是承诺清单，不排优先级；需要时按「最小修法 / 升级路径」评估成卡（进 `tasks.md`）再动手。

- 纪律：**新发现的小项先进本文件，不即时插队**当前批次；卡内不做卡外顺手改动。
- 每条尽量给：现状 → 影响 → 触发条件（什么时候才值得做）→ 最小修法 / 升级路径。
- 「有意保留（非待办）」小节 = 已登记的设计口径，**不要**当 bug 去"修"。

---

## 数据与契约

- **章级历史的深度与开销**（2026-11 章级历史交付后登记）
  - 现状：60s 节流 / 每章 4 份 / 全书预算 = 正文总量 × 4 ⇒ 约「最近 4 分钟」可退。千章书实测：每次保存 +**5.38ms**（p50），其中 **4.69ms** 是预算基数那条 `SUM(LENGTH(content_text))`（每次真压快照后重算全书正文总量），随章数线性增长。
  - 触发条件：作者反馈「历史太短」，或万章级书下保存延迟可感知。
  - 最小修法：深度个参数**必须同值同抬**（`MAX_SNAPSHOTS_PER_DOCUMENT` 与 `SNAPSHOT_BUDGET_MULTIPLIER`）——只抬一个又会回到「参数互相压制」（后者把前者静默压成更小值，且不报错）；开销侧改成复用保存路径已知的 `statsDelta` 维护累计值，去掉每次保存的全表 `SUM`。

- **码字统计的延期项（2026-11，随 `writing_stats_daily` 落地登记）**
  - 现状：v1 只有「按天 · 正增量 · 只存日合计」；会话面板是进程内状态。以下均**未做**：每日写作时长 / 空闲时长落库、逐章统计、按会话统计、周报 / 月报、设备合并、统计的人工编辑 / 导入 / 导出、跨时区口径、历史数据重算。（**连续天数 / 每日目标已不在本清单**：已按「日行派生视图 + 本机偏好」定稿，口径见 `../api/130-api-writing-stats.md`。）
  - 触发条件：出现「想看每天写了多久 / 每章写了多少 / 周报 / 多设备合并 / 修正统计」的真实需求时。
  - 升级路径：时长需新增按会话或按日的**时长表**（当前表只有字数，不预留空列）；逐章需在保存时同时写章维度；周报 / 月报仍是日行的派生视图，先补 UI 再评估是否落表；设备合并需要一个客户端设备标识 + 冲突口径，先改 `docs/design/40-cloud-sync.md`；统计编辑 / 导入会破坏「统计是正文派生」的不变式，必须先在 `10-data-model.md` §13.1 重新拍板。
  - 已知边界（不是缺陷）：恢复旧备份 / 云拉取会连统计一起回退；文件导入计入当日、但面板「本次」不计；删除正文不扣减；窄中栏的年度热力横向滚动。

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

- **书名校验两份实现**（2026-09 发布前审计发现，21.5 oracle 扩登）
  - 现状：`client/src/lib/book-name.ts` 与 `server/src/routes/project.ts` 各有一份同正则 + 同中文文案的校验（跨包共享缺口，两处注释都只承认「客户端跳包不共享」）。
  - 触发条件：下次改书名规则或文案时。
  - 最小修法：提 shared 纯函数 + 文案常量（REST schema、两处路由校验、客户端预校验共用）；**先定错误码差异**（`INVALID_PROJECT_PATH` vs `VALIDATION_ERROR`）再收敛，别顺手改。

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
  - 最小修法：该框在「本机无备份」时把「上传旧备份」禁用，并照 `DESIGN.md` §Components「云端存档」的口径提示先「立即备份」（另一半「立即手动备份并推送」仍可用）。
- **`BACKUP_CHANGE_TOLERANCE_MS` 的容差边界无覆盖**（卡 B oracle 登记的剩余部分）
  - 现状：`sessions/` 侧已改「备份时间戳 +1ms」造真实序（v0.0.51 清掉未来 mtime 构造）；`data.db` / `data.db-wal` 的 1s 容差（备份管道 `wal_checkpoint` 自激防护）在 0 / 1000ms 边界仍无用例。
  - 何时必须做：改 `BACKUP_CHANGE_TOLERANCE_MS` 或 `hasUnbackedChanges` 的基准口径时，补这两条边界用例。
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
  - **`DESIGN.md` 失败态口径已对齐（2026-09 兑现）**：文档现写「刻意不做独立「重试」按钮与 `empty-state`」，与代码（纯文案）一致。
  - **`getProjectBackups()` 失败与「真的没有备份」不可区分**（`.catch(() => null)` → 冲突框禁用强推并说「本机还没有备份」，可能不实）。
- **真云盘（坚果云）人工验收清单**（自动化环境只到「本地 WebDAV + mock fetch」；真实云盘的认证/配额/时区三项无法在 CI 覆盖）
  1. 坚果云网页端 → 安全选项 → **添加应用密码**（不是账号主密码）；在设置页「备份 → 云端备份」填**云盘根** `https://dav.jianguoyun.com/dav` + 注册邮箱 + 应用密码 → **保存** → **测试连接**（期望 toast「连接成功，已写入并删除测试文件」；应用会在其下自动建立并使用 `ai-editor/` 工作目录）。
  2. 点「立即备份」→ 点「推送到云端」：坚果云网页端应出现 `ai-editor/书名-<完整 projectId>/…-手动-<设备>-人物N-设定N-章N.zip`（工作根 `ai-editor/` 由应用自动创建；书目录名带 id，不是只按书名；名字过长被云盘拒时会回退为 `ai-editor-<id>` 或纯 `<id>`）。
  3. 另一台机器（或换一个创作根模拟）：同样的 WebDAV 配置 + 同一本书 → 打开项目 → 点左栏「同步云端」：若云端有份而本机无记录 → 期望弹**裁决框**；选「保留云端」后本机三文件被云端那份覆盖（覆盖前状态进 `.backups/`），**本机 `sessions/` 不动**（会话不参与同步）。
  4. 在本机改一处创作数据 → 关掉自动备份频率（把频率设为「关闭」）但保持自动推送开启 → 等过一个备份 tick → 期望**云端不变**、面板只显示「有改动未进最新备份」提示行与「自动推送不会触发」条件提示（口径：自动推送随备份频率生效，见 `40-cloud-sync.md` §5；对照项 = 把频率改回 10 分钟后手动备份一次，下一次有改动时 tick 应真的推）。
  5. 制造失败：把 WebDAV 地址改成不可达 → 点「同步云端」→ 期望只 toast「云端不可达（…），本地功能不受影响」、**角标不亮**；恢复地址后点一次推送 → 面板失败行应消失（`lastAutoPushError` 的唯一清除点 = 任何一次推送成功）。
  6. 配额/时区：坚果云免费账户有 1GB/月上传流量；跨时区两台机器的份按**文件集合**判定（不看时间戳），不应误报「已同步」。上传超 500MB 的包会被拒绝（`CLOUD_BACKUP_TOO_LARGE`，本机体积上限提示）。
  7. 凭据核对：`<创作根>/.ai-editor/cloud.json` 权限应为 `600`；`project.json` / 备份 zip / 任何 API 响应里都不应出现密码。

- **不可达文案已能拿到底层错误码（2026-09 兑现）**：`webdav.ts` 的 `describeErrorCause` 会展开 `AggregateError.errors` 并去重合并 code，`40-cloud-sync.md` 已按新行为描述。

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

- **项目规则随包搬运的三个已知边界（2026-11）**
  - ① **旧版本不认新包**：含 `AGENTS.md` 条目的包在旧版本上被白名单拒（400 `INVALID_BACKUP`）——只做前向兼容、不做降级；回退版本后需用旧包，或手工删掉包内该条目。
  - ② **当前会话仍用旧规则**：恢复 / 导入 / 云端拉取替换了文件，但运行中的会话在装配时已把规则读进 `agentsFilesOverride`（`packages/agent/src/runtime/resources.ts`），要换会话或重开项目才生效。
  - ③ **外部删除规则文件不触发备份**：变更判定把「基准之后从有到无」视为未变更（否则从未有规则的项目每 tick 都备份一次）；在文件管理器里删掉规则后需手动备份一次才会进包（包内无条目 ⇒ 他机恢复时删本机规则）。

## 云端存档（2026-09，MVP 已发布后的遗留项）

- **导入的书首次打开后变 `local-ahead`（2026-09 浏览器端到端实测登记，体验型）**
  - 机制：导入包里的 `data.db` 无伴生 `-wal`；首次打开该书时引擎创建/写 `data.db-wal`（job 归一、一致性补标等书务写入），mtime 晚于 `lastSyncAt` ⇒ 状态从 `synced` 转 `local-ahead`（点「同步云端」弹旧备份确认框）。**不是冲突**（云端集合未变），无数据风险；点「立即手动备份并推送」即回到已同步。
  - 触发条件：「从云端恢复 → 打开 → 首次同步」这个必然路径上多一些摩擦；用户抱怨时再做。
  - 最小修法：book state 加可选 `importedAt`（导入时写）；`setCurrentProject` 打开项目时若该书 state 有 `importedAt` → 把它当「导入后尚未打开」，把 `lastSyncAt` 重置为 `max(now, ceil(三文件 mtime))` 并删标记（即首次打开后再取一次基准，书务写入不再计入改动）。需同步改 `docs/api/100-api-cloud.md` 的边界段与加一条开路径测试。
  - 备选（不推荐）：改变更判定忽略 `-wal`——会丢掉「正文写入触发备份/推送」这个核心信号。

- **从云端恢复面的两个小缺口（2026-09 云端书架 oracle 登记）**
  - ① `GET /cloud/remote-books` 对 `books/` 里损坏的 `project.json` 会抛（`findBookDirById` 同 list/open 口径）⇒ 一本坏书挡住整个恢复面（500）。低频、与既有口径一致，暂不改；真要修则扫描时跳过坏书并单独标一行。
  - ② `import-book` 的 500 `INTERNAL_ERROR`（创作根未注入）未进文档错误码表——与 push/pull 同款（装配错误，不可能在真机上出现），不补。

- **删书端点的两个小缺口（2026-09 删书 oracle 登记）**
  - ① **路由层 409 透传无用例**：`POST /project/delete` 的前置推送撞冲突时承诺原码透传 409 `CLOUD_CONFLICT`（UI 的 force 分支依赖它），但现有「推送失败」用例只走 502；把 `throw err` 变异成硬编码 502，那些用例仍绿。最小修法（7~10 行）：照 502 用例复制一份——stub 里让云端 head 与 `lastPushedFileName` 不同，断言 409 + `code === "CLOUD_CONFLICT"` + 目录/state 保留 + 无 DELETE。
  - ② **force + 推送失败 + 存量无 `dirName` 时文案失真**：实际回 `CLOUD_FILE_NOT_FOUND`（「从未同步过」），而当时云端可能刚被建了空目录。方向安全（云端留档、state 不清、可重试），仅文案不准；下次改这段文案时一并修。
- **云端书架（全量同步）**（列云端全部书的目录、一键拉取到本机）
  - 现状（2026-09 起）：已做**「列 + 导入新书」**（`GET /cloud/remote-books` / `POST /cloud/import-book`，书架「从云端恢复…」）；未做逐书**冲突裁决**与一键拉全部、也无人端删除传播。
  - 触发条件：书多到「逐本点导入」开始痛，或需要以云端为书架视图。
  - 升级路径：在现有列表端点上加「与本机 id 比对」的分流 UI（已有 `localExists`）+ 一键逐本 import；冲突裁决复用 `cloud-conflict-dialog`。
- **一键推送整架书**（把未打开过的书也推上云）
  - 现状（有意）：推送挂在「当前打开的项目」上（自动定时 / 关闭项目 / 手动）；从未打开的书自然没上云，需逐本打开推一次。
  - 触发条件：「配好云盘后发现还有几本没备份」成为真实痛点。
  - 升级路径：遍历 `books/`，对未打开的书临时开 `data.db` 打包推送（注意：要串行、要跳过大目录、要复用 `pushBackup` 的冲突判定）。
- **文件级增量上传**（避免每次全量 `PUT` 整个 zip）
  - 现状（有意）：整包上传（云端文件 = 本地备份文件逐字节拷贝）——实现简单、无格式转换。**包体积 = 三文件**（2026-09 起 `sessions/` 不再进包），主要来自 `data.db` 内的正文本体。
  - 触发条件：单次推送体积/耗时可感知地变差（或云盘配额被反复烧穿）。
  - 升级路径：云端布局改为「一文件一对象」（`data.db` / `outline.json` 分别上传，只传变化项），拉取时本地重新打包成 zip 走现有校验管道；代价是冲突检测与保留策略的粒度全部重做。
- **内建端到端加密**
  - 现状（有意）：明文上传（用户主动选择上传即已把信任边界延伸到云盘厂商；半吊子加密只会制造“以为安全”的错觉）。需要 E2E 的用户用 `rclone serve webdav` + `rclone crypt` 自建桥接（加密在用户侧完成，本仓零代码）。
  - 触发条件：用户群体明确要求「云盘厂商不得看到内容」。
  - 升级路径：上传前 AES-GCM + 密钥管理（密钥放本机 → 新机器解不开；放云端 → 等于没加密）——这也是为什么暂不做（与多设备续写核心体验直接冲突）。
- **云端保留策略的按时间分层（GFS）**
  - 现状（有意）：云端只保留最近 5 份 + 带标签永不清理（主历史在本地 20 份，云端是异地副本而非历史归档）。
  - 触发条件：自动推送频繁到 5 个槽位在一小时内耗尽，且用户确实需要云端更长的回溯窗口。
  - 升级路径：按「每小时最多 1 份 / 每天最多 1 份」分层收敛（rsync 式 GFS）。
- **同步基准的毫秒截断 vs 文件系统 mtime 亚毫秒抖动**（2026-09 发布前审计登记）
  - 现状：`lastSyncAt` 是 ISO（毫秒）基准，`hasChangesSince` 对 `project.json` / `outline.json` / `AGENTS.md` **严格 `>`** 比较；文件 mtime 带亚毫秒且与 `Date.now()` 的截断有抖动 ⇒ 同步完成同一毫秒内落盘的文件可能被读成「本机有改动」——表现为多一次「有未备份改动」/ 自动推送（无数据风险，仅提示噪声）。
  - 触发条件：出现「刚同步完就报本机有改动」的真实反馈（测试侧已用「基准设在未来」的确定性构造避开）。
  - 最小修法：严格比较也加 1ms 容差（或把基准向上取整到秒）——代价是「同步后 1ms 内的改动」漏判；`hasChangesSince` 与相关用例需同改。
- **存量备份包仍含 `sessions/**` 条目**（2026-09 登记）
  - 现状：本地 `.backups/` 与云端旧 zip 里的会话条目读取时接受并忽略（不报错、不搬入）；不做重写迁移。
  - 触发条件：无（靠 20 份本地保留策略自然老化；云端 5 份同理）。
  - 最小修法：不修；若真要省盘，用户手动删 `.backups/` 里的旧份。

- **千章书整包备份与云端推送的体积**（2026-11 规模测量登记）
  - 现状：实测 1000 章 / 157 万字书 `data.db` = 13MB；本地存档与云端推送都是**整包 zip 全量**，云端保留多份。
  - 触发条件：真实用户拿百章级以上书长期使用（每次自动推送都要重传整包）。
  - 最小修法：先量化「一次 zip + 一次上传」的真实耗时/流量，再决定分卷打包或增量（勿提前上增量协议）。

## 前端 / UI

- **4 处手写分区卡应改回 `SectionCard`（2026-11 样式治理时登记）** — 现状：`EntityDetail.tsx` / `TimelineDetail.tsx` 各有 2 处自己写 `rounded-md border border-border p-4` + `<h2 class="text-sm font-semibold">` 的块（基础信息 / 关联），而同语义的 `SectionCard`（antd `Card`）已被用 111 处。两者与 `DESIGN.md` 契约的偏离是可量化的：圆角 6px vs `card` 的 8px、块标题 14px vs `section-title` 的 16px。**与 `skeleton-block` 硬耦合**：那 6 处骨架占位用的是同一个 6px，卡改成 8px 时骨架必须同卡改（否则加载完成瞬间圆角跳一档）。
  - 触发条件：做下一轮样式治理，或有人反馈这两个页面的块边界比别处细。
  - 最小修法：4 处换成 `<SectionCard>`，同时把 `components/ui/skeleton-block.tsx` 的圆角改 `rounded-lg`；**必须浏览器核一次像素**（6→8px、14→16px 都是可见变）。

- **6 处正文链接用的是墨色（与 `colorLink` 契约冲突，2026-11 登记）** — 现状：`character-detail.tsx` ×3、`Dashboard.tsx`、`ReferenceDetail.tsx`、`ReferenceList.tsx` 写的是 `<a className="text-primary hover:underline">`；而 `DESIGN.md` §Colors 明确「Link `#0075de` … **链接是蓝的，按钮是墨的**」，`AntdProvider.tsx` 也确实配了 `colorLink`（浅 `#0075de` / 深 `#529cca`）——`text-primary` 取到的是深墨 `#37352f`。
  - 触发条件：做链接 / 焦点口径收口时，或有用户反馈「分不清哪句是可点的」。
  - 最小修法：先在 `index.css` 的 `@theme inline` 补一行 `--color-link: var(--ant-color-link)`（当前没有 `text-link` 这个类），再把 6 处换成 `text-link`；`dead-token` 守卫会验证新变量有消费者。

- **另两个 chip 语义未收口（2026-11 样式治理时登记）** — 现状：① **静态状态胶囊** 2 处（`Dashboard.tsx` 的书架行 / 作家卡「已打开」：`rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground`）；② **灰底内联 token** 4 处（`change-summary.tsx`、`node-delta-list.tsx`、`HookPanel.tsx` ×2，含 1 处 `font-mono`：`rounded bg-muted px-1.5 py-0.5 text-xs`）。两者都与 `type-badge` 相邻但形态不同（前者描边 hairline + 灰字、后者灰底无描边），因此 **未** 并入 `ref-chip`。
  - 触发条件：同类写法再增 ≥3 处，或「已打开」这类状态需要统一态语。
  - 最小修法：① 状态胶囊先定它和 `type-badge` 的边界（描边色用 hairline 还是 `type-badge-border`），再决定给 `TypeChip` 加第三档还是新建 `status-pill`；② 灰底 token 归「内联代码 / 键名」语义，单独组件，不要与 chip 合并。

- **设定详情页的两个引用 chip 绕过未保存守卫（2026-11 复核发现，存量缺陷）** — 现状：`EntityDetail.tsx` 的「上级 / 子设定」chip 直接 `navigate()`（`:619` / `:640`），而它们渲染在 `SettingWorkbench` 里、该壳持有 `confirmDiscard()`（`:69`，rail 切换 / 后退 / 收起详情都过了它）——从 chip 切到另一个设定时**不经确认就丢弃当前表单编辑**。同文件已有正确写法（`SettingWorkbench.tsx:216` 的「设定树」返回条：`<a href>` + `e.preventDefault()` + `confirmDiscard().then`）。
  - 触发条件：用户从设定详情的上级 / 子设定 chip 跳走且表单 dirty。
  - 最小修法：给 `EntityDetail` 加 `onNavigate?: (to: string) => void`（`SettingWorkbench` 传 `confirmDiscard` 版），chip 改成 `ref-chip` 的 `to` + `onClick` 共存形态；**不要**在 `EntityDetail` 里直接读 leave-guard 模块单槽（壳与内层两级守卫会弹两次）。

- **人物页的加载骨架与加载后形态不一致（2026-11 复核发现）** — 现状：`character-detail.tsx:923` 的骨架是**两列 6px 假卡**（`grid md:grid-cols-2` + 2 个 `p-4` 盒），而加载完成后是 **tabs + 单个 `SectionCard`（antd Card = 8px）**（`:353` / `:409`）——骨架既数不对（2 vs 1），圆角也不对（6 vs 8）。这也是它**不**并入 `skeleton-block` 的原因（组件只服务 EntityDetail / TimelineDetail 那 4 处）。
  - 触发条件：做下一轮样式治理，或有人反馈「人物页加载完会跳一下」。
  - 最小修法：改成单个 `skeleton-block`（`rows={5}` + `className` 带上该页布局）且用 8px 圆角，同时在 `DESIGN.md` 的 `skeleton-block` 条目里把人物页从「例外」拿下。

- **设置页「备份」子导航切换会丢云端账号草稿（2026-11 离开守卫落地后登记）** — 现状：离开守卫覆盖「离开设置页」（左栏四处出口 + 浏览器后退），但「备份」tab 内三级导航（自动备份 ↔ 云端备份）是条件渲染（`panel === "auto" ? <AutoBackupPanel/> : <CloudBackupPanel/>`），切走即卸载云端表单，未保存的账号 / 密码草稿仍静默丢失。同类面里 `config-file-editor` 的四个文件槽**不丢**（已按全槽判 dirty 覆盖）。触发条件：用户填完账号未保存就切到自动备份，或反向。最小修法：子导航 `onClick` 先过同一个 `confirmLeave()`（守卫已就位，只需在切 pane 的入口问一句）；或让两个面板同时挂载（代价 = 进 tab 就拉两份数据）。

- **`models.json` / `settings.json` 两个写入口的旧快照覆盖（2026-11 自定义模型、运行参数两卡登记）** — 现状：两张表单卡都只持有挂载时 GET 的快照（`original` / `loadedText`），而同页下方「本机配置文件」的 JSON 编辑器能直接改同一份文件且不发任何刷新信号；不点「重新读取」就用旧快照整份回写，编辑器的改动被静默抹掉（`models.json` 写前有 `.bak` 可抢回一代；`settings.json` 无备份）。触发条件：出现真实的手编 JSON 后表单覆盖反馈，或同页两入口成为常用路径。最小修法：保存前先 GET 当前文本与快照比对，不一致就提示「文件已被其他入口修改，先重新读」并中止；不要引入 mtime/ETag 第二套真相。

- **单个坏 provider 锁死整张自定义模型卡（2026-11 有意不静默丢弃）** — 现状：`readCustomProviders` 把「某个 provider 不是对象 / `models` 不是数组 / 模型行不是对象」判为整份解析失败，卡片禁用编辑，用户必须去 JSON 分页修（避免静默丢字段）。触发条件：真实反馈「我只想改另一家却被整页拦住」。最小修法：降级为「只禁用该家 + 行内标记原因」，其余家可编辑；保存时只重写可解析的那几家（需先定「坏家是否原样透传」口径）。

- **参考资料详情的「只改元信息不置 pending」（2026-11 保存态单源卡的已知残留）** — 现状：`ReferenceDetail` 的保存态只跟正文（编辑器 `onChange` 置 `pending`、正文自动保存成功置 `saved`；手动保存另发 toast），名称 / 分类 / 标签 / URL 的改动不置 pending——页面没有「元信息 dirty」判定，页头可能显示「已保存 · HH:MM」而元信息尚未提交。触发条件：出现「改了分类没保存却显示已保存」的真实反馈。最小修法：加 `metadataDirty`（form 与 detail 逐字段比较 name / type / tags / url），状态派生与练习页同款（dirty 优先于 saved）；顺带让「保存」按钮在无改动时禁用，并补一条 SSR 断言。

- **升级 `@xyflow/react` 13（2026-11 画布选型时登记）** — 现状：锁 12.12.1（2026-11-02 稳定线）；13.0.1 已发布但仅一天，且有意随之引入 zustand 5 对齐与 `react-compiler-runtime`。触发条件：13.1+ 稳定，或 12 线出现安全 / React 兼容问题。最小修法：一个显式 commit 齐抬版本 + 全量测试 + 浏览器像素核对（base.css 与 `--xy-*` 变量集两版有差异，重点看 `xy-theme.css` 的 `light-dark()` 是否与主题切换冲突）。

- **画布手动「重新布局」按钮（2026-11 有意不做）** — 现状：缺失坐标的章自动落网格末尾，已有坐标永不覆盖；一旦手工挪乱，没有一键恢复入口。触发条件：用户反馈摆位乱且无法收拾，或增加「恢复默认布局」需求。最小修法：画布工具栏加按钮 → 清空该书 `ai-editor:canvas:{projectId}.nodes` 后重跑网格 + `fitView`（需二次确认：会抹掉全部手工摆位）。

- **画布按卷筛选已交付（2026-11）；仍缺搜索** — 现状：筛选现为三维（卷 / 状态 / 剧情线，同对象、未命中淡化不重排、组件态不持久化）；**按关键词定位到章**仍未做（千章下只能靠缩放入眼）。触发条件：真实书稿里「记得章名但找不到卡」。最小修法：工具条加 `search-input`，命中即 `fitView` 到节点；不要把它做成筛选（搜索是定位，不是过滤）。

- **画布交互矩阵扩张（2026-11 有意不做）** — 现状：只有单卡选中、拖摆、拖连、删边、MiniMap / Controls；无框选、多选、对齐吸附、边重连（改端点）。触发条件：用户要求批量整理（移动 / 删除 / 改连）。最小修法：先评估库自带能力（`selectionOnDrag` / `snapToGrid` / `reconnectable`）是否够用，够则开关 + token 调整，不够再补自研——不为此换库。

- **画布远档恒定屏幕字号（2026-11-19 有意不做）** — 现状：far 档 26px 章名 / 14px 数字角标在 0.25 倍率下屏幕约 6.5 / 3.5px，仍不可读；等比缩放的物理下限。触发条件：用户在 0.25 附近仍需要读章名 / 章号。最小修法：far 档标题与角标按 `calc(1 / zoom)` 反向缩放并夹上限（需把 zoom 写到 CSS 变量或节点级 `useStore` 订阅），先做像素核对，不要先加第三档。

- **antd 组件上的 `absolute` 定位（2026-11 实测）** — 现状：antd 会给 `.ant-btn` 等组件注入 `position: relative`，与 Tailwind 的 `.absolute` 同特异性但注入更晚 ⇒ 直接写在 antd 组件的 `className` 上会被压回 `relative`，元素静默贴到错误位置（类型检查与单测全绿，只有像素能发现）。当前靠约定：定位一律挂外层 `div`。触发条件：同类缺陷再现一次 ⇒ 在 `design-discipline.test.ts` 加源码扫描规则（antd 组件的 `className` 里出现 `absolute` / `fixed` / `sticky`）。

- **码字悬浮面板的两处观感短板（2026-11 UI 实测登记，P3）**
  - 现状：面板四指标标签复用全局 12px `text-muted-foreground`，浅色主题实测对比度 4.42:1（低于 WCAG AA 4.5）；深色主题的 `shadow-md` 在近黑底几乎不可见，层级只靠 1px `ring`。两处都是全局 caption / 浮层口径，不是面板独有。
  - 触发条件：做全站对比度或浮层层级收口时。
  - 最小修法：改全局 caption token 或统一加深一级文字色（同时核对 `components/antd-tokens.test.ts` 的对比度断言）；深色浮层阴影需先在 `docs/ui/DESIGN.md` 拍板第二套浮层阴影，不在本功能内顺手改。

- **提案组卡 / YOLO / 设定描述开关缺组件级渲染断言**（2026-11 oracle 登记，低）
  - 现状：组卡与两个 `Switch` 的 DOM 契约（`aria-label` / 风险 `title`、关闭后摘要消失而标题仍在）只有浏览器实测，无 SSR / 渲染测试；两个偏好 hook 的纯函数已有单测。
  - 触发条件：下次改这些控件或升级 antd `Switch` 时。
  - 最小修法：在已有 `ChatPanel` SSR 测试与新增 `setting-tree` 渲染测试中各加 1–2 条断言。

- **`OutlineDetail` 详情壳冗余嵌套**（2026-11 oracle 登记，低）
  - 现状：`flex flex-col gap-4` 外层内再套一层布局等价的 `flex min-w-0 flex-col gap-4`，可合并。
  - 触发条件：下次触碰该页布局时。

- **贴底跟随的「接线」无自动化咬合（2026-09 消息流 oracle 登记，中低危）**
  - 现状：单测只覆盖纯函数 `isNearBottom`（真值表）；`ChatPanel.tsx` 的三处接线——`onScroll` 同步意图、`stickRef` 的上升沿复位（`streaming` / `messagesLoading`）、滚动 effect 里的 `if (stickRef.current)` 守卫——**一起删掉也不会红**（oracle 变异探针 6：38 passed 全绿），即「抖动 / 停不住」的修复本体只靠浏览器核对。
  - 触发条件：再改这三个 effect / 事件时，或需要回归护栏时。
  - 最小修法：把「贴底意图」抽成纯函数（如 `nextStick(prev, { nearBottom, streamingRise, loadingRise })`）配真值表测试；容器赋值本身仍需浏览器核对（无 jsdom）。**同一面还包括**：`MessageList` 里 `liveTools` 只下发尾条消息的收紧（oracle 变异探针 8：回退成全量下发仍全绿，无咬合）。
- **已完结轮的工具行在再发一轮后回落成「进行中」（2026-09 消息流 oracle 登记，已知口径）**
  - 现状：工具状态（ok/error）只存在于本轮瞬态的 `streamTools`，`sendMessage` 会清空它；而历史 `role=tool` 消息要重载会话才有 ⇒ 上一轮的工具行在下一轮开始后回落成「进行中」（转圈 + 主色行，旧实现是灰点，直到重载）。与改动前同口径（非回归），但视觉上像「又在跑」。
  - 触发条件：用户盯着上一轮的工具行看下一轮生成时。
  - 最小修法：把「已完结轮的 callId → status」挂在消息上（随流式消息一起存，重载后被历史 `toolResults` 接管），**不新增全局表**。
- **`agent_end` 之后的同流重试帧被整段丢弃（2026-09 消息流 oracle 登记，既有）**
  - 现状：`stores/chat.ts` 的 `onEvent` 顶部有流身份守卫，而 `agent_end` 把 `currentStreamMsgId` 置 null ⇒ 同一流上后到的 `auto_retry_*` 及其后的正文 / 思考帧全被丢弃（只能重载会话才看得到）。静态阅读证据充分，**帧序未真机验证**。
  - 触发条件：真机遇到「报错重试后回答不上屏」。
  - 最小修法：先真机复现确认帧序，再定是延后清 `currentStreamMsgId`（守卫改成「本轮序号」）还是让重试事件在清空后仍被接受。

- **工具行状态无可读中文文案（2026-09 登记，2026-11 部分收口）**
  - 现状：工具行改用 x `ThoughtChain` 的状态轴后，失败 / 进行中带的是 antd 图标自带的 `role="img"` + `aria-label`（`close-circle` / `loading`，英文）；**成功有意不发任何信号**（回落序号），因此「这次调用成功了吗」仍只能从「不是红叉/不是转圈」反推。
  - 触发条件：做无障碍收口，或用户反馈「看不出这次调用成功没有」。
  - 最小修法：在工具行标题里给状态补充中文可访问名（`aria-label` / `sr-only` 文案），测试断可访问名而非类名。

- **停止生成按钮无可访问名（2026-11 真机实测登记，低）**
  - 现状：`Sender` 的 `loading` 态按钮由 x 内部渲染（`LoadingButton` → `ActionButton`，图标是自绘 SVG），既无 `aria-label` 也无 `title`；真机读到 `aria-label = null`，读屏只能报「按钮」。`Sender` 只认 `onCancel`、不透传该按钮的属性 ⇒ 无法从调用点补名。
  - 触发条件：做无障碍收口，或反馈「读屏不知道那个方块是停止」。
  - 最小修法：自绘停止按钮替掉 `loading` 态（代价 = 接管 x 的 loading 渲染），或给上游提 PR 让 `LoadingButton` 接受可访问名。**不要**把 `title` 打在容器上冒充——读屏仍读不到按钮名。

- **云端恢复框的「导入路径 409 CLOUD_NOT_CONFIGURED」无去设置页入口（2026-09 云端恢复 oracle 登记，低危）**
  - 现状：`cloud-remote-books-dialog.tsx` 只在**列表拉取**失败时置 `loadNotConfigured`；若打开框后凭据被清（罕见），点「导入」得到 409，文案承诺「去设置页」但框内没有那个按钮。
  - 最小修法（~6 行）：加 `importNotConfigured` state，导入错误为 `CLOUD_NOT_CONFIGURED` 时置位并在 presenter 里与列表失败态合并渲染同一个入口。
- **删书确认框的两处文案收窄（2026-09 删书 oracle 登记，低危）**
  - ① **force 分支触发面比契约宽**：现在是「任何 error」都换 `[仍要删除]`（`book-delete-dialog.tsx`），DESIGN 只要求「云前置推送失败」——`INVALID_PROJECT_PATH` 下重试必败，那个按钮是空承诺；严格口径可收窄为 `CLOUD_*` + `INTERNAL_ERROR`（后者必须留：打包失败可 force）。
  - ② **`remoteError` toast 重复**：服务端 message 已含「（本地已删除）」，客户端又拼「云端备份未能删除…可到云盘网页手动清理」→ `CLOUD_NOT_CONFIGURED` / `CLOUD_FILE_NOT_FOUND` 下句子重复且建议无意义。修法：toast 只保留服务端文案 + 一句「本地已删除」。
- **`shelf.test.ts` 一条用例标题强于断言（2026-09 删书 oracle 登记）**
  - 现状：「id 不匹配（同名也算不匹配）」一例传入的 config 没有 `name` 字段 ⇒ 把实现改成按 name 也能通过（真正拦住回退的是同组「同 id → 当前书」用例）。触发条件：下次改 `isCurrentBook` 时。最小修法：给该例的 config 补上与 book 同名的 `name`（一行）。
- **项目镜像刷新的在途去重窗口（2026-09 oracle 登记）**
  - 现状：`loadConfig` 有 `configPromise` 在途复用、`loadOutline` / `loadBookshelf` 在 `loading` 中直接 return、云 `refresh` 有 `inFlight` 合并——「先刷新再跳转」的流程（`openProjectAt` 与导入 / 恢复后的 `Promise.all([loadBookshelf(), loadConfig()])`）里若恰有同类在途请求，会 await 到**旧结果**并跳过新拉（后续 load 会再收敛，镜像短暂滞后）。
  - 触发条件：出现「刚切完书 / 刚导入还是显示旧书」的真实反馈。
  - 最小修法：给这三个 loader 加 `force` 参数（跳过在途复用并重发），调用点传 `force: true`；连带云 `refresh` 的 force。
- **「丢 await」无测试防守（2026-09 oracle 登记）**
  - 现状：`openProjectAt` 的 `await get().loadOutline()` 改成 `void` 也能让现有用例全绿（用例只断言「发了请求」，咬不住「等到了」）；实际语义差异 = 跳转时 config 可能还是旧 id。
  - 触发条件：再改该函数或其它「先刷新再跳转」的流程时。
  - 最小修法：断言「navigate 发生时 store 的 `config.id` 已是新书 id」（现成 mock 已能提供该断言所需数据，一行）。

- **大纲页交互无自动化守卫（浏览器像素走查是唯一防线）**（UX 批次 oracle 登记）
  - 现状：本仓无 jsdom，SSR 断言只覆盖「有 presenter 拆分」的组件（如 `CharacterDetailView`）；大纲页/设定树/PanelTree 的页面级交互（场行不渲染新建按钮、根级新建行只建卷且无切换按钮、阅读进度徽标走 `TypeChip`、角标在删除左侧）本轮只经像素量测确认，**未入库为测试**。
  - 影响：下次改动只靠人眼复查（本轮已量测的具体数字见 CHANGELOG）。
  - 触发条件：再改这三处行结构/行尾操作区时。
  - 最小修法：把 Outline 的页头/行操作区拆成 presenter 组件后补 `renderToString` 断言（与人物页同款）；**代价 = 一次真实拆分**，不要在页面里塞测试钩子。
  - **2026-09 局部兑现 → 2026-11 大纲页收口为 master-detail（rail + 详情）**：章视图 presenter（`components/outline/chapter-view.tsx`）与 `chapter-view.test.tsx` 随本批删除退场；**大纲树行仍未拆**（树行渲染仍闭在 `Outline.tsx` 的 `renderNodes` 内）——下次改树行操作区时仍按上一条拆。
- **章正文面板的大纲兜底「重试」在途时静默 no-op（2026-11 W0 验收登记）**
  - 现状：`ChapterEditor` 的兜底提示用 `useProjectStore.getState().loadOutline({ withMetadata: false })`；store 在 `outlineLoading` 时早退。旧版 `useOutlineLoader().retry` 会把重试排队到在途请求结束后。差异仅「首拉在途时点重试且该请求随后失败」→ 需再点一次；不丢数据、不留错态。
  - 触发条件：用户在大纲加载中看到兜底提示并点击重试。
  - 最小修法：`ChapterEditor` 增可选 `onRetryOutline`，壳传 `useOutlineLoader().retry`；或接受现状并保留本条目。
- **写作页卷章导航栏不做结构编辑（2026-11）**
  - 现状：rail 只有「卷折叠 / 选章 / 字数 / 宽度拖拽 / 收起」，新建章 / 卷、改名、删除、结构拖拽排序全在大纲树。写作页是持续写作面，**有意把结构编辑留给大纲页**（rail 是导航，不是第二个大纲页）。
  - 触发条件：用户反馈「在写作页要能新建下一章 / 调整卷内顺序」。
  - 最小修法：新建章 / 卷走大纲 `POST /outline`（章只能挂卷）；改名 = `PUT /outline/:id`；**拖拽需先定义跨卷语义**（rail 是卷组嵌套，跨卷拖动会同时改 parent 与 order）——实现前先扩 `DESIGN.md` 的 rail 行交互契约并补 SSR 测试。
- **写作页 rail 的扩展能力（2026-11 有意不做）**
  - 现状：无搜索 / 草稿筛选 / 卷章统计，无虚拟滚动与 roving tabindex（章数上千时全量渲染），无「计划剩余字数」（无数据模型）；宽度拖拽 / 收起已落地（6px 手柄 + 0 宽收起，见 `DESIGN.md`）。
  - 触发条件：真实项目章数 / 卷数导致 rail 卡顿，或出现搜索 / 草稿筛选的真实需求。
  - 最小修法：虚拟滚动先量测再引依赖（仓内无虚拟列表库，**不新增**）；键盘导航按 roving tabindex 实现（`aria-current` 已在选中行）；搜索 / 草稿筛选先定数据来源（客户端过滤 vs 服务端查询）。
- **大纲树按标签 / 状态筛选（2026-11 已交付）** — 现状：rail 页头「筛选」+ `Popover`（状态 / 剧情线标签），命中节点连同祖先链**隐藏**未命中整枝；生效时整树强制展开、禁用拖拽、编号恒按全树；组件态不持久化。判定单源 = `filterOutlineNodes`；契约见 `DESIGN.md` `outline-page`。
  - 仍未做：筛选态下的**存储/回访**（有意不做——组件态）与**筛选时的空态引导**（现为一行「无命中」）。
- **大纲树筛选：勾选生效链未做真机核验（2026-11 登记）**
  - 现状：纯函数（`filterOutlineNodes`）与接线（`onChange={setFilter}` 源码扫描）都有测试，弹层也能打开；但**「在真实浏览器里点勾选 → 树真的隐藏未命中行」这一步没验成**——headless 会节流页面定时器，弹层里的复选框点不到（实测两次都未生效，非功能缺陷）。
  - 触发条件：下次改这块 UI，或真实用户反馈「筛选没反应」。
  - 最小修法：用带浏览器工具的一次性核验（点「筛选大纲」→ 勾「草稿」→ 断言 `[data-node-id]` 数下降且全部命中），把结果写进本条后清卡。
- **大纲树章行标签显示开关（2026-11 登记，P2）**
  - 现状：章行有标签就显示第三行，无开关；书稿标签多且长时，树的行高与扫描密度会受影响。
  - 触发条件：真实书稿里标签行明显碍事（用户主动要求收起）。
  - 最小修法：rail header 增一枚 `Switch size="small"`（同设定树「描述」开关），`localStorage` `ai-editor:outline-tags`；关掉只隐藏标签行，不动标题 / 摘要 / 操作。
- **写作页卷章栏标签（2026-11 登记，P2）**
  - 现状：写作页左栏的卷章导航栏只显示章号 / 章名 / 字数，不显示剧情线标签；大纲树与画布都有。
  - 触发条件：用户在写作页需要按剧情线扫章。
  - 最小修法：复用 `outlineTagsFromData` + `previewOutlineTags`，行高与占位沿用写作页 rail 现有几何；不新增数据请求。
- **章行 / 画布卡第三行：长标签会把相邻短标签一起压扁（2026-11 验证登记，P2）**
  - 现状：两个 chip 都是 `min-w-0 truncate`，flex 按内容比例压缩；24 字长标签 + 3 字短标签时，280 / 320px 下短标签只剩 `#…` / `#复…`（600px 完整）。`title` 仍可读；大纲树与画布卡片同款行为。
  - 触发条件：真实书稿使用长标签且用户抱怨相邻短标签不可读。
  - 最小修法：按 `tag.length` 分配 `flexShrink`（长标签先截断），或两标签总字数超预算时只显示第一个 + `+N`；树与画布两处同改并补 SSR 断言。
- **编号未扩散到其他位置**（2026-09）
  - 现状：`第N卷` / `第N章` 只在大纲树与写作页卷章导航栏；章详情页标题 / 顶栏阅读进度 / 选章下拉 / 关系与伏笔面板仍是标题原文。
  - 触发条件：用户要求在详情页或下拉里看到章号。
  - 最小修法：详情页与顶栏可直接复用 `lib/outline-tree.ts` 的 `numberOutline`（已有树即可算）；下拉则要改全站公共的 `chapterNodeOptions`（影响人物页/伏笔/时间轴多个调用点），代价最高。
- **antd 是 caret 依赖（`^6.6.2`），而缩进对齐依赖其 `controlHeightSM`**（UX 批次 oracle 登记）
  - 现状：无子节点行占位用 `-ml-2 w-6`（24px）与 antd icon-only `size="small"` 按钮同几何——24 来自 `controlHeight(32) × 0.75`；已在 `components/antd-tokens.test.ts` 加一条「`controlHeightSM === 24`」断言兜底（上游 minor 改动会报红而不是静默错位）。
  - 触发条件：antd minor 升级时（测试会提醒，届时对齐 `w-6` 或改成 token 驱动的宽度）。

- **客户端 `SettingTreeNode.category` 是死键**（2026-09 发布前审计发现）
  - 现状：`client/src/lib/setting-tree.ts` 的树节点带 `category`，只写不读（旧分类字段残留；`components/entity/setting-rail.tsx:808` 注释已说明改用 tags）；注意 **`EntitySummary.summary.category` 仍是活字段**（`parent-setting-select.tsx` 在渲染），不能一并删。
  - 触发条件：下次触碰设定树数据派生时。
  - 最小修法：删 `SettingTreeNode.category` + 输入映射 + `setting-tree.test.ts` 对应断言。

- **关联页端点类型徽标的中文名（卡 5 已修）**
  - 现状：**已全部收敛**（2026-11）——关系视图 / Delta 徽标 / 回收站 / 关系对话框 / 概览卡 / 实体列表一律派生 shared `ENTITY_TYPE_LABELS`（`outline_node` 这类非实体端点类型在各处单独映射）。守卫 = `design-discipline.test.ts` 的「源码里不得出现手抄的类型→中文名表」（扫 `character: "人物"`）。
- **关联对话框其余下拉的浮层宽度**（卡 8.2 oracle 登记，既有）
  - 现状：`select-free-input`（关系类型）已加 `popupMatchSelectWidth={false}`；同弹窗另 4 个 `Select` 与通用关联页三个过滤 `Select` 仍跟触发器宽度（长实体名会截断）。
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
- **Ctrl+S 存档的窄窗口与未证实项**（2026-09 快捷键卡 oracle 登记，非阻塞）
  - 现状：① 结构化页的「保存中」重入门禁（`if (saving)` 类）直接返回 undefined ⇒ 在途保存未落定时按 Ctrl+S 会不等它落盘就进存档阶段（备份可能缺这一次改动；窗口 ≈ 一次 PUT RTT，写作页的章正文编辑面板已用 `saveNow` 串行链避开）；② `keydown` 的 `e.repeat` 早退帧不做 `preventDefault`（长按是否会重开浏览器原生保存对话框**未证实**）；③ 同步抛错的保存动作会绕过存档阶段（现注册点均 async/返回 promise，无现实路径）。
  - 触发条件：出现「快速连按保存 + Ctrl+S 后备份内容陈旧」的真实反馈；或在真机验证长按 Ctrl+S 的原生行为。
  - 最小修法：门禁分支改成「返回在途保存的 promise」（需各页持有在途引用）或返回 `false`（本次按键未产生保存 → 不存档）；② 把 `preventDefault` 提到 `e.repeat` 判断之前；③ `triggerSaveShortcut` 用 `try/catch` 包住同步调用。
- **时间轴「未挂载」组标题 = 斜体 + `truncate`（同类裁字风险，未复现）**（2026-09 全站扫描登记，低危）
  - 现状：`components/timeline/TimelineGroup.tsx` 的组标题是 `min-w-0 truncate …`，未挂载态另加 `italic`——与左栏顶部「书架」标识（斜体标签）同款组合（合成斜体墨迹越出字宽 ⇒ `overflow: hidden` 切右缘）。该 span 宽度取决于兄弟节点，且本机样本（`test-project`）无未挂载时间点 ⇒ 元素未渲染（8 页扫描 `overflow-x: hidden` + `font-style: italic` 零命中，故未修）。
  - 触发条件：有未挂载时间点的样本上看到「未挂载」右缘被切，或该行被压到文本宽度时。
  - 最小修法：只给未挂载分支补 `pr-0.5`（把斜体越界量让给 padding）——`truncate` 不能去掉，同一 span 也服务长名组标题（非斜体，确实需要省略号）。
- **泛型详情页的 select 只读值不走 `optionsLabels`**（2026-09 角色优先级卡登记，非阻塞）
  - 现状：人物页（档案网格 / 阅读进度 tab）的枚举字段只读值已渲染中文标签（角色优先级）；泛型 `EntityDetail`（hook 详情的 `status` / `payoff_timing`）仍显示原始 key（`planted` / `progressive` 一类）。两套控件实现是原因（见上一条「人物页 vs 泛型详情页抽公共层」）。
  - 触发条件：hook 详情页被反馈“状态列看不懂”；或真的上提公共字段控件时一并收口。
  - 最小修法：泛型只读渲染路径按 `optionsLabels` 映射（单点），与人物页同口径。
- **角色优先级（`data.priority`）有意不做项**（2026-09 设计定稿时逐条裁决，非漏改）
  - **同档内手动拖拽序**：现口径 = 组内按 `updated_at` 降序；要自由排列需给 character 接 `entities.sort_order`（setting 先例）。触发条件：出现「主角档内还要自定义次序」的真实需求。
  - **存量角色批量 / 猜测式分级回填**（AI 扫库、或按 `role` 文本关键词推断）：**明确不做**——「谁是主角」是作者意图，模型与关键词都会猜错并污染排序。
  - **rail 行优先级徽标 / 摘要字段 / `search_entities` 过滤 / `byPriority` 分布**：现口径 = 优先级只影响排序，`get_entity`（详情）已能让 AI 读到；rail 行不显示（与 `role` 文本视觉重复且 240px 拥挤）。触发条件：出现「左栏看不出谁是主角」的真实反馈。
  - **优先级驱动 AI 上下文注入权重**（主角优先灌入）：属 `20-context.md` 的设计面，未排期。

- **伏笔「已写未回收」已交付（2026-11）** — 现状：判定口径 = 未软删 + `status ∈ {planted, progressing}` + 有 `expected_resolve_node_id` + **该章已写过正文**（`content_text` 非空）；端点 `GET /hook/written-unresolved`（信封 `items`），工具侧 `analyze_hook_health` 多一个 `written_unresolved` 字段（注意与既有 `overdue` = 龄期 > 两倍半衰期 不是一回事）。伏笔页有行标记 + 筛选，写作 rail 有计数行。
  - 仍未做：「已写未回收」的**跨卷排序解释**（现按章序）与「写了几个字才算写过」的字数阈值（现为非空即算）。

- **后退守卫的两个历史栈残差（2026-11 复核登记，报告级）**
  - ① **离开哨兵后残留一条同 URL 死条目**：dirty 时点另一行并确认放弃 ⇒ `navigate()` 在哨兵之上压新条目、dirty 复位，哨兵留在栈里；之后那次后退落到它、`armed` 已失效 ⇒ 视觉「按了没反应」。根治要改 `navigate` 时机（先撤哨兵并等回声），收益不抵复杂度。
  - ② **哨兵恰是首条历史条目时**（深链直开就编辑）`back()` 无回声 ⇒ `suppressed` 残留，吞掉下一次真实后退一次。同样只是一次死按键，无数据风险。
  - 触发条件：真实用户反馈「后退按了没反应」；届时先把「离开哨兵」这条补上，②随同一次改。
- **历史端点新增了进程级 `ModelRuntime` 依赖**（端到端验收 oracle 登记，低危）
  - 现状：`GET /chat/sessions/:id/messages` 为算 `subscription` 而 `await getModelRuntime()`；该方法创建失败（凭据/模型目录损坏）时这个**只读**端点会 500（此前它只依赖会话文件）。
  - 触发条件：出现「聊天记录打不开但其它页面正常」的反馈。
  - 最小修法：把模型侧查询包成 best-effort（失败 → `subscription: false`、`contextUsage` 省略），不让只读端点因模型运行时故障而不可用。

- **历史会话的占用百分比**
  - 现状：打开历史会话时占用段显示 `? · 窗口`（只知窗口、不知占用）——重建需要 pi 未导出的 `estimateContextTokens`（`getContextUsage()` 的内部口径），自建等于复刻一套估算。
  - 触发条件：上游导出该函数，或用户反馈「打开旧会话看不到占用」影响判断。
- **状态栏实时速度估算与首字延迟（TTFT）**
  - 现状：速度只在每条 assistant 消息生成完后报一次（解码速度），生成中无数字。实时数字需对增量做 chars→token 估算，会把同一个字段变成两套口径。
  - 触发条件：用户要求「生成中就能看到快不快」。
  - 升级路径：待估算口径先收口再加，且必须与实测值在同字段上区分标注。TTFT 可与速度同批做（`message_start` → 首个增量的时长，meter 已经在记这两个时刻）。
- **会话平均速度 / 活跃时长**
  - 现状：只报最近一轮；平均值需 meter 累加并通过 `usage` 下发（历史会话无数据，只能覆盖「本次打开期间」）。
- **缓存浪费（重计费）诊断**
  - 现状：状态栏只报缓存读/写量与命中率；pi 的 `/session` 另有 `Cache Re-billed`（本该命中却重付的部分，含 `idleMs` 与模型切换标记，`core/cache-stats.ts`）。
  - 触发条件：用户怀疑「缓存只在某些轮生效」。
- **状态栏点击展开统计面板**
  - 现状：明细走 hover 的原生 `title`（无消息计数 / 工具调用数 / 会话文件 / git 分支 / 活跃时长）。
  - 触发条件：用户要求「像 pi-web 那样点开看全量统计」。
- **会话列表里的每会话成本列**
  - 现状：`GET /chat/sessions` 列表不带 usage；「哪本书/哪个会话烧钱多」需要逐条打开。
  - 触发条件：用户提出成本审计需求（列表页聚合会多扫一遍全部会话文件，需先评估大书库下的耗时）。

- **大纲页：整树展开仍是卡顿入口**（2026-11 实测后收窄的遗留面）
  - 已做：节点数 > `OUTLINE_AUTO_COLLAPSE_NODE_LIMIT` 时首屏只展开卷（渲染期派生，无全量白渲染）。千章书实测（**修正口径见下条**）：DOM 58,579 → **842**；主线程 990 → **346ms**（脚本 498 → 219ms）；最长单次 long task **306 → 85ms**。展开单卷（170 行）= 不新增 long task。
  - 剩余：页头「全部展开」一键仍会把 3,020 行全挂上（实测一次 **306ms** 长任务 + 主线程 +644ms；不崩，但有可见停顿）。触发条件：真实用户在大书上频繁点它。最小修法：大字书下把该钮语义改为「展开当前卷」并改名（名与行为必须一致），或上虚拟滚动（行高可变 + 拖拽/折叠/右键，成本高，无现成依赖）。
  - 测量方法：`test-project/measure-ui.mjs`（CDP 直连 headless Chrome，只取数字、不产生截图）——后续 UI 规模问题可复用它，勿再靠外推。
- **大纲画布：已视口化渲染，剩余为 MiniMap 全量方块**（2026-11 实测后收窄）
  - 已做：`onlyRenderVisibleElements`（千章书 DOM 12,699 → **1,680**、实际挂载卡片 1,000 → **32**；修正口径后主线程 **878ms**、最长单次长任务 179ms——本页仍是全应用第二重，MiniMap 占 1,000 个 SVG rect）+ 节点改传显式 `width/height`（库的尺寸口径是 `measured ?? width ?? initialWidth`，**不读 `style`**——只写 style 时视口外节点尺寸为 0，`fitView` / 边定位不准，且每张已挂载卡片都要装 ResizeObserver）。
  - 剩余：MiniMap 仍把**全部**节点画成 SVG 方块（1000 个）。A/B 三次对照显示隐藏它只能减 DOM（1,680 → 676），wall-clock 差异落在噪声内（1,092~1,397 vs 1,211~2,489）⇒ 不为无证据的收益改产品行为，保留 MiniMap。触发条件：千章书下 MiniMap 交互变卡时。最小修法：大树时降采样或换成缩略图缓存。
  - 另：千章书点「适应视图」会被 `minZoom` 夹住（不会一次挂 1000 张，实测 0 个新 long task）——属预期而非缺陷。
- **大纲画布千章布局**（同上）
  - 现状：只按 205 节点量过（LOD 两档、补位布局单源）。
  - 触发条件：千章书打开画布；最小修法：同上的真实测量先行。
- **UI 治理 P0 的三处验证残留（2026-11，四张卡交付后登记）**
  - ① **ErrorBanner 的像素核对未做（6 处，其中 2 处是结构变化）**：`gap-2 → gap-3` 与「`ml-auto` 按钮位」动 4 处（`setting-rail` / `HookPanel` / `Timeline` / `Trash`）；另 2 处更明显——`character-rail` 的重试按钮从 **32px、红条之外** 变成 **24px、红条之内**，`chapter-rail` 同样把按钮移进了染色盒。SSR 断言与全量测试都覆盖不到观感。触发条件：下次碰到这四处错误态，或用户反馈错误条挤/散。最小修法：浏览器逐处看一次，若观感变差用调用点 `className` 覆写 `gap`（不得恢复第二份手写实现）。
  - ② **弹窗叠层 `Esc` 未验证**：`Dialog` 换芯后「只关最顶层」由 rc-dialog 的 portal 栈保证，但本机 `test-project` 的画布没有连线（`edges = 0`），构造不出「连线抽屉 + 删除确认框」这个叠层路径。触发条件：有含连线的书、或下次改弹窗/抽屉。最小修法：打开连线抽屉 → 点删除 → 按一次 `Esc`，断言抽屉仍在、确认框已关。
  - ③ **Tab 折返边界有一帧落在 `body`**：30 次 `Tab` 不出 `.ant-modal-wrap`，但折返瞬间 `document.activeElement` 会短暂是 `body`（antd `useLockFocus` 的哨兵元素行为，非焦点逃逸）。触发条件：无障碍专项收口时。最小修法：若要完全消除，换 `focus-trap` 语义或给哨兵加 `tabIndex` 处理——收益低，先不动。

## AI / 产品能力

- **联网检索的未做项**（2026-10 交付 `web_search` / `fetch_content` 时登记）
  - 现状：两个只读工具（搜索摘要 + 按需抓正文），共用 DeepSeek 凭据、按次计费、都不落盘；结果在聊天里以来源卡片呈现。
  - 未做（各有明确触发条件）：
    - **结果缓存与分页**（`responseId` + `get_search_content` 形态）：当前每次调用都重新检索 / 重新抓取。触发条件：搜索成为高频动作、token 成本可见地上升。
    - **来源卡片 → 参考资料实体**（一键落库）：卡片目前只能点开原网页。触发条件：用户想把检索到的资料转成参考资料。
    - **多供应商回退**：有意不做（YAGNI）——单供应商失败时直接报错，比隐式切换更容易诊断。
    - **搜索 / 抓取费用计入会话账目**：需要把按次计费换算成金额并与 pi 的 token 账目并表，口径未定；当前只在文档里声明不进账。
    - **`count` 只是期望条数**：`runWebSearch` 不按请求条数硬切，上游若多返回就会全部进上下文，最终只剩工具结果 token 闸门兜底。触发条件：实测上游不遵守 `count`。最小修法：`hits.slice(0, count)`（保留上游顺序）。
    - **上限叠加时的 JSON 截断风险**：最大条数 × 单条异常上限加 JSON 信封会略超 `TOOL_RESULT_MAX_TOKENS`；硬切会破坏 JSON，来源卡片退化为普通工具行。默认条数安全。触发条件：真实出现“上限条数 + 极长摘要”。最小修法：下调单条异常上限或默认条数。

- **移动提案未跟踪被移动节点的当前位置**（2026-11 oracle 登记，既有语义）
  - 现状：`buildProposeMoveNode` 只采集被移动节点自身 `updated_at`；`moveOutlineNode` 移动时不推进该节点自身版本，旧父也不进引用。提案生成后用户把节点移到别处，确认仍按提案里的旧目标执行，可能静默覆盖用户操作。
  - 触发条件：用户频繁在提案待确认期间手动拖拽大纲节点。
  - 最小修法：move 提案补「当前父」引用（存在性/版本按冲突语义定），或在执行前校验 `findParentOf` 与生成时一致。

- **跨包工具目录守卫的盲区**（2026-09 推演批次 oracle 登记）
  - 现状：`tools` 包的守卫只比「名字集合」（`TOOL_NAMES` 的自动+提案部分 ≡ `listTools()`），**权限分组不参与**——registry 里把某工具改成 `proposal` 而名字仍属自动集合 ⇒ 守卫绿；全仓仅 4 处点状权限断言。组间搬名（净集合不变）同样不红（靠 shared `constants.test.ts` 的字面量数组断言兜）。
  - 触发条件：新增/搬动工具到别的权限分组，或想让「工具分级」也能被单测拦住。
  - 最小修法：守卫改成比「名字 + `permission` 对」的集合（一行），或给 shared 侧分组常量加一个导出给 tools 守卫。

- **能力面板模板库**（跨书复用 / 命名管理）
  - 现状：只有「内置 3 套 + 从角色复制结构」。
  - 升级路径：把派生函数的"源"从**角色记录**换成**模板记录**（零返工）。
- **面板相关 AI 一致性规则**（如"等级不得下降"）
  - 现状：不做。
  - 结论：自由结构下硬编码规则会大量误报，YAGNI。
- **人物页 Delta 时间线**（该角色跨章节的变更记录列表）
  - 现状：由 AI 的 `get_delta_history` 覆盖（页面不给时间线 UI）。
  - 触发条件：作者频繁需要"逐条回看这个角色改过什么"。

- **检索与导航在千章规模下的剩余缺口**（2026-11 千章导航批次交付后登记）
  - **正文检索未上 FTS5**：现在 `search_manuscript` 走 `content_text LIKE '%q%'`，实测 157 万字全表扫 5–9ms，够用。触发条件：正文规模上一个数量级（千万字级）或需要相关度排序。最小修法：FTS5 trigram 虚拟表 + 同步（注意 1–2 字查询在 trigram 下退化，仍需 LIKE 兜底）。
  - **检索不覆盖参考资料正文**：`search_references` 只搜名字 + tags，命中正文关键词（标题里没有）找不到。触发条件：参考笔记正文成为实际查找对象。最小修法：`search_manuscript` 加 `owner_kind` 维度，或复用同一条 LIKE 管道。
  - **卷内章数超量时单卷查询再撞线**：`get_outline(volume_id, depth=2)` 50 章 ≈ 6.3k token；卷内章数过百后又会逼近单条工具结果上限。触发条件：单卷 >130 章的书。最小修法：加章号区间 / `offset` 参数。
  - **`search_outline` 无相关度排序**：结果按阅读序、单页上限固定，命中数百条时只能翻页看。触发条件：命中集大到无法逐页扫读。最小修法：排序键可配（摘要命中优先）或让 `query` 支持多个命中面权重。
  - **工具面已 49 个**：每轮请求都要带全部描述（两个新检索工具约 +300–400 token/轮）。触发条件：再增工具时。最小修法：工具按工作区/场景分组下发（需评估 pi 的装配接口是否支持）。

## 桌面版（v0.0.40 已交付主功能）

> 已交付部分（书库位置 / 目录选择闭环 / 菜单与日志 / 安全与导航 / 设置页通用 tab / Windows 打包 workflow）见根 `CHANGELOG.md` 的 `## [v0.0.40]` 与 `## [v0.0.41]`；设计契约见 `docs/design/50-desktop.md`。下列是**仍未做**的顺延项与待验证项：

- **`log.ts` 只接管 `console.log/warn/error`（未接管 `info`/`debug`）** — 现状：桌面版日志落盘的唯一实现只替换这三个方法（`console.info !== console.log`，实测），任何用 `console.info`/`console.debug` 输出的库都不落盘；当前靠调用方显式接 logger 绕过（2026-09 更新器即如此：`autoUpdater.logger = { info: (m) => console.log(m), … }`）。影响：真机排障时库的 info 级上下文丢失（只留 error/warn）。触发条件：下一次某个依赖的 info/debug 输出成为排障必需。最小修法：`log.ts` 的 levels 表加 `["info", "info"]` / `["debug", "debug"]`；**副作用要先想清楚**——Chromium/依赖的 debug 噪声会进水，可能需要按前缀过滤或另开 verbose 开关。
- **窗口尺寸/位置记忆** — 现状：每次启动回默认尺寸。触发条件：有用户抱怨布局丢失（与 `localStorage` 面板偏好丢失同源体验问题，一起做）。最小修法：写进 `desktop.json`（一个 `window` 字段），窗口 `resize`/`move` 防抖写入。
- **Windows 代码签名 + macOS 公证** — 现状：不签名（Windows 有 SmartScreen 提示、macOS 首次需右键打开）。**不再是自动更新的前置**：Windows 更新已在未签名下跑通，代价是信任锚仅为「GitHub Releases + sha512」且 SmartScreen 提示不消（安全边界见 `50-desktop.md` §5.2）。触发条件：SmartScreen/安全提示成为反馈主题，或分发规模需要用户侧验签。升级路径：Windows 代码签名证书（或 Azure Trusted Signing）→ `electron-builder` 的 `signtool` / `win.publisherName`（写上后会**自动启用**更新包的 Authenticode 校验）；macOS 另需 Apple Developer（$99/年）+ `notarize` 配置。
- **手动检查在慢网下会先弹一个「正在后台下载…」框（两个框的观感）**（2026-09-16 真机）— 现状：v0.0.45+ 已修「已下完还说正在下载」的假话（下载秒回时只弹安装框），但下载确实耗时（>1.2s 判定窗口）时仍会先弹「正在后台下载…」、用户关闭后再弹「已下载」——两句都是真话但观感啰嗦。触发条件：用户反馈这一点。最小修法：去掉中间框（代价：慢网下点菜单后长时间无任何回应）；或做非模态进度（要 client UI，见「设置页内嵌更新面板」条）。

- **设置页内嵌更新面板**（显示版本 / 手动检查 / 下载进度）— 现状：v0.0.44 起更新走主进程原生对话框 + 菜单「帮助 → 检查更新…」，client 侧零改动（`50-desktop.md` §5.2）。触发条件：用户反馈找不到检查入口、或要看下载进度。最小修法：扩 `DesktopBridge`（invoke + 状态推送）+ 设置页「通用」一行，更新逻辑不动。
- **`await closeServer()` 之后 `quitAndInstall` 失败的窗口期**（应用活着但后端已关）— 现状：同步失败只可能在 `installerPath == null`（与 `update-downloaded` 事件矛盾，几乎不可达）；真实失败是 spawn 的**异步**错误（EACCES/ENOENT，杀软拦截同列），那时应用照常退出、只是没装上，兜底也拦不到。触发条件：真机日志出现 `Cannot run installer: error code: …`。最小修法：`quitAndInstall` 前 `autoUpdater.once("error", …)` 弹一次错误框（3 行）；当前不做（YAGNI）。
- **更新灰度 / 预发布通道** — 现状：所有安装态都从 `/releases/latest` 拿最新正式版。触发条件：需要先给部分人验版本。**口径（必须遵守）**：将来若发 `vX.Y.Z-beta.1` 这类 tag，Release **必须勾 prerelease**——否则 `/releases/latest` 会把 beta 推给所有正式用户（`50-desktop.md` §5.2）。
- **macOS / Linux 自动更新** — 现状：更新器有 win32 守卫，只对 Windows 安装态生效。触发条件：相应平台恢复出包（macOS 另需签名/公证——那是 electron-updater 的硬前置）。
- **端口 +1 时的偏好丢失** — 现状：端口分段隔离已把 web 生产 / dev 挪出桌面端分段（见 `build.md` §端口策略），桌面端只在**起点被无关进程占用**时才在窗口内 +1，`localStorage` 按 origin 隔离 → 主题/面板偏好重置（一次）。触发条件：真实反馈重复出现。升级路径：自定义协议 `app://` + protocol handler 反代 `/api/*`（需验证 SSE 流透传）；或偏好转经服务端配置持久化。
- **Linux deb/rpm 包** — 现状：只有 AppImage。触发条件：Linux 用户量起来。
- **Windows / macOS 安装包的品牌图标未实测（只能 CI 出包时复核）** — 现状：Linux 面已实测通过（AppImage 内 `usr/share/icons/hicolor/scalable/apps/ai-editor.svg` 与源文件逐字节相同、`.DirIcon` 指向它，见图标链路口径 `50-desktop.md` §5.3）；`win.icon` 的 `.svg → .ico` 与 `mac.icon` 的 `.svg → .icns` 转换**只在出对应平台包时发生**（转换需联网下载工具集 `icons@1.1.0`；Linux 路径直通 SVG、不触发），本机无 Wine/mac 环境故未验。触发条件：下一次 `v*` tag 出 Windows 包。最小验证：从 Release 取回 exe，看安装器与任务栏图标不是 Electron 默认；默认图标的对照哈希可解 `node_modules/.pnpm/app-builder-lib@*/node_modules/app-builder-lib/templates/icons/`（Linux 面已用该目录的 `electron-linux/256x256.png` 做过负控制）。
- **开机自启** — 现状：不做。触发条件：用户要求（与「自动备份需要进程活着的」的期待相关）。
- **`pnpm deploy` 失效时的 esbuild 兜底** — 现状：主路径未验证通过前不预先实现兜底。触发条件：打包主路径（`pnpm deploy` + electron-builder）被实测证伪（collect 不到 workspace 依赖或原生模块 load 失败）。
- **Windows 包的真实安装验收（只能人工/真机）** — 现状：`desktop.yml` 已在 v0.0.40 跑通三平台、随后收窄为只出 Windows；包能构建、能下载，但**「装得上、启得开、选书库、建库、导入备份」全链路未在真实 Windows 上逐项验过**（本仓开发机是 WSL，Windows 交叉构建需 Wine 故不做）。触发条件：发版后拿到 exe 的人实测。最小验证：安装 → 首次启动直达书架 → 新建一本 → 导入一个备份（书名应取自备份而非 zip 文件名）。
- **自动检查失败对网络不稳的用户完全不可见** — 现状：启动检查失败只落日志（设计如此，避免网络抖动打扰创作）；实测真机直连 GitHub 不稳时会出现 `net::ERR_CONNECTION_TIMED_OUT`，用户**既看不到失败也永远收不到更新**（手动点检查才会看到提示）。触发条件：出现「版本一直不更新」类反馈。最小修法：连续 N 次自动检查失败后在菜单「帮助 → 检查更新…」旁或启动时提示一次；或给菜单项加状态标识。

- **卸载器「清除使用数据」的删除分支 + 签名门禁负向用例（只能真机）** — 现状：卸载流程本身**未实测过**（2026-09-16 那次数据消失是用户手工删的，不是卸载器干的）。触发条件：下次在真机卸载时。最小验证：卸载选「是」→ 带签名文件（`.ai-editor/library.json`）的书库与 `%APPDATA%\AI Editor` 应被清；事先手工建一个**无签名**的同名目录 `<文档>\AI Editor` → 卸载选「是」后它**必须仍在**（防误删的负向用例）；选「否」则全部保留。
- **安装器缓存副本是否真被卸载清掉（真机）** — 现状：`installer.nsh` 在用户主动卸载时 `RMDir /r "$LOCALAPPDATA\ai-editor-desktop-updater"`，但未在真机确认过。触发条件：下次卸载时。最小验证：卸载后 `%LOCALAPPDATA%` 下不应再有 `ai-editor-desktop-updater\`（安装时会新建）；带 scope 的旧名残留也应被清。
- **macOS 的两处菜单行为（无 mac 环境可验）** — 现状：Edit 角色菜单（Cmd+C/V）与「打开书库/日志目录」的 `shell.openPath` 均未在 macOS 上验证。触发条件：有 mac 环境时。
- **撤 `latest.yml` 的负向用例（低优先级，只能真机）** — 现状：手动检查在云端元数据缺失时应弹「检查更新失败」而不是假「已是最新」（自动路径的静默失败已在真机验过：网络超时只落 `[error]`）。触发条件：顺手能验时。

- **GitHub Actions 的 Node 20 弃用告警（v0.0.44 首现）** — 现状：Desktop workflow 报 `actions/upload-artifact@v4` 与 `softprops/action-gh-release@v2` 被强制跑在 Node 24（`Node.js 20 is deprecated`），**仅告警、任务成功**。触发条件：上游改成硬报错，或两个 action 各抬一个 major（`upload-artifact@v5` / `action-gh-release@v3`）时。最小修法：两个 action 各抬一个 major，其余 `actions/*` 一并核对（三个 workflow 共用）。

- **打包态冒烟的判据档位**（2026-11-24 v0.0.66 首发已实测）— 主判据 = 日志含「菜单已就绪」（真建出窗口 + 装好菜单）；退路 = 只含 server 启动行（打 `::warning::` 后仍以 0 退出）。**首发那一次 windows-latest 命中主判据**（日志：「主进程建出窗口并装好菜单」）⇒ Windows runner 能建窗，退路不是常态，不必再假设它长期生效。触发条件：冒烟开始出现 `::warning::`（= 走了退路）或 runner 镜像变动时——先核是不是窗口创建退化了，再决定是否收敛成单一判据。

- **Windows 自动更新的真机闭环** — ✅ **已完成（2026-09-16/17，连续五跳：0.0.44→0.45→0.46→0.47→0.48）**；明细与「代码新旧指纹」见 `50-desktop.md` §5.2 与 `CHANGELOG.md`。**残留两个未专门观测的小项**：升级时是否弹 UAC（预期不弹，per-user）、安装对话框的 Esc/Enter 是否都走「稍后」——真机顺手验。
- **macOS / Linux 安装包的恢复** — 现状：matrix 里两项已注释（无真实用户需求 + 无 mac 环境可验）。触发条件：出现相应平台的真实用户。（Linux 包本机可随时出；macOS 需 mac runner。）
- **原生文件对话框的真实桌面验收（只能人工）** — 现状：WSLg 下 GTK 文件对话框挂起，开发机无法断言其可见性与交互（最小 Electron 对照实验同样挂起 → 环境问题，非本仓代码）。影响：首次启动选目录、书架页「浏览…」、设置页「更改书库位置」三处的真实体验未验证。触发条件：有 macOS / Windows / 真实 Linux 桌面环境可用时。最小验证：首次启动点一次选目录 + 选完确认重启后是否直达该书库。

## 块文档与正文（2026-09，批 12 交付后的遗留项）

- **新建参考资料时的「名称」入口不可发现（12.8 走查实测）** — 现状：草稿页标题是**静态文本**「新建参考资料」，必须点它才切成输入框；而「名称必填」报错出现在表单底部（正文下方），离名称位置很远——实测第一次操作会把名字填进「分类」。触发条件：下一个真实用户（或自己隔一周再用）反馈「不知道怎么命名」。最小修法：草稿态直接渲染标题输入框（placeholder「未命名参考资料」）+ 报错就近显示在标题下方（只动 ReferenceDetail 的 titleNode 分支）。
- **块文档格式选型的历史论证（已否决方案，勿重提）** — 2026-09 决策：正文/参考资料真相 = `document_records.content`（BlockNote 块数组 JSON，随 `data.db`）。**已否决**：① 项目目录 `manuscript/<章id>.md` 为真相（md↔块为**双向有损**转换，每次「打开→保存」都可能静默丢颜色/对齐/嵌套，且要额外维护备份四处同步 + `.trash/` + mtime 台账）；② `references/` 目录继续作真相（同上，且参考资料要改为受限 schema）。触发条件：只有在「必须能被 Obsidian 等外部编辑器直接改写正文」成为硬需求时才重新评估——届时升级路径 = 反向导出（块 JSON → md 落盘）+ 明确主从（导出物只读）。决策背景见 `CHANGELOG.md` v0.0.49 段与 `docs/design/10-data-model.md` §14。
- **小说文档导出的 md 保真度（2026-09 登记）** — 现状：全书导出（`GET /project/export-novel`）走 shared `blocksToPlainMd`（= `content_text` 投影），**内联斜体/粗体/下划线/高亮丢失**（该投影只看 `text` / `link`）；单章页头「导出 markdown」走 BlockNote 序列化器，两者对同一份正文可能产出不同文本。触发条件：用户抱怨导出的正文丢了加粗/斜体。升级路径：客户端 BlockNote 序列化 + 批量取章正文端点 + 客户端 zip 依赖（fflate，目前只在 server）+ 无头编辑器实例（详情页才有实例）。**不得**为了导出而给 `blocksToPlainMd` 加样式标记——那会改 `content_text` 本身，连带改字数统计与 AI 读取口径。
- **TXT 网文排版的非段落块判定（2026-11 登记）** — 现状：整本 TXT 只读 `content_text`（不读块 JSON），网文排版按「段首标记」启发式区分普通段落与非段落块（`#` / `- ` / `1. ` / `> ` / `|` / 代码围栏 / `![` / `---`）；不是块级精确判定，正文里以这些字符开头的普通段落可能被误判，代码 / 表格内部行也可能被错误缩进。v1 不清理非段落块的轻量 md 标记（`- ` / `> ` / 围栏 / `|` / `[文字](url)`）。触发条件：用户抱怨 TXT 里出现 md 标记或缩进错位。升级路径：shared `blocksToPlainText` 按块类型输出纯文本 + 整本改读块 JSON（新增批量 `content` 查询）+ 单章复用；不得改 `content_text` 本身。
- **TXT 导出的 GB18030 / BOM 选项（2026-11 登记）** — 现状：TXT 固定 UTF-8 无 BOM + CRLF；`TextEncoder` 只支持 UTF-8，不引 `iconv-lite`。触发条件：旧平台 / 阅读器明确要求 GBK / GB18030 或 BOM。升级路径：服务端输出前用 `iconv-lite` 转码 + 显式编码选项；默认仍 UTF-8 无 BOM（BOM 会破坏「首行 = 第一章标题」的解析）。
- **参考资料正文检索已交付（2026-11）** — 现状：`search_references` 新增 `body?: boolean`（缺省 false = 旧行为逐字不变）；`body: true` 时命中面加 `content_text`（LIKE，不上 FTS5），正文命中项带 `snippet`（窗宽常量 `REFERENCE_SNIPPET_WINDOW_CHARS`）。工具数不变（仍 49）。
  - 仍未做：参考资料正文与章正文**合并检索**（跨 `owner_kind` 一次查）；测过的 LIKE 成本（157 万字 5–9ms）表明需要时再加并不困难。
- **AI 建议落库（章级批注）** — 现状：AI 对正文的建议只活在对话里（L1）。触发条件：用户反复问「刚才那条建议呢」。升级路径：新表（章级 suggestion：锚点可为块 id/纯章级）+ 采纳/忽略状态 + 正文页侧栏列表；**不得**演进为「AI 直写正文」。
- **正文只读模式** — 现状：**专注模式（2026-09）已落地**（只收三栏外壳 / `main-toolbar` / 页头），但**编辑器仍是可编辑态**（无只读切换）；阅读与打印体验仍缺。触发条件：需要纯净阅读/打印（或导出打印稿）。最小修法：同一个编辑器 `editable={false}` + 隐工具条的浮动条（入口已收在常显工具条右侧，只读 = 那里多一个开关；**注意** `editable` 变更会让 BlockNote 重挂 contenteditable，切换时不得丢失未保存输入）。
- **「页头常驻」尚未全站统一（2026-09 登记）** — 现状：参考资料列表/详情、人物工作台、时间轴、写作页、大纲页（2026-11 改版）为**常驻**；概览 / 实体列表 / 设置 / 回收站仍走**外壳滚动**（页头随内容离开）。口径与实现方式已写进 `DESIGN.md` §中栏页头结构「页头常驻」。触发条件：逐页改造时（视觉同步做，不要一次全仓翻）或用户抱怨某页找不到操作按钮。最小修法：该页 `section` 改 `flex h-full min-h-0 flex-col` + 内容进内层 `flex min-h-0 flex-1 flex-col overflow-y-auto`。
- **写作面的剩余旋钮（行宽 / 选中字数 / 阅读模式）** — 现状：2026-09 写作面批次只做「字体 / 字号 / 行高 / 纸张 / 纹理 / 段首缩进 + 专注模式」；**行宽档位**（窄/默认/宽/全宽）与**选中字数**当时评估后被削；**只读模式**见上一条。触发条件：写作时长上来后出现「行太宽难扫行」或「想知道这段多少字」的真实抱怨。最小修法：行宽 = `[data-writing-width]` 给 `.bn-editor` 上 `max-width` + `margin-inline: auto`（一行 CSS）；选中字数 = 监听 selection 变化（`onSelectionChange`）算选中文本长度。
- **纸张纹理与文本行对齐** — 现状：横线/网格是固定间距的装饰纹理（默认关闭），**不随正文行盒高对齐**（`DESIGN.md` §写作面偏好 / Known Gaps 已登记）。触发条件：用户按「稿纸」预期用它写字并抱怨错位。升级路径（需先定口径）：把行高锁成整数倍（24px 的倍数）+ 段距归零，并对标题类块单独补相位——代价是牺牲自选行高与部分排版自由度，**不确认要写稿纸不启动**。
- **写作工具条的 a11y 名字（卡 13.5 登记，已试过一遍）** — 现状：工具条根元素只有 `role="toolbar"`、无 `aria-label`（库自带浮动条同样）。**不可用「多传一个属性」解决**：`Components.FormattingToolbar.Root` 只收 `className/children/onMouseEnter/onMouseLeave/variant`，其余键会被 core 的 `assertEmpty` 抛错（fixer 用探针实证：typecheck 绿、运行时崩）。触发条件：真需要屏幕阅读器识别该区域时。升级路径：自绘 Root（拿走 ariakit `Toolbar` 的那层包装）或给库提 PR；**别再走传属性那条路**。
- **参考资料详情页没有专注模式（有意）** — 现状：专注模式只给写作页的章正文（`Q7 决策`：参考资料页一半是元数据表单，「专注」语义不成立）。触发条件：用户明确要求写长笔记时也能纯净界面。最小修法：给 `ReferenceDetail` 也传 `focus`/`status` + 沿用同一 AppShell 分支（但得先定「表单去哪」）。
- **写作面文案的手抄同源（卡 13.5 登记）** — 现状：帮助弹窗里「撤销 / 重做 / 写作设置 / 六档位名」是手写字面量，与 `editor-toolbar.tsx` / `writing-settings.tsx` 同名同值（库字典里没有这些名字）；快捷键与工具条按钮名已经字典同源。触发条件：改名时发现两处不同步。最小修法：把这几个名字提到一处导出常量（与 `shared/src/constants/delta.ts` 同思路），帮助弹窗与按钮共引用。
- **浏览器形态关标签页 / 崩溃断电仍会丢最后一段输入**（2026-11，桌面侧 flush 通道落地后登记）— 现状：flush 通道只属 Electron 外壳（`win.on("close")` 拦截），web 形态（`pnpm start` + 浏览器）关标签页、以及任何形态下的崩溃 / 断电 / 强杀都不经过它。触发条件：出现「关标签页或崩溃丢一段字」的真实反馈。升级路径：渲染侧 `pagehide` + `keepalive: true`（请求体 ≤64KB，长章会超）或 localStorage 草稿 + 启动恢复提示——后者覆盖面最广，但要先定「草稿与服务端哪份更新」的判定，等于引入第二份真相。
- **写作工具条窄幅折行的顺序摩擦（卡 13.1 实测登记，低危）** — 现状：中栏窄于按钮总宽时工具条折行（已不裁切），但 `flex-1` 撑开块的右端组可能被挤到第二行靠左。触发条件：真实用户在小屏/三栏并行时抱怨按钮位置跳。最小修法：给右端组 `margin-left: auto` 或把状态区移到独立行。
- **桌面版导出直写目录（含「另存为」原生对话框）** — 现状：导入导出走标准 `<input type=file>` / `<a download>`（桌面版会落在默认下载目录，小说文档的卷/章目录树只在 zip 内）。触发条件：用户抱怨找不到导出文件，或要求「把目录树直接落进我的稿子文件夹」。最小修法（两条路径都要，别只做一半）：`preload` 加目录选择能力（或复用已有 `pickDirectory`）+ 服务端新增「按给定目录直写小说文档目录树」端点；浏览器形态保持 `desktopBridge()` 能力检测不变。
- **正文级搜索/全文统计（UI 侧）** — 现状：只有大纲树与写作页卷章导航栏的 `metadata.textLength`、以及参考资料列表摘要。触发条件：全书搜索需求落地时（与 `search_manuscript` 同批考虑，复用 `content_text`）。
- **块编辑器升级纪律的执行细则** — 现状：`@blocknote/*` exact pin，升级 = 显式 commit + 全量测 + 像素核对（同 pi）。触发条件：每次升级时要核对的清单（`blockSpecs`/`--bn-*` 变量名/ariakit 变体行为）——目前只有原则，无 checklist。
- **md 导入的有损提示误报（卡 12.6 oracle 登记，安全侧放大）** — 现状：判定 = `blocksToMarkdownLossy(tryParseMarkdownToBlocks(原文))` 与归一化后的原文比对；**外部编辑器的合法写法会被判「有损」并弹确认**（实测：`-` 列表→`*`、`1)`→`1.`、`---`→`***`、`<br>`、无语言围栏的代码块→`text`、md 表格补对齐空格、行首全角空格）。自产 md 再导入不误报（校定 canonical），所以不是死循环；代价是用户多点一次确认。触发条件：实际导入外部草稿的用户抱怨频繁。收紧路径：改为比较「块级文本内容集合」而非 md 串（需写一个 md→文本片段的轻量抽取器，或直接比较两次 parse 的块 JSON 文本）。
- **`sanitizeDocumentFileName` 的两处小缺陷（卡 12.6 oracle 登记，低危）** — ① docstring 声称「去首尾点」但 `../../etc/passwd` → `.. etc passwd`（首点残留；单段下载名，浏览器会平坦化，无穿越风险）；② 未处理 Windows 保留名（`CON`/`NUL`/`COM1`…）。触发条件：有用户报告下载失败或名字怪异。最小修法：点清理改为「去全部前导点」+ 加保留名后缀。
- **导入路径的三个缺口（卡 12.6 oracle 与 fixer 登记）** — ① JSON 导入无二次确认（契约只要求 md 有损时确认）；② 含未知块类型的 JSON 能过浅校验、可能在挂载时被错误边界接管（与 REST 浅校验同宽）；③ 无文件体积上限。触发条件：真实用户误导入或大文件卡顿。最小修法：共用一次「覆盖前确认」、体积上限常量 + 提示。
- **参考资料正文没有分页读取（12.9 对照登记）** — 现状：章正文有 `get_chapter_text(offset, max_chars)` 分页拉取（截断时告知续读起点）；而 AI 取参考资料只有 `get_entity('reference')` 一次性返回全文投影——超长笔记撞上单条工具结果上限时被外层截断，提示语说「请缩小查询范围或分页获取」，但参考资料没有分页入口，模型只能放弃全文。触发条件：真出现「长参考资料（世界观/background 笔记）AI 读不完整」的疼痛。最小修法：`get_entity` 的 reference 分支加可选 `offset`/`max_chars`（与 `get_chapter_text` 同款分页 + 截断提示），或新增只读工具 `get_reference_text`；**不得**顺带加写工具。
- **参考资料正文没有覆盖保护（12.8 卡实测登记）** — 现状：章正文的 `PUT /manuscript/:id` 支持 `base_updated_at` → 409 `DOCUMENT_STALE`；而参考资料走实体泛型 `PUT /entity/reference/:id`，请求 schema 是 `.strict()`（只有 name/data），**无版本戳**，两窗口同时编辑 = 后写覆盖。与其它实体（人物/设定/地点/伏笔/事件/时间点）行为一致，「多标签页并发」本就是 MVP 不做的延期项；真正的保护是**自动保存失败可见 + 重试**（不静默丢改动）。
  - 触发条件：出现真实的多窗口/多设备同时改同一篇笔记并丢内容的疼痛。
  - 升级路径（**先定口径再动手**）：`entityUpdateReqSchema` 加可选 `base_updated_at`；**比较对象必须是 `document_records.updated_at`（正文时间戳）而不是 `entities.updated_at`**——后者在改标签/分类时也会推进，会让「另一窗口只改了标签」造成本地正文保存误报冲突；同时要想清「不带 content 的元数据 PUT 是否需要校验」（倾向不需要）。需要一张独立卡 + oracle。
  - 已知残差（有意接受）：客户端「先 GET 比对再 PUT」的预检方案不可靠（GET→PUT 之间正好是真竞态窗口，且每次自动保存多一次请求），**不要用**。
- **块编辑器接线无自动化回归钉（卡 12.12/12.5 修复轮登记）** — 现状：`initialContent: []` 崩页与 `dictionary: zh` 两个缺陷都只有浏览器走查证据；仓内无 jsdom，组件不参与单测。触发条件：重现「改一行传参把编辑器搞崩」。可选最小修法：按 `design-discipline.test.ts` 的源码扫描风格加一条断言（如 `document-editor.tsx` 必须包含 `dictionary: zh` 且不得出现 `initialContent: []`），或引入 jsdom 只测封装组件的挂载。
- **`document_records` 的两份 DDL 文本差一行行尾注释**（卡 12.2 oracle 登记，P3 无功能影响） — 现状：`packages/db/src/tables.ts` 的声明 DDL 在 `PRIMARY KEY (owner_kind, owner_id)` 后带 `-- 一 owner 一行（…）` 注释，`migrations/008_document_records.ts` 的迁移 DDL 无该注释；去注释后逐字相等。唯一消费该文本的是「v0 空库结构快照」（只对 `user_version === 0` 生效，已到 v8 的库不参与）。触发条件：有人想加「迁移 DDL 文本 == 声明 DDL 文本」的断言时。最小修法：把注释挪到行首或去掉（同步改两处）。

- **`/chat` 请求体的 `context` 是 strip 模式（未知键静默剥离，非 400）**（卡 7 oracle 登记，低）
  - 现状：`chatSendReqSchema` 顶层 `.strict()`，但嵌套 `context` 是普通 `z.object` ⇒ `{practice_sample_id, zzz}` 会被剥掉 `zzz` 而非拒绝。**本卡未改动该语义**（只往 `context` 加字段）；文档从未要求 `context` 拒绝未知键。
  - 影响：无安全面问题（剥离反而保证客户端自造字段到不了注入逻辑）；仅「严格性」口径不统一。
  - 触发条件：有人要求「未知 context 键必须 400」时；最小修法 = `context` 收紧为 `.strict()` + 同步 `docs/api/80-api-chat.md`（**不要**在别的卡里顺手改）。

- **切换工作区瞬间的「旧 kind 请求」竞态**（卡 8 浏览器复验登记，低）
  - 现状：从根首页打开另一个 `kind` 的工作区时，服务端 `currentProject` 已切换而客户端旧页面组件尚未卸载 ⇒ 其 effect 可能再打一条旧 kind 端点请求（实测出现过 **1 条 400**；同一路径复跑多次为 0 条，时序相关）。终态正确、无数据损坏，仅控制台噪音。
  - 触发条件：控制台噪音被当成故障线索时（或该 400 出现在用户可见的报错路径上时）。
  - 最小修法：切换工作区时中止/丢弃在途查询（store 已有 loadSeq 竞态守卫，可扩成「按 kind 丢弃」）——**不要**为它加全局 loading 门。

## 工作区路由（delete / rename / import）遗留项（2026-10）

- **`POST /project/delete` 的错误码顺序：`project.json` 损坏时先撞 500**（卡 11 oracle 登记，非某次改动引入，可达性极低）
  - 现状：`readProjectFile` 对损坏 JSON 是**抛错**（不是返回 null）⇒ 「不在该 kind 目录下」那条 400 `INVALID_PROJECT_PATH` 判定够不到，响应变成 500 `INTERNAL_ERROR`（实测：`books/` 之外 + 损坏 `project.json` → 500；同目录 + 合法文件 → 400）。仅错误码差异，不删任何东西。
  - 触发条件：有人要求「坏 `project.json` 一律 400」时；最小修法 = delete 内把读取抛错映射为 400 `INVALID_PROJECT_PATH`（与 open 的「不存在/损坏」口径一并定）。
- **`POST /project/rename` 后 `lastProject` 不更新**（卡 11 oracle 登记，两种 kind 同况）
  - 现状：`writeLastProject` 只在 `POST /project/open` 成功时调用（`routes/project.ts`）；rename 只改 `project.root` 与目录名 ⇒ 创作根 `.ai-editor/config.json` 的 `lastProject` 仍指旧路径。
  - 影响：重启后 `detectLastProject` 找不到目录 → 落回书架/待命，不直达刚改名的那个工作区（数据无损，只多一步手工打开）。
  - 最小修法：rename 成功后 `writeLastProject(projectRoot, targetDir)`（一行，同 open 语义）。

- **根首页标题仍为「书架」，与「工作区聚合入口」的定位略偏**（卡 11 浏览器核对时的措辞观察，低）
  - 现状：`#/` 页头标题 = 「书架」（描述行已改为「选择一本小说或练习区打开…」），而练习工作区左栏顶部标识是「文风练习」且也指向该页 ⇒ 同一页在两个 kind 下有两个名字。
  - 触发条件：用户/文案评审提出该页命名时；最小修法 = 改页头标题与 `DESIGN.md` 的「根首页」小节一行（**先定用词**：不要把设计侧词「工作区」直接搬进界面）。

## 开发环境（Windows，2026-11 实测登记）

- **Windows 上 `pnpm dev` 直接失败** — 现状：`packages/server` 的 dev script 是 POSIX 前缀 `NODE_ENV=development tsx watch src/index.ts`，Windows 下报 `'NODE_ENV' 不是内部或外部命令`，且 `pnpm -r --parallel` 会把其它包的 dev 一并带崩。触发条件：需要在 Windows 一键起 dev（当前得手动分两处起 server / client）。最小修法：改用 `cross-env`（新增一个 devDependency）或 `node --env-file`；不新增依赖的做法是给 server 加一个 dev 入口脚本。
- **Windows 上 server 测试仍有红（HOME 沙箱部分已修，2026-11）** — 已修：6 个用 `process.env.HOME` 做沙箱的测试文件现在**同时**设 `USERPROFILE` 并加了一条 `expect(homedir()).toBe(tmp)` 守卫（`os.homedir()` 在 Windows 只读 `USERPROFILE`，只改 `HOME` 等于没改 ⇒ 用例会静默读写真实 `~/.pi/agent` 与 `~/.ai-editor/pi-agent`）。效果：`routes/settings.test.ts` 11 → 0、`routes/chat.test.ts` 2 → 1，全量 97 → 86。**剩余红与沙箱无关**，分四类：①`EPERM` 删临时目录（sqlite 句柄未释放：`entity` 49 / `names` 9 / `project` 5 / `project-delete` 1 / `backup` 1 / `chat` 1）；②`0600` 权限断言（`cloud/state` 1）；③本地 WebDAV 测试服务 403（`webdav.integration` 12）；④端口被占用（`index.test` 1，本机跑着 `start:test-project` 时 3500/3501 拿不到）。CI 是 Linux，不受 ①~④ 影响。
- **Windows 本机的桌面打包链路（2026-11-26 实测登记）** — 三层，前两层已解、第三层仍属环境：① Electron 42+ 无 postinstall（懒下载）：`pnpm install` 后 `node_modules/electron/` 只有 `cli.js` 与类型，`dist/` 要等首次运行时才下载；本机 GitHub Releases 不可达（`install.js` 报 `TypeError: fetch failed`）⇒ 走镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`（实测成功，约 246 MB）。② `pack.mjs` 的 `run()` 曾对所有命令 `shell: true` ⇒ 跑 `process.execPath` 时被 `cmd /c` 在 `C:\Program Files` 的空格处截断（`'C:\Program' 不是内部或外部命令`）。**已修**：`shell` 只给 `pnpm`/`npm` 这类 `.cmd` 包装脚本，node 一律不过 shell（两侧已有探针证据：node→shell:false 通过、node→shell:true 失败、pnpm→shell:true 通过）。同类隐患仍在 `scripts/publish-packages.mjs`（`run()` 完全不走 shell，Windows 上调 `npm` 会失败）——**有意不支持**（它只服务 Linux CI；已在该脚本头注释与 `build.md`「脚本约束」里声明，要本地演练走 WSL 或 CI），不修也不加分支。③ 修好后 `pnpm desktop:dist` 能走完 deploy、拉齐 electron 与 builder 工具集（需同时给 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 两个镜像变量），但最后卡在 `EPERM: rename release/win-unpacked.tmp → win-unpacked`，且 `.tmp` 里的 `default_app.asar` 被某个句柄占住（`tasklist` 无 electron、`Get-Process` 无对应路径；`rm` / `rmdir` 都报「另一个程序正在使用」）。⇒ **Windows 包仍只由 CI 出**，本机不把本地出包当受支持路径；要核对桌面端改动用开发态 `electron . --user-data-dir=<临时目录> --remote-debugging-port=<端口>`（界面缩放那轮即此法验到 CDP 读数）。

## 发布前审计登记（2026-09，v0.0.52）

- **REST 校验范围在 api 文档与 zod schema 两处出现（有意保留的契约镜像）** — 现状：`docs/api/*.md` 的请求体注释写明「1-100 字符」这类范围，单一来源 = shared `types/api.ts` 的 zod schema，文档是契约说明视图。触发条件：改任一校验范围时（schema 与文档同改）。**不**做「文档插值常量」——api 文档是给人读的契约，插值会降低可读性。
- **代码注释里的历史阶段编号（`卡 N` / `S1.2` / `G2` / `F9`）** — 现状：约 300 处，作为 provenance 记号保留（不指向可变契约）；**合同文档的编号引用已在 v0.0.51 清掉**（`docs/api`、`docs/db`、`docs/ui`、`docs/design` 正文），`backlog.md` 保留（登记来源）。触发条件：若将来要求注释零历史编号，再做一次机械替换（无技术风险，纯 churn）。
- **`packages/server/src/middleware/project.ts` 有两个无人引用的导出**（knip 审计发现，非某次改动引入）— `getProject`（导出但全仓无 import；路由实际经 `requireCurrentProject` / `getCurrentProject` 读取）与 `DATA_DB_FILE_NAME`（本文件内部使用，外部已改从 `@whispering233/ai-editor-db` 取）。**不删除的理由**：与任何行为无关，纯 churn；触发条件：下次改该文件时顺手收掉（`getProject` 若确实无调用点，直接删函数）。
- **`packages/server` 的测试在 Windows 本机全红**（2026-11 上台基线时登记，2026-11-24 补齐两类归因）— 现状：**两类**平台问题混在一起，① `afterEach` 的 `rmSync(tmpdir)` 删不掉仍被 SQLite 句柄握着的临时库 ⇒ Windows `EPERM`（Linux 上 unlink 打开的文件无问题）② 历史端点用例靠隔离 `HOME` 制造「没有可用模型」，但 Windows 走 `USERPROFILE` ⇒ 隔离失效、`getAvailable()` 仍返回全量模型目录（Linux CI 绿、本机红，可据此判平台）。本仓开发环境是 WSL，故长期没被发现。影响：Windows 上「全量测试绿」这条护栏对 server 不可用（`client` 那批源码扫描红已随 `.gitattributes` + `fileURLToPath` 修正）。触发条件：需要在 Windows 上跑 server 测试判回归时；最小修法 = ① 各用例 `afterEach` 先关库再删目录，或在 `rmSync` 外包一层容忍 EPERM ② 隔离段同时设 `USERPROFILE`（或改用 `os.homedir()` 可注入的方式）——**不要**去改生产代码的关闭时机。
- **flush 回执没有关联序号 / 页面未挂载时关窗固定等 3s**（2026-11 C1 复核登记，低危两项）— ① `desktop:flush-done` 只带 `ok` 布尔、主进程只按 `event.sender` 过滤 ⇒ 超时后迟到的 `ok=true` 会被下一次关窗的等待认领（两次都是「保存一次」的语义，无数据风险）；② 渲染侧没有 `onFlushRequest` 监听者时 `send` 静默丢弃，只能靠 `FLUSH_TIMEOUT_MS` 兜底 ⇒ 启动瞬间 / 页面加载失败时关窗要等满 3 秒才出确认框。

## 作家文风练习（2026-10，改版后的升级路径）

- **风格说明素材包的结构化统计（NLP 画像）**
  - 现状：素材包 = markdown 文本（`practice_style_packs` 单列 `content`）+ 预置常量；**统计信息不落库**（有意不预留空列）。
  - 升级路径：**用代码算全文**（词频 / 句长分布 / 段落长度 / 对话与描写配比 / 标点密度 / 人称 / 词汇丰富度），以**后续迁移加列或加表**接入；读写仍走同一处（db helper + `style-pack` 端点族）。
  - 为什么不现在做：预置作家只要一个、用户导入的长文样本尚未积累 ⇒ 先立结构 = 无消费方的死结构（YAGNI）。
  - 触发条件：出现「想看到这个作家的统计画像（而不是只有人工写的风格说明）」的需求。
- **长文范本自动切样本**
  - 现状：范文单条上限 = 常量 `MAX_PRACTICE_SAMPLE_CHARS`（100000 字），用户导入整本仍靠手动分段；不做自动切分。
  - 升级路径：单文件导入 → 按自然段/字数切 N 个样本（每次仍练一段；这是「导入范本」，**不是**被移除的「拆解」管线：不产出结构化创作要素、不要求模型理解整本）。
  - 触发条件：真实出现「想练整本文风」的需求，且样本级练习已被用起来。
- **跨工作区取文本（从某本书的章正文 / 参考资料送进练习）**
  - 现状：只能手动复制粘贴或导出文本文件再导入（跨工作区取数受「服务端同一时刻只打开一个工作区」约束）。
  - 升级路径：书侧提供「选中文本 → 送进练习区」动作（一次性快照落 `practice_samples`）；服务端短暂只读打开另一个工作区会突破单例不变式，**不推荐**。
  - 触发条件：用户抱怨「手动复制粘贴太麻烦」。
- **多稿历史**
  - 现状：1 样本 : 1 稿、1 自由练习篇 : 1 稿（`draft` / `feedback` 与行同行），可覆盖重写；改稿不保留旧版本与旧点评。
  - 升级路径：拆 `practice_attempts` 表（行 1:N 稿件，各自带反馈），把 `draft` / `feedback` 迁过去；写入类迁移必须幂等 + 现有行回填为第 1 稿。
  - 触发条件：出现「想看自己几次改写前后的进步」这类需求。
- **练习区多标签页并发防覆盖**
  - 现状：`PUT /practice/samples/:id` 与 `PUT /practice/free/:id` 是后写覆盖（与结构化数据/参考资料现状一致）；块文档那套版本戳（409 `DOCUMENT_STALE`）未应用到练习稿。
  - 触发条件：与全局「多标签页并发」延期项一并处理（见下节 `## MVP 明确不做`）。
- **作品清单用户自建 / 作家介绍与作品介绍可编辑**
  - 现状：**有意不做**——作品清单是封闭集合（预置 + 「其他」兜底），作家 / 作品介绍只读；理由：产品不校验文本归属，兜底桶已是「不校验」的诚实表达；自建作品会引入增删改与级联语义（删作品时它名下样本怎么办），超出练习边界。
  - 触发条件：真实出现「预置清单装不下我的练习材料」的反馈。
- **练习列表 `hasFeedback` 判定读整列 `feedback` 文本** — 现状：`listPracticeSamples` / `listPracticePieces` 为算 `hasFeedback` 把 `feedback` 整列拉进内存（与详情同一防御解析口径），当前单工作区数据量下无性能问题。触发条件：单工作区样本 / 自由练习量明显变大时；可换 SQL `json_valid()` + 长度判定，但需同步保留坏 JSON 不打挂列表的防御口径。（登记来源：卡 2 oracle 的 P2-1，report-only）
- **练习响应 schema 在运行时无消费点** — 现状：`shared` 的练习响应 schema（列表 / 详情 / 素材包 / 写稿 / 删除）只作类型契约，服务端不 `.parse()`（路由层手工拼字段，靠 server 测试的键集断言兜住）；project 模块有「经 schema 自检后返回」的先例。触发条件：改动练习响应字段时希望多一层运行期自检（与 project 口径对齐）。
- **根首页练习卡显示各作家样本数（需聚合端点）** — 现状：`GET /project/list` 不带样本数，「N 篇范文」只在**当前打开**的练习工作区卡上显示（多作家时其余卡只剩「最近更新 …」，有意降级，有单测钉住）。触发条件：预置作家多到需要横向对比进度时；最小修 = 新增一个只回「author_id → 样本数」的小聚合端点（或让 list 顺带回计数），客户端卡片直接展示。（登记来源：卡 6 oracle 的 P2-1）
- **预置素材的内容语言本地化**
  - 现状：预置作家介绍 / 作品介绍 / 风格说明与界面文案同为中文（`project.json` 的 `language` 不能切换它们）。
  - 触发条件：出现非中文用户需求（届时按语言分文件组织 `shared/authors/`，仍是加文件 + 清单一行）。
- **历史提案卡与消息内工具行信息重复**（提案历史只读卡 reviewer P3 登记，report-only）
  - 现状：同一条 `propose_*` 调用既出现在消息内折叠工具行「调用了 …」，又出现在历史提案卡；历史卡折叠行对 create/update 还会重复动词（如「新建实体 新建实体：类型…」）。
  - 触发条件：真实反馈视觉冗余 / 需要紧凑卡片时；届时隐藏历史卡对应工具行或合并两种展示，并去掉与 label 重复的前缀（需先改 `docs/ui/DESIGN.md` 并同步测试断言）。
- **`PROJECT_ALREADY_EXISTS` 不在 shared `ERROR_CODES` 联合里**（卡 8 登记，report-only）
  - 现状：它是服务端补充码（`packages/server/src/middleware/error.ts` 的 `EXTRA_CODES`；客户端多处按字面量比较，如 `lib/cloud-books.ts` 与 `Dashboard.tsx` 的懒创建兼容分支），shared 的 `ERROR_CODES` 里没有它 ⇒ `ApiError.code` 的类型联合不含该值，客户端比较前必须先把码宽化（`const code: string | null = ...`）否则 TS 报“no overlap”。
  - 触发条件：下次批量整理错误码时（把服务端补充码并入 shared 联合，或给 `ApiError.code` 另立服务端码集）。
  - 最小修法：在 shared `ERROR_CODES` 补该值（并同步 `docs/api/` 的码表），客户端可去掉宽化写法。

## MVP 明确不做（勿顺手实现）

多标签页并发、undo、token 统计、跨书参考资料导入——为 MVP 边界，实现前需先改产品口径。**章级正文历史同样不对 AI 开放**：快照表无工具、不进提示词（AI 只读当前正文与两侧摘要），「让 AI 看看我昨天那版」属有意非目标——放开前要先定「模型如何区分版本」与「回写权威性」两个口径（见 `00-master-design.md`）。**正文侧的「多标签页并发」已有局部防守**：块文档保存携带 `base_updated_at`，不一致回 409 `DOCUMENT_STALE`（防覆盖，不做协同合并）。**「token 统计」的会话级用量已随状态栏落地**（占用 / 费用 / 解码速度 / 缓存命中率 / 累计 tokens），仍未做的是聚合与审计面（会话列表成本列、全库汇总——见「会话状态栏的延期项」）。


## 测量工具（口径登记）

- **UI 规模测量的两条口径**（2026-11 登记，已修）
  - `test-project/measure-ui.mjs` 早期把「每次采样返回的**累计** longtask 数组」用 `flatMap` 拼起来求和 ⇒ 同一条被重复计 4~5 遍，曾据此报出 4 倍虚高的「long task 总时长」（大纲页 4,336ms、画布 5,251ms 均为虚高）。
  - 现在：只取最后一次采样，并同时输出 `Performance.getMetrics` 的 `TaskDuration` / `ScriptDuration` / `LayoutDuration` 作独立交叉校验——**今后报 UI 性能只认主线程任务时长与最长单次长任务，不用「longtask 求和」单独作结论**。
  - 另一条：`test-project/profile-boot.mjs` 做 CPU 采样（CDP `Profiler` 域）。千章书概览页实测：主线程 310ms / 脚本 187ms，主线程大段空闲 ⇒ 「启动地板很重」的假设**不成立**，不必为此改造代码分割。

## 有意保留（非待办，仅登记）

- **`PROVIDER_ICONS` 里的「非内置家」品牌映射（2026-09 pi 升级 oracle 复核后登记，**不是死键**）** — 现状：映射表 41 键里有 6 个（`moonshot` / `qwen` / `zhipu` / `cohere` / `perplexity` / `grok`）不是 pi 内置 provider id——逐版核对 0.74.2 / 0.80.5 / 0.85.1 / 0.87.1 / 1.0.4 / 1.3.0 都没有这些 id（1.3.0 实测目录 43 个 provider id，旧版里 `qwen` 的命中是 `thinkingFormat: "qwen"` 兼容标记，不是 provider）。它们随 `7288288` 从 pi-web 的同名表**整体搬入**（与该 svg 精灵一起，这 6 个 symbol 都在 `provider-icons.svg` 里）。**上游已核实（2026-10-08）**：`agegr/pi-web`（本机克隆 `~/projects/pi-web`，v0.9.1 / `8366762`）的 `components/ProviderIcon.tsx` —— 两表各 41 键、symbol 与 color **零差异**（唯一差别就是本卡的 `azure` 改名），且 `public/provider-icons.svg` 与本仓**逐字节相同（md5 `f19b29d3…`）**；pi-web 自己的 provider 列表同样来自 pi SDK（`lib/provider-listing-runtime.ts` 的 `modelRuntime.getProviders()`）并同样支持自定义 `models.json` 家 ⇒ 这 6 个在两边都是同一种东西，不是搬错的遗留。**为什么要留着**：provider 列表是数据驱动的（`modelRuntime.getProviders()`，无白名单），自定义 `models.json` 家（id 由用户起）同样走 `providerIcon(id)` ⇒ 自建一个叫 `cohere` / `grok` 的家能拿到正确品牌图标。本次升级只改了真被改名的 `azure-openai-responses` → `azure`（0.87.1 → 1.0.4 目录里被删/改名的 provider 仅此一个）。**别当死代码删**。

- **REST 保持泛型**：直连 API 仍可为 `hook.status` 写 `op=update`、为 character 写已移除字段。收窄落在前端 + AI 提案层 + executor；这是**分层口径**，不是漏改（已在 `10-data-model.md` §14 不变式 1 登记）。
- **`filters.status`**：保留给 hook 生命周期查询，character 侧不再消费。
- **数据/接口字段名 `current_position` 不改**：前端显示为「阅读进度」（UI 文案与字段名分离，见 `../ui/DESIGN.md` `character-workbench` 与 `../api/10-api-project.md`）。
- **快捷键只读不可自定义**（2026-09）：设置页「快捷键」是说明页——键位写死在 `lib/save-shortcut.ts`（清单 `lib/shortcuts.ts` 引用同一常量）。触发条件：出现「想改键位/改组合键」的真实需求；升级路径：加一张 localStorage 覆盖表（清单与判定共读），不改现有注册栈。
- **测试文件里的包名 typo（旧账）** — 现状：`packages/client/src/lib/character-workbench.test.ts` 的 import 写成 `@whispering2333/ai-editor-shared`（多一个 `3`）；type-only + `.test.ts` 不进 `typecheck` ⇒ 静默，测试内类型错误永不被发现（同型 typo 已在切分卡内修过一处）。触发条件：下次触碰该文件时。最小修法：改包名（一行）。
- **`Typography` 不在 antd 根元素守卫名单里（盲区）**（21.8 oracle 登记） — 现状：`design-discipline.test.ts` 的 `ANTD_GUARDED_COMPONENTS` 只扫 `Button` / `Input`，`Typography.Text` 上挂的 Tailwind 字号类会被 antd 无层 CSS 压掉（实测 `text-xs` 挂上、渲染仍是 14px）。触发条件：新增 antd 组件到守卫清单时（扩名单会连带扫描既有 13 处 `Typography` 用法，需一张独立卡）。最小修法：评估扩名单，并清理存量被无层 CSS 压掉的字号类。
- **antd `Typography` 自带字体栈与 `--font-sans` 不一致**（21.8 oracle 登记，非本卡引入） — 现状：antd 字体栈是 Latin+Emoji 栈，Linux 上数字与空格会落到彩色 emoji 字体（实测警告行「39」字形异常），Windows/macOS 命中系统字体无影响；既有先例（`Trash.tsx` 计数、云备份面板时间）同款。触发条件：出现 Linux 用户抱怨字体怪异。最小修法：给 antd 字体栈补 `PingFang SC` / `Microsoft YaHei`（或给 `--font-sans` 对齐），需全站核一遗像素。
- **延期项≠技术债记录**：真正"必须做但没做"的项请写进本文件的相应小节，并在触发条件写清"何时必须做"。
- **大纲页 / 设定页不迁移 antd `Tree`（2026-09 考察结论）**
  - 结论：保持自绘缩进行。成本 = `Outline.tsx` / `setting-rail.tsx` 两处视图层重写（纯逻辑 `lib/outline-tree.ts` / `lib/setting-tree.ts` 与单测可留）；**语义冲突在拖拽**——rc-tree 用鼠标水平位置（`dropLevelOffset`）决定落层级，与现有「行上下半 = 同级前后 / 行中段 = 成为子级 / 空白区 = 排根末尾」·三套语义不对应，且**空片区落点 rc-tree 无对应**；antd `Tree.js` 把 `dropIndicatorRender` 写在 props 展开之后（**不可注入**），指示线只能改 CSS。
  - 收益只有两项：键盘导航（↑↓ `activeKey` / ←→ 折叠）、大树虚拟滚动（`virtual` 默认 true）——但**触发条件：单本项目大纲节点数百且展开卡顿，或明确需要键盘无障碍时**⇒ **按需单点补**（默认只展开卷 / 只给大纲页加虚拟列表 / rc-tree 直接接管），不换引擎。
  - 可用 token（日后真要迁）：`indentSize` / `titleHeight`（默认 = `controlHeightSM` 24，可按层级覆盖）、`nodeSelectedBg`；v6 语义槽 `classNames.item|itemTitle|itemSwitcher|itemIcon`。
  - **已失效的旧理由（不要再用）**：`DESIGN.md` 曾写「antd Tree 选中面派生 token 不可信」——`controlItemBgActive` 已在 `AntdProvider` 全局覆盖为 `{colors.surface-muted}`，并有 `antd-tokens.test.ts` 对比度守卫；真理由是行为集与拖拽语义。

- **不引入 `@earendil-works/pi-durable` 作为会话内核（2026-10-24 评估结论）**
  - 结论：会话继续用 `pi-coding-agent` 的 `AgentSession` + pi session v3 文件。pi-durable 是 pi 同线的**平行内核**（Harness / Conversation / Entry / Commit / Task / Storage），依赖 `chord` + `pi-ai` + `pi-codemode` + `pi-telemetry`、**不依赖 `pi-coding-agent`**，README 自述 Experimental（API 随发布变）⇒ 只登记，不采纳。
  - 换内核的代价：本仓会话侧（`packages/agent/src/runtime/` 的 `sessions.ts` 扫盘、`message-projection.ts` 历史投影、`events.ts` SSE 投影、`usage.ts` 账目、`speed.ts` 速度计）与历史面板（`packages/client/src/components/chat/ChatPanel.tsx`）全建立在 `pi-coding-agent` 的 `SessionManager` / `SessionEntry` / `AgentSessionEvent` / `getSessionStats()` 上 ⇒ 全部重写；`packages/tools` 的工具装配换一套；并重新引入 `pi-coding-agent` 1.2.0 已移除的 `chord` 依赖。
  - 收益错配：durable 的核心价值是「进程死掉后从 checkpoint 继续」，而本仓数据都在 `data.db`、AI 产出是带 TTL 的提案、会话丢失的代价 = 重发一句话。
  - 保留事实：pi 的 `ModelRuntime implements Models`，durable 的 `HarnessOptions.models` 正好收 `Models`（或返回它的函数）⇒ 将来真要接入时，凭据/配置的唯一入口（`packages/server/src/model-runtime.ts`）不必重做。
  - 重新评估触发条件：出现「后台长任务」（定时批量分析、跨会话编排、进程可被驱逐的托管形态）且现有备份 tick 链 / 提案机制无法承载时。
