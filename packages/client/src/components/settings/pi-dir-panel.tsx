// 设置页「高级 → pi 配置目录」（docs/design/tasks.md 卡 4；契约见 docs/api/90-api-settings.md）
//
// 一个值一件事：当前生效目录（可编辑）+ 缺省目录（「恢复默认」= 原样 PUT 缺省值）。
// 保存即生效（服务端重建 pi 实例），不重启应用；有在途对话时服务端 409，文案直接呈现。
import { useEffect, useState } from "react";
import { Button, Input } from "antd";
import { ApiError, getPiConfigDir, setPiConfigDir } from "../../lib/api";
import { desktopBridge } from "../../lib/desktop";
import { useUiStore } from "../../stores/ui";
import { SectionCard } from "../ui/section-card";

export function PiDirPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const bridge = desktopBridge();
  /** 生效目录（服务端值）；null = 加载中或读取失败 */
  const [dir, setDir] = useState<string | null>(null);
  /** 缺省目录（「恢复默认」用的值） */
  const [defaultDir, setDefaultDir] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getPiConfigDir()
      .then((res) => {
        setDir(res.dir);
        setDefaultDir(res.defaultDir);
        setDraft(res.dir);
      })
      .catch(() => showToast("读取 pi 配置目录失败", "error"));
  }, [showToast]);

  async function save(next: string): Promise<void> {
    const trimmed = next.trim();
    if (trimmed === "" || saving) return;
    setSaving(true);
    try {
      const res = await setPiConfigDir(trimmed);
      setDir(res.dir);
      setDraft(res.dir);
      showToast("已切换 pi 配置目录，立即生效");
    } catch (err) {
      // 409 = 当前项目有在途对话（服务端拒绝换目录，会话运行时不能中途重建）
      showToast(err instanceof ApiError ? err.message : "保存失败，请重试", "error");
    } finally {
      setSaving(false);
    }
  }

  /** 桌面版「浏览…」：原生选目录 → 只填输入框，不自动保存（换目录由用户按「保存」确认） */
  async function browse(): Promise<void> {
    if (bridge === null) return;
    const picked = await bridge.pickDirectory();
    if (picked !== null && picked !== "") setDraft(picked);
  }

  const dirty = dir !== null && draft.trim() !== dir;

  return (
    <SectionCard
      title="pi 配置目录"
      action={
        <Button
          type="primary"
          size="small"
          loading={saving}
          disabled={!dirty || draft.trim() === ""}
          onClick={() => void save(draft)}
        >
          保存
        </Button>
      }
    >
      {/* 弹性宽度挂外层：antd Input 会给自身注入 min-width: 0（见 AGENTS.md） */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={() => void save(draft)}
            placeholder="加载中…"
            aria-label="pi 配置目录"
          />
        </div>
        {bridge !== null && (
          <Button size="small" disabled={saving} onClick={() => void browse()}>
            浏览…
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="small"
          disabled={defaultDir === null || saving || draft === defaultDir}
          onClick={() => {
            if (defaultDir !== null) {
              setDraft(defaultDir);
              void save(defaultDir);
            }
          }}
        >
          恢复默认
        </Button>
        <span className="text-xs text-muted-foreground">
          默认：{defaultDir ?? "…"}（与 pi CLI 的 ~/.pi/agent 相互隔离）
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        凭据、模型目录、运行参数都存在这个目录里；换目录后模型与凭据立即从新目录读取。目录不存在会自动创建。
      </p>
    </SectionCard>
  );
}