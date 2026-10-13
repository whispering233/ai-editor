// 工作区类型路由守卫（**UX 守卫**，卡 8）：两个 kind 下都只可达自己的页面，跨 kind 的 hash 一律挡回落点。
//
// 边界在哪：**服务端 `requireKind` 才是边界**（小说语义端点被练习工作区访问 → 400 `KIND_MISMATCH`）；
// 这里只是不把用户送进必然报错、或与外壳错配的页面（左栏与 InfoBar 都按当前 `kind` 渲染，而手输 hash /
// 旧书签 / 开机直达仍可能落进去——只挡一个方向就会出现「小说左栏 + 练习占位页」）。
//
// 两侧口径（都 fail-closed，**不要改成「枚举小说语义路由」的写法**——那条清单会把将来新增的小说路由漏掉）：
//   - 练习工作区（`kind = "practice"`）= **允许清单**：`#/`（根首页 = 工作区聚合入口，两种 kind 都可达）
//     / `#/practice` 及其子路径 / `#/preferences`（设置）；其余一律重定向 `#/practice`。
//   - 小说工作区（`kind = "novel"`）= **默认放行小说路由，只挡练习专属段**：首段是 `practice` → 重定向 `#/`
//     （它没有小说语义的页面，留着就是死页）。
//
// **判定发生在「选择渲染哪个页面之前」**——这正是本模块没有 hook 的原因：`main.tsx` 拿本函数的返回值
// 直接决定渲染目标页面还是渲染 `RedirectTo`，被挡下的 hash **不挂载目标页面**。旧写法（挂在外壳的
// effect 里挂载后再补跳）会让被挡下的页面先打出对面工作区的请求（400）——练习页（卡 9/10）接上自己的
// 端点后，同一模式会反向放大，故不再保留第二处判定。
// 单一实现处 = `workspaceRedirectPath`；纯函数放 `lib/`（同 `lib/workspace.ts` 的理由：client 无 jsdom，
// 判定要在纯函数层才测得到）。
import type { WorkspaceKind } from "@whispering233/ai-editor-shared";
import type { Route } from "../hooks/use-route";

/** 练习工作区的 hash 首段（小说侧守卫只挡这一段） */
const PRACTICE_SEGMENT = "practice";

/** 练习工作区允许的 hash 首段（根路由 `#/` 由空 segments 表达，单独允许） */
export const PRACTICE_ALLOWED_SEGMENTS: readonly string[] = [PRACTICE_SEGMENT, "preferences"];

/** 练习工作区的落点（被挡下的 hash 一律去这里——它唯一的页面） */
export const PRACTICE_REDIRECT_PATH = "/practice";

/** 小说工作区被挡下时的落点 = 根首页（工作区聚合入口，用户可在那里打开练习区） */
export const NOVEL_REDIRECT_PATH = "/";

/**
 * 该路由是否需要在当前工作区类型下重定向（纯函数，供单测与 `main.tsx` 的渲染分支）：
 * 返回目标 path，或 null = 允许通行。小说侧默认放行、练习侧走允许清单（见文件头）。
 *
 * `kind = null`（配置未加载 / 未打开工作区）时**不判定**：这一帧由首帧落点（`useEnterLastBook`）负责。
 */
export function workspaceRedirectPath(kind: WorkspaceKind | null, route: Route): string | null {
  if (kind === null) return null;
  const first = route.segments[0];
  if (kind === "practice") {
    if (first === undefined || PRACTICE_ALLOWED_SEGMENTS.includes(first)) return null;
    return PRACTICE_REDIRECT_PATH;
  }
  return first === PRACTICE_SEGMENT ? NOVEL_REDIRECT_PATH : null;
}
