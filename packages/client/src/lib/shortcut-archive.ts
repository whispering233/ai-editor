// Ctrl/Cmd + S 的「本地存档」阶段（契约 = DESIGN.md §设置页「快捷键」区）
// 语义：保存落定后生成一份手动备份（与设置页「立即备份」同管道，落 .backups/）。
// 节流：距上次**成功**存档不足 SHORTCUT_BACKUP_THROTTLE_MINUTES 时只保存不存档——
// 连按不会把保留窗口刷成同一分钟的快照，也不会连推云端（手动备份会触发自动推送）。
// 节流基准是进程内时间戳：刷新即重置——存档是磁盘事实，不是用户偏好，不入 localStorage。
// 本模块零依赖（备份请求与时间源都注入），节流状态封装在实例里，便于单测。

/** 节流窗口（分钟）：**单一定义处**——toast 文案与判定都引用它，不复述数字 */
export const SHORTCUT_BACKUP_THROTTLE_MINUTES = 5;

/** 节流窗口（毫秒）：由分钟档派生 */
const THROTTLE_MS = SHORTCUT_BACKUP_THROTTLE_MINUTES * 60_000;

export type ArchiveResult =
  /** 已生成一份新备份 */
  | { status: "archived" }
  /** 节流窗口内：只保存、未生成新备份 */
  | { status: "skipped" }
  /** 上一份还在生成：不重入（它的结果会自己上报） */
  | { status: "busy" }
  /** 备份请求失败（错误对象原样带出，文案由调用方按既有错误码口径映射） */
  | { status: "failed"; error: unknown };

export interface ArchiveDeps {
  /** 生成一份手动备份（真实实现 = `POST /project/backup`） */
  createBackup: () => Promise<unknown>;
  /** 时间源（测试注入；真实实现 = Date.now） */
  now: () => number;
}

export interface ShortcutArchive {
  run(deps: ArchiveDeps): Promise<ArchiveResult>;
}

/** 存档状态机（节流基准 + 在途标志）：进程内应只有一个实例（`hooks/use-save-archive.ts` 持有） */
export function createShortcutArchive(): ShortcutArchive {
  let lastArchivedAt: number | null = null;
  let inFlight = false;

  return {
    async run(deps: ArchiveDeps): Promise<ArchiveResult> {
      if (inFlight) return { status: "busy" };
      const at = deps.now();
      if (lastArchivedAt !== null && at - lastArchivedAt < THROTTLE_MS) {
        return { status: "skipped" };
      }
      inFlight = true;
      try {
        await deps.createBackup();
        // 只有成功才推进基准：失败后下一次按键立刻重试（失败不是一次存档）
        lastArchivedAt = at;
        return { status: "archived" };
      } catch (error) {
        return { status: "failed", error };
      } finally {
        inFlight = false;
      }
    },
  };
}
