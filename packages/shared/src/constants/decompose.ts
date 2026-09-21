// 拆解小说常量（跨端共用：server 的会话守卫 / 保留上限与 client 的只读态判别都读这里）
//
// 口径出处：docs/design/60-decompose.md §2.1（会话形态：id 前缀即 kind）与 §7.2（保留上限）。

/** 拆解会话 id 前缀（会话 id = 前缀 + 清洗后的 job id；判别只用前缀，零成本且不解析 id 内部） */
export const DECOMPOSE_SESSION_ID_PREFIX = "decompose-";
