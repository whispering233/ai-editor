// Ctrl+S 存档阶段契约测试：节流窗口、失败不推进基准、在途不重入。
import { describe, expect, it, vi } from "vitest";
import { createShortcutArchive, SHORTCUT_BACKUP_THROTTLE_MINUTES } from "./shortcut-archive";

const THROTTLE_MS = SHORTCUT_BACKUP_THROTTLE_MINUTES * 60_000;

describe("快捷键存档节流", () => {
  it("首次生成；窗口内跳过（含窗口前一毫秒）；窗口到点后再生成", async () => {
    const archive = createShortcutArchive();
    let now = 1_000;
    const createBackup = vi.fn(async () => {});
    const deps = { createBackup, now: () => now };

    expect(await archive.run(deps)).toEqual({ status: "archived" });
    expect(await archive.run(deps)).toEqual({ status: "skipped" });

    now += THROTTLE_MS - 1;
    expect(await archive.run(deps)).toEqual({ status: "skipped" });

    now += 1;
    expect(await archive.run(deps)).toEqual({ status: "archived" });
    expect(createBackup).toHaveBeenCalledTimes(2);
  });

  it("失败不推进节流基准：同一时间点也能立刻重试", async () => {
    const archive = createShortcutArchive();
    const createBackup = vi.fn(async (): Promise<void> => {
      throw new Error("boom");
    });
    const deps = { createBackup, now: () => 0 };

    const failed = await archive.run(deps);
    expect(failed.status).toBe("failed");

    createBackup.mockImplementation(async () => {});
    expect(await archive.run(deps)).toEqual({ status: "archived" });
  });

  it("在途不重入（第二次 busy）；完成后按节流继续判定", async () => {
    const archive = createShortcutArchive();
    let now = 0;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const createBackup = vi.fn(() => gate);
    const deps = { createBackup, now: () => now };

    const first = archive.run(deps);
    expect(await archive.run(deps)).toEqual({ status: "busy" });

    release();
    expect(await first).toEqual({ status: "archived" });
    expect(await archive.run(deps)).toEqual({ status: "skipped" }); // 基准已推进

    now += THROTTLE_MS;
    expect(await archive.run(deps)).toEqual({ status: "archived" });
  });
});
