// 云端配置表单的纯函数（卡 3）：表单状态 ↔ API 补丁 / 预填 / 脏判定
//
// 为什么独立成模块：表单到请求的映射有几条容易搞错的语义（密码留空不提交、空串清空、
// 凭据不全时不提交密码、设备名预填生效值），把它们收敛成可单测的纯函数，面板组件只管渲染与副作用。
//
// 契约：`docs/api/100-api-cloud.md` 的 `PUT /cloud/config`（卡 2 服务端语义）、
// `docs/design/40-cloud-sync.md` §7（凭据三件套要么齐、要么全无）、`docs/ui/DESIGN.md` §备份与云端存档。

import type { CloudStatus } from "@whispering233/ai-editor-shared";

/** 面板表单状态（四个输入框；password 恒以空串起始——服务端从不回传密码） */
export interface CloudConfigForm {
  url: string;
  username: string;
  password: string;
  device: string;
}

/** 空表单（新建/未配置态；密码框留空 = 不修改） */
export const EMPTY_CLOUD_CONFIG_FORM: CloudConfigForm = { url: "", username: "", password: "", device: "" };

/**
 * 由 status 预填表单：
 * - `url` / `username`：回显已配置值（未配置 → 空串）
 * - `password`：**恒为空串**（服务端从不回传；留空 = 保留原值）
 * - `device`：预填**当前生效值**（配置值或 hostname 派生值）。字段可见 = 不隐藏「实际会写进备份文件名的是什么」；
 *   清空该字段再保存 = 回退 hostname 派生（`PUT /cloud/config` 的 `device: ""` 语义）。
 *   代价（已登记）：首次保存会把当前的 hostname 派生值显式写进 cloud.json——机器改名后需手动改设备名。
 */
export function cloudConfigFormFrom(status: CloudStatus | null): CloudConfigForm {
  if (status === null) return { ...EMPTY_CLOUD_CONFIG_FORM };
  return {
    url: status.url ?? "",
    username: status.username ?? "",
    password: "",
    // 只预填**用户设过**的设备名（卡 (a)）：没设过就留空（说明行告知「留空 = 用本机名 <生效值>」），
    // 否则「只点保存」会把派生值钉进 cloud.json，从此不再跟随 hostname
    device: status.deviceConfigured ? status.device : "",
  };
}

/** 凭据是否「填了一半」（地址与用户名必须同时给、或同时清空） */
export function isCredentialHalfFilled(form: CloudConfigForm): boolean {
  const hasUrl = form.url.trim() !== "";
  const hasUsername = form.username.trim() !== "";
  return hasUrl !== hasUsername;
}

/** 表单 → `PUT /cloud/config` 补丁（字段语义与卡 2 服务端逐条对齐） */
export function buildCloudConfigPatch(form: CloudConfigForm): {
  url: string;
  username: string;
  password?: string;
  device: string;
} {
  const url = form.url.trim();
  const username = form.username.trim();
  const password = form.password;
  const credentialsComplete = url !== "" && username !== "";
  // 空白密码（纯空格/制表符）= 留空：不提交（服务端只判 `password !== ""`，空白会被当成真密码存下
  // → configured=true 但认证永远 401）；**非空密码提交原值、不做 trim**（不改用户密码内容）
  const passwordProvided = password.trim() !== "";
  return {
    // url/username/device 空串照传：服务端语义分别是「清空该项」「回缺省 hostname」（幂等，无需脏判定）
    url,
    username,
    device: form.device.trim(),
    // password 留空 ⇒ 不提交（服务端 = 保留原值）；凭据不全时也不提交——
    // 否则服务端按「三件套要么齐要么全无」静默丢弃，用户会以为存上了（卡 2 oracle 复核第 2 条）
    ...(passwordProvided && credentialsComplete ? { password } : {}),
  };
}

/** 表单是否有未保存改动（与 status 比对；password 只要非空即算改动） */
export function isCloudConfigDirty(form: CloudConfigForm, status: CloudStatus | null): boolean {
  if (status === null) {
    return (
      form.url.trim() !== "" ||
      form.username.trim() !== "" ||
      form.password.trim() !== "" ||
      form.device.trim() !== ""
    );
  }
  return (
    form.url.trim() !== (status.url ?? "") ||
    form.username.trim() !== (status.username ?? "") ||
    form.device.trim() !== (status.deviceConfigured ? status.device : "") ||
    // 密码：空白与空串同为「未改动」（与服务端「空白 = 留空」语义一致，否则点亮保存却发出空改动）
    form.password.trim() !== ""
  );
}
