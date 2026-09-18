// 云端存档路由：GET /status、PUT /config、POST /test（挂载于 /api/v1/cloud）
//
// 契约 = `docs/api/100-api-cloud.md`；语义与不变式 = `docs/design/40-cloud-sync.md`。
// 卡 2 只做**配置段**：账号读写 + 连通性/读写权限测试；云端的列表、推送、拉取在后续卡片，
// 那时 status 会补上 remote/local/state（现在不填，避免「字段存在但永远为 null」的假契约）。
//
// 三个端点均**不要求**项目已打开（设置页需先能配账号；projectId 仅作回显）。
// 凭据纪律：password 永不进响应——不是脱敏展示，而是根本不回传。

import { Hono } from "hono";
import { cloudConfigPutReqSchema, cloudPullReqSchema, cloudPushReqSchema } from "@whispering233/ai-editor-shared/schemas";
import type { CloudConfigPutResult, CloudStatus, CloudTestResult } from "@whispering233/ai-editor-shared";
import { sanitizeDeviceName } from "@whispering233/ai-editor-shared";
import { HttpError, ok } from "../middleware/error.js";
import { getCurrentProject, requireCurrentProject } from "../middleware/project.js";
import { currentDeviceName } from "../cloud/device.js";
import { configuredDeviceName, readAutoPush, readBookState, readWebdavConfig, writeCloudConfig } from "../cloud/state.js";
import { startAutoBackup } from "../backup.js";
import { cloudFileSet, computeCloudSync, findExistingCloudDir, pullBackup, pushBackup, toCloudBackups } from "../cloud/sync.js";
import { createWebdavClient, type DavEntry } from "../cloud/webdav.js";

/** 云端存档路由（挂载于 /api/v1/cloud） */
export const cloudRoutes = new Hono();

/** 读写探测用的临时文件名（沿用 `.tmp-` 约定：推送前清理流程会顺带回收遗留文件） */
export const WEBDAV_WRITE_TEST_FILE = ".tmp-ai-editor-writetest";
/** 探针用的工作子目录：**坚果云等云盘不允许在根目录直接建文件**（PUT 根 → 404 ObjectNotFound），
 * 但允许建子目录 ⇒ 探针写进它里面；建不了子目录（不支持/权限不足）时退回根目录写法 */
export const WEBDAV_WRITE_TEST_DIR = ".tmp-ai-editor-writetest-dir";

/**
 * 归一化 WebDAV 根 URL：必须是 `http(s)` 绝对地址；去尾斜杠（路径拼接由客户端逐段编码）。
 * 非法 → 400 VALIDATION_ERROR（文案面向用户，指出期望形态与示例）。
 */
function normalizeWebdavUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      // 不回显原始输入（用户可能把 ftp://用户名:密码@host 这类串粘进来；卡 D）
      "WebDAV 地址不是合法 URL（示例：https://dav.jianguoyun.com/dav/ai-editor）",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    // 只回显协议段（`parsed.protocol`），不回显原始输入（同上；卡 D）
    throw new HttpError(400, "VALIDATION_ERROR", `WebDAV 地址只接受 http/https（当前：${parsed.protocol}）`);
  }
 // 拒绝 URL 内嵌凭据（oracle 卡 2 验证 F1）：undici 拒绍带 credentials 的 URL（保存后永远不通），
 // 且该串会被原样回显进响应（凭据泄露）。**不静默剥离**——静默会让用户以为填对了。
  if (parsed.username !== "" || parsed.password !== "") {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "WebDAV 地址不得内嵌用户名/密码（如 https://user:pw@host/dav）——请分别填到用户名与应用密码字段",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

// GET /api/v1/cloud/status —— 配置段 + 云端段（remote：目录与备份列表）+ 本机段与三态（local/state）
// 已配置且打开了项目时发起 PROPFIND（缓存命中 2 次、需回退扫描时 3 次：书目录 + 目录列举 [+ 云根]）；
// 失败不影响本端点成功返回（remote=null + errorCode，state="unreachable"）
cloudRoutes.get("/status", async (c) => {
  const webdav = readWebdavConfig();
  const project = getCurrentProject();
  let remote: CloudStatus["remote"] = null;
  let rawEntries: DavEntry[] = [];
  let errorCode: string | undefined;
  if (webdav !== null && project !== null) {
    try {
      const client = createWebdavClient(webdav);
      const state = readBookState(project.config.id);
      const dirName = await findExistingCloudDir(client, project, state?.dirName);
      rawEntries = dirName === null ? [] : ((await client.list(dirName)) ?? []);
      remote = { dirName, backups: toCloudBackups(rawEntries) };
    } catch (err) {
      // 云端检查失败：只反映在状态里（remote=null + errorCode），不阻塞本地功能
      errorCode = err instanceof HttpError ? err.code : "CLOUD_UNREACHABLE";
    }
  }
  const { local, state } = computeCloudSync(
    project,
    webdav !== null,
    remote === null ? null : { files: cloudFileSet(rawEntries) },
  );
  const payload: CloudStatus = {
    configured: webdav !== null,
    url: webdav?.url ?? null,
    username: webdav?.username ?? null,
    device: currentDeviceName(),
    // 「用户显式设过」与「生效值」分开（卡 (a)）：面板只预填设过的值，避免保存时把派生值钉进配置
    deviceConfigured: configuredDeviceName() !== null,
    autoPush: readAutoPush(),
    projectId: project?.config.id ?? null,
    remote,
    local,
    state,
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
  return c.json(ok(payload));
});

// POST /api/v1/cloud/pull —— 从云端拉取一份备份应用到当前项目（缺省 = 云端 head）
// 语义：三文件覆盖 + `sessions/` **并集合并**（基线三方比较、删除优先）；
// 覆盖前自动快照本机当前状态（restore 管道既有行为）
cloudRoutes.post("/pull", async (c) => {
  const project = requireCurrentProject(); // 409 NO_PROJECT_OPEN
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = cloudPullReqSchema.parse(body);
  const result = await pullBackup(project, {
    ...(parsed.file_name !== undefined ? { fileName: parsed.file_name } : {}),
  });
  return c.json(ok(result));
});

// PUT /api/v1/cloud/config —— 写入账号配置/设备名/自动推送开关（合并写；响应不含凭据）
cloudRoutes.put("/config", async (c) => {
  const parsed = cloudConfigPutReqSchema.parse(await c.req.json());

  // url：空串 = 清空；非空 → 归一化（校验失败 400）
  const url = parsed.url === undefined ? undefined : parsed.url.trim() === "" ? null : normalizeWebdavUrl(parsed.url.trim());
  // username：空串 = 清空
  const username = parsed.username === undefined ? undefined : parsed.username.trim();
  // password：**缺省或空串 = 保留原值**（响应从不回传 → 表单留空即不改）
  const password = parsed.password === undefined || parsed.password === "" ? undefined : parsed.password;
  // device：空串 = 回到缺省；非空 → sanitize（非法 400）
  let device: string | null | undefined;
  if (parsed.device !== undefined) {
    if (parsed.device.trim() === "") {
      device = null;
    } else {
      const sanitized = sanitizeDeviceName(parsed.device);
      if (sanitized === null) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "设备名非法（trim 后 1-16 字符，禁连字符 `-` 与路径分隔符/保留字符）",
        );
      }
      device = sanitized;
    }
  }

  writeCloudConfig({
    ...(url !== undefined ? { url } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(device !== undefined ? { device } : {}),
    ...(parsed.autoPush !== undefined ? { autoPush: parsed.autoPush } : {}),
  });

  // 自动推送的排程条件依赖自动备份频率：本机开关可能在本次保存中改变——立即重排一次 tick
  //（幂等；只在「备份频率关闭 + autoPush」时才真的排上 2h 兜底）——否则要等下次 open/restore
  const project = getCurrentProject();
  if (project !== null) startAutoBackup(project);

  const payload: CloudConfigPutResult = { saved: true };
  return c.json(ok(payload));
});

// POST /api/v1/cloud/push —— 推送一份本地备份到云端（缺省取最新一份；force = 冲突时用本机覆盖云端）
cloudRoutes.post("/push", async (c) => {
  const project = requireCurrentProject(); // 409 NO_PROJECT_OPEN
  const body: unknown = await c.req.json().catch(() => ({}));
  const parsed = cloudPushReqSchema.parse(body);
  const result = await pushBackup(project, {
    ...(parsed.file_name !== undefined ? { fileName: parsed.file_name } : {}),
    ...(parsed.force !== undefined ? { force: parsed.force } : {}),
  });
  return c.json(ok(result));
});

// POST /api/v1/cloud/test —— 连通性 + 读/写权限探测（认证通过但无写权限是最常见的误配）
cloudRoutes.post("/test", async (c) => {
  const webdav = readWebdavConfig();
  if (webdav === null) {
    throw new HttpError(409, "CLOUD_NOT_CONFIGURED", "云盘未配置：请先填写 WebDAV 地址与用户名/应用密码");
  }
  const client = createWebdavClient(webdav);

  // 1) 根目录可达性：列不出来（404）→ 幂等创建 → **复核**（卡：MKCOL 可能被服务器以
  // 「已存在」等状态敷衍而不真正创建；不复核的话错误会错位到后面的 PUT 上，报 404 让人以为
  // 是写权限问题）。复核仍不存在 → 报「目录不存在且创建失败」并给出地址与建议。
  const entries = await client.list("");
  let created = false;
  if (entries === null) {
    created = await client.ensureWorkingRoot(); // 云盘根 + 工作根都幂等创建（地址还不存在也能自愈）
    if ((await client.list("")) === null) {
      throw new HttpError(
        502,
        "CLOUD_UNREACHABLE",
        `云盘目录不存在且创建失败：${webdav.url}（请确认地址指向你自己的 WebDAV 根目录，坚果云为 https://dav.jianguoyun.com/dav；若地址多带了一层不存在的子目录，先删掉它再测）`,
      );
    }
  }
  // 2) 写权限探测：**优先写进工作子目录**（坚果云等云盘根目录不可写文件：PUT `/dav/x` → 404
  // ObjectNotFound，而建子目录是允许的）；子目录建不了（不支持/权限不足）→ 退回根目录写法。
  // **可写不可删的云盘（DELETE 403/405…）不降级为认证失败**——读 + 写都通过了，凭据有效，只是清理失败；
  // 报 502 AUTH_FAILED 会误导用户去查凭据。这里改为成功 + 提示残留（具体状态码进日志）。
  let probeDir: string | null = null;
  try {
    // 先清历史残留（上一次因删除失败留下的空目录）——顺带验证删除能力
    await client.removeDir(WEBDAV_WRITE_TEST_DIR).catch(() => undefined);
    await client.mkcol(WEBDAV_WRITE_TEST_DIR); // 幂等：已存在返回 false，同样可用
    probeDir = WEBDAV_WRITE_TEST_DIR;
  } catch (err) {
    console.error("[cloud] 工作子目录创建失败，探针退回根目录写法:", err);
  }
  const probePath = probeDir === null ? WEBDAV_WRITE_TEST_FILE : `${probeDir}/${WEBDAV_WRITE_TEST_FILE}`;
  await client.put(probePath, new TextEncoder().encode("ai-editor webdav write test"));
  let leftover = false;
  try {
    await client.remove(probePath);
  } catch (err) {
    leftover = true;
    console.error("[cloud] 测试文件删除失败（云盘可能不允许删除；凭据本身正常）:", err);
  }
  if (probeDir !== null && !leftover) {
    // 子目录一并清掉（用 removeDir：集合删除需要尾斜杠 + Depth: infinity，否则某些云盘不删、留空目录）
    try {
      await client.removeDir(probeDir);
    } catch (err) {
      console.error("[cloud] 测试目录删除失败（空目录残留，下次「测试连接」会再清一次）:", err);
    }
  }

  // baseUrl 回显**用户的云盘根**（配置值；工作根 `<根>/ai-editor` 由客户端层拼，不进配置语义）
  const payload: CloudTestResult = { connected: true, baseUrl: webdav.url, created, ...(leftover ? { leftoverWriteTestFile: true } : {}) };
  return c.json(ok(payload));
});
