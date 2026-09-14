// 设置页「备份 → 云端备份」面板（卡 3 建，卡 4/5 扩，卡 6 改接 store）
//
// 契约：`docs/api/100-api-cloud.md`、`docs/ui/DESIGN.md` §备份与云端存档 的 `cloud-backup-panel`。
// - 「清除凭据」= 清空 url + username（密码框留空即可；服务端不变式：url/username 皆空 ⇒ password 一并丢弃）
// - 三件套要么齐、要么全无：凭据不全时不提交 password（`lib/cloud-config.ts` 收敛该判断）
// - `/cloud/test`、`/cloud/*` 的 400/409/502 文案为中文可读，直接展示
//
// **卡 6 的状态归属**：`status` / 本机份 / 推送 / 拉取 / 两个对话框都已上提到 `stores/cloud.ts`
//（左栏「同步云端」按钮是第二个消费者——两份消费者必须看到同一份状态，否则会出现「角标说冲突、面板说已同步」）。
// 本面板只留**表单草稿**（url / 用户名 / 密码 / 设备名）与「保存 / 测试连接」——纯页内 UI 状态，切走即弃。
// 推送失败的冲突分支不再走行内入口，改为打开 `cloud-conflict-dialog`（DESIGN.md §544）。

import { useEffect, useState } from "react";
import { Button, Input, Switch, Tag, Typography } from "antd";
import { putCloudConfig, testCloudConnection } from "../../lib/api";
import type { CloudSyncState } from "@whispering233/ai-editor-shared";
import { cloudErrorText, useCloudStore } from "../../stores/cloud";
import { BACKUP_KIND_LABELS, formatBackupMeta, formatBackupTime, formatBytes } from "../../lib/backup";
import {
  EMPTY_CLOUD_CONFIG_FORM,
  buildCloudConfigPatch,
  cloudConfigFormFrom,
  isCloudConfigDirty,
  isCredentialHalfFilled,
  type CloudConfigForm,
} from "../../lib/cloud-config";
import { useUiStore } from "../../stores/ui";
import { SectionCard } from "../ui/section-card";

/** 三态文案（`state` → 一句人话；左栏按钮的提示与动作都据此派生） */
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

  /** 云端状态与动作（唯一状态源；与左栏「同步云端」共享） */
  const status = useCloudStore((s) => s.status);
  const statusFailed = useCloudStore((s) => s.statusFailed);
  const localLatest = useCloudStore((s) => s.localLatest);
  const busy = useCloudStore((s) => s.busy);
  const lastError = useCloudStore((s) => s.lastError);
  const refresh = useCloudStore((s) => s.refresh);
  const push = useCloudStore((s) => s.push);
  const openPullConfirm = useCloudStore((s) => s.openPullConfirm);

  /** 表单草稿（status 就绪后预填；密码恒为空串） */
  const [form, setForm] = useState<CloudConfigForm>({ ...EMPTY_CLOUD_CONFIG_FORM });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    void refresh().then((next) => {
      // 首帧预填表单草稿（之后只在「保存成功」时回填，避免清掉用户正在编辑的内容）
      if (next !== null) setForm(cloudConfigFormFrom(next));
    });
  }, [refresh]);

  const configured = status?.configured === true;
  /** 云端最新一份（head = 列表首项；无云端目录/无备份 → null） */
  const remoteHead = status?.remote?.backups[0] ?? null;
  /** 云端份列表（≤5 行 = 云端保留上限；时间倒序） */
  const remoteBackups = status?.remote?.backups.slice(0, 5) ?? [];
  const autoPush = status?.autoPush === true;
  const dirty = isCloudConfigDirty(form, status);
  const halfFilled = isCredentialHalfFilled(form);
  const pulling = busy === "pull";
  const pushing = busy === "push";

  async function handleSave(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      await putCloudConfig(buildCloudConfigPatch(form));
      // 保存成功才回填（密码框随之清空）；status 由 store 统一刷新
      const next = await refresh();
      if (next !== null) setForm(cloudConfigFormFrom(next));
      showToast("云端配置已保存");
    } catch (err) {
      showToast(cloudErrorText(err, "无法连接服务，配置未保存"), "error");
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
      showToast(cloudErrorText(err, "无法连接服务，测试未执行"), "error");
    } finally {
      setTesting(false);
    }
  }

  async function handleAutoPush(next: boolean): Promise<void> {
    setSwitching(true);
    try {
      await putCloudConfig({ autoPush: next });
      await refresh(); // 只刷状态：不动用户未保存的表单草稿
      showToast(next ? "已开启自动推送" : "已关闭自动推送");
    } catch (err) {
      showToast(cloudErrorText(err, "自动推送开关未保存"), "error");
    } finally {
      setSwitching(false);
    }
  }

  /** 本机最新份为空时的推送目标提示（缺省推送本机最新一份，服务端解析） */
  const noLocalBackup = localLatest === null;

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
        {statusFailed && <p className="mt-2 text-xs text-destructive">云端配置读取失败，请刷新页面重试。</p>}

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

      {/* ③ 同步状态（状态行 + 云端份列表 + 推送 / 拉取） */}
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
                <Button size="small" disabled={pulling} onClick={() => openPullConfirm(entry)}>
                  拉取
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button disabled={!configured || noLocalBackup || pushing} loading={pushing} onClick={() => void push()}>
            推送到云端
          </Button>
          <Button
            disabled={remoteHead === null || pulling}
            loading={pulling}
            onClick={() => remoteHead !== null && openPullConfirm(remoteHead)}
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

        {/* 动作失败文案（推送/拉取）：toast 会消失，行内留一份可回看；冲突另开裁决框 */}
        {lastError !== null && <p className="mt-2 text-xs text-destructive">{lastError}</p>}
      </SectionCard>
    </div>
  );
}
