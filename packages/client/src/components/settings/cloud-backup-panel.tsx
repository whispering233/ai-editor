// 设置页「备份 → 云端备份」面板（卡 3）：账号配置 + 自动推送开关
//
// 契约：`docs/api/100-api-cloud.md`（卡 2 只实现配置段 status/config/test）、
// `docs/ui/DESIGN.md` §备份与云端存档 的 `cloud-backup-panel`、`docs/design/tasks.md` 卡 3 的语义前置：
// - 「清除凭据」= 清空 url + username（密码框留空即可；服务端不变式：url/username 皆空 ⇒ password 一并丢弃）
// - 三件套要么齐、要么全无：凭据不全时不提交 password（`lib/cloud-config.ts` 收敛该判断）
// - `status` 当前只有 6 字段（remote/local/state/errorCode 属卡 4/5）
// - `/cloud/test` 的 400/502 文案为中文可读，直接展示
//
// 卡 3 做「账号配置」与「自动推送」两段；卡 4 增「同步状态」段；卡 5 补齐三态提示、云端份列表与拉取
//（含 `cloud-pull-confirm` 确认框与拉取后刷新项目数据）。冲突裁决对话框仍属卡 6——本段冲突分支先在行内给
//「用本机覆盖云端」入口，届时替换为 `cloud-conflict-dialog`。
// 状态持有：与「AI 模型」「项目规则」两个 pane 一致——**页内 state + 直接调 API**，不引 store
//（第二个消费者出现时再上提：卡 6 的左栏「同步云端」按钮需要跨组件共享状态）。

import { useEffect, useState } from "react";
import { Button, Input, Switch, Tag, Typography } from "antd";
import type { CloudStatus } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  getCloudStatus,
  getProjectBackups,
  pullCloudBackup,
  pushCloudBackup,
  putCloudConfig,
  testCloudConnection,
  type BackupEntry,
} from "../../lib/api";
import type { CloudBackupEntry, CloudSyncState } from "@whispering233/ai-editor-shared";
import { ConfirmDialog } from "../outline/dialogs";
import { BACKUP_KIND_LABELS, formatBackupMeta, formatBackupTime, formatBytes } from "../../lib/backup";
import {
  EMPTY_CLOUD_CONFIG_FORM,
  buildCloudConfigPatch,
  cloudConfigFormFrom,
  isCloudConfigDirty,
  isCredentialHalfFilled,
  type CloudConfigForm,
} from "../../lib/cloud-config";
import { useProjectStore } from "../../stores/project";
import { useChatStore } from "../../stores/chat";
import { useUiStore } from "../../stores/ui";
import { SectionCard } from "../ui/section-card";

/** 三态文案（`state` → 一句人话；卡片 5/6 的提示与动作都据此派生） */
const SYNC_STATE_LABELS: Record<CloudSyncState, string> = {
  unconfigured: "未配置云盘",
  "no-project": "未打开项目",
  unreachable: "云端检查失败（本地功能不受影响）",
  synced: "已同步",
  "local-ahead": "本机有未同步的改动（可推送）",
  "remote-ahead": "云端有更新（可拉取）",
  conflict: "两边都有改动——需裁决（保留云端 / 用本机覆盖）",
};

export function CloudBackupPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const notifyDataChanged = useUiStore((s) => s.notifyDataChanged);
  const loadConfig = useProjectStore((s) => s.loadConfig);
  const loadOutline = useProjectStore((s) => s.loadOutline);

  /** 服务端配置快照（null = 尚未读到 / 读取失败） */
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** 表单草稿（status 就绪后预填；密码恒为空串） */
  const [form, setForm] = useState<CloudConfigForm>({ ...EMPTY_CLOUD_CONFIG_FORM });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [switching, setSwitching] = useState(false);
  /** 本机最新一份备份（推送缺省目标；无项目/无备份 → null） */
  const [localLatest, setLocalLatest] = useState<BackupEntry | null>(null);
  const [pushing, setPushing] = useState(false);
  /** 推送失败信息（含冲突：409 CLOUD_CONFLICT 时给「用本机覆盖云端」入口） */
  const [pushError, setPushError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [pulling, setPulling] = useState(false);
  /** 待确认的拉取目标（非 null → 渲染 `cloud-pull-confirm` 确认框） */
  const [pullTarget, setPullTarget] = useState<CloudBackupEntry | null>(null);

  /**
   * 拉状态；`refill` 决定是否同时用服务端值重填表单：
   * - 保存成功后 `refill = true`（表单与服务端对齐，密码框随之清空）
   * - 只是切开关时 `refill = false`（**不能清掉用户正在编辑的草稿**）
   */
  async function refresh(refill: boolean): Promise<void> {
    try {
      const next = await getCloudStatus();
      setStatus(next);
      if (refill) setForm(cloudConfigFormFrom(next));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }

  /** 拉本机最新一份备份（推送按钮的目标；无项目打开 → null，不报错） */
  async function loadLocalLatest(): Promise<void> {
    try {
      const res = await getProjectBackups();
      setLocalLatest(res.backups[0] ?? null);
    } catch {
      setLocalLatest(null);
    }
  }

  useEffect(() => {
    void refresh(true);
    void loadLocalLatest();
  }, []);

  const configured = status?.configured === true;
  /** 云端最新一份（head = 列表首项；无云端目录/无备份 → null） */
  const remoteHead = status?.remote?.backups[0] ?? null;
  /** 云端份列表（≤5 行 = 云端保留上限；时间倒序） */
  const remoteBackups = status?.remote?.backups.slice(0, 5) ?? [];
  const autoPush = status?.autoPush === true;
  const dirty = isCloudConfigDirty(form, status);
  const halfFilled = isCredentialHalfFilled(form);

  /** 失败提示：服务端文案（400 校验 / 502 三码）已中文可读，直接透传；网络层给固定文案 */
  function errorText(err: unknown, fallback: string): string {
    return err instanceof ApiError && err.code !== "CLIENT_NETWORK_ERROR" ? err.message : fallback;
  }

  async function handleSave(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      await putCloudConfig(buildCloudConfigPatch(form));
      await refresh(true);
      showToast("云端配置已保存");
    } catch (err) {
      showToast(errorText(err, "无法连接服务，配置未保存"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    if (testing) return;
    setTesting(true);
    try {
      const res = await testCloudConnection();
      // created = 本次测试顺带在云盘上创建了根目录（首次接入的常见路径）
      showToast(res.created ? "连接成功，已在云盘创建目录" : "连接成功（已写入并删除测试文件）");
    } catch (err) {
      showToast(errorText(err, "无法连接服务，测试未执行"), "error");
    } finally {
      setTesting(false);
    }
  }

  async function handleAutoPush(next: boolean): Promise<void> {
    setSwitching(true);
    try {
      await putCloudConfig({ autoPush: next });
      await refresh(false); // 只刷开关状态：不清用户未保存的表单草稿
      showToast(next ? "已开启自动推送" : "已关闭自动推送");
    } catch (err) {
      showToast(errorText(err, "自动推送开关未保存"), "error");
    } finally {
      setSwitching(false);
    }
  }

  /**
   * 拉取（确认后执行）：成功 → 刷新项目数据（config / outline / 会话，与 restore 同款）
   * + 只刷状态（`refill = false`，不动表单草稿）。
   * 覆盖前服务端已自动快照本机状态；两个打包目录走并集合并（本机独有的对话/资料不会丢）。
   */
  async function handlePull(entry: CloudBackupEntry): Promise<void> {
    if (pulling) return;
    setPullTarget(null);
    setPulling(true);
    try {
      const res = await pullCloudBackup({ fileName: entry.fileName });
      await refresh(false);
      await loadLocalLatest();
      await Promise.all([loadConfig(), loadOutline()]);
      notifyDataChanged();
      useChatStore.getState().clearSessions();
      void useChatStore.getState().loadSessions();
      const { kept, written, removed } = res.merged;
      const mergeNote =
        kept > 0 || removed > 0 ? `（本机独有保留 ${kept} 个、云端新增 ${written} 个、按云端删除 ${removed} 个文件）` : "";
      showToast(`已从云端拉取，覆盖前状态已自动快照（${res.snapshot.fileName}）${mergeNote}`);
    } catch (err) {
      showToast(errorText(err, "无法连接服务，拉取未执行"), "error");
    } finally {
      setPulling(false);
    }
  }

  /**
   * 推送（缺省最新一份）：成功后只刷状态与云端列表（`refill = false`，不动表单草稿）+
   * 重取本机最新份（本机侧无变化，但保持数据新鲜）。冲突（409）时把服务端文案落到面板里，
   * 并给出「用本机覆盖云端」入口（正式裁决对话框在卡 6）。
   */
  async function handlePush(force = false): Promise<void> {
    if (pushing) return;
    setPushing(true);
    setPushError(null);
    try {
      const res = await pushCloudBackup(force ? { force: true } : {});
      await refresh(false);
      await loadLocalLatest();
      const prunedNote = res.pruned.length > 0 ? `，已清理云端 ${res.pruned.length} 份旧备份` : "";
      const snapshotNote = res.snapshot !== undefined ? `；云端原版本已存为本地备份 ${res.snapshot.fileName}` : "";
      showToast(`已推送到云端（${formatBytes(res.pushed.size)}）${prunedNote}${snapshotNote}`);
    } catch (err) {
      const message = errorText(err, "无法连接服务，推送未执行");
      const conflict = err instanceof ApiError && err.code === "CLOUD_CONFLICT";
      setPushError({ message, conflict });
      showToast(message, "error");
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ① 账号配置 */}
      <SectionCard title="账号配置">
        <p className="mb-3 text-xs text-muted-foreground">
          把备份 zip 推送到你自己的 WebDAV 云盘（坚果云原生支持；其他云盘可用 rclone / AList 自建桥接）。
          云端是备份的另一块磁盘，本地数据不依赖它，随时可以停用。
        </p>

        <div className="flex flex-col gap-2">
          <Input
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="WebDAV 地址（如 https://dav.jianguoyun.com/dav/ai-editor）"
            aria-label="WebDAV 地址"
          />
          <Input
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="用户名（坚果云填注册邮箱）"
            aria-label="WebDAV 用户名"
          />
          <Input.Password
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="应用密码（留空则不修改）"
            aria-label="WebDAV 应用密码"
          />
          <Input
            value={form.device}
            onChange={(e) => setForm((f) => ({ ...f, device: e.target.value }))}
            placeholder="设备名（如 家里的台式机；留空用本机名）"
            aria-label="设备名"
          />
        </div>

        {halfFilled && (
          <p className="mt-2 text-xs text-destructive">
            地址与用户名要么都填、要么都清空（都清空 = 关闭云存档，密码会一并丢弃）；当前不会提交密码
          </p>
        )}
        {!configured && status !== null && !halfFilled && (
          <p className="mt-2 text-xs text-muted-foreground">填写地址与用户名/应用密码并保存后即可测试连接。</p>
        )}
        {loadFailed && <p className="mt-2 text-xs text-destructive">云端配置读取失败，请刷新页面重试。</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="primary" disabled={!dirty || saving} loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
          <Button disabled={!configured || testing} loading={testing} onClick={() => void handleTest()}>
            测试连接
          </Button>
          <span className="text-xs text-muted-foreground">测试连接使用已保存的配置</span>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          凭据以明文保存在本机 .ai-editor/cloud.json（权限 600），不进项目文件、不进备份包；接口响应从不回传密码。
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          设备名决定备份文件名里的来源段（留空 / 清空 = 用本机名派生）。免费云盘有上传流量限制
          （如坚果云免费账户 1GB/月），开启自动推送会持续消耗配额。
        </p>
      </SectionCard>

      {/* ② 自动推送 */}
      <SectionCard title="自动推送">
        <p className="mb-2 text-xs text-muted-foreground">
          每 2 小时且只在创作数据有变更时推送一次；关闭项目与手动备份会额外触发一次；纯聊天不单独触发。
          关闭时仍可在云端面板手动推送。
        </p>
        <div className="flex items-center gap-2">
          <Switch
            checked={autoPush}
            loading={switching}
            disabled={!configured}
            onChange={(next) => void handleAutoPush(next)}
            aria-label="自动推送开关"
          />
          <span className="text-sm">{autoPush ? "已开启" : "已关闭"}</span>
          {!configured && <span className="text-xs text-muted-foreground">先完成账号配置</span>}
        </div>
      </SectionCard>

      {/* ③ 同步状态（卡 4：云端最新份 / 本机最新份 / 推送；拉取与三态状态机属卡 5/6） */}
      <SectionCard title="同步状态">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>
            云端最新份：
            {remoteHead === null
              ? configured
                ? "（云端还没有备份）"
                : "（未配置）"
              : `${formatBackupTime(remoteHead.createdAt)} · ${BACKUP_KIND_LABELS[remoteHead.kind]}${
                  remoteHead.name !== undefined ? ` · ${remoteHead.name}` : ""
                }${formatBackupMeta(remoteHead) !== null ? ` · ${formatBackupMeta(remoteHead)}` : ""} · ${formatBytes(remoteHead.size)}`}
          </span>
          <span>
            本机最新份：
            {localLatest === null
              ? "（无可用备份，先「立即备份」）"
              : `${formatBackupTime(localLatest.createdAt)} · ${BACKUP_KIND_LABELS[localLatest.kind]}${
                  localLatest.name !== undefined ? ` · ${localLatest.name}` : ""
                } · ${formatBytes(localLatest.size)}`}
          </span>
          <span>
            本机已推份：
            {status?.local?.lastPushedFileName ?? "（还没同步过）"}
            {status?.local?.lastSyncAt != null ? ` · 上次同步 ${formatBackupTime(status.local.lastSyncAt)}` : ""}
            {status?.local?.dirty === true ? " · 有未同步改动" : ""}
          </span>
          <span>
            状态：{status === null ? "读取中…" : SYNC_STATE_LABELS[status.state]}
            {status?.errorCode !== undefined ? `（${status.errorCode}）` : ""}
          </span>
        </div>

        {/* 云端份列表（≤5 行 = 云端保留上限；行尾标「云端最新」、行内可拉取任一份） */}
        {remoteBackups.length > 0 && (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {remoteBackups.map((entry, index) => (
              <li key={entry.fileName} className="flex items-center gap-2 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm" title={entry.fileName}>
                  <Typography.Text type="secondary">{formatBackupTime(entry.createdAt)}</Typography.Text>
                  <Tag className="ml-1.5">{BACKUP_KIND_LABELS[entry.kind]}</Tag>
                  {entry.name !== undefined ? <Typography.Text strong>{entry.name}</Typography.Text> : null}
                  {index === 0 ? <Tag className="ml-1.5">云端最新</Tag> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBackupMeta(entry) !== null ? `${formatBackupMeta(entry)} · ` : ""}
                  {formatBytes(entry.size)}
                </span>
                <Button size="small" disabled={pulling} onClick={() => setPullTarget(entry)}>
                  拉取
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            disabled={!configured || localLatest === null || pushing}
            loading={pushing}
            onClick={() => void handlePush()}
          >
            推送到云端
          </Button>
          <Button
            disabled={remoteHead === null || pulling}
            loading={pulling}
            onClick={() => remoteHead !== null && setPullTarget(remoteHead)}
          >
            拉取云端最新
          </Button>
          {remoteHead !== null && (
            <span className="text-xs text-muted-foreground">
              云端已有 {status?.remote?.backups.length ?? 0} 份（保留最近 5 份）；拉取会用云端那份覆盖三文件，
              本机独有的对话与资料按并集保留
            </span>
          )}
        </div>

        {pullTarget !== null && (
          <ConfirmDialog
            title="从云端拉取"
            description={`${formatBackupTime(pullTarget.createdAt)} · ${BACKUP_KIND_LABELS[pullTarget.kind]}${
              pullTarget.name !== undefined ? ` · ${pullTarget.name}` : ""
            }${formatBackupMeta(pullTarget) !== null ? ` · ${formatBackupMeta(pullTarget)}` : ""} · ${formatBytes(
              pullTarget.size,
            )}。将用云端那份覆盖当前项目的三文件（id/书名不变）；本机当前状态会先自动快照到本地备份（可回退），本机独有的对话与资料按并集保留（不会被删）。`}
            confirmLabel="拉取"
            danger
            onConfirm={() => handlePull(pullTarget)}
            onClose={() => setPullTarget(null)}
          />
        )}

        {pushError !== null && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-destructive">{pushError.message}</p>
            {pushError.conflict && (
              <div className="flex items-center gap-2">
                <Button size="small" disabled={pushing} onClick={() => void handlePush(true)}>
                  用本机覆盖云端
                </Button>
                <span className="text-xs text-muted-foreground">
                  覆盖前会先把云端那份下载存进本机备份（两边都留档）
                </span>
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
