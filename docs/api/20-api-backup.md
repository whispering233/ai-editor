# 备份管理

> 自动/手动备份、重命名、恢复、书名重命名。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

> 自动备份由服务端定时器驱动（服务运行期间生效，频率 = project.json `backup_frequency_minutes`，缺省 10 分钟）。备份文件存项目目录内 `.backups/`，命名格式：
>
> ```
> <YYYYMMDD-HHmmssSSS>-<自动|手动>-<设备>[-<标签>]-人物N-设定N-章N.zip
> 20260813-101530123-自动-苹果本-人物32-设定58-章120.zip
> 20260813-181200400-手动-苹果本-定稿-人物32-设定58-章120.zip
> ```
>
> 毫秒时间戳（本地时区；字典序 = 时间序）＋ **类型段**（`自动` = 定时器 / 覆盖前快照，`手动` = 立即备份）＋ **设备段**（必填：来源机器，缺省 = 简化 hostname，设置页可改名；禁 `-`）＋可选**用户标签**（1-30 字符）＋ **尾部固定三段统计**（固定尾部使解析可从尾部倒切，标签里出现类似字样也不歧义，见下「设备与统计」）。**旧格式兼容解析不迁移**：旧秒级 `<YYYYMMDD-HHmmss>.zip` → auto、旧带名称无类型段 `<YYYYMMDD-HHmmssSSS>-<名称>.zip` → manual、旧单字母 `-m`/`-a` 段 → 对应类型；旧文件名无设备/统计字段，读侧缺省——历史备份仍可列出/恢复/参与保留策略。格式与导出 zip 完全一致（三文件 + wal_checkpoint；含 `references/**` 与 `sessions/**` 目录条目），**每项目保留最近 20 份**（超出删除最旧，含覆盖前自动快照）。全部端点要求当前项目已打开（无项目 → 409 `NO_PROJECT_OPEN`，与 `/config` 一致）。
>
> **设备与统计**：设备名规则 = trim 后 1-16 字符，**禁 `-`**（文件名段分隔符）与路径分隔符/保留字符（`\ / : * ? " < > |`）/控制字符/纯点，非法 → 400 `VALIDATION_ERROR`；未配置时用简化 hostname（去 `.local`、滤非法字符、截 16 字符）。统计三项 = 备份时点该项目的**未软删**存量（人物数 / 设定数 / `outline.json` 中未软删 `chapter` 数，**不含回收站**），由服务端在生成 zip 时顺便统计并写进文件名；**UI 不自行解析文件名**（格式知识只活在 shared 纯函数里）。
>
> **与云端存档的关系**：云端存档推送的就是这里的一份备份文件（**逐字节拷贝、文件名原样**）；删除要传播到另一台机器需**推送一次**（见 [100-api-cloud.md](./100-api-cloud.md)）。
>
> **变更检测**：自动备份「有变更才备份」判定在三文件 mtime 基础上增加：① **`references/`（含 .trash/）与 `sessions/` 目录内全部文件的最大 mtime**（本地新增/外部编辑 md 文档、新的对话消息同样触发）；② **两个打包目录自身的 mtime**（删除文件不会刷新任何剩余文件的 mtime，只看文件会漏检删除）。

### GET /api/v1/project/backups

当前项目的自动备份列表。

```typescript
// Query: (none)

// Res: 200
{
  backups: Array<{
    fileName: string;   // 备份文件名（新格式含类型/设备/统计段；restore 用此引用）
    size: number;       // 字节数
    createdAt: string;  // 备份时间（ISO 8601，由文件名时间戳解析）
    kind: "auto" | "manual";  // 备份类型标签（必填；由文件名解析——
                              //   自动/手动 段；旧 -m/-a 段、旧带名称（无类型段）→ manual；旧秒级 → auto）
    name?: string;      // 用户标签（由文件名解析——自动备份/快照/旧备份无此字段）
    device?: string;    // 来源设备（新格式；旧格式文件名无此字段）
    stats?: {          // 尾部三段统计（新格式；旧格式文件名无此字段）
      characters: number;  // 人物数（未软删）
      settings: number;    // 设定数（未软删）
      chapters: number;    // 章数（outline.json 未软删 chapter）
    };
  }>;
}
```

**语义**：按时间倒序（最新在前）；`.backups/` 不存在返回空数组（不报错）。

### POST /api/v1/project/backup

立即备份当前项目（手动触发；设置页「立即备份」按钮与左栏底部「立即备份」入口）。**kind 恒为 manual**。

```typescript
// Req（请求体可选；缺省 = 纯时间戳文件名）
{
  name?: string;  // 手动备份自定义名称：trim 后 1-30 字符（MAX_BACKUP_NAME_LENGTH）；
                  // 禁路径分隔符/保留字符（: * ? " < > |）/控制字符/纯点（. ..）；
                  // 自动剥离尾部 .zip；非法 → 400 VALIDATION_ERROR
}

// Res: 200
{
  backup: {
    fileName: string;   // <时间戳>-手动-<设备>[-<标签>]-人物N-设定N-章N.zip
    size: number;
    createdAt: string;
    kind: "manual";     // 备份类型标签
    name?: string;      // 带标签时返回规范化后的标签
    device: string;     // 来源设备（必填：配置的设备名或缺省简化 hostname）
    stats: { characters: number; settings: number; chapters: number };  // 生成时点的未软删存量
  };
}
```

**语义**：与自动备份同款管道（三文件 + wal_checkpoint + `references/**` + `sessions/**` → `.backups/<时间戳>-手动…>.zip` → 触发保留策略清理）；统计三项在生成 zip 时顺便算出并写进文件名。文件写入失败 → 500 `INTERNAL_ERROR`。**启用云存档且开自动推送时**：手动备份成功后自动推送这一份（见 [100-api-cloud.md](./100-api-cloud.md)）。

### POST /api/v1/project/backup/rename

重命名备份（设置页备份列表行内编辑）。**只改名称段，时间戳与 kind 保持**——重命名不改变备份来源标签。

```typescript
// Req
{
  fileName: string;  // 备份文件名（须匹配 .backups/ 内命名格式，防路径穿越；不存在 → 404 VALIDATION_ERROR「备份不存在」）
  name?: string;     // 新标签（规则同手动备份：trim 后 1-30 字符/禁路径分隔符与保留字符/禁纯点/自动剥 .zip；
                     //   非法 → 400 VALIDATION_ERROR）。空串或缺省 = 清除标签段
}

// Res: 200
{
  backup: {
    fileName: string;   // 新文件名（时间戳/类型/设备/统计段不变，只动标签段）
    size: number;
    createdAt: string;
    kind: "auto" | "manual";
    name?: string;      // 新标签（清除后无此字段）
    device?: string;
    stats?: { characters: number; settings: number; chapters: number };
  };
}
```

**旧格式文件重命名保持旧形态**（仅秒级补毫秒 `000`）：不补设备/统计段——统计必须描述**该备份的内容**，用当前项目状态凑一份会谎报；旧文件不迁移（见上「命名」）。

**语义**：同目录 renameSync 原子改名；新标签与原有相同（幂等）→ 直接返回当前条目不报错；**改名前检查目标文件名是否已存在**——已存在 → 409 `BACKUP_TARGET_EXISTS`（防 rename 静默覆盖丢失备份）；改名不触碰 zip 内容（标签只进文件名）。**注意**：为**已推送到云端的同一份**改名不会自动重命名云端文件——下次推送把改好名的那一份推上去，云端旧那份由保留策略老化（带标签的份永不清理，包括已被改名的历史份）。

**错误码**：400 `VALIDATION_ERROR`（文件名格式非法/新名称非法）、404 `VALIDATION_ERROR`（备份不存在）、409 `BACKUP_TARGET_EXISTS`（目标文件名已存在）。

### POST /api/v1/project/backup/restore

从备份列表恢复当前项目（覆盖恢复）。

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
1. fileName 白名单校验（仅允许 `.backups/` 下的合法命名（新格式 / 毫秒纯时间戳 / 带标签 / 旧秒级）；时间戳部分 ^$ 锚定纯数字 + 名称部分拒绝路径分隔符，防 `..` 穿越）
2. **覆盖前自动快照**：将当前三文件打包为快照存入 `.backups/`（复用备份管道）
3. 备份包校验（同 import 校验顺序 3-7：zip 解析/白名单/三文件齐全/顶层契约/data.db user_version 三态分流——绝不静默重建）
4. **原子替换**：临时目录解压校验通过后，三文件覆盖写入项目目录（原子写）；**project.json 内 `name` 归一为当前目录名**（与 import 覆盖一致，维持「目录名 = 书名」不变式；`id` 保留当前项目 id）
5. **无会话归属迁移**（对话历史改造后删除此步）：会话已随项目目录内 `sessions/*.jsonl` 走，不再依赖 data.db 的 `project_id`；恢复时 `sessions/` 目录**整体覆盖**（与 `references/` 同语义：清空本地残留后写回备份条目）
6. 服务端当前项目引用不变（id 保留）；前端刷新 config/outline/会话数据

**错误码**：400 `VALIDATION_ERROR`（坏包/文件名非法）、404（备份不存在）、409 `SCHEMA_VERSION_MISMATCH`（同上）。

**与云端拉取的区别（不可混用语义）**：本端点是「回到那个时间点」= **整体覆盖**（三文件 + `references/` 与 `sessions/` 目录均以备份内容为准，本地残留不混入）；云端 `POST /cloud/pull` 是「把另一台机器的东西拿过来」= 三文件覆盖 + 两个目录**并集**（见 [100-api-cloud.md](./100-api-cloud.md)）。

### POST /api/v1/project/rename

重命名当前书籍（同名并存场景的区分配套）。

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
- 当前打开的书改名：服务端**同步更新内部项目路径引用**（会话/历史按 id 不受影响）；前端刷新书架与 config（`GET /project/config` 的 name 变化）。**启用云存档时额外 `MOVE` 云端书目录**（`<旧名>-<projectId>` → `<新名>-<projectId>`，WebDAV `MOVE` 原子改名、目录内备份随之）；`MOVE` 失败不阻塞本地改名（下一轮同步按 id 回退扫描自动修正缓存）。
- 未打开项目时 → 409 `NO_PROJECT_OPEN`。

---
