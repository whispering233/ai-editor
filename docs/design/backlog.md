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

- **备份响应 schema 未收敛到 shared**（卡 1 oracle 验证登记）
  - 现状：`docs/api/*.md` 声明「响应 schema 单一来源 = shared `types/api.ts`」，但备份响应类型实际在 `client/src/lib/api.ts`（`BackupEntry`）与 `packages/server/src/backup.ts`（`BackupFileInfo`）**各写一份**（请求侧两个 zod schema 确在 shared）。
  - 触发条件：云端批次（卡 2-7）要给备份响应加字段时——那会让第三份手抄出现。
  - 最小修法：把备份条目响应 schema（`backups` / `backup`）提到 shared，client 与 server 共用；顺带修正 `docs/api/20-api-backup.md` 首行「响应 schema 单一来源」的表述。

- **云根目录的 `.tmp-` 探测文件永不被清 + DELETE 不可用时 `/cloud/test` 误报认证失败**（卡 2 oracle 验证 F4）
  - 现状：`POST /cloud/test` 会在**云盘根目录**写 `.tmp-ai-editor-writetest` 再删；若服务器允许写但禁止删（DELETE 403），该文件残留，且端点报 502 `CLOUD_AUTH_FAILED`（凭据其实正常）。
  - 影响：卡 4 的保留清理只扫**书目录**，云根这份不会被回收；「`.tmp-*` 无残留」判据的口径需写明范围。
  - 触发条件：卡 4 落地推送清理时（顺手决定：云根 `.tmp-*` 是否也纳入清理扫描）。
  - 最小修法：`/test` 的 DELETE 失败降级为「连接可用 + 提示残留」而不是 502；或推送清理扫一遍云根 `.tmp-*`。

## 云端存档（2026-09，MVP 已发布后的遗留项）

- **云端书架**（列云端全部书的目录、一键拉取到本机）
  - 现状（有意）：MVP 只做当前打开的书；第二台机器首次获取走「云盘网页下载 zip → 导入备份」（按 `project.id` 分流：匹配 → 覆盖恢复，不匹配 → 导入新书）。
  - 触发条件：真实用到第三台机器 / 换机频繁，手工下载导入开始痛。
  - 升级路径：`PROPFIND` 云端根列全部 `<书名>-<projectId>` 目录 + 一个新的列表端点 + 一个 UI 区块（拉取后按 id 分流复用现有 import 逻辑）。
- **文件级增量上传**（避免每次全量 `PUT` 整个 zip）
  - 现状（有意）：整包上传（云端文件 = 本地备份文件逐字节拷贝）——实现简单、无格式转换。包体积主要来自 `sessions/`（聊天历史累积）与 `references/`（md 文档）。
  - 触发条件：单次推送体积/耗时可感知地变差（或云盘配额被反复烧穿）。
  - 升级路径：云端布局改为「一文件一对象」（`data.db` / `outline.json` / `references/**` / `sessions/**` 分别上传，只传变化项），拉取时本地重新打包成 zip 走现有校验管道；代价是冲突检测与保留策略的粒度全部重做。
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

- **客户端 `SettingTreeNode.category` 是死键**（2026-09 发布前审计发现）
  - 现状：`client/src/lib/setting-tree.ts` 的树节点带 `category`，只写不读（旧分类徐标残留；`components/entity/setting-tree.tsx:769` 注释已说明改用 tags）；注意 **`EntitySummary.summary.category` 仍是活字段**（`parent-setting-select.tsx` 在渲染），不能一并删。
  - 触发条件：下次触碰设定树数据派生时。
  - 最小修法：删 `SettingTreeNode.category` + 输入映射 + `setting-tree.test.ts` 对应断言。

- **参考资料页「分类徽标」形态与类型徽标不一致**（卡 10.4 登记）
  - 现状：`pages/ReferenceDetail.tsx:354` 的分类徽标已是中性色，但形态是**描边徽标**（`border border-border rounded-md`），与 `TypeChip`（**描边式**：1px `type-badge-border` + `surface-muted` 底 + `rounded-sm`）仍有差异——圆角档不同，且它同时是页头右侧的元信息位（不是行内徽标）。
  - 触发条件：再次调整参考资料页头部布局时。
  - 最小修法：换 `TypeChip`（一行），代价是页头那一块视觉微变（圆角 `rounded-md` → `rounded-sm`、边框色 `border-border` → `type-badge-border`）。
- **关联页端点类型徽标缺 `timepoint`/`event` 中文标签**（卡 10.5 浏览器实测发现）
  - 现状：`components/entity/relations-view.tsx:32` `ENDPOINT_TYPE_LABEL` 只有 `character`/`setting`/`location`/`hook`/`outline_node`；时间点↔事件关系（`occurs_at`）在关联总览的源/目标列直接显示原始类型串 `timepoint` / `event`（fallback `?? type`）。
  - 影响：用户看到程序设计语义的英文标识（正是本仓多次收敛过的那类问题）。
  - 触发条件：下次触碰关联页或统一「类型→中文名」映射时。
  - 升级路径：把该表与 `Trash.tsx` 的 `ENTITY_TYPE_LABEL`、`lib/entity-list.ts` 的类型标签合并为一份（另一端点在人物页/大纲页都已有中文名）。
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

## MVP 明确不做（勿顺手实现）

多标签页并发、undo、token 统计、跨书参考资料导入——为 MVP 边界，实现前需先改产品口径（见 `00-master-design.md`）。

## 有意保留（非待办，仅登记）

- **REST 保持泛型**：直连 API 仍可为 `hook.status` 写 `op=update`、为 character 写已移除字段。收窄落在前端 + AI 提案层 + executor；这是**分层口径**，不是漏改（已在 `10-data-model.md` §14 不变式 1 登记）。
- **`filters.status`**：保留给 hook 生命周期查询，character 侧不再消费。
- **数据/接口字段名 `current_position` 不改**：前端显示为「阅读进度」（UI 文案与字段名分离，见 `../ui/DESIGN.md` `character-workbench` 与 `../api/10-api-project.md`）。
- **延期项≠技术债记录**：真正"必须做但没做"的项请写进本文件的相应小节，并在触发条件写清"何时必须做"。
