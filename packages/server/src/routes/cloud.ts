// 云端存档路由：GET /status、PUT /config、POST /test（挂载于 /api/v1/cloud）
//
// 契约 = `docs/api/100-api-cloud.md`；语义与不变式 = `docs/design/40-cloud-sync.md`。
// 卡 2 只做**配置段**：账号读写 + 连通性/读写权限测试；云端的列表、推送、拉取在后续卡片，
// 那时 status 会补上 remote/local/state（现在不填，避免「字段存在但永远为 null」的假契约）。
//
// 三个端点均**不要求**项目已打开（设置页需先能配账号；projectId 仅作回显）。
// 凭据纪律：password 永不进响应——不是脱敏展示，而是根本不回传。

import { Hono } from "hono";
import { cloudConfigPutReqSchema } from "@whispering233/ai-editor-shared/schemas";
import type { CloudConfigPutResult, CloudStatus, CloudTestResult } from "@whispering233/ai-editor-shared";
import { sanitizeDeviceName } from "@whispering233/ai-editor-shared";
import { HttpError, ok } from "../middleware/error.js";
import { getCurrentProject } from "../middleware/project.js";
import { currentDeviceName } from "../cloud/device.js";
import { readAutoPush, readWebdavConfig, writeCloudConfig } from "../cloud/state.js";
import { createWebdavClient } from "../cloud/webdav.js";

/** 云端存档路由（挂载于 /api/v1/cloud） */
export const cloudRoutes = new Hono();

/** 读写探测用的临时文件名（沿用 `.tmp-` 约定：推送前清理流程会顺带回收遗留文件） */
export const WEBDAV_WRITE_TEST_FILE = ".tmp-ai-editor-writetest";

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
      `WebDAV 地址不是合法 URL：${raw}（示例：https://dav.jianguoyun.com/dav/ai-editor）`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "VALIDATION_ERROR", `WebDAV 地址只接受 http/https：${raw}`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

// GET /api/v1/cloud/status —— 配置段（不发起任何网络请求；云端状态在卡 4 起补）
cloudRoutes.get("/status", (c) => {
  const webdav = readWebdavConfig();
  const project = getCurrentProject();
  const payload: CloudStatus = {
    configured: webdav !== null,
    url: webdav?.url ?? null,
    username: webdav?.username ?? null,
    device: currentDeviceName(),
    autoPush: readAutoPush(),
    projectId: project?.config.id ?? null,
  };
  return c.json(ok(payload));
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

  const payload: CloudConfigPutResult = { saved: true };
  return c.json(ok(payload));
});

// POST /api/v1/cloud/test —— 连通性 + 读/写权限探测（认证通过但无写权限是最常见的误配）
cloudRoutes.post("/test", async (c) => {
  const webdav = readWebdavConfig();
  if (webdav === null) {
    throw new HttpError(409, "CLOUD_NOT_CONFIGURED", "云盘未配置：请先填写 WebDAV 地址与用户名/应用密码");
  }
  const client = createWebdavClient(webdav);

  // 1) 根目录可达性：列不出来（404）→ 幂等创建
  const entries = await client.list("");
  const created = entries === null ? await client.mkcol("") : false;
  // 2) 写权限探测：写一个临时小文件再删除（留下残file也不怕——`.tmp-` 前缀在清理白名单内）
  await client.put(WEBDAV_WRITE_TEST_FILE, new TextEncoder().encode("ai-editor webdav write test"));
  await client.remove(WEBDAV_WRITE_TEST_FILE);

  const payload: CloudTestResult = { connected: true, baseUrl: webdav.url, created };
  return c.json(ok(payload));
});
