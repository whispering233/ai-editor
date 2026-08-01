// Dashboard 首页（S1.4：无项目引导开/建；完整统计留后续卡）
// 路由：#/（默认落地页）；数据：GET /api/v1/project/config（project store）
// 无项目（config=null 且非加载中）时落地为「项目开/建」引导：
//   - loadError=NO_PROJECT_OPEN → 开/建表单（路径 + 名称/语言可选，创建时）
//   - loadError=CLIENT_NETWORK_ERROR（服务未启动）→ 连接失败提示 + 重试
// 项目已打开 → 保持占位（完整概览统计见 doc/ui/pages/dashboard.md，后续卡实现）
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ApiError } from "../lib/api";
import { describeOpenError } from "../lib/error-messages";
import { useProjectStore } from "../stores/project";

/** 从任意错误提取错误码（ApiError → 服务端/客户端码；未知 → null 走兜底文案） */
function openErrorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/** 表单前置校验：路径为空时提示并返回 false */
function validatePath(path: string, setFormError: (msg: string | null) => void): boolean {
  if (!path.trim()) {
    setFormError("请输入项目目录路径（绝对路径）");
    return false;
  }
  return true;
}

export default function Dashboard() {
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const loadError = useProjectStore((s) => s.loadError);
  const loadConfig = useProjectStore((s) => s.loadConfig);
  const openProjectAt = useProjectStore((s) => s.openProjectAt);
  const createProjectAt = useProjectStore((s) => s.createProjectAt);

  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const noProject = config === null && !configLoading;

  /** 创建项目（表单 submit：preventDefault + 校验；创建成功 → store 内自动 open） */
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!validatePath(path, setFormError)) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createProjectAt(path.trim(), name.trim() ? { name: name.trim(), language } : undefined);
    } catch (err) {
      setFormError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  /** 打开项目（按钮 onClick，无事件参数） */
  async function handleOpen() {
    if (!validatePath(path, setFormError)) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await openProjectAt(path.trim());
    } catch (err) {
      setFormError(describeOpenError(openErrorCode(err)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">Dashboard 首页</h1>

      {configLoading && <p className="text-sm text-zinc-500">加载中…</p>}

      {noProject && loadError === "CLIENT_NETWORK_ERROR" && (
        <div className="mt-4 max-w-md rounded-md border border-zinc-200 p-4">
          <p className="text-sm text-zinc-700">无法连接服务，请确认 ai-editor 服务已启动后重试。</p>
          <Button className="mt-3" onClick={() => void loadConfig()} type="button">
            重试
          </Button>
        </div>
      )}

      {noProject && loadError !== "CLIENT_NETWORK_ERROR" && (
        <div className="mt-4 max-w-md rounded-md border border-zinc-200 p-4">
          <h2 className="mb-1 text-base font-semibold">打开或创建项目</h2>
          <p className="mb-3 text-sm text-zinc-500">
            未打开项目。输入项目目录的绝对路径（目录须已含 project.json），或指定路径创建新项目。
          </p>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-zinc-600">项目路径（绝对路径）</span>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/home/me/novels/my-story"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-600">项目名称（仅创建时，可选）</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="我的小说" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-600">语言（仅创建时，可选）</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as "zh" | "en")}
                className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                创建项目
              </Button>
              <Button type="button" variant="outline" disabled={submitting} onClick={() => void handleOpen()}>
                打开项目
              </Button>
            </div>
          </form>
        </div>
      )}

      {config !== null && (
        <p className="text-sm text-zinc-500">
          项目概览：项目信息、四类要素统计、大纲概览、最近会话（后续卡实现）
        </p>
      )}
    </section>
  );
}
