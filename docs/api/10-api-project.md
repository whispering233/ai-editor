# 项目管理

> 项目（书）创建/打开/关闭/书架列表/配置/项目规则文件（AGENTS.md）/导出/导入。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

### POST /api/v1/project/create

创建新项目。

```typescript
// Req
{
  path: string;          // 项目目录路径（绝对路径）
  config?: {
    name?: string;       // 项目名称，默认取目录名
    language?: "zh" | "en";
    // prompt 已废弃：不再接受（strict schema 传入 → 400 VALIDATION_ERROR）；
    // 项目规则改由 PUT /api/v1/project/agents 写入 AGENTS.md
  };
}

// Res: 200
{
  id: string;            // project_id
  path: string;
  created: true;
}
```

### POST /api/v1/project/open

打开已有项目。

```typescript
// Req
{
  path: string;          // 已有项目目录（必须包含 project.json）
}

// Res: 200
{
  id: string;
  name: string;
  language: "zh" | "en";
  config: ProjectConfig;  // 完整项目配置
  // ProjectConfig 含 schema_version: number（对应 project.json 的 schema_version）
  // 附加字段（shared projectOpenResSchema 未含，服务端附加构造）：
  //   rebuilt?: true    —— 删库重建发生（提示客户端「已重建」）
  //   migrated?: true   —— 前向迁移发生（旧版本经 runMigrations 自动升级；与 rebuilt 互斥）
  //   fromVersion?: number —— 重建/迁移前的旧版本号（备份/快照命名 v{n}）
}
```

**副作用（2026-09）**：open 成功后服务端把目标目录的绝对路径合并写入**创作根** `.ai-editor/config.json` 的 `lastProject`（原子写，保留同文件其他键）——下次启动自动打开这本书（见 `../design/build.md` §启动流程）。写入失败（只读目录等）静默，不影响 open 结果。

**路径校验（create/open 通用）**：
- 路径需规范化（`path.resolve`），拒绝相对路径逃逸与符号链接指向项目目录之外（防越权读写任意目录）。
- open 必须校验目标目录包含 `project.json`，否则拒绝。
- 校验失败返回 `{ code: "INVALID_PROJECT_PATH" }`（400）。

**schema 版本检测（open 时）**：
- 以 data.db 的 `user_version` 为准判定，三分支：
  - **同版本**（`user_version` === 当前）→ 正常打开。
  - **旧版本**（`user_version` < 当前）：
    - **有迁移路径**（`MIGRATIONS` 存在从当前版本到目标版本的连续迁移链，见 `../db/schema.md` 迁移机制）→ **前向迁移**（`runMigrations`：整批迁移前自动快照 `data.db.v{n}.{时间戳}.bak` + 每迁移一个事务原子提交）；响应附加 `migrated: true` + `fromVersion`；数据保全完整。
    - **无迁移路径** → **删库重建兜底**（备份 `data.db.v{n}.bak` + `outline.json.v{n}.bak`、重置 outline 空树、清空回收站）；响应附加 `rebuilt: true` + `fromVersion`。
  - **未来版本**（`user_version` > 当前——堵「装新版后回退旧版 → 降级重建清零」的降级数据丢失路径）：**拒绝打开**，返回 409 `PROJECT_VERSION_NEWER`（message 提示「项目 data.db 版本高于当前程序版本，请升级程序后打开」）；**不触发任何重建/备份/写操作**，数据文件原封不动。
- `project.json` 的 `schema_version` 仅用于 JSON 结构判断。

### POST /api/v1/project/close

关闭当前项目（释放数据库连接）。

```typescript
// Req: (none)

// Res: 200
{
  saved: true;
}
```

### POST /api/v1/project/delete

删除书架中的一本书（本地目录 + 可选云端目录）。**删除不可恢复**：本地 `.backups/` 在该书目录内，随目录一并删除。

```typescript
// Req
{
  path: string;           // 书目录绝对路径；须是 <创作根>/books/ 的**直接子目录**且含 project.json
                          //   （不存在/链接跳转/不在 books/ 下 → 400 INVALID_PROJECT_PATH）
  force?: boolean;        // true = 云端前置推送失败时仍然删除本机（缺省 false = 中止、不删任何东西）
  delete_remote?: boolean;// true = 同时删除该书云端目录并清掉 cloud.json 的该书 state；
                          //   缺省 false = 云端备份原样保留（用户可在云盘网页自行删除）
}

// Res: 200
{
  deleted: true;
  path: string;
  pushed?: { fileName: string };  // 删除前推送成功的那一份（云盘已配置且该书有同步记录时才有）
  remoteDeleted?: true;           // delete_remote 且云端目录删除成功
  remoteError?: { code: string; message: string };  // delete_remote 失败：本地已删、云端保留（best-effort）
}
```

**语义**：

1. **删除前推送（纯本地判据，不碰网络）**：`cloud.json` 已配置**且**该书有 book state（推过/拉过）→ 先打包本机最新状态并推送一次（未打开的书临时开 data.db，同覆盖前快照管道）；其余情况（云盘未配置 / 该书从未上云 = 「一个云端备份都没有」）→ 直接删，不发任何云端请求。
2. **推送链路失败 → 不删**，按原错误码返回（云错误 502 `CLOUD_*`：不可达 / 认证 / 配额 / 冲突；打包或统计失败等本机错误 500 `INTERNAL_ERROR`）；`force: true` 才继续删（最新改动不会上云，风险由用户确认时承担）。**前置推送对未打开的书用裸连接打开 `data.db`（不走 open 的版本对齐管道）**——删书不应触发迁移/重建；版本更高导致的读取失败按 500 处理（可 `force` 越过）。
3. **删除动作顺序**：取消在跑拆解 job（若该书有）→ 若删的是当前打开的书：`closeProject` + 清空 `currentProject` + 抹掉 `<创作根>/.ai-editor/config.json` 的 `lastProject` 键（下次启动回书架，不指向已删目录）→ 物理删目录。
4. **`deleteRemote` 是 best-effort**：在本地删除**之后**执行（WebDAV 集合删除 = 尾斜杠 + `Depth: infinity` + 清 `cloud.json` state）；失败不改变「本地已删」的结果，以 `remoteError` 返回，UI 提示可去云盘网页手动清理。
5. 目标已是当前书时，删完客户端应回书架并发刷新书架/项目配置/云端状态。

**错误码**：400 `INVALID_PROJECT_PATH`（路径非法/已不存在/不在 `books/` 下/目录不含 `project.json`）、502 `CLOUD_*` / 500 `INTERNAL_ERROR`（前置推送链路失败且未 `force`）。

### GET /api/v1/project/list

书架列表（S1.5 书架模式）：扫描创作根 `books/` 下含 `project.json` 的子目录，供 Dashboard 书架展示。

```typescript
// Query: (none)

// Res: 200
{
  rootPath: string;   // 创作根（server 启动参数 projectRoot）
  books: Array<{
    id: string;        // project.json 的 id（**项目身份**：当前书高亮/打开判定一律按它，不按 name）
    name: string;      // 目录名（书名）
    path: string;      // 书目录绝对路径（创作根/books/<书名>/）
    origin: "book" | "decompose";  // 出处：book = 手建/导入（缺省；project.json 无该字段即归此类），decompose = 由「拆解小说」建档
    updatedAt: string; // project.json 的 updated_at（ISO 8601）
  }>;
}
```

**语义**：
- **不依赖当前项目**——书架模式待命（无 currentProject）时同样可用；`books/` 不存在返回空数组（不报错）。
- 排序按 `updatedAt` 倒序（最近更新在前）；书架按 `origin` 分「小说项目 / 小说拆解」两组展示（空组不渲染）。
- 过滤规则：仅目录 + 含 `project.json`（`readProjectFile` 探测）；`books/` 下无 project.json 的目录（如草稿箱）与普通文件不列出。
- 兼容旧语义：创作根自身若有 `project.json`（旧部署模式）仍按 `detectProject` 打开，`list` 只列 `books/` 子目录（根自身不是书）。

### GET /api/v1/project/config

获取当前项目配置。

```typescript
// Query: (none)

// Res: 200
{
  id: string;
  name: string;
  language: "zh" | "en";
  // prompt 字段已废弃：不再返回——项目规则唯一事实源改为项目目录 AGENTS.md
  // （见 GET /api/v1/project/agents）；旧 project.json 中的 prompt 残留字段不再读取
  schemaVersion: number;     // schema 版本（对应 project.json 的 schema_version）
  currentPosition: string | null;  // 大纲「阅读进度」节点 id（**UI 文案 = 阅读进度；字段名不变**；project.json，伏笔健康指标/双视图依赖）——**仅章**：
                                   //   必须指向存在的非软删 chapter 节点（卷/场景不承载写作进度）
  backupFrequencyMinutes: number | null;  // 自动备份频率（分钟；null = 关闭；缺省 10）
  createdAt: string;         // ISO datetime
  updatedAt: string;
}
```

### PUT /api/v1/project/config

更新项目配置。

```typescript
// Req
{
  name?: string;
  language?: "zh" | "en";
  // prompt 已废弃：不再接受（strict schema 传入 → 400 VALIDATION_ERROR）；
  // 项目规则改由 PUT /api/v1/project/agents 写入 AGENTS.md
  current_position?: string | null;  // 更新「阅读进度」（UI 文案）：须指向存在的非软删 **chapter** 节点；null = 清除
                                    // 错误码分两类：不存在/已软删 → 400 OUTLINE_NODE_NOT_FOUND（既有语义，
                                    //   project 路由用 400 而非 404——参数语义错误）；
                                    //   非章（volume/scene）→ 400 VALIDATION_ERROR
  backup_frequency_minutes?: number | null;  // 自动备份频率；null = 关闭；仅接受枚举值 1/5/10/15/30/60（BACKUP_FREQUENCIES），其他（含 0）→ 400 VALIDATION_ERROR——0 仅读侧兼容旧数据，写侧不接受
}

// Res: 200
{
  updated: true;
}
```

### GET /api/v1/project/agents

读取当前项目规则文件 AGENTS.md 内容（项目规则**唯一事实源**，取代 project.json `prompt` 字段）。

```typescript
// Query: (none)

// Res: 200
{
  content: string;          // AGENTS.md 文件内容（文件不存在 → 空串）
  exists: boolean;          // 文件是否存在（false 时 content 为空串）
  updatedAt: string | null; // 文件 mtime（ISO 8601；文件不存在 → null）——外部修改检测依据
}
```

**语义**：
- 无当前项目 → 409 `NO_PROJECT_OPEN`（与 `/config` 一致）。
- **文件不存在不报错**：AGENTS.md 是可选文件（新项目/未迁移项目可能没有），返回 `exists: false` + 空串，前端据此展示空编辑区。
- `updatedAt` = 文件系统 mtime（ISO 8601）——**外部修改检测**：用户在文件管理器中直接编辑 AGENTS.md 后 mtime 变化，前端比对上次读取的 `updatedAt`，不一致即提示「文件已被外部修改，请刷新/重新加载」。
- 读取为**每次实时读文件**（不缓存）——外部编辑立即可见。

### PUT /api/v1/project/agents

写入当前项目规则文件 AGENTS.md（设置页直接编辑 AGENTS.md 文件内容）。

```typescript
// Req
{
  content: string;   // AGENTS.md 完整内容（整体替换；空串 = 清空规则文件，保留空文件不删除）
}

// Res: 200
{
  saved: true;
  updatedAt: string;  // 写入后的文件 mtime（ISO 8601）——前端更新本地比对基线
}
```

**语义**：
- 无当前项目 → 409 `NO_PROJECT_OPEN`。
- **整体替换**（非追加）：`content` 为 AGENTS.md 完整内容；空串 = 清空规则（保留空文件，不删除——`exists` 语义稳定）。
- 文件不存在时自动创建；写入走**原子写**（临时文件 + fsync + rename 同款）——防崩溃/断电损坏。
- 写入后返回新 mtime，前端更新本地比对基线（外部修改检测用）。
- 写入失败 → 500 `INTERNAL_ERROR`。

### GET /api/v1/project/export

导出当前项目完整数据为 zip 备份包（产品承诺「数据主权归用户」的载体，见 `../design/00-master-design.md`）。

> **响应为二进制 zip（`application/zip`），不走 `{success, data}` 包裹**——「通用约定」成功响应的显式例外（契约见 `@whispering233/ai-editor-shared` 的 `PROJECT_EXPORT_FILE_NAMES` 常量注释）。

```typescript
// Query: (none)

// Res: 200 —— application/zip 二进制
//  Headers:
//   Content-Type: application/zip
//   Content-Disposition: attachment; filename="book.zip"; filename*=UTF-8''<书名>.zip  // RFC 5987（中文书名 percent-encoded）
//  Body: zip 内文件（条目名 = 数据文件原名/相对路径，import 侧按此固定名校验）
//   project.json
//   outline.json
//   data.db        // 导出前服务端 wal_checkpoint(TRUNCATE)——主文件为完整快照，无需附带 -wal/-shm
//                  // **含正文与参考资料**（document_records）与全部结构化数据
// （2026-09：不再有 references/** 条目——参考资料正文已进 data.db；**也不再含 `sessions/**`**
//   ——会话是纯本地目录，不进任何 zip）
```

**语义**：
- 导出**当前打开项目**（无项目 → 409 `NO_PROJECT_OPEN`，与 `/config` 一致）。
- zip 天然不含 DeepSeek key（key 存 pi agent dir 的 `~/.pi/agent/auth.json`，不入项目文件；旧的 `~/.ai-editor/config.json` 已废弃、代码忽略）。
- 三文件缺失任一 → 500 `INTERNAL_ERROR`（打开的项目三文件必然齐全，缺失即损坏，不导出半成品包）。
- **`sessions/` 目录不在包内**（2026-09）：会话是纯本地目录，不进导出 zip（也不进备份/云端）——导出包只剩三文件；正文与参考资料随 `data.db` 走，无额外目录。

### POST /api/v1/project/import

导入备份 zip（校验 + 原子搬入；分流：**id 匹配书架已有项目 → 覆盖恢复，不匹配 → 导入为新书**）。

```typescript
// Req: multipart/form-data
//   file: zip 备份包（必填；大小上限 50MB，超限 400 VALIDATION_ERROR）
//   name: 书名（**可选**）。留空/不传 → 用备份内 project.json 的 name（备份是权威；
//         备份文件名是 `<时间戳>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N`，
//         拿它当书名会把元信息写进目录名）。显式传入时严格校验：禁路径分隔符 / \、
//         纯点 . / ..、控制字符——同 client 新建项目规则（非法 → 400）
//         目标目录为服务端决定的 创作根/books/<name>/（客户端不可指定路径，防越权）
//   注：备份内书名若为空串/含非法字符（手工改坏的包）→ 兑底「导入的书籍」（同名自动去重）

// Res: 200
{
  imported: true;
  id: string;     // 项目 project_id（覆盖恢复 = 书架目标项目原 id；导入新书 = 沿用 zip 内 project.json 的 id）
  path: string;   // 书目录绝对路径（创作根/books/<name>/ 或去重名）
  name: string;   // 书名（新书目录名；project.json 内部 name 同此）
  mode: "restored" | "new";  // restored = id 匹配覆盖恢复；new = 导入为新书（前端按此提示 toast）
}
```

**分流逻辑（在校验通过后）**：
1. 解压校验完成后读取 zip 内 `project.json` 的 `id`；
2. **id 与书架已有项目匹配**（遍历 `books/*/project.json` 比对）→ **覆盖恢复**：走 restore 同款管道（覆盖前自动快照当前状态 → 原子替换三文件 → 返回 `mode: "restored"`）；覆盖目标按 id 定位目录（不是按 name）；**覆盖时 project.json 内 `name` 归一为当前目录名**（id 是身份、name 是展示名——维持「目录名 = 书名」不变式，恢复的是数据不是身份；改名需求走 `/project/rename`）；覆盖目标是当前打开的书 → data.db 重连 + 定时器重启（同 restore 语义），未打开的书无连接无需重连；
3. **id 不匹配** → 导入为新书：目标 `books/<name>/` 冲突时**不再 409**——若前端已选择重命名（name 为新名）则无冲突；若保持原样（name 与书架冲突）则**目录自动去重为 `books/<书名> (N)/`**（N 为最小正整数，project.json 内部 name 同步为去重名，维持「目录名 = 书名」不变式）。

**校验顺序**（任一步失败即拒绝，不触发删库重建逻辑）：
1. `content-length` 预检（> 50MB 快速拒绝，防超大请求先缓冲）+ `file.size` 复核
2. 书名校验（防路径逃逸）
3. zip 解压（fflate Unzip 流式 + **解压总字节预算 200MB**——zip 炸弹防御；解析失败/零条目 → 400 `VALIDATION_ERROR`「不是有效的项目备份包」）
4. **条目白名单**：接受 `PROJECT_EXPORT_FILE_NAMES` 三文件名 + `sessions/` 前缀条目（前缀开头且不含 `..` 路径段才接受；**存量旧包含 `sessions/**`，读取时接受并在搬入时忽略**；未知条目严格拒绝——逐名比对天然防 zip 路径穿越）；**历史包内的 `references/` 条目按未知条目拒绝**（开发阶段无真实用户，不做兼容）
5. 三文件齐全（缺任一 → 400）
6. `project.json`/`outline.json` 顶层契约（JSON 可解析 + id/name/schema_version；`{id:"root",type:"root",schema_version,children[]}`）
7. `data.db`：**文件大小 > 0 → 打开成功（非 SQLite/空文件 → 400 坏包）→ `user_version` === 当前版本，或 < 当前版本且有迁移路径**（搬入后首次 open 自动前向迁移）

**错误码**：
- 400 `VALIDATION_ERROR`：坏包/缺文件/未知条目/契约不符/书名非法/超大小上限
- 409 `SCHEMA_VERSION_MISMATCH`：data.db `user_version` 与当前程序版本不匹配且**无迁移路径**（`v > 当前` → 「备份来自更高版本程序」，零触碰；`v < 当前` 但有迁移路径 → 放行，搬入后 open 自动前向迁移）；**一律不静默重建**

**原子搬入/覆盖**：校验在 `mkdtemp` 临时目录完成（无论成败清理）；通过后 `mkdir` + 复制三文件到 `books/<name>/`（或覆盖目标目录，覆盖前先快照），任一失败清理半成品（不留下残缺书）。导入**不自动打开**（与 create 一致，前端刷新书架）。**覆盖恢复分支与 restore 同口径：只覆盖三文件，不触碰本机 `sessions/`**（会话是纯本地目录；存量旧包内的 `sessions/**` 条目接受但搬入时忽略）。

---
