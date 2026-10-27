// 「自动推送」区的条件提示（DESIGN.md `cloud-backup-panel`）：开着自动推送但备份频率为「关闭」时，
// 开关下多一行提示——只提示，不弹窗、不禁用开关。
// 渲染手法同 InfoBar.test / chat-panel.test（仓内无 jsdom/@testing-library 纪律，用 react-dom/server）：
// SSR 下 zustand 取 getInitialState()，故用 Object.assign 预置初值（SSR 不跑 effect，无需 mock 请求）。
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { CloudBackupPanel } from "./cloud-backup-panel";
import { useCloudStore } from "../../stores/cloud";
import { useProjectStore } from "../../stores/project";

const HINT = "当前自动备份频率为「关闭」→ 自动推送不会触发（至少选一个备份频率）";

/** SSR 预置：云盘已配置（否则开关被禁用） + 指定 autoPush 与备份频率 */
function render(autoPush: boolean, backupFrequencyMinutes: number | null): string {
  Object.assign(useCloudStore.getInitialState(), {
    status: {
      configured: true,
      url: "https://dav.example.com/dav",
      username: "u",
      device: "本机",
      deviceConfigured: false,
      autoPush,
      projectId: "proj-1",
      remote: null,
      local: null,
      state: "unconfigured" as const,
    },
  });
  Object.assign(useProjectStore.getInitialState(), {
    config: {
      id: "proj-1",
      name: "青云记",
      language: "zh" as const,
      kind: "novel" as const,
      authorId: null,
      schemaVersion: 1,
      currentPosition: null,
      deductionNodes: [],
      backupFrequencyMinutes,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    },
  });
  return renderToString(<CloudBackupPanel />);
}

afterEach(() => {
  Object.assign(useCloudStore.getInitialState(), { status: null });
  Object.assign(useProjectStore.getInitialState(), { config: null });
});

describe("CloudBackupPanel · 自动推送条件提示", () => {
  it("自动推送开 + 备份频率为「关闭」→ 显示提示行（说明行同时写明随频率触发）", () => {
    const html = render(true, null);

    expect(html).toContain(HINT);
    expect(html).toContain("随自动备份频率触发：创作数据（正文数据、大纲、参考资料、项目规则）有变更");
    expect(html).toContain("备份频率关闭时不会自动推送");
  });

  it("备份频率已选 → 不显示提示行", () => {
    expect(render(true, 10)).not.toContain(HINT);
  });

  it("自动推送关 → 不显示提示行（频率关闭也不提示：没有在等它干活）", () => {
    expect(render(false, null)).not.toContain(HINT);
  });
});
