// 设置页「高级 → 本机配置文件」编辑器（docs/design/tasks.md 卡 5）
//
// 不为每份 pi 配置做表单：整份 JSON 文本直编（JSON 的结构差异太大，表单会立刻变形为「半个 pi」）。
// 契约要点（docs/api/90-api-settings.md）：
// - 四份文件的白名单在 shared `CONFIG_FILE_NAMES`，展示登记在 `lib/config-files.ts`
// - 保存前服务端按 **pi 的读口径** 校验（models.json 宽容注释、auth/settings 严格、search.json 只认 apiKey），
//   失败 400 且不写盘；本组件必须保留用户输入并展示服务端文案
// - 明文凭据只在这个本机回环端点回传：文本框里就是原文，不做掩码（掩码挡不住响应体，只会挡住用户）
import { useEffect, useRef, useState } from "react";
import { Button, Input, Segmented } from "antd";
import type { ConfigFileName } from "@whispering233/ai-editor-shared/schemas";
import { ApiError, getConfigFile, saveConfigFile } from "../../lib/api";
import {
  fileDirty,
  fileEdited,
  fileFailed,
  fileLoaded,
  fileLoading,
  fileSaveFailed,
  fileSaved,
  stateOf,
  type FileState,
  type FileStateMap,
} from "../../lib/config-file-draft";
import { CONFIG_FILE_ENTRIES, configFileEntry } from "../../lib/config-files";
import { useRegisterDirty } from "../../hooks/use-leave-guard";
import { useUiStore } from "../../stores/ui";
import { SectionCard } from "../ui/section-card";

/** 拉取失败 / 网络错误的统一文案 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function ConfigFileEditor() {
  const showToast = useUiStore((s) => s.showToast);
  const [active, setActive] = useState<ConfigFileName>("auth.json");
  const [files, setFiles] = useState<FileStateMap>({});
  const [saving, setSaving] = useState(false);

  /** 只在读当前槽位时用它（不放进 effect 依赖，避免「拉取→setState→再拉取」的自激） */
  const filesRef = useRef<FileStateMap>(files);
  filesRef.current = files;

  const state = stateOf(files, active);
  const entry = configFileEntry(active);
  const dirty = fileDirty(state);
  // 离开守卫看**四个槽位全休**，不是当前槽位：切到别的槽再离开，前一个槽的草稿同样会丢
  useRegisterDirty(Object.values(files).some(fileDirty));

  /** 按名字更新一个槽位（函数式更新：并发保存/拉取不会互相覆盖） */
  function update(name: ConfigFileName, fn: (prev: FileState) => FileState): void {
    setFiles((prev) => ({ ...prev, [name]: fn(stateOf(prev, name)) }));
  }

  // 首次进入 / 上次拉取失败的槽位才去读；已经就绪的槽位不再重读（保留用户草稿）
  useEffect(() => {
    const slot = stateOf(filesRef.current, active);
    if (slot.status === "ready" || slot.status === "loading") return;
    update(active, fileLoading);
    let cancelled = false;
    void getConfigFile(active)
      .then((res) => {
        if (cancelled) return;
        update(active, (prev) => fileLoaded(prev, { exists: res.exists, content: res.content }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        update(active, (prev) => fileFailed(prev, messageOf(err, "读取失败，请重试")));
      });
    return () => {
      cancelled = true;
    };
    // 依赖只留 active：槽位状态经 filesRef 读，避免「拉取 → setState → 再拉取」的自激
  }, [active]);

  async function handleSave(): Promise<void> {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      await saveConfigFile(active, state.draft);
      update(active, fileSaved);
      showToast(`${active} 已保存，立即生效`);
    } catch (err) {
      // 400 = 校验失败（服务端文案已说明哪一行哪里不对）：保留输入，展示原文
      update(active, (prev) => fileSaveFailed(prev, messageOf(err, "保存失败，请重试")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="本机配置文件"
      action={
        <Button
          type="primary"
          size="small"
          loading={saving}
          disabled={!dirty || state.status !== "ready"}
          onClick={() => void handleSave()}
        >
          保存
        </Button>
      }
    >
      <Segmented
        block
        size="small"
        value={active}
        onChange={(value) => setActive(value as ConfigFileName)}
        options={CONFIG_FILE_ENTRIES.map((item) => ({ label: item.label, value: item.name }))}
      />
      <p className="mt-2 text-xs text-muted-foreground">{entry?.hint}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="font-mono text-muted-foreground">{active}</span>
        {state.status === "ready" && !state.exists && <span className="text-muted-foreground">文件不存在，保存即创建</span>}
        {dirty && <span className="text-muted-foreground">未保存</span>}
      </div>
      {/* 等宽与内距挂外层（antd 根元素上的 class 会被它后注入的无层 CSS 压掉，见 design-discipline 守卫） */}
      <div className="mt-2 font-mono text-xs">
        <Input.TextArea
          value={state.draft}
          rows={14}
          spellCheck={false}
          disabled={state.status !== "ready"}
          placeholder={state.status === "ready" ? "" : "读取中…"}
          onChange={(e) => update(active, (prev) => fileEdited(prev, e.target.value))}
          aria-label={`${active} 内容`}
        />
      </div>
      {state.error !== null && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        凭据以明文存在这些文件里（只在本机回传，不进日志 / 备份 / 云端）。保存后立即生效，不需要重启。
      </p>
    </SectionCard>
  );
}