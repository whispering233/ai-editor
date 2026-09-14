// 生效设备名（备份文件名第 3 段「来源设备」的唯一解析点）
//
// 优先级：云端配置的 `webdav.device`（用户在设置页改写）→ 缺省 = 本机 hostname 派生
// （`defaultDeviceName`：去域名后缀、滤非法字符、剥首尾空白与 `_`、截 16 字符）。
// 配置值必须通过 `sanitizeDeviceName` 才生效（`configuredDeviceName` 已收敛该校验）。
//
// 为什么放在云端模块：设备名随云端配置走（`cloud.json`），备份管道只消费「当前生效值」——
// 见 `docs/design/40-cloud-sync.md` §7 与 `docs/api/20-api-backup.md`「设备与统计」。

import { defaultDeviceName } from "../device-name.js";
import { configuredDeviceName } from "./state.js";

/** 当前生效设备名（配置值优先；无配置/配置非法 → 简化 hostname，恒合法） */
export function currentDeviceName(): string {
  return configuredDeviceName() ?? defaultDeviceName();
}
