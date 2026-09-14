// 设置页「备份 → 云端备份」面板（卡 3）：账号配置 + 自动推送开关
//
// 契约：`docs/api/100-api-cloud.md`（卡 2 只实现配置段 status/config/test）、
// `docs/ui/DESIGN.md` §备份与云端存档 的 `cloud-backup-panel`、`docs/design/tasks.md` 卡 3 的语义前置：
// - 「清除凭据」= 清空 url + username（密码框留空即可；服务端不变式：url/username 皆空 ⇒ password 一并丢弃）
// - 三件套要么齐、要么全无：凭据不全时不提交 password（`lib/cloud-config.ts` 收敛该判断）
// - `status` 当前只有 6 字段（remote/local/state/errorCode 属卡 4/5）
// - `/cloud/test` 的 400/502 文案为中文可读，直接展示
//
// 本卡只做「账号配置」与「自动推送」两段：状态区 / 云端份列表 / 推送 / 拉取属卡 4/5（那时才有时序数据）。
// 状态持有：与「AI 模型」「项目规则」两个 pane 一致——**页内 state + 直接调 API**，不引 store
//（第二个消费者出现时再上提：卡 6 的左栏「同步云端」按钮需要跨组件共享状态）。

import { useEffect, useState } from "react";
import { Button, Input, Switch } from "antd";
import type { CloudStatus } from "@whispering233/ai-editor-shared";
import { ApiError, getCloudStatus, putCloudConfig, testCloudConnection } from "../../lib/api";
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

export function CloudBackupPanel() {
  const showToast = useUiStore((s) => s.showToast);

  /** 服务端配置快照（null = 尚未读到 / 读取失败） */
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** 表单草稿（status 就绪后预填；密码恒为空串） */
  const [form, setForm] = useState<CloudConfigForm>({ ...EMPTY_CLOUD_CONFIG_FORM });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [switching, setSwitching] = useState(false);

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

  useEffect(() => {
    void refresh(true);
  }, []);

  const configured = status?.configured === true;
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
    </div>
  );
}
