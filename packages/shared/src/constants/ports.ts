// 服务监听端口分段（唯一定义；守卫测试 = constants.test.ts 断言窗口两两不相交）
//
// 为什么分段：web 生产 / web 开发 / 桌面端共用同一份 server 代码，端口被占时的 +1 兜底若
// 跨形态游走，会出现「Vite proxy 打到别的形态的 server」这类**静默串数据**（dev proxy 是
// 固定目标，无法跟随 +1）。分段后任何形态的兜底都出不了自己窗口。
//
// 窗口选址：三段都在 IANA 已废弃登记项区间内（无实现的遗留协议），避开真实数据库/中间件
// 端口与系统临时端口区；语义与选址理由见 docs/design/build.md §端口策略。
export interface PortRange {
  /** 窗口起点：首个尝试的端口 */
  base: number;
  /** 尝试次数（1 = 严格单端口：被占直接报错，不 +1） */
  attempts: number;
}

export const PORT_RANGES = {
  /** 桌面端：已发布用户的 localStorage 偏好锚在 base 上 ⇒ 本段刻意不动 */
  desktop: { base: 3456, attempts: 20 },
  /** web 生产（bin / npx ai-editor） */
  web: { base: 3500, attempts: 20 },
  /** web 开发态：Vite proxy 是固定目标 ⇒ 严格单端口 */
  dev: { base: 3520, attempts: 1 },
} as const satisfies Record<string, PortRange>;
