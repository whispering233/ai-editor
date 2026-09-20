// 全站 Ctrl/Cmd + S 的存档阶段（唯一注册者 = `AppShell`；契约 = DESIGN.md §设置页「快捷键」区）
// - 无项目打开：只保存、不存档、不提示（备份端点本身要求项目已打开）
// - toast 文案里的分钟数由 SHORTCUT_BACKUP_THROTTLE_MINUTES 插值（不复述数字）
// - 存档实例（节流基准 + 在途标志）进程内唯一：模块级实例，切页/重挂不重置，刷新页面才重置
// - handler 只注册一次，行为经 ref 取最新（与 useSaveShortcut 同款，避免注册栈顺序频繁变动）
import { useEffect, useRef } from "react";
import { ApiError, CLIENT_NETWORK_ERROR, createProjectBackup } from "../lib/api";
import { registerArchiveHandler } from "../lib/save-shortcut";
import { createShortcutArchive, SHORTCUT_BACKUP_THROTTLE_MINUTES } from "../lib/shortcut-archive";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

/** 存档状态机实例（节流状态进程内唯一） */
const archive = createShortcutArchive();

/** 备份失败文案：服务端错误码带出的说明优先，网络层失败归为连接问题（与左栏「立即备份」同口径） */
function failureText(err: unknown): string {
  return err instanceof ApiError && err.code !== CLIENT_NETWORK_ERROR
    ? err.message
    : "无法连接服务";
}

export function useSaveArchive(): void {
  const showToast = useUiStore((s) => s.showToast);
  const projectOpen = useProjectStore((s) => s.config !== null);
  const ref = useRef({ showToast, projectOpen });
  ref.current = { showToast, projectOpen };

  useEffect(
    () =>
      registerArchiveHandler(() => {
        const { showToast, projectOpen } = ref.current;
        if (!projectOpen) return;
        void archive
          .run({ createBackup: () => createProjectBackup(), now: () => Date.now() })
          .then((result) => {
            switch (result.status) {
              case "archived":
                showToast("已保存并生成存档");
                break;
              case "skipped":
                showToast(
                  `已保存 · 距上次存档不足 ${SHORTCUT_BACKUP_THROTTLE_MINUTES} 分钟，未生成新存档`,
                );
                break;
              case "busy":
                break; // 上一份还在生成：它的结果会自己上报，不重复提示
              case "failed":
                showToast(`已保存，但生成存档失败：${failureText(result.error)}`, "error");
                break;
            }
          });
      }),
    [],
  );
}
