// 云端（WebDAV）同步的**唯一状态源 + 一键状态机**（卡 6 上提，替代面板页内 state）
//
// 契约：`docs/ui/DESIGN.md` §538 `sync-cloud-button`（角标 + 一键状态机）、§548 `cloud-conflict-dialog`；
// `docs/design/40-cloud-sync.md` §3 三态流转；`docs/api/100-api-cloud.md` 端点信封。
//
// 两条硬约束（卡 5 oracle 复核的债）：
// - **不轮询**：`/status` 每次 2-3 次 PROPFIND（云盘配额 600 次/30 分钟）→ 只在「打开项目」「点击按钮」
//   「推送/拉取/保存配置后」刷新；同一时刻的并发请求合并为一个（`inFlight`）。
// - **`unreachable` 只轻提示**：角标不亮、不弹窗；toast 文案强调本地功能不受影响（离线可用底线）。
//
// 边界（有意留白）：账号表单草稿（url / 用户名 / 密码 / 设备名）**不进 store**——纯页内 UI 状态，
// 切走面板即弃；本 store 只持「服务端状态 + 跨组件动作 + 跨页意图」。

import { create } from "zustand";
import type { CloudBackupEntry, CloudStatus } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  createProjectBackup,
  getCloudStatus,
  getProjectBackups,
  pullCloudBackup,
  pushCloudBackup,
  type BackupEntry,
} from "../lib/api";
import { formatBytes } from "../lib/backup";
import { navigate } from "../hooks/use-route";
import { useProjectStore } from "./project";
import { useChatStore } from "./chat";
import { useUiStore } from "./ui";

/** 设置页「备份」pane 的二级项（跨页跳转意图的目标） */
export type SettingsBackupPane = "cloud";

/** 角标语义色：`conflict` = error（需人裁决）、未推改动/云端更新 = warning（有事可做、非错误）；
 * 其余状态不显示角标（`unreachable` 明确不亮——见 DESIGN.md §538）。 */
export function cloudBadgeTone(status: CloudStatus | null): "error" | "warning" | null {
  if (status === null) return null;
  if (status.state === "conflict") return "error";
  if (status.state === "local-ahead" || status.state === "remote-ahead") return "warning";
  return null;
}

/** 失败提示：服务端文案（400 校验 / 409 冲突 / 502 三码）已中文可读，直接透传；网络层给固定文案。
 * 导出：`lib/api.ts` 是唯一 API 入口，错误文案口径（含 `CLIENT_NETWORK_ERROR`）必须与面板一致 */
export function cloudErrorText(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.code !== "CLIENT_NETWORK_ERROR" ? err.message : fallback;
}

interface CloudState {
  /** 服务端状态快照；null = 尚未检查（未打开项目 / 检查前） */
  status: CloudStatus | null;
  /** 状态读取失败（网络层）：面板据此提示「重试」，角标不亮 */
  statusFailed: boolean;
  /** 本机最新一份备份（推送缺省目标 / 裁决框「本机那份」的展示；无项目或无备份 → null） */
  localLatest: BackupEntry | null;
  /** 本机份列表**读取失败**（与「真的没有备份」区分，卡 C）：true 时禁用强推/上传旧备份并说明原因，
   * 不得把故障显示成「本机还没有备份」（那是把故障说成事实） */
  localLatestUnavailable: boolean;
  /** 在途动作（防连点；左栏按钮 `loading` 与面板按钮 `disabled` 都看它） */
  busy: "refresh" | "push" | "pull" | null;
  /** 最近一次动作失败文案（面板行内展示；toast 之外留一份可回看） */
  lastError: string | null;
  /** 裁决对话框开关（左栏与面板共用同一个宿主） */
  conflictOpen: boolean;
  /** 待确认的拉取目标（非 null → 渲染 `cloud-pull-confirm`） */
  pullTarget: CloudBackupEntry | null;
  /** 跨页意图：非 null → 设置页「备份」pane 选中该项（消费后置回 null） */
  pendingSettingsPane: SettingsBackupPane | null;
  /** 旧包上传确认框开关（卡 B：`local.backupStale` 时点「同步云端」弹它，二选一） */
  staleDialogOpen: boolean;

  /** 刷新状态（并发合并；返回最新快照，网络层失败 → null）。不轮询，只在事件点调用。 */
  refresh: () => Promise<CloudStatus | null>;
  /** 清空状态（关闭项目 / 回到书架：角标随之熄灭，不残留上一本书的判断） */
  clearStatus: () => void;
  /** 左栏「同步云端」一键状态机（先实时复查，再按 state 分派） */
  syncNow: () => Promise<void>;
  /** 推送云端（`force` = 用本机覆盖云端；成功后失败态清空，冲突则弹裁决框） */
  push: (options?: { force?: boolean }) => Promise<void>;
  /** 先「立即备份」生成新格式备份，再推送（旧包上传确认框的第一个选项） */
  pushAfterFreshBackup: () => Promise<void>;
  /** 拉取（省略 entry = 云端最新一份）；成功后刷新项目数据（config / outline / 会话） */
  pull: (entry?: CloudBackupEntry) => Promise<void>;
  openPullConfirm: (entry: CloudBackupEntry) => void;
  closePullConfirm: () => void;
  openConflict: () => void;
  closeConflict: () => void;
  pullConflictKeepCloud: () => Promise<void>;
  openStaleDialog: () => void;
  closeStaleDialog: () => void;
  /** 请求「跳到设置页 → 备份 → 云端备份」（未配置时的引导） */
  requestCloudPane: () => void;
  consumePendingPane: () => void;
}

/** 在途的 `/status` 请求（合并并发；finally 清空——成功后不留缓存，保证「点击即实时复查」） */
let inFlight: Promise<CloudStatus | null> | null = null;

export const useCloudStore = create<CloudState>((set, get) => ({
  status: null,
  statusFailed: false,
  localLatest: null,
  localLatestUnavailable: false,
  busy: null,
  lastError: null,
  conflictOpen: false,
  pullTarget: null,
  pendingSettingsPane: null,
  staleDialogOpen: false,

  refresh: async () => {
    if (inFlight !== null) return inFlight;
    // busy 归属（卡 C）：只在自己「从空闲变为 refresh」时设它，也只在**自己设过**时清它——
    // 否则会在 push/pull 在途时把它们的 busy 清掉（虽同 tick 内窗口极小，但破坏「谁设的谁清」不变式）
    const ownsBusy = get().busy === null;
    if (ownsBusy) set({ busy: "refresh" });
    inFlight = (async () => {
      try {
        // 本机份列表是本地读写（不碰云盘），与状态一起刷，两个消费者看到同一份快照。
        // 读取失败要能与「真的没有备份」区分（卡 C）——用结果对象而不是闭包赋值（TS 收窄）
        const [next, backupsResult] = await Promise.all([
          getCloudStatus(),
          getProjectBackups()
            .then((res) => ({ ok: true as const, res }))
            .catch(() => ({ ok: false as const })),
        ]);
        set({
          status: next,
          statusFailed: false,
          localLatest: backupsResult.ok ? (backupsResult.res.backups[0] ?? null) : null,
          localLatestUnavailable: !backupsResult.ok,
        });
        return next;
      } catch {
        set({ statusFailed: true, status: null, localLatest: null });
        return null;
      } finally {
        if (ownsBusy) set({ busy: null });
      }
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  },

  clearStatus: () =>
    set({
      status: null,
      statusFailed: false,
      localLatest: null,
      lastError: null,
      // 关闭项目/切书时一并收掉对话框与跨页意图（否则旧书的状态会挂在界面上）
      conflictOpen: false,
      pullTarget: null,
      staleDialogOpen: false,
      pendingSettingsPane: null,
    }),

  syncNow: async () => {
    if (get().busy !== null) return;
    const next = await get().refresh(); // 每次点击实时复查（DESIGN.md §538：不做轮询）
    if (next === null) {
      useUiStore.getState().showToast("云端状态读取失败，本地功能不受影响", "error");
      return;
    }
    const toast = (text: string, kind?: "success" | "error") => useUiStore.getState().showToast(text, kind);
    switch (next.state) {
      case "no-project":
        return; // 无项目时按钮本就禁用（这里兜底：不动作、不报错）
      case "unconfigured":
        // 引导：跳设置页并选中「备份 → 云端备份」（意图经 store 下传，选中态仍不进 URL）
        get().requestCloudPane();
        navigate("/preferences");
        return;
      case "unreachable":
        toast(`云端不可达${next.errorCode !== undefined ? `（${next.errorCode}）` : ""}，本地功能不受影响`, "error");
        return;
      case "synced":
        // 卡 B：`synced` 只说明「上次同步后没改动」——若最新备份早于最新改动（推过旧包的典型形态），
        // 直接说「已是最新」会撒谎：改弹旧包确认框让用户决定
        if (next.local?.backupStale === true) {
          get().openStaleDialog();
          return;
        }
        toast("已是最新（云端与本机一致）");
        return;
      case "local-ahead":
        // 卡 B：有改动未进最新备份 → 不直接推旧包（云端永不创建备份），交用户二选一
        if (next.local?.backupStale === true) {
          get().openStaleDialog();
          return;
        }
        await get().push();
        return;
      case "remote-ahead": {
        const head = next.remote?.backups[0];
        if (head !== undefined) get().openPullConfirm(head);
        return;
      }
      case "conflict":
        get().openConflict();
        return;
    }
  },

  push: async (options = {}) => {
    if (get().busy !== null) return;
    // staleDialogOpen：用户在旧包确认框里选了「上传旧备份」→ 关框（与 pull 清 pullTarget 同款）
    set({ busy: "push", lastError: null, staleDialogOpen: false });
    try {
      const res = await pushCloudBackup(options.force === true ? { force: true } : {});
      await get().refresh();
      const prunedNote = res.pruned.length > 0 ? `，已清理云端 ${res.pruned.length} 份旧备份` : "";
      const snapshotNote =
        res.snapshot !== undefined ? `；云端原版本已存为本地备份 ${res.snapshot.fileName}` : "";
      useUiStore.getState().showToast(`已推送到云端（${formatBytes(res.pushed.size)}）${prunedNote}${snapshotNote}`);
      set({ conflictOpen: false });
    } catch (err) {
      const message = cloudErrorText(err, "无法连接服务，推送结果未确认（可能已在服务端执行）");
      set({ lastError: message });
      // 冲突（409）直接开裁决框：行内入口已由 `cloud-conflict-dialog` 取代（DESIGN.md §544）
      if (err instanceof ApiError && err.code === "CLOUD_CONFLICT") set({ conflictOpen: true });
      useUiStore.getState().showToast(message, "error");
    } finally {
      set({ busy: null });
    }
  },

  /**
   * 先备份再推送（卡 B 的「立即手动备份并推送」）：
   * `POST /project/backup`（新格式、统计为当下真实值）→ 再走既有 `push()`（含留档/冲突/失败处理）。
   * 备份失败只 toast（不推旧包——用户的意图是「推最新的」，不是「凑合推一份」）。
   */
  pushAfterFreshBackup: async () => {
    if (get().busy !== null) return;
    set({ staleDialogOpen: false, lastError: null });
    try {
      await createProjectBackup();
    } catch (err) {
      const message = cloudErrorText(err, "无法连接服务，备份结果未确认");
      set({ lastError: message });
      useUiStore.getState().showToast(message, "error");
      return;
    }
    await get().push();
  },

  pull: async (entry) => {
    if (get().busy !== null) return;
    set({ busy: "pull", pullTarget: null, lastError: null });
    try {
      const res = await pullCloudBackup(entry !== undefined ? { fileName: entry.fileName } : {});
      // 项目数据与 restore 同款刷新（服务端已重连 data.db）
      await Promise.all([useProjectStore.getState().loadConfig(), useProjectStore.getState().loadOutline()]);
      useChatStore.getState().clearSessions();
      void useChatStore.getState().loadSessions();
      useUiStore.getState().notifyDataChanged();
      await get().refresh();
      const { kept, written, removed } = res.merged;
      const mergeNote =
        kept > 0 || removed > 0
          ? `（本机独有保留 ${kept} 个、云端新增 ${written} 个、按云端删除 ${removed} 个文件）`
          : "";
      useUiStore
        .getState()
        .showToast(`已从云端拉取，覆盖前状态已自动快照（${res.snapshot.fileName}）${mergeNote}`);
      set({ conflictOpen: false });
    } catch (err) {
      const message = cloudErrorText(err, "无法连接服务，拉取结果未确认（可能已在服务端执行）");
      set({ lastError: message });
      useUiStore.getState().showToast(message, "error");
    } finally {
      set({ busy: null });
    }
  },

  /** 冲突裁决框「保留云端（拉取覆盖本机）」：**显式带上对话框里展示的那一份**（卡 C）——
   * 不能只写「拉取云端 head」：对话框与点击之间云端可能又多了新份，界面承诺要与实际动作一致 */
  pullConflictKeepCloud: async () => {
    // 与冲突框展示同一数据源（`status.remote.backups[0]`），不是「服务端当下 head」
    await get().pull(get().status?.remote?.backups[0]);
  },
  openPullConfirm: (entry) => set({ pullTarget: entry }),
  closePullConfirm: () => set({ pullTarget: null }),
  openConflict: () => set({ conflictOpen: true }),
  closeConflict: () => set({ conflictOpen: false }),
  openStaleDialog: () => set({ staleDialogOpen: true }),
  closeStaleDialog: () => set({ staleDialogOpen: false }),
  requestCloudPane: () => set({ pendingSettingsPane: "cloud" }),
  consumePendingPane: () => set({ pendingSettingsPane: null }),
}));
