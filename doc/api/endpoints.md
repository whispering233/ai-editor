# 核心 API 端点设计

所有 API 遵循 REST 风格，由 Hono 框架实现。前缀 `/api/v1`。

**通用约定**：
- 请求体为 JSON
- 成功响应：`{ success: true, data: T }`
- 错误响应：`{ success: false, error: { code: string, message: string } }`
- 统一 HTTP 状态码：200 成功、400 参数错误、404 不存在、409 冲突、500 服务端错误
- **命名约定**：请求体/查询参数用 snake_case，响应体用 camelCase，outline.json 内部字段用 snake_case；文件字段与 API 字段的显式映射函数定义于 `@whispering233/ai-editor-shared/utils`（backlog #7）。**嵌套 `data` 对象内部字段原样透传**（保持 snake_case，如 `expected_payoff`）——camelCase 映射仅应用于 API 顶层契约字段（2026-08 修订）。
- **id 约定**：`{前缀}-{nanoid}`（如 `char-9f3k2m`）。前缀表：`char-`/`set-`/`loc-`/`hook-`/`ev-`（实体，`ev-` 为事件，决策 26）、`sc-`/`ch-`/`vol-`（大纲）、`rel-`（关系，S3.2 补充）、`proj-`（项目）、`prop_`/`sess_`/`call_`（运行时对象）。本文示例中的 `char-9` 等为形状示意，**非自增序号**。
- **错误码**：所有错误码统一枚举 `ErrorCode`（单一来源：`@whispering233/ai-editor-shared/types/api.ts`），REST 响应、SSE error 事件、工具结果截断提示共用。

**类型定义**：以下 `Req` / `Res` 类型对应 `@whispering233/ai-editor-shared` 包中 `types/api.ts` 的 Zod schema。

---

## 项目管理

### POST /api/v1/project/create

创建新项目。

```typescript
// Req
{
  path: string;          // 项目目录路径（绝对路径）
  config?: {
    name?: string;       // 项目名称，默认取目录名
    language?: "zh" | "en";
    prompt?: string;     // 项目级提示词
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
  // ProjectConfig 含 schema_version: number（对应 project.json 的 schema_version，决策 13）
  // 附加字段（shared projectOpenResSchema 未含，服务端附加构造）：
  //   rebuilt?: true    —— 删库重建发生（决策 13 修订，提示客户端「已重建」）
  //   migrated?: true   —— 前向迁移发生（E5：旧版本经 runMigrations 自动升级；与 rebuilt 互斥）
  //   fromVersion?: number —— 重建/迁移前的旧版本号（备份/快照命名 v{n}）
}
```

**路径校验（create/open 通用，决策 17）**：
- 路径需规范化（`path.resolve`），拒绝相对路径逃逸与符号链接指向项目目录之外（防越权读写任意目录）。
- open 必须校验目标目录包含 `project.json`，否则拒绝。
- 校验失败返回 `{ code: "INVALID_PROJECT_PATH" }`（400）。

**schema 版本检测（open 时，决策 13 修订 + E4 + E5）**：
- 以 data.db 的 `user_version` 为准判定，三分支：
  - **同版本**（`user_version` === 当前）→ 正常打开。
  - **旧版本**（`user_version` < 当前）：
    - **有迁移路径**（`MIGRATIONS` 存在从当前版本到目标版本的连续迁移链，见 `doc/database/schema.md` 迁移机制）→ **前向迁移**（`runMigrations`：整批迁移前自动快照 `data.db.v{n}.{时间戳}.bak` + 每迁移一个事务原子提交）；响应附加 `migrated: true` + `fromVersion`；数据保全完整。
    - **无迁移路径** → **删库重建兜底**（决策 13：备份 `data.db.v{n}.bak` + `outline.json.v{n}.bak`、重置 outline 空树、清空回收站）；响应附加 `rebuilt: true` + `fromVersion`。
  - **未来版本**（`user_version` > 当前，E4——堵「装新版后回退旧版 → 降级重建清零」的降级数据丢失路径）：**拒绝打开**，返回 409 `PROJECT_VERSION_NEWER`（message 提示「项目 data.db 版本高于当前程序版本，请升级程序后打开」）；**不触发任何重建/备份/写操作**，数据文件原封不动。
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

### GET /api/v1/project/list

书架列表（S1.5 书架模式）：扫描创作根 `books/` 下含 `project.json` 的子目录，供 Dashboard 书架展示。

```typescript
// Query: (none)

// Res: 200
{
  rootPath: string;   // 创作根（server 启动参数 projectRoot）
  books: Array<{
    name: string;      // 目录名（书名）
    path: string;      // 书目录绝对路径（创作根/books/<书名>/）
    updatedAt: string; // project.json 的 updated_at（ISO 8601）
  }>;
}
```

**语义**：
- **不依赖当前项目**——书架模式待命（无 currentProject）时同样可用；`books/` 不存在返回空数组（不报错）。
- 排序按 `updatedAt` 倒序（最近更新在前）。
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
  prompt: string;            // 项目提示词
  schemaVersion: number;     // schema 版本（对应 project.json 的 schema_version，决策 13）
  currentPosition: string | null;  // 大纲「当前位置」节点 id（project.json，伏笔健康指标依赖）
  backupFrequencyMinutes: number | null;  // 自动备份频率（分钟，决策 27；null = 关闭；缺省 10）
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
  prompt?: string;
  current_position?: string | null;  // 更新「当前位置」（须指向存在的非软删大纲节点）
  backup_frequency_minutes?: number | null;  // 自动备份频率（决策 27；null = 关闭；仅接受枚举值 5/10/15/30/60，其他（含 0）→ 400 VALIDATION_ERROR——0 仅读侧兼容旧数据，写侧不接受）
}

// Res: 200
{
  updated: true;
}
```

### GET /api/v1/project/export

导出当前项目完整数据为 zip 备份包（E1，release-review §二——产品承诺「数据主权归用户」的载体）。

> **响应为二进制 zip（`application/zip`），不走 `{success, data}` 包裹**——「通用约定」成功响应的显式例外（契约见 `@whispering233/ai-editor-shared` 的 `PROJECT_EXPORT_FILE_NAMES` 常量注释）。

```typescript
// Query: (none)

// Res: 200 —— application/zip 二进制
//  Headers:
//   Content-Type: application/zip
//   Content-Disposition: attachment; filename="book.zip"; filename*=UTF-8''<书名>.zip  // RFC 5987（中文书名 percent-encoded）
//  Body: zip 内三文件（条目名 = 数据文件原名，import 侧按此固定名校验）
//   project.json
//   outline.json
//   data.db        // 导出前服务端 wal_checkpoint(TRUNCATE)——主文件为完整快照，无需附带 -wal/-shm
```

**语义**：
- 导出**当前打开项目**（无项目 → 409 `NO_PROJECT_OPEN`，与 `/config` 一致）。
- zip 天然不含 DeepSeek key（决策 17：key 存用户级配置 `~/.ai-editor/config.json`，不入项目文件）。
- 三文件缺失任一 → 500 `INTERNAL_ERROR`（打开的项目三文件必然齐全，缺失即损坏，不导出半成品包）。

### POST /api/v1/project/import

导入备份 zip（E2 校验 + 原子搬入；决策 27 分流：**id 匹配书架已有项目 → 覆盖恢复，不匹配 → 导入为新书**）。

```typescript
// Req: multipart/form-data
//   file: zip 备份包（必填；大小上限 50MB，超限 400 VALIDATION_ERROR）
//   name: 书名（必填；禁路径分隔符 / \、纯点 . / ..、控制字符——同 client 新建项目规则）
//        目标目录为服务端决定的 创作根/books/<name>/（客户端不可指定路径，防越权）

// Res: 200
{
  imported: true;
  id: string;     // 项目 project_id（覆盖恢复 = 书架目标项目原 id；导入新书 = 沿用 zip 内 project.json 的 id）
  path: string;   // 书目录绝对路径（创作根/books/<name>/ 或去重名）
  name: string;   // 书名（新书目录名；project.json 内部 name 同此）
  mode: "restored" | "new";  // 决策 27：restored = id 匹配覆盖恢复；new = 导入为新书（前端按此提示 toast）
}
```

**分流逻辑（决策 27，在 E2 校验通过后）**：
1. 解压校验完成后读取 zip 内 `project.json` 的 `id`；
2. **id 与书架已有项目匹配**（遍历 `books/*/project.json` 比对）→ **覆盖恢复**：走 restore 同款管道（覆盖前自动快照当前状态 → 原子替换三文件 → 返回 `mode: "restored"`）；覆盖目标按 id 定位目录（不是按 name）；**覆盖时 project.json 内 `name` 归一为当前目录名**（id 是身份、name 是展示名——维持「目录名 = 书名」不变式，恢复的是数据不是身份；改名需求走 `/project/rename`）；覆盖目标是当前打开的书 → data.db 重连 + 定时器重启（同 restore 语义），未打开的书无连接无需重连；
3. **id 不匹配** → 导入为新书（原 E2 语义）：目标 `books/<name>/` 冲突时**不再 409**——若前端已选择重命名（name 为新名）则无冲突；若保持原样（name 与书架冲突）则**目录自动去重为 `books/<书名> (N)/`**（N 为最小正整数，project.json 内部 name 同步为去重名，维持「目录名 = 书名」不变式）。

**校验顺序**（任一步失败即拒绝，不触发删库重建逻辑）：
1. `content-length` 预检（> 50MB 快速拒绝，防超大请求先缓冲）+ `file.size` 复核
2. 书名校验（防路径逃逸）
3. zip 解压（fflate Unzip 流式 + **解压总字节预算 200MB**——zip 炸弹防御；解析失败/零条目 → 400 `VALIDATION_ERROR`「不是有效的项目备份包」）
4. **条目白名单**：只接受 `PROJECT_EXPORT_FILE_NAMES` 三文件名（未知条目严格拒绝——逐名比对天然防 zip 路径穿越）
5. 三文件齐全（缺任一 → 400）
6. `project.json`/`outline.json` 顶层契约（JSON 可解析 + id/name/schema_version；`{id:"root",type:"root",schema_version,children[]}`）
7. `data.db`：**文件大小 > 0 → 打开成功（非 SQLite/空文件 → 400 坏包）→ `user_version` === 当前版本，或 < 当前版本且有迁移路径**（搬入后首次 open 由 E5 自动前向迁移）

**错误码**：
- 400 `VALIDATION_ERROR`：坏包/缺文件/未知条目/契约不符/书名非法/超大小上限
- 409 `SCHEMA_VERSION_MISMATCH`：data.db `user_version` 与当前程序版本不匹配且**无迁移路径**（`v > 当前` → 「备份来自更高版本程序」（E4 语义，零触碰）；`v < 当前` 但有迁移路径 → 放行，搬入后 open 自动前向迁移（E5））；**一律不静默重建**

**原子搬入/覆盖**：校验在 `mkdtemp` 临时目录完成（无论成败清理）；通过后 `mkdir` + 复制三文件到 `books/<name>/`（或覆盖目标目录，覆盖前先快照），任一失败清理半成品（不留下残缺书）。导入**不自动打开**（与 create 一致，前端刷新书架）。

---

## 备份管理（决策 27 + 决策 28 + 决策 29）

> 自动备份由服务端定时器驱动（服务运行期间生效，频率 = project.json `backup_frequency_minutes`，缺省 10 分钟）。备份文件存项目目录内 `.backups/`，时间戳命名（决策 28 毫秒精度 + **决策 29 类型标记段**：`<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`——kind 为 `m`（手动）/ `a`（自动带名称），自动备份/快照为纯时间戳；手动备份无名称也带 `-m` 段，与自动备份可靠区分；**旧格式兼容解析不迁移**：旧秒级 `<YYYYMMDD-HHmmss>.zip` → auto、旧带名称无 kind 段 `<YYYYMMDD-HHmmssSSS>-<名称>.zip` → manual、纯时间戳 → auto——历史备份仍可列出/恢复/参与保留策略），格式与 E1 导出 zip 完全一致（三文件 + wal_checkpoint），**每项目保留最近 20 份**（超出删除最旧，含覆盖前自动快照）。全部端点要求当前项目已打开（无项目 → 409 `NO_PROJECT_OPEN`，与 `/config` 一致）。

### GET /api/v1/project/backups

当前项目的自动备份列表。

```typescript
// Query: (none)

// Res: 200
{
  backups: Array<{
    fileName: string;   // 备份文件名（毫秒级时间戳命名；restore 用此引用）
    size: number;       // 字节数
    createdAt: string;  // 备份时间（ISO 8601，由文件名时间戳解析）
    kind: "auto" | "manual";  // 备份类型标签（决策 29，必填；由文件名解析——
                              //   -m/-a 标记段、旧带名称（无标记）→ manual、纯时间戳/旧秒级 → auto）
    name?: string;      // 自定义名称（决策 28/29；由文件名解析——自动备份/快照/旧备份无此字段；
                        //   自动备份重命名后带 -a 段 + 名称，kind 仍为 auto）
  }>;
}
```

**语义**：按时间倒序（最新在前）；`.backups/` 不存在返回空数组（不报错）。

### POST /api/v1/project/backup

立即备份当前项目（手动触发；设置页「立即备份」按钮）。**kind 恒为 manual**（文件名落 `-m` 段，决策 29）。

```typescript
// Req（请求体可选；缺省 = 纯时间戳文件名）
{
  name?: string;  // 手动备份自定义名称（决策 28）：trim 后 1-30 字符（MAX_BACKUP_NAME_LENGTH）；
                  // 禁路径分隔符/保留字符（: * ? " < > |）/控制字符/纯点（. ..）；
                  // 自动剥离尾部 .zip；非法 → 400 VALIDATION_ERROR
}

// Res: 200
{
  backup: {
    fileName: string;   // <YYYYMMDD-HHmmssSSS>-m.zip（无名称）或 <YYYYMMDD-HHmmssSSS>-m-<名称>.zip
    size: number;
    createdAt: string;
    kind: "manual";     // 决策 29
    name?: string;      // 带名称时返回规范化后的名称
  };
}
```

**语义**：与自动备份同款管道（三文件 + wal_checkpoint → `.backups/<时间戳>-m...>.zip` → 触发保留策略清理）。文件写入失败 → 500 `INTERNAL_ERROR`。

### POST /api/v1/project/backup/rename

重命名备份（决策 29；设置页备份列表行内编辑）。**只改名称段，时间戳与 kind 保持**——重命名不改变备份来源标签。

```typescript
// Req
{
  fileName: string;  // 备份文件名（须匹配 .backups/ 内时间戳格式，防路径穿越；不存在 → 404 VALIDATION_ERROR「备份不存在」）
  name?: string;     // 新名称（规则同决策 28：trim 后 1-30 字符/禁路径分隔符与保留字符/禁纯点/自动剥 .zip；
                     //   非法 → 400 VALIDATION_ERROR）。空串或缺省 = 清除名称段——
                     //   manual 保留 -m 标记（<时间戳>-m.zip），auto 回到纯时间戳
}

// Res: 200
{
  backup: {
    fileName: string;   // 新文件名 <YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip（时间戳与 kind 不变；
                        //   旧格式文件改名时顺带规范化：旧秒级补毫秒 000、旧带名称无 kind 段补 kind 段）
    size: number;
    createdAt: string;
    kind: "auto" | "manual";
    name?: string;      // 新名称（清除后无此字段）
  };
}
```

**语义**：同目录 renameSync 原子改名；新名称与原名称相同（幂等）→ 直接返回当前条目不报错；**改名前检查目标文件名是否已存在**——已存在 → 409 `BACKUP_TARGET_EXISTS`（防 rename 静默覆盖丢失备份）；改名不触碰 zip 内容（名称只进文件名，决策 28 语义）。

**错误码**：400 `VALIDATION_ERROR`（文件名格式非法/新名称非法）、404 `VALIDATION_ERROR`（备份不存在）、409 `BACKUP_TARGET_EXISTS`（目标文件名已存在）。

### POST /api/v1/project/backup/restore

从备份列表恢复当前项目（覆盖恢复，决策 27）。

```typescript
// Req
{
  fileName: string;  // 备份文件名（须匹配 .backups/ 内时间戳格式，防路径穿越；不存在 → 404 VALIDATION_ERROR「备份不存在」）
}

// Res: 200
{
  restored: true;
  snapshot: {
    fileName: string;  // 覆盖前自动生成的当前状态快照文件名（后悔药，已计入保留策略）
    createdAt: string;
  };
}
```

**恢复流程**：
1. fileName 白名单校验（仅允许 `.backups/` 下时间戳格式——决策 28 兼容 `<YYYYMMDD-HHmmssSSS>.zip` 毫秒级 / `<YYYYMMDD-HHmmssSSS>-<名称>.zip` 带自定义名称 / 旧秒级 `<YYYYMMDD-HHmmss>.zip`；时间戳部分 ^$ 锚定纯数字 + 名称部分拒绝路径分隔符，防 `..` 穿越）
2. **覆盖前自动快照**：将当前三文件打包为快照存入 `.backups/`（复用备份管道）
3. 备份包校验（同 import 校验顺序 3-7：zip 解析/白名单/三文件齐全/顶层契约/data.db user_version 三态分流——E4/E5 语义，绝不静默重建）
4. **原子替换**：临时目录解压校验通过后，三文件覆盖写入项目目录（原子写）；**project.json 内 `name` 归一为当前目录名**（与 import 覆盖一致，维持「目录名 = 书名」不变式；`id` 保留当前项目 id）
5. **data.db 会话归属迁移（B2.2 审核 P1-1）**：备份包内 `project_id` ≠ 当前项目 id 时（跨项目恢复），替换后执行 `UPDATE chat_messages SET project_id = ? WHERE project_id = ?`（旧 id → 当前 id）——「保留 id 保会话」的理由在跨项目场景同样成立，聊天历史不静默消失
6. 服务端当前项目引用不变（id 保留，决策 27）；前端刷新 config/outline/会话数据

**错误码**：400 `VALIDATION_ERROR`（坏包/文件名非法）、404（备份不存在）、409 `SCHEMA_VERSION_MISMATCH`（同上）。

### POST /api/v1/project/rename

重命名当前书籍（决策 27：同名并存场景的区分配套）。

```typescript
// Req
{
  name: string;  // 新书名（校验同创建规则：禁路径分隔符/纯点/控制字符）
}

// Res: 200
{
  renamed: true;
  path: string;  // 新书目录绝对路径（创作根/books/<新名>/）
  name: string;  // 新书名
}
```

**语义**：
- 校验新名 → 目标目录 `books/<新名>/` 已存在（且不是当前书自身目录）→ 409 `PROJECT_ALREADY_EXISTS`；
- **仅支持重命名书架 `books/` 下的书**：创作根自身是项目（旧单项目部署兼容语义）时 → 400 `VALIDATION_ERROR`（移动创作根会破坏书架结构）；
- **原子移动**：`books/<旧名>/` → `books/<新名>/` + 更新 project.json 内 name（任一失败回滚，不留下半成品）；`.backups/` 随目录移动自然携带；
- 当前打开的书改名：服务端**同步更新内部项目路径引用**（会话/历史按 id 不受影响）；前端刷新书架与 config（`GET /project/config` 的 name 变化）。
- 未打开项目时 → 409 `NO_PROJECT_OPEN`。

---

## 实体 CRUD

> **软删过滤（决策 12 修订）**：常规查询端点（GET 列表/详情、关系查询、Delta 查询等）**默认过滤软删对象**；回收站 API（`/api/v1/trash/*`）是访问软删对象的唯一入口。

> **实体类型（决策 26 + G2 修订，2026-08）**：`type` 现支持 **6 种**——`character` / `setting` / `location` / `hook` / **`event`（事件，时间轴）** / **`timepoint`（时间标签点，时间轴）**。两者完全复用本章节泛型端点（列表/详情/创建/更新/软删），id 前缀 `ev-` / `tp-`；软删/回收站走 `/api/v1/trash/entity/:type/:id/*` 泛型路径（无需独立端点）。

**event 的 data 字段（决策 26 + G2 修订；shared `eventDataSchema`）**：

| 字段 | 是否必选 | 数据类型 | 取值范围 | 备注 |
| :--- | :------- | :------- | :------- | :--- |
| `description` | 否 | string | — | 事件描述文本 |
| `tags` | 否 | string[] | — | 标签数组，分类筛选用 |

**G2 修订（2026-08）**：`time_label` 字段**已移除**——时间标签实体化为 `timepoint`（name = 时间标签文本），事件经 `occurs_at` 关系挂载到时间点（1:n，见关系节）。旧数据经迁移 `003_timepoint.ts` 自动转换。

**timepoint 实体（G2）**：`data` 空（`{}`），`name` = 时间标签文本（可重命名）。

- **排序（双独立线性序，G2）**：`GET /api/v1/entity/event` 按 `sort_order` 升序（事件全局线性序，拖拽为权威，组内排序键）；`GET /api/v1/entity/timepoint` 按 `sort_order` 升序（时间点全局线性序，拖拽为权威，组间顺序）。`sort_order` 持久化于 data.db `entities.sort_order` 列（各类型内线性，见 `doc/database/schema.md`），其余实体类型无该语义。

### GET /api/v1/entity/:type

列出指定类型的所有实体。

```typescript
// Path
type: "character" | "setting" | "location" | "hook" | "event" | "timepoint";

// Query
{
  q?: string;           // 搜索关键词（模糊匹配 name）
  offset?: number;      // 分页偏移，默认 0
  limit?: number;       // 每页条数，默认 50，最大 200
  sort?: "name" | "created_at" | "updated_at";
  order?: "asc" | "desc";
}

// Res: 200
{
  items: EntitySummary[];
  total: number;
  offset: number;
  limit: number;
}

// EntitySummary（列表用摘要，不含完整 data）
{
  id: string;
  type: "character" | "setting" | "location" | "hook" | "event" | "timepoint";
  name: string;
  // 各类型的关键摘要字段：
  //   character → role, status
  //   setting   → category
  //   location  → type
  //   hook      → status, payoff_timing (从 data JSON 提取)
  //   event     → description, tags (从 data JSON 提取)
  //   timepoint → （无专属摘要字段，G2：时间标签文本 = name）
  summary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// 注意：type="event" 时列表恒按 sort_order 升序返回（事件全局线性序，决策 26/G2），
// type="timepoint" 时列表恒按 sort_order 升序返回（时间点全局线性序，G2），
// sort/order 查询参数不参与两者排序
```

### GET /api/v1/entity/:type/:id

获取实体详情。

```typescript
// Path
type: "character" | "setting" | "location" | "hook" | "event" | "timepoint";
id: string;

// Res: 200
{
  id: string;
  type: string;
  name: string;
  data: Record<string, unknown>;  // 完整字段
  // 关联信息（紧邻 1 跳）
  relations: RelationSummary[];
  deltaCount: number;
  createdAt: string;
  updatedAt: string;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND", message: "..." } }
```

### POST /api/v1/entity/:type

创建实体。

```typescript
// Path
type: "character" | "setting" | "location" | "hook" | "event" | "timepoint";

// Req
{
  name: string;              // 必填，1-100 字符
  data?: Record<string, unknown>;  // 根据 type 有不同的 schema
}

// 各 type 的 data 字段说明：
// character: { role?, gender?, age?, personality?: string[], motivation?, abilities?: string[], status?, custom_fields? }
// setting:   { category?, parent_id?, description?, rules?: string[], custom_fields? }
// location:  { type?, parent_id?, description?, custom_fields? }
// hook:      { status?, category?, expected_payoff?, payoff_timing?, half_life?, is_core?, notes? }
//             (详见 database/hooks.md)
// event:     { description?, tags?: string[] }（决策 26 + G2 修订，精校验 + passthrough，详见本章节开头字段表）
// timepoint: {}（G2：时间标签文本 = name，data 无专属字段）

// Res: 201
{
  id: string;                // 自动生成，如 "char-9", "hook-3", "ev-1"（ev- 为事件形状示意）
  type: string;
  name: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// Res: 400（校验失败）
{ error: { code: "VALIDATION_ERROR", message: "name is required", fields?: string[] } }
```

### PUT /api/v1/entity/:type/:id

更新实体。使用 partial update（仅修改传入字段）。

**清空语义（2026-08 用户反馈 F1 修复）**：data 字段提交**空值即清除**——`""`（字符串字段）/ `[]`（数组字段）经浅合并覆盖原值；未传入的字段不受影响（partial）。event 字段（`description`/`tags`）支持此语义（`time_label` 已随 G2 移除）。

```typescript
// Path
type: string;
id: string;

// Req
{
  name?: string;
  data?: Partial<Record<string, unknown>>;  // 只合并传入的 data 字段，不覆盖全部
}

// Res: 200
{
  id: string;
  updated: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

### DELETE /api/v1/entity/:type/:id

软删实体（决策 12）：标记 `deleted_at`，**本体保留**可还原；级联移除其关联的关系与 Delta 记录。

```typescript
// Path
type: string;
id: string;

// Res: 200
{
  deleted: true;                // 软删：仅标记 deleted_at，实体本体仍保留（可还原）
  cascaded: {
    relations: number;    // 一并软删的关系数
    deltas: number;       // 一并软删的 Delta 数
  };
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

### PUT /api/v1/entity/event/:id/move

调整事件在时间轴上的位置（拖拽重排，决策 26）。**仅 `event` 类型支持**——时间轴事件顺序是全局事件线性序，持久化到 data.db `entities.sort_order` 列（组内排序键，G2）。

```typescript
// Path
type: "event";                // 仅事件可排序（其余实体类型无 sort_order 语义）
id: string;

// Req（shared: entityMoveReqSchema，命名风格同 outlineMoveReqSchema）
{
  order: number;             // 目标位置（0-based 全局事件线性序，范围 [0, 事件总数]）
}

// Res: 200（shared: entityMoveResSchema）
{
  moved: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

**语义**（与 `PUT /outline/:nodeId/move` 口径一致，决策 26）：
- `order` 超过当前事件总数 → clamp 到末尾（不返回 4xx）；**负数在 HTTP 层被 schema 拒绝（400 VALIDATION_ERROR，`z.number().int().min(0)`）**——db 层 moveEvent 对负数 clamp 至 0 仅为内部防御语义（HTTP 路径不可达）。
- 排序为拖拽权威：移动后事件列表（`GET /api/v1/entity/event`）按新 `sort_order` 升序返回。
- **G2 跨组拖拽**：事件拖到另一时间点区块 = 改挂载（`occurs_at` 关系移除 + 新建）+ 本 move 端点重排——由前端按序调用（先关系后 move，或一次复合请求，以服务端实现为准），事务内完成。

### PUT /api/v1/entity/timepoint/:id/move

调整时间点在时间轴上的位置（拖拽重排，G2 决策 26 修订）。**仅 `timepoint` 类型支持**——时间点顺序是全局时间点线性序（组间顺序），持久化到 data.db `entities.sort_order` 列。

```typescript
// Path
type: "timepoint";            // 仅时间点可排序
id: string;

// Req（shared: entityMoveReqSchema 同款）
{
  order: number;             // 目标位置（0-based 全局时间点线性序，范围 [0, 时间点总数]）
}

// Res: 200（shared: entityMoveResSchema 同款）
{
  moved: true;
}

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

**语义**：同 event move（clamp 到末尾、负数 400）。**拖拽时间点不修改其下事件序**——仅重排时间点 sort_order（整组移动不动内部，G2 双独立线性序）。

---

## 关系管理

> **端点类型（决策 26 + G2 扩展）**：关系端点 source_type / target_type 支持全部实体类型（含 **`event`**、**`timepoint`**）与 `outline_node`；预定义关系类型新增 **`occurs_in`**（event→outline_node，事件锚定大纲节点，多对多，决策 26）与 **`occurs_at`**（timepoint→event，**1:n，G2**）——**锚定/挂载 = 关系本身，无独立字段**；occurs_at 语义：一个事件至多挂一个时间点（服务端建关系校验，重复挂载 409 或先移除旧关系，以实现为准）；事件无挂载 = 未挂载（归入时间轴「未挂载」兜底区）。

### GET /api/v1/relation

查询关系。支持从任意实体出发的 k 跳遍历。

```typescript
// Query
{
  source_type?: string;   // 起点类型，不传则查询所有类型
  source_id?: string;     // 起点 ID，不传则按 type 过滤
  target_type?: string;   // 终点类型过滤
  target_id?: string;     // 终点 ID 过滤
  relation_type?: string; // 关系类型过滤
  depth: 1 | 2 | 3;      // 1=紧邻, 2=k跳, 3=3 层上限（有向 BFS + 路径级防环；2026-08 修订：文档「全量遍历」对齐实现语义，避免图爆炸）
}

// Res: 200
{
  // depth=1: 直接关系
  relations: {
    id: string;
    sourceType: string;
    sourceId: string;
    sourceName?: string;     // 联表查询填充
    targetType: string;
    targetId: string;
    targetName?: string;
    relationType: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }[];

  // depth>=2: 追加路径信息
  paths?: {
    nodes: { type: string; id: string; name: string }[];
    edges: { from: string; to: string; relationType: string }[];
  }[];
}
```

### POST /api/v1/relation

建立关系。

```typescript
// Req
{
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relation_type: string;     // 参见 database/schema.md 预定义关系类型（含 occurs_in 事件锚定，决策 26）
  metadata?: Record<string, unknown>;
}

// Res: 201
{
  id: string;
  relation: {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    relationType: string;
  };
}

// Res: 409（关系已存在）
{ error: { code: "RELATION_EXISTS" } }
```

### PUT /api/v1/relation/:id

更新关系元数据（2026-08 交互优化 I1：画布连线标签线上编辑）。**仅支持 `metadata` 字段 patch**（当前唯一用途 = `plot_edge` 连线标签）；关系三元组（source/target/relation_type）不可变——要改连接请删后重建。

```typescript
// Path
id: string;

// Req（shared: relationUpdateMetaReqSchema）
{
  metadata: Record<string, unknown>;   // 整体替换 metadata（含清空：传 {} 或 null）
}

// Res: 200
{
  updated: true;
}

// Res: 404
{ error: { code: "RELATION_NOT_FOUND" } }   // 不存在（含已软删——软删关系不可编辑，决策 12）
```

**语义**：metadata 整体替换（非浅合并）——画布连线标签编辑时传 `{ label: "新标签" }`，清空标签传 `{}`；与 POST 创建侧的 trim 对称，服务端对 label 做首尾空格去除。

### DELETE /api/v1/relation/:id

删除关系。**物理删除，不进入回收站**（决策 12 修订：关系是轻量可重建对象；`deleted_at` 软删仅服务于实体/节点级联删除场景）。

```typescript
// Path
id: string;

// Res: 200
{
  deleted: true;
}

// Res: 404
{ error: { code: "RELATION_NOT_FOUND" } }
```

---

## Delta 变更追踪

### POST /api/v1/delta

追加属性变更记录。

```typescript
// Req
{
  node_id: string;                // 触发变更的大纲节点 ID
  target_type: string;            // 变更目标类型——**仅实体类型**（白名单由 ENTITY_TYPES 派生：
                                  //   character/setting/location/hook/event，event 随决策 26 自动扩入）
                                  //   （2026-08 收紧：大纲节点不可作为变更目标——节点代表的故事导致实体
                                  //   发生变更，节点结构化信息不出现在变更记录中；历史 outline_node 目标
                                  //   数据保留展示，仅创建路径拒绝；校验在路由层，shared schema 不动）
  target_id: string;              // 变更目标 ID
  changes: {
    field: string;                // 字段名
    op: "set" | "update" | "add" | "remove";
    from?: string | number | null;  // 旧值（op=update 时必填）
    to?: string | number | null;    // 新值（op=set/update 时必填；add/remove 用 value）
    value?: string | number;         // 值（op=add/remove 时使用）
  }[];
  description: string;            // 人类可读描述
  // 注意：无 order 入参——order 由服务端生成，全局单调递增（与 schema.md 一致）
  // op 语义（2026-08 修订）：set=直接替换；update=旧值→新值（写入端不校验 from，
  //   冲突在 computeState 时以跳过+conflicts 呈现，决策 9 修订）；add=按 value 向数组追加；
  //   remove=按值匹配从数组移除（不存在的值静默忽略）
}

// Res: 201
{
  id: string;
  applied: DeltaRecord;           // 完整的 Delta 记录
}

// Res: 400
// { error: { code: "VALIDATION_ERROR" } }
// 触发条件：schema 校验失败（含 fields）；per-op 必填缺失（set→to、update→from+to、add/remove→value）；
//   target_type 非实体类型（2026-08 收紧：仅实体类型，白名单由 ENTITY_TYPES 派生——含 event，决策 26；路由层白名单校验）

// 示例
// Req: { node_id: "sc-37", target_type: "character", target_id: "char-3",
//        changes: [{ field: "combat_power", op: "update", from: "100", to: "150" }],
//        description: "张三获得断剑认可" }
```

### GET /api/v1/delta/node/:nodeId

获取指定大纲节点触发的所有 Delta。

```typescript
// Path
nodeId: string;

// Res: 200
{
  nodeId: string;
  deltas: DeltaRecord[];
}

// DeltaRecord
{
  id: string;
  nodeId: string;
  targetType: string;
  targetId: string;
  targetName?: string;        // 联表填充
  changes: { field: string; op: string; from?: unknown; to?: unknown }[];
  description: string;
  order: number;
  createdAt: string;
}
```

### POST /api/v1/delta/compute

计算实体到达指定大纲节点时的累积状态。

```typescript
// Req
{
  target_type: string;          // 目标实体类型
  target_id: string;            // 目标实体 ID
  at_node_id: string;           // 到达的大纲节点 ID（服务端自动计算根 → at_node 的树路径，决策 9/19）
}

// Res: 200
{
  targetType: string;
  targetId: string;
  atNodeId: string;
  state: Record<string, unknown>;   // 初始 data + 路径上所有 Delta 累积后的结果
  appliedDeltas: {                   // 参与计算的 Delta 列表
    nodeId: string;
    description: string;
    changes: unknown[];
    skipped?: { index: number; field: string; expected: unknown; actual: unknown }[];
    // skipped：该 delta 中被跳过的 change（决策 9 修订：op=update 且当前值 ≠ from）
  }[];
  conflicts: {                       // 汇总的冲突字段（2026-08 修订，替代原 409 DELTA_CONFLICT）
    deltaId: string;
    field: string;
    expected: unknown;               // delta 中 from
    actual: unknown;                 // 应用时实际值
  }[];
}

// Res: 404
{ error: { code: "OUTLINE_NODE_NOT_FOUND" } }  // at_node_id 不存在（已 purge）

// Delta 累积规则（决策 9 修订）：
//   到达目标节点的状态 = 实体初始 data + 树路径上所有 Delta 累积
//   双层排序：节点间按树路径顺序（根 → at_node）；同一节点内按 order 递增
//   set:     直接替换值
//   update:  旧值→新值（校验当前值等于 from；不匹配**跳过该 change 并继续累积**，
//            在 skipped / conflicts 中标注——手动编辑 data 不产生 Delta 属正常用户
//            行为，不再返回 409，2026-08 修订）
//   add:     向数组追加
//   remove:  按值匹配从数组移除
//   Delta 可见性：触发节点或目标实体任一软删即不参与计算（决策 12 修订）
```

---

## 大纲操作

### GET /api/v1/outline

获取完整大纲树（严格三层，无游离节点，决策 19）。

```typescript
// Query
{
  with_metadata?: boolean;   // 为 true 时计算节点 metadata 统计（跨 outline.json × data.db 联查，默认 false）
}

// Res: 200
{
  id: "root";
  type: "root";
  schemaVersion: number;     // outline.json 顶层 schema_version（决策 13）
  children: OutlineNode[];
}

// OutlineNode
{
  id: string;                    // 如 "vol-1", "ch-3", "sc-15"
  type: "volume" | "chapter" | "scene";
  title: string;
  summary?: string;              // 可选描述
  data?: Record<string, unknown>; // 节点结构化信息（决策 23，麦基字段集；无 data 时省略）
  children?: OutlineNode[];      // 卷下有章，章下有场景
  updatedAt: string;             // 节点版本戳（决策 19，提案快照比对）
  metadata?: {                   // 仅 with_metadata=true 时返回
    hookCount?: number;          // 关联的伏笔数
    charCount?: number;          // 关联角色数
    deltaCount?: number;         // 此节点触发的 Delta 数
  };
}
```

> **节点 `data`（决策 23，2026-08 新增）**：按层级 schema（`OUTLINE_NODE_DATA_SCHEMAS`，shared 单一来源）校验——scene：`goal`/`conflict_levels`/`value_from`/`value_to`；chapter：`reversal`/`climax_scene`；volume：`climax_scene`/`inciting_scene`。引用字段（`climax_scene`/`inciting_scene`）宽松校验（任意场景节点 id），MVP 不校验引用范围。编辑 data 不自动生成 Delta（决策 9 修订语义）。

### POST /api/v1/outline

创建新大纲节点。**严格三层，parent_id 必填**（决策 19，无游离节点）。

```typescript
// Req
{
  type: "volume" | "chapter" | "scene";
  title: string;                 // 1-200 字符
  parent_id: string;             // 必填，无默认值
                                 // volume → 挂 root
                                 // chapter → 挂 volume 或 root
                                 // scene → 必须挂 chapter
  summary?: string;
  data?: Record<string, unknown>; // 可选，节点结构化信息（决策 23，按层级 schema 校验）
}

// Res: 201
{
  id: string;                    // "vol-2", "ch-8" 等（前缀 + nanoid）
  type: string;
  title: string;
  parentId: string | null;
  updatedAt: string;             // 创建时间戳（节点版本戳，决策 19）
}

// Res: 400
{ error: { code: "VALIDATION_ERROR", message: "parent_id is required" } }
```

### PUT /api/v1/outline/:nodeId

更新大纲节点信息。

```typescript
// Path
nodeId: string;

// Req
{
  title?: string;
  summary?: string;
  data?: Record<string, unknown>; // 部分合并（决策 23；按层级 schema 校验，失败 400 VALIDATION_ERROR）
}

// Res: 200
{
  updated: true;
}
```

### PUT /api/v1/outline/:nodeId/move

移动大纲节点（拖拽重排）。

```typescript
// Path
nodeId: string;

// Req
{
  parent_id: string;             // 新的父节点 ID（严格三层约束同 POST /outline，决策 19）
  order: number;                 // 在兄弟节点中的位置（0-based）
}

// Res: 200
{
  moved: true;
  previousParentId: string;
  newParentId: string;
}

// 画布视图中的投影自动更新（决策 1）
```

### DELETE /api/v1/outline/:nodeId

软删大纲节点（决策 12）：标记 `deleted`，**本体保留**可还原；级联移除子节点、关联的 Delta 和关系（仅移除关联数据，被删对象本体保留）。

```typescript
// Path
nodeId: string;

// Res: 200
{
  deleted: true;                // 软删：仅标记 deleted + deleted_at，节点本体保留（可还原）
  cascaded: {
    children: number;       // 递归软删的子节点数
    relations: number;      // 一并软删的关联关系数
    deltas: number;         // 一并软删的 Delta 数
  };
}
```

### GET /api/v1/outline/:nodeId/path

获取从根到指定节点的路径 ID 列表。

```typescript
// Path
nodeId: string;

// Res: 200
{
  nodeId: string;
  path: string[];               // 从根到目标节点的 ID 数组
                                 // 如 ["root", "vol-1", "ch-3", "sc-15"]
}
```

---

## 回收站

软删（决策 12）的实体与大纲节点进入回收站，本体保留可还原；回收站定期清理（实现期定义保留时长）。

### GET /api/v1/trash

列出回收站中的软删对象。

```typescript
// Res: 200
{
  entities: { id: string; type: string; name: string; deletedAt: string }[];
  nodes:    { id: string; type: string; title: string; deletedAt: string }[];
}
```

### POST /api/v1/trash/entity/:type/:id/restore

还原软删实体（恢复 `deleted_at` 为 NULL），并**级联还原**其关联的关系与 Delta（决策 12 修订）。

```typescript
// Path
type: string;
id: string;

// Res: 200
{ restored: true; restoredRelations: number; restoredDeltas: number }

// Res: 404
{ error: { code: "ENTITY_NOT_FOUND" } }
```

> **可见性（决策 12 修订）**：级联还原全部关系（不因另一端仍软删而跳过）；还原后若某关系的端点仍软删，该关系暂不可见，端点还原后自动可见。

### POST /api/v1/trash/outline/:nodeId/restore

还原软删大纲节点（恢复 `deleted`/`deleted_at` 标记），并**级联还原**其关联的关系与 Delta；子节点若仍在回收站则一并还原（决策 12 修订）。可见性规则同实体 restore（端点仍软删的关系暂不可见）。

```typescript
// Path
nodeId: string;

// Res: 200
{ restored: true; restoredChildren: number; restoredRelations: number; restoredDeltas: number }

// Res: 404
{ error: { code: "OUTLINE_NODE_NOT_FOUND" } }

// Res: 409
{ error: { code: "OUTLINE_ANCESTOR_DELETED", message: "..." } }
// 存在软删祖先：需先还原祖先（决策 12 修订），杜绝「可见节点挂在不可见父」的畸形树
```

### DELETE /api/v1/trash/entity/:type/:id

彻底删除（purge，物理清除且不可恢复）：清除实体本体及其关联的关系与 Delta。仅用于回收站清理。

```typescript
// Path
type: string;
id: string;

// Res: 200
{ purged: true }
```

### DELETE /api/v1/trash/outline/:nodeId

彻底删除大纲节点（purge，物理清除且不可恢复）：**递归物理删除整棵子树**（子节点一并清除），并清除其关联的关系与 Delta。仅用于回收站清理。

```typescript
// Path
nodeId: string;

// Res: 200
{ purged: true }
```

---

## AI 对话

### POST /api/v1/chat

发送消息给 AI，通过 SSE 流式返回。

```typescript
// Req
{
  message: string;              // 用户消息
  session_id?: string;          // 会话 ID，不传则创建新会话
  context?: {
    focus_entity_type?: string;  // 当前聚焦的实体类型（用于上下文组装）
    focus_entity_id?: string;    // 当前聚焦的实体 ID
    focus_node_id?: string;      // 当前聚焦的大纲节点 ID
  };
}

// 对话历史持久化（决策 18）：本会话的消息写入 data.db 的 chat_messages 表；
// 服务重启后携带同一 session_id 即可继续上次对话。

// Res: SSE stream
// 消息格式（SSE event stream, text/event-stream）:
//
// event: ping             // 心跳（每 15-30s，决策 20）：探活 + 断开检测
// data: {}
//
// event: tool_call         // AI 调用了工具
// data: { "tool": "get_entity", "args": {...}, "id": "call_xxx" }
//
// event: tool_result       // 工具执行结果
// data: { "tool": "get_entity", "result": {...}, "id": "call_xxx" }
//
// event: text              // AI 文本回复片段
// data: { "delta": "张三这个角色..." }
//
// event: proposal          // AI 发出提案
// data: { "proposal_id": "prop_xxx", "type": "propose_create_entity", "preview": {...} }
//
// event: done              // 对话轮次结束
// data: { "session_id": "sess_xxx" }
//
// event: error
// data: { "code": "...", "message": "..." }
//
// 顺序与生命周期约定（2026-08 修订）：
//   - proposal 事件在对应 tool_result 之后、循环继续之前发送；前端以 proposal 事件渲染提案卡片
//   - error 事件后流立即关闭（客户端收到 error 即终止解析）
//   - 确认/拒绝提案的 HTTP 请求与 SSE 流生命周期解耦：流关闭后确认仍有效（TTL 内）
```

**客户端解析约束（决策 20）**：本端点返回 POST + SSE，浏览器原生 `EventSource` 只支持 GET，客户端必须用 `fetch` + `ReadableStream` 自写 SSE 解析（`client/src/hooks/use-sse.ts`），并处理：跨 chunk 的 `data:` 行拼接、注释行（`:` 开头）跳过、`[DONE]` 哨兵；**心跳期间若有写操作失败即视为连接断开**，触发全链路取消提示。

**取消语义（决策 16）**：SSE 断开（浏览器刷新/断网）即触发全链路取消——服务端通过 AbortController 终止 agent 循环、中止 DeepSeek fetch；未确认提案按会话作废；正在执行的写操作完成当前一步后停止，操作顺序固定「先 DB 后 JSON」，两存储间不一致由**启动一致性校验**兜底补标（以大纲节点软删为准补标关联记录，决策 16 修订）。断开检测三路并用（决策 20）：`stream.onAbort` + `c.req.raw` 的 close/error 监听 + 心跳写失败。客户端重连后提示「上次会话已取消」。

### GET /api/v1/chat/sessions

获取会话列表（决策 18：「继续上次对话」入口）。

```typescript
// Res: 200
{
  sessions: {
    id: string;              // session_id
    lastMessage: string;     // 最后一条消息摘要（截断）
    messageCount: number;
    createdAt: string;
    updatedAt: string;       // 最后活动时间
  }[];
}
// 按最后活动时间倒序；仅返回当前项目的会话（按 project_id 隔离，决策 18）
```

### GET /api/v1/chat/sessions/:id/messages

获取指定会话的消息历史（供 UI 恢复聊天记录）。

```typescript
// Path
id: string;                  // session_id

// Res: 200
{
  sessionId: string;
  messages: {
    id: string;
    role: "user" | "assistant" | "tool";
    content?: string | null;
    toolCalls?: unknown[];    // assistant 消息的工具调用数组
    toolCallId?: string | null;  // tool 消息关联的调用 id
    createdAt: string;
  }[];
}
// 按 created_at 升序；仅返回当前项目的会话
```

---

## 提案确认

### POST /api/v1/proposal/:proposalId/confirm

用户确认提案。

```typescript
// Path
proposalId: string;

// Res: 200
{
  confirmed: true;
  result: unknown;              // 执行结果（如新创建的 entity id）
}

// Res: 409 — 提案过期（决策 14）
// 确认时服务端重新校验提案引用的实体/大纲节点仍存在且快照一致；
// 校验失败返回 { code: "PROPOSAL_STALE" }，前端提示重新生成提案。

// Res: 404
{ error: { code: "PROPOSAL_NOT_FOUND" } }  // proposal_id 不存在（已过期清除/SSE 断开作废）

// Res: 409
{ error: { code: "PROPOSAL_PROJECT_MISMATCH" } }
// 提案所属项目 ≠ 当前项目（决策 14 修订；切换项目时提案已清空，此为防御性校验）
```

### POST /api/v1/proposal/:proposalId/reject

用户拒绝提案。

```typescript
// Path
proposalId: string;

// Res: 200
{
  rejected: true;
}
```

---

## 系统设置

### GET /api/v1/settings/llm

读取 LLM 配置（决策 17：设置页可配置 DeepSeek key）。

```typescript
// Res: 200
{
  model: string;            // 当前模型名（默认 "deepseek-v4-flash"）
  apiKeySet: boolean;       // 是否已配置 key（不回传明文）
  apiKeyMasked?: string;    // 掩码展示，如 "sk-****1234"
}
// 来源优先级：环境变量 DEEPSEEK_API_KEY > ~/.ai-editor/config.json
```

### PUT /api/v1/settings/llm

更新 LLM 配置（写入用户级配置文件 `~/.ai-editor/config.json`，**绝不写入项目文件**，决策 17）。

```typescript
// Req
{
  model?: string;           // 模型名（默认 "deepseek-v4-flash"）
  api_key?: string;         // 新 key；空字符串 = 清除已保存 key
}

// Res: 200
{
  saved: true;
}
// 配置变更仅影响新请求；运行中的 agent 循环不受扰动
```
