# 云端存档（Cloud Sync）

> 通过 WebDAV 把备份 zip 推送到用户的云盘、并从云端拉取——**可选的异地副本与多设备续写通道，云端不是事实源**。设计语义（为什么、不变式、失败语义）见 [`../design/40-cloud-sync.md`](../design/40-cloud-sync.md)；备份命名见 [20-api-backup.md](./20-api-backup.md)；公共约定见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`。

> **传输层只有 WebDAV**（坚果云原生；其他云盘由用户自建 `rclone serve webdav` / AList 桥接）。配置与同步状态落**创作根** `<创作根>/.ai-editor/cloud.json`（权限 0600，明文）——**绝不进项目文件**（`project.json` / `outline.json` / `data.db` / `sessions/` / 备份 zip 天然不含任何云盘凭据）。
>
> **项目依赖**：`/status` `/config` `/test` 不要求项目打开（设置页需先能配账号）；`/push` `/pull` 要求当前项目已打开（无项目 → 409 `NO_PROJECT_OPEN`）。
>
> **离线可用**：云端链路的任何失败都不得阻塞打开/关闭/编辑/备份。打开项目时的后台检查失败**只记日志并反映在状态里，绝不弹窗**。

### GET /api/v1/cloud/status

云端与本机的同步状态（设置页面板与左栏「同步云端」按钮的唯一数据源）。

> **已全部落地**（卡 2 配置段 + 卡 4 `remote`/`errorCode` + 卡 5 `local`/`state`）。已配置且打开了项目时发起 `PROPFIND`；
> **请求预算**：每次刷新 ≤ 3 次 PROPFIND（`dirName` 缓存命中 2 次：书目录 + 目录列举；缓存失效需扫云根 +1）。
> 云端检查失败不影响本端点成功返回（`remote: null` + `errorCode`，`state: "unreachable"`）。
>
> **三态判定**（`docs/design/40-cloud-sync.md` §3）：`云端有更新` = 云端文件集合 ≠ `lastSeenCloudFiles`（**不看时间戳**）；
> `本机有改动` = 创作数据 mtime 晚于 `lastSyncAt`（**不含 `.backups/`**；`data.db`/`-wal` 比较带 1s 容差——checkpoint 会刷新其 mtime，其余文件**严格比较**）；无同步记录 ⇒ 本机按「有改动」、云端有份按「有更新」⇒ `conflict`（保守）。

```typescript
// Res: 200
{
  configured: boolean;        // cloud.json 的 webdav url/username/password 三项齐备
  url: string | null;         // 回显（**不含密码**）
  username: string | null;
  device: string;             // 生效设备名（配置值；未配 → 简化 hostname：去域名后缀、滤非法字符、剥首尾空白与 `_`、截 16 字符）
  autoPush: boolean;          // 自动推送开关（本机级，缺省 false）
  projectId: string | null;   // 当前打开的项目 id（无项目 → null，下面两段为 null）
  remote: null | {
    dirName: string | null;   // 云端书目录名 `<书名>-<完整 projectId>`（尚未创建 → null）
    backups: Array<{          // 该书目录内可解析的备份（**时间倒序**；[0] = head）
      fileName: string;
      createdAt: string;      // ISO 8601（由文件名时间戳解析，本地时区）
      kind: "auto" | "manual";
      name?: string;          // 用户标签（带标签的份永不参与云端清理）
      device?: string;        // 来源设备（新命名格式；旧格式文件名无此字段）
      stats?: { characters: number; settings: number; chapters: number }; // 新格式尾部三段统计
      size: number;
    }>;
  };
  local: null | {            // 本机侧状态（未打开项目 → null）
    lastPushedFileName: string | null;   // **冲突判定基准** = 本机最后一次成功同步（推/拉）到的云端文件名
    lastSyncAt: string | null;           // 上次同步成功时刻（ISO 8601）；null = 从未同步过
    dirty: boolean;                      // 本机创作数据自 lastSyncAt 后有改动（三文件 + data.db-wal + 两个打包目录；**不含 .backups/**）
    latestBackupFileName: string | null; // 最新一份本地备份（推送缺省目标）
  };
  state: "unconfigured" | "no-project" | "synced" | "local-ahead" | "remote-ahead" | "conflict" | "unreachable";
  errorCode?: string;         // 云端检查失败时的码（"CLOUD_AUTH_FAILED" | "CLOUD_UNREACHABLE" | "CLOUD_QUOTA_EXCEEDED"）
}
```

**state 判定**（三态状态机，`../design/40-cloud-sync.md` §3）：

| state | 条件 | UI |
| :--- | :--- | :--- |
| `unconfigured` | 未配置 webdav | 引导进设置页云端面板 |
| `no-project` | 未打开项目 | 按钮禁用 |
| `unreachable` | 本次 PROPFIND 失败（附 `errorCode`） | 状态区显示失败原因 + 重试 |
| `synced` | 云端无更新且本机无改动 | 「已同步」 |
| `remote-ahead` | **云端文件集合 ≠ `lastSeenCloudFiles`**、本机无改动 | 「拉取」 |
| `local-ahead` | 本机有改动、云端无更新 | 「推送」 |
| `conflict` | 两者皆有（含「从未同步过 + 云端有份」） | 裁决（保留云端 / 用本机强推） |

> `conflict` 与 `remote-ahead` 的差别只在「本机是否有改动」；**云端更新的判定不看时间戳**（跨机器时钟偏差会漏报）。

### PUT /api/v1/cloud/config

写入云盘账号配置与设备名、自动推送开关。**响应不回传任何凭据**。

```typescript
// Req（字段全部可选；缺省 = 不修改）
{
  url?: string;       // 完整 WebDAV 根 URL（含用户自定义前缀），如 https://dav.jianguoyun.com/dav/ai-editor
                      // 空串 = 清空该项（与 username 皆空 = 回到「未配置」）
                      // **不得内嵌用户名/密码**（userinfo，如 https://u:pw@host/dav）→ 400 VALIDATION_ERROR：
                      // 该形态在本机 fetch 层不可用，且会把凭据回显进响应（不静默剥离）
  username?: string;  // 空串 = 清空
  password?: string;  // **缺省或空串 = 不修改**（从不回传 → 表单留空即保留原值）
                      // 例外（凭据三件套要么齐、要么全无）：url 与 username **皆清空**时，password
                      // 一并丢弃——「清除凭据」只需清空 url + username（密码框留空即可）
  device?: string;    // 设备名；规则：trim 后 1-16 字符，禁 `-`（文件名分隔符）与路径分隔符/保留字符
                      // （\ / : * ? " < > |）/控制字符/纯点 → 否则 400 VALIDATION_ERROR；空串 = 回缺省 hostname
  autoPush?: boolean; // 自动推送开关
}

// Res: 200
{ saved: true }
```

**语义**：写入 `<创作根>/.ai-editor/cloud.json`（原子写；文件权限 0600，创建时设置）；只改传入的字段。`url` 不做连通性校验（连通性走 `/test`，避免保存被网络问题阻塞）。

### POST /api/v1/cloud/test

连接测试（设置页「测试连接」按钮）：`PROPFIND` 根路径 → 不存在则 `MKCOL` 幂等创建 → `PUT` 一个写测试小文件再 `DELETE`（**验证读 + 写权限**，认证通过但无写权限是最常见的误配）。

```typescript
// Req: (none —— 用已保存的配置；先 PUT /config 再 test)
// Res: 200
{ connected: true; baseUrl: string; created: boolean }  // created = 本次新建了根目录
```

**错误码**：409 `CLOUD_NOT_CONFIGURED`、502 `CLOUD_AUTH_FAILED` / `CLOUD_UNREACHABLE` / `CLOUD_QUOTA_EXCEEDED`。

### POST /api/v1/cloud/push

推送一份本地备份到云端（**上传「本地备份文件本身」，逐字节拷贝、文件名原样**）。

```typescript
// Req
{
  fileName?: string;  // 要推送的本地备份文件名（缺省 = 最新一份）；须通过 parseBackupFileName 白名单
                      // （兼容全部历史格式）→ 否则 400 VALIDATION_ERROR
  force?: boolean;    // true = 云端 head ≠ lastPushed 时「用本机强推」：
                      //   先把云端那份 GET 下来存进本地 .backups/（文件名原样），再 PUT 本机那份
}

// Res: 200
{
  pushed: { fileName: string; size: number; device: string; kind: "auto" | "manual"; name?: string;
            stats?: { characters: number; settings: number; chapters: number } };
  remote: { dirName: string; headFileName: string };
  pruned: string[];      // 本次云端保留清理删除的文件名（带用户标签的份永不列入；只删「能解析出时间戳且无标签」的份）。
                         //   注意：`.tmp-*` 的清理属流程第 2 步（垃圾回收），**不计入** pruned
  snapshot?: { fileName: string };  // force 且云端有 head 时：下载存档进 .backups/ 的那份
}
```

**流程**（`../design/40-cloud-sync.md` §3 / §6）：

1. 定位云端书目录：`cloud.json` 缓存 `dirName` 走快路径 → `PROPFIND` 404 时回退扫描根目录、按目录名后缀 `-<projectId>` 匹配并修正缓存；目录不存在 → `MKCOL` 幂等创建
2. 清理遗留 `.tmp-*` → 列目录取 head → **冲突检测**（head 存在且 ≠ `lastPushedFileName` → 无 `force` 时 409 `CLOUD_CONFLICT`）
3. **体积检查**：zip > 500MB（云盘单文件上限）→ 400 `CLOUD_BACKUP_TOO_LARGE`（不等服务器回 413）
4. `PUT` 到 `.tmp-<正式文件名>` → `MOVE` 成正式名（**正式名下永远是完整包**）；`MOVE` 带 **`Overwrite: T`**——
   **同一份重推幂等覆盖**（用户连点、上次清理失败再推，否则目标已存在会 412 卡死）；跨机器同名冲突由 head 判定拦在前面，
   不靠 `MOVE` 412 兜底
5. 更新 `lastPushedFileName` / `lastSeenHeadFileName` / `lastSyncAt` / `baseEntries`（= 本次推送包内两个打包目录的条目名）
6. **保留策略**：只保留最近 5 份 + **带用户标签的永不清理** + 只删「能解析出时间戳」的份（`.tmp-` 垃圾由第 2 步清理，不属保留策略）；**只在推送成功后执行**，清理失败不阻塞推送

**错误码**：409 `NO_PROJECT_OPEN` / `CLOUD_NOT_CONFIGURED` / `CLOUD_CONFLICT`、404 `VALIDATION_ERROR`（本地备份不存在 / 本机没有任何可推送的备份——**先于任何网络动作**）、400 `VALIDATION_ERROR` / `CLOUD_BACKUP_TOO_LARGE`、502 `CLOUD_AUTH_FAILED` / `CLOUD_UNREACHABLE` / `CLOUD_QUOTA_EXCEEDED`。

### POST /api/v1/cloud/pull

从云端拉取一份备份应用到当前项目（**三文件覆盖 + `references/` 与 `sessions/` 并集**）。

```typescript
// Req
{
  fileName?: string;  // 云端备份文件名（缺省 = 云端 head）；须通过 parseBackupFileName 白名单
}

// Res: 200
{
  pulled: { fileName: string; size: number; createdAt: string };
  snapshot: { fileName: string; createdAt: string };  // 覆盖前本机自动快照（restore 管道既有行为）
  merged: { kept: number; written: number; removed: number };
  // kept    = 本机独有（云端没有、基线也没有）→ 保留
  // written = 云端新增（本机没有、基线也没有）→ 写入
  // removed = 云端删除（本机有、基线有、云端没有）→ 删本机
}
```

**流程**：`GET` 云端那份 → **覆盖前自动快照本机当前状态**（restore 管道既有）→ `validateBackupPackage`（zip 结构/白名单/三文件齐全/data.db `user_version` 三态分流）→ **三文件覆盖**（`project.json` 的 `name` 归一为当前目录名、`id` 保留——与 restore 同口径）+ **两目录并集**（基线三方比较、删除优先，见设计文档 §4）→ 重连 data.db + 版本对齐 + 重启备份定时器 → 更新 `lastSeenHeadFileName` / `lastSyncAt` / `baseEntries`。

**同步状态更新**：`lastPushedFileName` = **拉到的这份**（既是新的冲突判定基准，也是「本机已基于该版本」的标记——拉取后立刻推送不会被判冲突）；`lastSeenHeadFileName` = 云端 head；`lastSeenCloudFiles` = 拉取时的云端文件集合；`baseEntries` = 该包的打包目录条目（下次并集比较的基线）。

**与本地 restore 的区别（不可混用语义）**：本地 restore 是「回到那个时间点」= **整体覆盖**（保持现状不变）；云端 pull 是「把另一台机器的东西拿过来」= 三文件覆盖 + 两目录**并集**（本机独有的对话/资料不被静默吃掉）。并集只对 pull 生效——实现上是显式参数，restore 路径行为不变。

**删除如何真正生效**：本机删除后**推送到云端**，另一台拉取时按「云端删除」规则删除（并集不得复活本机已删除的文件）。UI 义务：删除会话 / 参考资料后的 toast 提示「推送到云端后，另一台也会同步删除」。

**错误码**：409 `NO_PROJECT_OPEN` / `CLOUD_NOT_CONFIGURED` / `SCHEMA_VERSION_MISMATCH`、404 `CLOUD_FILE_NOT_FOUND`、400 `VALIDATION_ERROR`（坏包/文件名非法）、502 `CLOUD_AUTH_FAILED` / `CLOUD_UNREACHABLE` / `CLOUD_QUOTA_EXCEEDED`。

### 不做的事

- **不改动本地 restore**（`POST /project/backup/restore` 保持整体覆盖语义）；云端书架（列云端全部书一键拉）与增量上传见 `../design/backlog.md`。
- **不做服务端定时重试**：手动动作失败由用户重试；自动推送失败等下一个 tick；关闭项目时推送失败只记日志 + 状态区标记。
- **不做密码回传 / 密码脱敏展示**：任何响应都不含 password 字段（前端表单留空 = 保留原值）；URL 里的内嵌凭据同样被拒绝，而不是剥离后回显「干净的 URL」。
- **不校验书名与云端目录名一致**：云端定位按 `projectId` 匹配；书名变化走 `POST /project/rename` 时的目录 `MOVE`。
