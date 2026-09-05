# 备份管理

> 自动/手动备份、重命名、恢复、书名重命名。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

> 自动备份由服务端定时器驱动（服务运行期间生效，频率 = project.json `backup_frequency_minutes`，缺省 10 分钟）。备份文件存项目目录内 `.backups/`，时间戳命名（毫秒精度 + **类型标记段**：`<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`——kind 为 `m`（手动）/ `a`（自动带名称），自动备份/快照为纯时间戳；手动备份无名称也带 `-m` 段，与自动备份可靠区分；**旧格式兼容解析不迁移**：旧秒级 `<YYYYMMDD-HHmmss>.zip` → auto、旧带名称无 kind 段 `<YYYYMMDD-HHmmssSSS>-<名称>.zip` → manual、纯时间戳 → auto——历史备份仍可列出/恢复/参与保留策略），格式与导出 zip 完全一致（三文件 + wal_checkpoint；含 `references/**` 目录条目），**每项目保留最近 20 份**（超出删除最旧，含覆盖前自动快照）。全部端点要求当前项目已打开（无项目 → 409 `NO_PROJECT_OPEN`，与 `/config` 一致）。

> **变更检测**：自动备份「有变更才备份」判定在三文件 mtime 基础上增加 **references/ 目录内全部文件（含 .trash/）最大 mtime**——本地新增/外部编辑 md 文档同样触发自动备份。

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
    kind: "auto" | "manual";  // 备份类型标签（必填；由文件名解析——
                              //   -m/-a 标记段、旧带名称（无标记）→ manual、纯时间戳/旧秒级 → auto）
    name?: string;      // 自定义名称（由文件名解析——自动备份/快照/旧备份无此字段；
                        //   自动备份重命名后带 -a 段 + 名称，kind 仍为 auto）
  }>;
}
```

**语义**：按时间倒序（最新在前）；`.backups/` 不存在返回空数组（不报错）。

### POST /api/v1/project/backup

立即备份当前项目（手动触发；设置页「立即备份」按钮）。**kind 恒为 manual**（文件名落 `-m` 段）。

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
    fileName: string;   // <YYYYMMDD-HHmmssSSS>-m.zip（无名称）或 <YYYYMMDD-HHmmssSSS>-m-<名称>.zip
    size: number;
    createdAt: string;
    kind: "manual";     // 备份类型标签
    name?: string;      // 带名称时返回规范化后的名称
  };
}
```

**语义**：与自动备份同款管道（三文件 + wal_checkpoint → `.backups/<时间戳>-m...>.zip` → 触发保留策略清理）。文件写入失败 → 500 `INTERNAL_ERROR`。

### POST /api/v1/project/backup/rename

重命名备份（设置页备份列表行内编辑）。**只改名称段，时间戳与 kind 保持**——重命名不改变备份来源标签。

```typescript
// Req
{
  fileName: string;  // 备份文件名（须匹配 .backups/ 内时间戳格式，防路径穿越；不存在 → 404 VALIDATION_ERROR「备份不存在」）
  name?: string;     // 新名称（规则同手动备份名称：trim 后 1-30 字符/禁路径分隔符与保留字符/禁纯点/自动剥 .zip；
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

**语义**：同目录 renameSync 原子改名；新名称与原名称相同（幂等）→ 直接返回当前条目不报错；**改名前检查目标文件名是否已存在**——已存在 → 409 `BACKUP_TARGET_EXISTS`（防 rename 静默覆盖丢失备份）；改名不触碰 zip 内容（名称只进文件名）。

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
1. fileName 白名单校验（仅允许 `.backups/` 下时间戳格式——兼容 `<YYYYMMDD-HHmmssSSS>.zip` 毫秒级 / `<YYYYMMDD-HHmmssSSS>-<名称>.zip` 带自定义名称 / 旧秒级 `<YYYYMMDD-HHmmss>.zip`；时间戳部分 ^$ 锚定纯数字 + 名称部分拒绝路径分隔符，防 `..` 穿越）
2. **覆盖前自动快照**：将当前三文件打包为快照存入 `.backups/`（复用备份管道）
3. 备份包校验（同 import 校验顺序 3-7：zip 解析/白名单/三文件齐全/顶层契约/data.db user_version 三态分流——绝不静默重建）
4. **原子替换**：临时目录解压校验通过后，三文件覆盖写入项目目录（原子写）；**project.json 内 `name` 归一为当前目录名**（与 import 覆盖一致，维持「目录名 = 书名」不变式；`id` 保留当前项目 id）
5. **data.db 会话归属迁移（B2.2 审核 P1-1）**：备份包内 `project_id` ≠ 当前项目 id 时（跨项目恢复），替换后执行 `UPDATE chat_messages SET project_id = ? WHERE project_id = ?`（旧 id → 当前 id）——「保留 id 保会话」的理由在跨项目场景同样成立，聊天历史不静默消失
6. 服务端当前项目引用不变（id 保留）；前端刷新 config/outline/会话数据

**错误码**：400 `VALIDATION_ERROR`（坏包/文件名非法）、404（备份不存在）、409 `SCHEMA_VERSION_MISMATCH`（同上）。

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
- 当前打开的书改名：服务端**同步更新内部项目路径引用**（会话/历史按 id 不受影响）；前端刷新书架与 config（`GET /project/config` 的 name 变化）。
- 未打开项目时 → 409 `NO_PROJECT_OPEN`。

---
