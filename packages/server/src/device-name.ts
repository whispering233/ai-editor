// 生效设备名（备份文件名第 3 段「来源设备」的来源）
//
// 缺省 = 本机 hostname 派生（shared `deviceNameFromHostname`：去域名后缀、`-` 与非法字符转 `_`、
// 截 16 字符），保证备份文件名里的设备段始终非空且合法（禁 `-`）。
// 云端存档启用后，用户在设置页配置的 `device`（`cloud.json`）优先——覆盖逻辑由云端模块接入
// （见 `docs/design/40-cloud-sync.md` §7）。

import { hostname } from "node:os";
import { deviceNameFromHostname } from "@whispering233/ai-editor-shared";

/** 本机缺省设备名（纯派生，无 IO；每次调用重算，hostname 变更无需重启） */
export function defaultDeviceName(): string {
  return deviceNameFromHostname(hostname());
}
