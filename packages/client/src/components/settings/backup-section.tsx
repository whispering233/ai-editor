// 设置页「自动备份」区（B2 决策 27 + B2.5 决策 28 + B2.6 决策 29；doc/ui/pages/settings.md「自动备份」区）
// 交互（settings.md「关键交互」+ 任务卡 B2.4/B2.5/B2.6）：
//  - 频率下拉：选择即保存 PUT /project/config { backup_frequency_minutes }（null = 关闭，
//    仅枚举 5/10/15/30/60）；载入用 config.backupFrequencyMinutes（缺省 10 / null → 关闭选中）
//  - [备份名称（可选）输入框] + [立即备份]：POST /project/backup（带 name，决策 28）→
//    清空输入 + 刷新列表 + toast「已备份」；失败 toast（磁盘错误透传 message）
//  - 历史备份列表：GET /project/backups → 行 = 时间（当年 MM-DD HH:mm:ss / 跨年 YY-MM-DD
//    HH:mm:ss，决策 28 补秒）+ 类型标签（决策 29：自动=中性徽标 / 手动=强调徽标）+ 自定义
//    名称（如有）+ 大小（KB/MB 人类可读）+ [重命名] [加载]
//  - [重命名]（决策 29 行内编辑，无 Dialog）：铅笔按钮 → 该行切编辑态（行内 input 预填当前
//    名称 + 确认/取消按钮）；Enter/确认提交 POST /project/backup/rename（空输入 = 清除名称段）、
//    Esc/失焦取消、输入未变更不发请求（幂等保护）；400/404 行内错误提示并保持编辑态，成功
//    toast「已重命名」+ 刷新列表
//  - [加载] → 强确认 Dialog（ConfirmDialog，danger）→ POST /project/backup/restore → 成功 toast
//    （含覆盖前自动快照文件名）→ 刷新 config/outline（dataVersion 信号驱动中栏数据页）+ 会话重载
//    （chat store 订阅仅响应 config.id 变化，restore 保留 id → 手动 clearSessions + loadSessions）；
//    409 SCHEMA_VERSION_MISMATCH（备份来自更高版本）→ ConfirmDialog 内阻断提示（透传服务端 message）
//  - 空态：「暂无备份，自动备份将在数据变更后按频率生成」；无项目打开 → 整区禁用 + 引导文案
// 风格约束：token 类（bg-muted/border-border/text-muted-foreground 等），禁硬编码色类（layout.md §3）
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { ApiError, CLIENT_NETWORK_ERROR, createProjectBackup, getProjectBackups, renameProjectBackup, restoreProjectBackup, type BackupEntry } from "../../lib/api";
import { BACKUP_FREQUENCY_OPTIONS, BACKUP_KIND_LABELS, formatBackupTime, formatBytes } from "../../lib/backup";
import { MAX_BACKUP_NAME_LENGTH } from "@whispering233/ai-editor-shared";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";
import { useChatStore } from "../../stores/chat";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../outline/dialogs";

/**
 * 备份列表请求序号（模块级，仿 chat store loadSeq 模式——P2-1 代际守卫）：
 * 每次发请求递增；响应落地时校验序号未变才写入列表，项目已切换/关闭的在途响应直接丢弃，
 * 避免「关项目后旧响应落地覆盖新列表 / 切项目后闪现旧项目数据」的竞态
 */
let backupListSeq = 0;

export function BackupSection() {
  const showToast = useUiStore((s) => s.showToast);
  const showError = useUiStore((s) => s.showError);
  const notifyDataChanged = useUiStore((s) => s.notifyDataChanged);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const updateConfig = useProjectStore((s) => s.updateConfig);
  const loadConfig = useProjectStore((s) => s.loadConfig);
  const loadOutline = useProjectStore((s) => s.loadOutline);

  /** 频率保存中（选择即保存；保存中禁用下拉防连点） */
  const [frequencySaving, setFrequencySaving] = useState(false);
  /** 备份列表；null = 未加载/加载失败 */
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [backupsLoading, setBackupsLoading] = useState(false);
  /** 列表加载失败的错误码（CLIENT_NETWORK_ERROR 等；null = 无错误/未加载） */
  const [backupsError, setBackupsError] = useState<string | null>(null);
  const [backupNowRunning, setBackupNowRunning] = useState(false);
  /** 待加载的备份（非 null 时渲染强确认 Dialog） */
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);
  /** 立即备份的自定义名称（决策 28；trim 后非空才随请求提交，成功后清空） */
  const [backupName, setBackupName] = useState("");
  /**
   * 行内重命名编辑态（决策 29，单行同时编辑；null = 无编辑中）：
   * fileName = 目标备份；value = 输入框当前值（预填 b.name ?? ""）；
   * saving = 提交中（禁用输入/按钮防连点）；error = 行内错误提示（400/404 透传 message，网络失败固定文案）
   */
  const [renaming, setRenaming] = useState<{ fileName: string; value: string; saving: boolean; error: string | null } | null>(null);
  /**
   * renaming 最新值镜像（渲染时同步，oracle P1-2）：
   * onBlur 守卫与 catch 兜底需要读「当前」而非事件绑定时闭包快照——saving 置位后 input 被
   * disabled，浏览器对持有焦点的禁用元素自动触发 blur，此时必须能读到 saving 已为 true
   */
  const renamingRef = useRef(renaming);
  renamingRef.current = renaming;

  /** 拉取备份列表（仅项目打开时有效；无项目 → 直接返回防 409 NO_PROJECT_OPEN 误报）；
   *  代际守卫：响应落地时校验请求序号未变（关项目/切项目时在途响应丢弃，P2-1） */
  async function loadBackups() {
    if (useProjectStore.getState().config === null) return;
    const seq = ++backupListSeq;
    setBackupsLoading(true);
    setBackupsError(null);
    try {
      const res = await getProjectBackups();
      if (seq !== backupListSeq) return; // 请求期间项目已切换/关闭，旧列表作废
      setBackups(res.backups);
    } catch (err) {
      if (seq !== backupListSeq) return;
      const code = err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR;
      setBackupsError(code);
    } finally {
      if (seq === backupListSeq) setBackupsLoading(false);
    }
  }

  // 项目身份驱动：切项目（id 变化）→ 重拉列表；关闭项目（null）→ 清空 + 作废在途请求 + 关闭残留确认框。
  // prevProjectId 初始 null：挂载时项目已打开（store 缓存）也能触发首载
  const projectId = config?.id ?? null;
  const prevProjectId = useRef<string | null>(null);
  useEffect(() => {
    if (projectId === null) {
      backupListSeq++; // 作废在途列表请求（关项目时丢弃旧响应，防闪旧数据）
      setBackups(null);
      setBackupsError(null);
      setRestoreTarget(null);
      setRenaming(null); // 关项目同时退出行内重命名编辑态
      prevProjectId.current = null;
      return;
    }
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId;
      void loadBackups();
    }
  }, [projectId]);

  /** 频率选择即保存（决策 27：null = 关闭；select 受控值回弹由 store config 重拉保证） */
  async function handleFrequencyChange(raw: string) {
    if (config === null) return;
    const value = raw === "null" ? null : Number(raw);
    if (value === config.backupFrequencyMinutes) return; // 防重复提交
    setFrequencySaving(true);
    try {
      await updateConfig({ backup_frequency_minutes: value });
      showToast(value === null ? "已关闭自动备份" : `自动备份频率已设为每 ${value} 分钟`);
    } catch (err) {
      if (err instanceof ApiError && err.code === CLIENT_NETWORK_ERROR) {
        showError("CLIENT_NETWORK_ERROR", "无法连接服务，频率未保存");
      } else {
        showToast("频率保存失败，请重试", "error");
      }
    } finally {
      setFrequencySaving(false);
    }
  }

  /** 立即备份：成功刷新列表（新条目在顶部）+ toast；失败 toast（磁盘错误透传服务端 message） */
  async function handleBackupNow() {
    if (config === null || backupNowRunning) return;
    setBackupNowRunning(true);
    try {
      const name = backupName.trim();
      await createProjectBackup(name.length > 0 ? name : undefined); // 决策 28：空输入不传 name
      setBackupName(""); // 成功后清空（同频率下拉「选择即保存」惯例）
      showToast(name.length > 0 ? `已备份「${name}」` : "已备份");
      await loadBackups();
    } catch (err) {
      showToast(
        err instanceof ApiError && err.code !== CLIENT_NETWORK_ERROR
          ? err.message
          : "无法连接服务，备份失败",
        "error",
      );
    } finally {
      setBackupNowRunning(false);
    }
  }

  /**
   * 加载备份（强确认通过后）：restore → toast（含覆盖前快照文件名）→ 刷新项目数据：
   * config/outline 重拉（中栏数据页经 dataVersion 信号重拉）+ 会话重载（chat store 订阅
   * 仅响应 config.id 变化，restore 保留 id → 手动 clearSessions + loadSessions）；
   * 失败（409 SCHEMA_VERSION_MISMATCH 等）抛给 ConfirmDialog 显示并保持打开
   */
  async function handleRestore() {
    if (restoreTarget === null) return;
    const res = await restoreProjectBackup(restoreTarget.fileName);
    showToast(`已恢复备份，覆盖前状态已自动快照（${res.snapshot.fileName}）`);
    await Promise.all([loadConfig(), loadOutline()]);
    notifyDataChanged();
    useChatStore.getState().clearSessions();
    void useChatStore.getState().loadSessions();
    void loadBackups(); // 顶部出现覆盖前自动快照
  }

  /**
   * 行内重命名提交（决策 29）：
   * - 幂等保护：输入 trim 后与原名称一致 → 不发请求直接退出编辑态
   * - 空输入 = 清除名称段（renameProjectBackup 收到空串/undefined → body 传 { name: "" }）
   * - 成功：退出编辑态 + toast + 刷新列表（backupListSeq 代际守卫在 loadBackups 内）；
   *   400/404：行内错误提示（透传服务端 message），保持编辑态；网络失败：行内固定文案
   * - 失败兜底（oracle P1-2）：saving 期间 input 被 disabled 触发的 blur 已被 onBlur 守卫挡住，
   *   正常流程行内错误必有挂点；但若编辑态被其他路径清掉（如提交中关项目），catch 读 ref 兜底
   *   toast，保证失败必有反馈（toast 放 updater 外，避免 StrictMode 下 updater 双执行的副作用）
   */
  async function handleRenameSubmit() {
    if (renaming === null || renaming.saving) return;
    const originalName = backups?.find((b) => b.fileName === renaming.fileName)?.name ?? "";
    const trimmed = renaming.value.trim();
    if (trimmed === originalName) {
      setRenaming(null); // 未变更：视为取消，不发请求
      return;
    }
    setRenaming({ ...renaming, saving: true, error: null });
    try {
      await renameProjectBackup(renaming.fileName, renaming.value);
      setRenaming(null);
      showToast(trimmed.length > 0 ? `已重命名「${trimmed}」` : "已清除备份名称");
      await loadBackups();
    } catch (err) {
      const message =
        err instanceof ApiError && err.code !== CLIENT_NETWORK_ERROR
          ? err.message
          : "无法连接服务，重命名失败";
      if (renamingRef.current === null) {
        // 编辑态已被清掉（行内错误无处可挂）→ 兜底 toast，避免静默失败
        showToast(message, "error");
        return;
      }
      setRenaming((r) => (r === null ? r : { ...r, saving: false, error: message }));
    }
  }

  /** 频率下拉选中值：缺省 10 → 「每 10 分钟」；null → 关闭；非枚举脏值（旧数据手工写入，读侧
   *  原样透传）→ 归为关闭——与服务端定时器 resolveBackupFrequency（非枚举 = 关闭）语义一致 */
  const frequencyValue =
    config === null
      ? ""
      : BACKUP_FREQUENCY_OPTIONS.some((o) => String(o.value) === String(config.backupFrequencyMinutes))
        ? String(config.backupFrequencyMinutes)
        : "null";

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-foreground">自动备份</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        跟随书籍：备份与频率均为本项目独立；服务运行期间按频率自动备份，有变更才生成新备份；每项目保留最近 20 份
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={frequencyValue}
          onChange={(e) => void handleFrequencyChange(e.target.value)}
          disabled={config === null || frequencySaving}
          aria-label="自动备份频率"
          className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {BACKUP_FREQUENCY_OPTIONS.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          autoComplete="off"
          value={backupName}
          onChange={(e) => setBackupName(e.target.value)}
          maxLength={MAX_BACKUP_NAME_LENGTH}
          placeholder="备份名称（可选）"
          aria-label="备份名称（可选）"
          disabled={config === null}
          className="w-36 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button
          onClick={() => void handleBackupNow()}
          disabled={config === null || backupNowRunning}
          type="button"
        >
          {backupNowRunning ? <Loader2 className="size-4 animate-spin" /> : null}
          立即备份
        </Button>
      </div>
      {config === null && !configLoading && (
        <p className="mt-1 text-xs text-muted-foreground/70">打开项目后可用</p>
      )}

      {/* 历史备份列表（仅项目打开时渲染；无项目 → 引导文案已在上方） */}
      {config !== null && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">历史备份</p>
          <div className="overflow-hidden rounded-lg border border-border">
            {backupsLoading && backups === null ? (
              /* 首载骨架（重载不闪骨架：条件含 backups === null，layout.md §4.3） */
              <div className="space-y-1 p-2">
                <div className="h-7 animate-pulse rounded-md bg-muted" />
                <div className="h-7 animate-pulse rounded-md bg-muted" />
              </div>
            ) : backupsError !== null ? (
              <div className="flex items-center justify-between px-2 py-2">
                <p className="text-xs text-muted-foreground">
                  {backupsError === CLIENT_NETWORK_ERROR ? "无法连接服务" : "备份列表加载失败"}
                </p>
                <Button variant="outline" size="xs" onClick={() => void loadBackups()}>
                  重试
                </Button>
              </div>
            ) : backups !== null && backups.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground/70">
                暂无备份，自动备份将在数据变更后按频率生成
              </p>
            ) : backups !== null ? (
              <ul className="divide-y divide-border">
                {backups.map((b) => {
                  const editing = renaming !== null && renaming.fileName === b.fileName;
                  return (
                    <li key={b.fileName} className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        {/* 行身份区：时间 + 类型标签 + 自定义名称（完整文件名 title tooltip 保持） */}
                        <span className="min-w-0 flex-1 text-sm" title={b.fileName}>
                          <span className="text-muted-foreground">{formatBackupTime(b.createdAt)}</span>
                          {/* 类型标签（决策 29）：自动 = 中性低调徽标，手动 = primary 强调徽标 */}
                          <span
                            className={
                              b.kind === "manual"
                                ? "ml-1.5 rounded border border-primary/40 px-1 text-[10px] leading-4 text-primary"
                                : "ml-1.5 rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground"
                            }
                          >
                            {BACKUP_KIND_LABELS[b.kind]}
                          </span>
                          {!editing && b.name !== undefined ? (
                            <span className="ml-1.5 font-medium text-foreground">{b.name}</span>
                          ) : null}
                        </span>
                        {!editing ? (
                          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(b.size)}</span>
                        ) : null}
                        {editing ? (
                          /* 行内编辑态：input（预填当前名称）+ 确认/取消；Enter 提交 / Esc 或失焦取消 */
                          <>
                            <input
                              autoComplete="off"
                              value={renaming.value}
                              onChange={(e) =>
                                setRenaming((r) =>
                                  r === null ? r : { ...r, value: e.target.value, error: null },
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleRenameSubmit();
                                else if (e.key === "Escape") setRenaming(null);
                              }}
                              onBlur={() => {
                                // oracle P1-2 竞态守卫：saving 置位后 input 被 disabled，浏览器对
                                // 聚焦中的禁用元素自动触发 blur——此时不清编辑态，否则异步失败返回时
                                // 行内错误无处可挂（静默失败）。saving 期间 Esc/取消按钮均被禁用，
                                // 编辑态只能由成功路径/兜底 toast 路径收尾
                                if (!renamingRef.current?.saving) setRenaming(null);
                              }}
                              maxLength={MAX_BACKUP_NAME_LENGTH}
                              disabled={renaming.saving}
                              autoFocus
                              aria-label="备份新名称"
                              className="w-36 shrink-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => void handleRenameSubmit()}
                              disabled={renaming.saving}
                              onMouseDown={(e) => e.preventDefault()} // 防抢焦点触发 input 失焦取消
                              aria-label="确认重命名"
                              title="确认（Enter）"
                            >
                              {renaming.saving ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Check className="size-3" />
                              )}
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => setRenaming(null)}
                              disabled={renaming.saving}
                              onMouseDown={(e) => e.preventDefault()}
                              aria-label="取消重命名"
                              title="取消（Esc）"
                            >
                              <X className="size-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() =>
                                setRenaming({
                                  fileName: b.fileName,
                                  value: b.name ?? "",
                                  saving: false,
                                  error: null,
                                })
                              }
                              aria-label={`重命名备份 ${formatBackupTime(b.createdAt)}`}
                              title="重命名"
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button variant="outline" size="xs" onClick={() => setRestoreTarget(b)}>
                              加载
                            </Button>
                          </>
                        )}
                      </div>
                      {/* 行内错误提示（400/404 透传服务端 message / 网络失败固定文案），保持编辑态 */}
                      {editing && renaming.error !== null ? (
                        <p className="mt-1 text-xs text-destructive">{renaming.error}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      )}

      {/* 加载强确认（settings.md「关键交互」：展示备份时间 + 类型标签 + 名称 + 大小 + 覆盖说明 +
          后悔药提示）；409 SCHEMA_VERSION_MISMATCH 时 ConfirmDialog 显示服务端 message 保持打开（阻断） */}
      {restoreTarget !== null && (
        <ConfirmDialog
          title="加载备份"
          description={`${formatBackupTime(restoreTarget.createdAt)} · ${BACKUP_KIND_LABELS[restoreTarget.kind]}${
            restoreTarget.name !== undefined ? ` · ${restoreTarget.name}` : ""
          } · ${formatBytes(restoreTarget.size)}。将覆盖当前项目数据；覆盖前会自动备份当前状态（可回退）`}
          confirmLabel="确认加载"
          danger
          onConfirm={handleRestore}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
