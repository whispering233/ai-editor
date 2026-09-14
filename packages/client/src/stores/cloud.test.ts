// `stores/cloud.ts` 测试（卡 6）：一键状态机的分支判定 + 角标三态 + 不轮询/并发合并
//
// 契约：`docs/ui/DESIGN.md` §538（角标只在三种状态亮；点击 = 一键状态机；不做轮询）、
// `docs/design/40-cloud-sync.md` §3（三态流转）、`docs/api/100-api-cloud.md`（信封与错误码）。
// mock 方式与 `stores/project.test.ts` 一致：部分 mock `lib/api`（ApiError 保持真实实现）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudStatus, CloudSyncState } from "@whispering233/ai-editor-shared";
import { ApiError } from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    createProjectBackup: vi.fn(),
    getCloudStatus: vi.fn(),
    getProjectBackups: vi.fn(),
    pushCloudBackup: vi.fn(),
    pullCloudBackup: vi.fn(),
  };
});
vi.mock("../hooks/use-route", () => ({ navigate: vi.fn() }));

import {
  createProjectBackup as apiCreateProjectBackup,
  getCloudStatus as apiGetCloudStatus,
  getProjectBackups as apiGetProjectBackups,
  pullCloudBackup as apiPullCloudBackup,
  pushCloudBackup as apiPushCloudBackup,
} from "../lib/api";
import { navigate } from "../hooks/use-route";
import { cloudBadgeTone, useCloudStore } from "./cloud";
import { useUiStore } from "./ui";

/** 造一份状态快照（只有 state 是断言关心的；其余字段给合法空值） */
function status(
  state: CloudSyncState,
  extra: Partial<CloudStatus> = {},
  local: { backupStale?: boolean } = {},
): CloudStatus {
  return {
    configured: state !== "unconfigured",
    autoPush: false,
    state,
    local: {
      lastPushedFileName: null,
      lastSyncAt: null,
      dirty: state === "local-ahead" || state === "conflict",
      latestBackupFileName: "20260915-013215757-手动-验证机-人物0-设定0-章0.zip",
      backupStale: local.backupStale === true,
    },
    ...extra,
  } as CloudStatus;
}

const REMOTE_ENTRY = {
  fileName: "20260915-013215757-手动-验证机-人物3-设定0-章12.zip",
  createdAt: "2026-09-14T17:32:15.757Z",
  kind: "manual" as const,
  device: "验证机",
  stats: { characters: 3, settings: 0, chapters: 12 },
  size: 2392,
};

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ toast: null });
  useCloudStore.setState({
    status: null,
    statusFailed: false,
    localLatest: null,
    busy: null,
    lastError: null,
    conflictOpen: false,
    pullTarget: null,
    pendingSettingsPane: null,
    staleDialogOpen: false,
    localLatestUnavailable: false,
  });
  vi.mocked(apiGetProjectBackups).mockResolvedValue({ backups: [] });
});

describe("cloudBadgeTone：角标只在三种状态亮", () => {
  it("conflict = error；local-ahead / remote-ahead = warning；其余（含 unreachable/未读到）不亮", () => {
    expect(cloudBadgeTone(status("conflict"))).toBe("error");
    expect(cloudBadgeTone(status("local-ahead"))).toBe("warning");
    expect(cloudBadgeTone(status("remote-ahead"))).toBe("warning");
    // unreachable 明确不亮（离线可用底线：角标不常亮、不弹窗）
    expect(cloudBadgeTone(status("unreachable"))).toBeNull();
    expect(cloudBadgeTone(status("synced"))).toBeNull();
    expect(cloudBadgeTone(status("unconfigured"))).toBeNull();
    expect(cloudBadgeTone(status("no-project"))).toBeNull();
    expect(cloudBadgeTone(null)).toBeNull();
  });
});

describe("refresh：并发合并 + 失败态", () => {
  it("同一时刻的并发 refresh 只发一次请求（不轮询的前提）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    const [a, b] = await Promise.all([useCloudStore.getState().refresh(), useCloudStore.getState().refresh()]);
    expect(apiGetCloudStatus).toHaveBeenCalledTimes(1);
    expect(a?.state).toBe("synced");
    expect(b?.state).toBe("synced");
  });

  it("请求失败 → 返回 null 且 statusFailed=true（角标不亮，面板提示重试）", async () => {
    vi.mocked(apiGetCloudStatus).mockRejectedValue(new ApiError("CLIENT_NETWORK_ERROR", "网络不可用"));
    const next = await useCloudStore.getState().refresh();
    expect(next).toBeNull();
    expect(useCloudStore.getState().statusFailed).toBe(true);
    expect(cloudBadgeTone(useCloudStore.getState().status)).toBeNull();
  });
});

describe("syncNow：点击时的一键分派", () => {
  it("已同步 → 只提示（不推送、不拉取、不弹窗）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    await useCloudStore.getState().syncNow();
    expect(apiPushCloudBackup).not.toHaveBeenCalled();
    expect(apiPullCloudBackup).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast?.text).toContain("已是最新");
  });

  it("未配置 → 设置页意图置位 + 跳 /preferences（选中态不进 URL，由 store 下传）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("unconfigured", { configured: false }));
    await useCloudStore.getState().syncNow();
    expect(useCloudStore.getState().pendingSettingsPane).toBe("cloud");
    expect(vi.mocked(navigate)).toHaveBeenCalledWith("/preferences");
    expect(apiPushCloudBackup).not.toHaveBeenCalled();
  });

  it("本机有改动 → 直接推送（缺省最新一份）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("local-ahead"));
    vi.mocked(apiPushCloudBackup).mockResolvedValue({
      pushed: { fileName: "b.zip", size: 1024 },
      remote: { dirName: "书-proj-x", headFileName: "b.zip" },
      pruned: [],
    } as Awaited<ReturnType<typeof apiPushCloudBackup>>);
    await useCloudStore.getState().syncNow();
    expect(apiPushCloudBackup).toHaveBeenCalledWith({});
    expect(useUiStore.getState().toast?.text).toContain("已推送到云端");
  });

  it("云端有更新 → 打开拉取确认框（不直接拉）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(
      status("remote-ahead", { remote: { dirName: "书-proj-x", backups: [REMOTE_ENTRY] } }),
    );
    await useCloudStore.getState().syncNow();
    expect(useCloudStore.getState().pullTarget?.fileName).toBe(REMOTE_ENTRY.fileName);
    expect(apiPullCloudBackup).not.toHaveBeenCalled();
  });

  it("冲突 → 打开裁决框（两条路都不自动走）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(
      status("conflict", { remote: { dirName: "书-proj-x", backups: [REMOTE_ENTRY] } }),
    );
    await useCloudStore.getState().syncNow();
    expect(useCloudStore.getState().conflictOpen).toBe(true);
    expect(apiPullCloudBackup).not.toHaveBeenCalled();
    expect(apiPushCloudBackup).not.toHaveBeenCalled();
  });

  it("云端不可达 → 只 toast（强调本地不受影响；不弹窗、角标不亮）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("unreachable", { errorCode: "CLOUD_UNREACHABLE" }));
    await useCloudStore.getState().syncNow();
    expect(useStoreToast()).toContain("本地功能不受影响");
    expect(useCloudStore.getState().conflictOpen).toBe(false);
    expect(useCloudStore.getState().pullTarget).toBeNull();
    expect(cloudBadgeTone(useCloudStore.getState().status)).toBeNull();
  });
});

describe("push / pull：失败态与裁决框归位", () => {
  it("推送冲突（409 CLOUD_CONFLICT）→ 打开裁决框 + 行内错误文案落 store", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("conflict"));
    vi.mocked(apiPushCloudBackup).mockRejectedValue(
      new ApiError("CLOUD_CONFLICT", "云端已有更新的备份（x.zip）——请先拉取查看，或选择用本机覆盖云端"),
    );
    await useCloudStore.getState().push();
    expect(useCloudStore.getState().conflictOpen).toBe(true);
    expect(useCloudStore.getState().lastError).toContain("云端已有更新的备份");
    expect(useCloudStore.getState().busy).toBeNull();
  });

  it("强推成功后裁决框归位（云端仍有更晚他机份时角标会再亮 → 允许再次强推）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("conflict"));
    vi.mocked(apiPushCloudBackup).mockResolvedValue({
      pushed: { fileName: "b.zip", size: 1024 },
      remote: { dirName: "书-proj-x", headFileName: "b.zip" },
      pruned: [],
      snapshot: { fileName: "20260915-013216970-自动-验证机-人物0-设定0-章0.zip" },
    } as Awaited<ReturnType<typeof apiPushCloudBackup>>);
    useCloudStore.setState({ conflictOpen: true });
    await useCloudStore.getState().push({ force: true });
    expect(apiPushCloudBackup).toHaveBeenCalledWith({ force: true });
    expect(useCloudStore.getState().conflictOpen).toBe(false);
    // 留档文件名回显（债 5：两条路都要说明「另一边留档在哪」）
    expect(useStoreToast()).toContain("20260915-013216970-自动-验证机-人物0-设定0-章0.zip");
  });

  it("拉取：成功后刷项目数据 + 回显留档文件名 + 清空待确认目标", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    vi.mocked(apiPullCloudBackup).mockResolvedValue({
      pulled: REMOTE_ENTRY,
      snapshot: { fileName: "20260915-013217008-自动-验证机-人物0-设定0-章0.zip" },
      merged: { kept: 1, written: 1, removed: 1 },
    } as Awaited<ReturnType<typeof apiPullCloudBackup>>);
    useCloudStore.setState({ pullTarget: REMOTE_ENTRY as never });
    await useCloudStore.getState().pull(REMOTE_ENTRY as never);
    expect(apiPullCloudBackup).toHaveBeenCalledWith({ fileName: REMOTE_ENTRY.fileName });
    expect(useCloudStore.getState().pullTarget).toBeNull();
    expect(useStoreToast()).toContain("20260915-013217008-自动-验证机-人物0-设定0-章0.zip");
    expect(useStoreToast()).toContain("本机独有保留 1 个");
  });

  it("在途动作互斥：push 进行中再点 pull 不重复发请求", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    let release: (() => void) | null = null;
    vi.mocked(apiPullCloudBackup).mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve({ pulled: REMOTE_ENTRY, snapshot: { fileName: "s.zip" }, merged: { kept: 0, written: 0, removed: 0 } } as never);
      }),
    );
    const first = useCloudStore.getState().pull(REMOTE_ENTRY as never);
    await Promise.resolve();
    await useCloudStore.getState().pull(REMOTE_ENTRY as never);
    expect(apiPullCloudBackup).toHaveBeenCalledTimes(1);
    release?.();
    await first;
  });
});

describe("卡 B：有改动未进最新备份（backupStale）", () => {
  it("local-ahead + backupStale → 点同步云端**不直接推**，改弹旧包确认框", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("local-ahead", {}, { backupStale: true }));
    await useCloudStore.getState().syncNow();
    expect(useCloudStore.getState().staleDialogOpen).toBe(true);
    expect(apiPushCloudBackup).not.toHaveBeenCalled();
    expect(useCloudStore.getState().conflictOpen).toBe(false);
  });

  it("synced + backupStale（推过旧包的典型形态）→ 不谎报「已是最新」，改弹旧包确认框", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced", {}, { backupStale: true }));
    await useCloudStore.getState().syncNow();
    expect(useCloudStore.getState().staleDialogOpen).toBe(true);
    expect(useStoreToast()).not.toContain("已是最新");
  });

  it("backupStale=false 时行为与现状一致（local-ahead 直接推、synced 只提示）", async () => {
    vi.mocked(apiPushCloudBackup).mockResolvedValue({
      pushed: { fileName: "b.zip", size: 1 },
      remote: { dirName: "d", headFileName: "b.zip" },
      pruned: [],
    } as Awaited<ReturnType<typeof apiPushCloudBackup>>);
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("local-ahead"));
    await useCloudStore.getState().syncNow();
    expect(apiPushCloudBackup).toHaveBeenCalledTimes(1);
    expect(useCloudStore.getState().staleDialogOpen).toBe(false);

    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    await useCloudStore.getState().syncNow();
    expect(useStoreToast()).toContain("已是最新");
  });

  it("「立即手动备份并推送」= 先 POST /project/backup 再推送", async () => {
    vi.mocked(apiCreateProjectBackup).mockResolvedValue({ backup: {} } as Awaited<ReturnType<typeof apiCreateProjectBackup>>);
    vi.mocked(apiPushCloudBackup).mockResolvedValue({
      pushed: { fileName: "b.zip", size: 1 },
      remote: { dirName: "d", headFileName: "b.zip" },
      pruned: [],
    } as Awaited<ReturnType<typeof apiPushCloudBackup>>);
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    useCloudStore.setState({ staleDialogOpen: true });

    await useCloudStore.getState().pushAfterFreshBackup();

    expect(apiCreateProjectBackup).toHaveBeenCalledTimes(1);
    expect(apiPushCloudBackup).toHaveBeenCalledTimes(1);
    expect(useCloudStore.getState().staleDialogOpen).toBe(false);
  });

  it("备份失败时不推旧包（用户的意图是「推最新的」），只 toast 错误", async () => {
    vi.mocked(apiCreateProjectBackup).mockRejectedValue(new ApiError("VALIDATION_ERROR", "备份名称非法"));
    useCloudStore.setState({ staleDialogOpen: true });
    await useCloudStore.getState().pushAfterFreshBackup();
    expect(apiPushCloudBackup).not.toHaveBeenCalled();
    expect(useStoreToast()).toContain("备份名称非法");
    expect(useCloudStore.getState().staleDialogOpen).toBe(false);
  });

  it("「上传旧备份」= 直接走既有 push（不带 force）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("local-ahead"));
    vi.mocked(apiPushCloudBackup).mockResolvedValue({
      pushed: { fileName: "b.zip", size: 1 },
      remote: { dirName: "d", headFileName: "b.zip" },
      pruned: [],
    } as Awaited<ReturnType<typeof apiPushCloudBackup>>);
    useCloudStore.setState({ staleDialogOpen: true });
    await useCloudStore.getState().push();
    expect(apiCreateProjectBackup).not.toHaveBeenCalled();
    expect(apiPushCloudBackup).toHaveBeenCalledWith({});
    expect(useCloudStore.getState().staleDialogOpen).toBe(false);
  });

  it("clearStatus 一并收掉对话框状态与跨页意图（切书不残留）", () => {
    useCloudStore.setState({ conflictOpen: true, pullTarget: {} as never, staleDialogOpen: true, pendingSettingsPane: "cloud" });
    useCloudStore.getState().clearStatus();
    const s = useCloudStore.getState();
    expect([s.conflictOpen, s.pullTarget, s.staleDialogOpen, s.pendingSettingsPane]).toEqual([false, null, false, null]);
  });
});

describe("卡 C：busy 归属 / 冲突框带份 / 读取失败区分 / 宿主上移", () => {
  it("refresh 在 push 在途时不抢也不清 busy（谁设的谁清）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    // 模拟 push 在途：busy 已由 push 设为 "push"
    useCloudStore.setState({ busy: "push" });
    await useCloudStore.getState().refresh();
    expect(useCloudStore.getState().busy).toBe("push"); // 未被 refresh 清掉
  });

  it("refresh 自己设的 busy 在结束后归位", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    useCloudStore.setState({ busy: null });
    await useCloudStore.getState().refresh();
    expect(useCloudStore.getState().busy).toBeNull();
  });

  it("冲突框「保留云端」拉取的是**框里展示的那一份**（不是服务端当下 head）", async () => {
    const shown = { ...REMOTE_ENTRY, fileName: "20260915-013216970-手动-验证机-人物0-设定0-章0.zip" };
    useCloudStore.setState({
      status: status("conflict", { remote: { dirName: "d", backups: [shown] } }),
      conflictOpen: true,
    });
    vi.mocked(apiPullCloudBackup).mockResolvedValue({
      pulled: shown,
      snapshot: { fileName: "s.zip" },
      merged: { kept: 0, written: 0, removed: 0 },
    } as Awaited<ReturnType<typeof apiPullCloudBackup>>);
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));

    await useCloudStore.getState().pullConflictKeepCloud();

    expect(apiPullCloudBackup).toHaveBeenCalledWith({ fileName: shown.fileName });
  });

  it("本机份列表读取失败 → localLatestUnavailable=true（与「真的没有备份」区分）", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    vi.mocked(apiGetProjectBackups).mockRejectedValue(new ApiError("INTERNAL_ERROR", "读目录失败"));
    await useCloudStore.getState().refresh();
    expect(useCloudStore.getState().localLatestUnavailable).toBe(true);
    expect(useCloudStore.getState().localLatest).toBeNull();
  });

  it("本机确实没有备份（列表读得到但为空）→ unavailable=false", async () => {
    vi.mocked(apiGetCloudStatus).mockResolvedValue(status("synced"));
    vi.mocked(apiGetProjectBackups).mockResolvedValue({ backups: [] });
    await useCloudStore.getState().refresh();
    expect(useCloudStore.getState().localLatestUnavailable).toBe(false);
    expect(useCloudStore.getState().localLatest).toBeNull();
  });
});

/** toast 文案（`ui` store 的 toast 快照） */
function useStoreToast(): string {
  return useUiStore.getState().toast?.text ?? "";
}
