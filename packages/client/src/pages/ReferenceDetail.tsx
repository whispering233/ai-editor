// 参考资料详情页（卡 12.8）
// - 编辑态（#/references/:id）= 详情页即编辑器：标题行内编辑 + 分类/标签/URL + 正文块编辑器 + 建立关联 + 删除
// - 新建态（#/references/new，**单一入口**）= 名称 + 可选 URL + 分类 + 标签 + 正文（POST 创建 → 跳编辑态）；
//   旧草稿双路由 #/references/new/md、#/references/new/link 已由 main.tsx 重定向到新入口
// - 正文 = 块文档：`data.content` 是**块数组 JSON 字符串**，真相在服务端 `document_records`
//   （docs/api/30-api-entity.md「reference 特例」）；空文档口径 = 键缺失 / `""` / `"[]"` 一律空
// - 保存：正文**自动保存**（空闲 1500ms 落盘 + 卸载/切路由 flush + 失败可见 + 重试），
//   名称/分类/标签/URL 与正文一起由「保存」按钮 / Ctrl+S（useSaveShortcut）手动提交；
//   **无版本戳保护**：实体 PUT 不接受 `base_updated_at`（strict schema），并发写 = 后写覆盖，
//   与其它实体一致（卡 12.8 裁决；章正文的 409 弹窗不适用于此页）
// - 导入 / 导出（纯客户端，无端点；范式照抄 pages/Manuscript.tsx）：导出块 JSON（无损）/ markdown（先确认有损）；
//   导入 md / 块 JSON 覆盖正文（有损必须先确认）→ **换 key 重挂编辑器**（BlockNote 非受控）→ 交给自动保存落盘
// 焦点上报：编辑态上报 focus_entity_type/id；新建态无实体不上报
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DeleteOutlined,
  DownOutlined,
  ExportOutlined,
  ImportOutlined,
  LinkOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import type { EntityDetailRes } from "../lib/api";
import {
  ApiError,
  createEntity,
  deleteEntity,
  getEntityDetail,
  listEntities,
  updateEntity,
} from "../lib/api";
import { applyTagSuggestion, suggestTags, tagsToInput } from "../lib/timeline";
import { navigate } from "../hooks/use-route";
import { useSaveShortcut } from "../lib/save-shortcut";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { errorBannerClass, skeletonClass } from "../lib/styles";
import { Button, Dropdown, Input } from "antd";
import { PageTitle } from "../components/ui/page-title";
import { PageHeader } from "../components/ui/page-header";
import { TagSuggest } from "../components/timeline/TagSuggest";
import {
  CreateRelationDialog,
  type RelationSource,
} from "../components/entity/create-relation-dialog";
import { DocumentEditor, type DocumentEditorApi } from "../components/blocknote/document-editor";
import { AUTOSAVE_DELAY_MS, createAutosave } from "../lib/manuscript";
import {
  downloadTextFile,
  exportDocumentJson,
  exportDocumentMarkdown,
  MARKDOWN_LOSSY_NOTICE,
  markdownImportConfirmMessage,
  planDocumentImport,
  readTextFile,
} from "../lib/document-io";
import { referenceSaveData, referenceSource } from "../lib/reference";

/** 分类回显映射（**仅存量显示**——material 等旧枚举值回显中文名，非可选建议；新自定义分类无映射原样显示） */
const TYPE_LABELS: Record<string, string> = {
  material: "素材摘抄",
  inspiration: "灵感记录",
  theory: "写作理论",
  reference: "设定参考",
};

/** 新建条目的缺省分类（REST 不兜底，页面给缺省——见 docs/api/30-api-entity.md「reference 特例」） */
const DEFAULT_TYPE = "material";

/** 详情页表单（编辑态由详情同步填充；新建态空表单）。
 * 正文**不在表单里**：块编辑器非受控，最新内容在 `contentRef`（保存/flush/重试取它） */
interface EditForm {
  name: string;
  type: string;
  tagsInput: string;
  url: string;
}

const EMPTY_FORM: EditForm = { name: "", type: DEFAULT_TYPE, tagsInput: "", url: "" };

export default function ReferenceDetail({ id, draft = false }: { id?: string; draft?: boolean }) {
  // 挂载/切换时上报页面焦点（当前参考资料作为「问 AI」上下文；新建态无实体不上报）
  const setCurrentFocus = useUiStore((s) => s.setCurrentFocus);
  useEffect(() => {
    if (!draft && id !== undefined) {
      setCurrentFocus({ focus_entity_type: "reference", focus_entity_id: id });
    }
  }, [draft, id, setCurrentFocus]);

  const [detail, setDetail] = useState<EntityDetailRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // 表单（编辑态由 detail 同步填充——无异步回填竞态；新建态空表单）
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 标题行内编辑（标题点击编辑，Enter 确认/Esc 取消）
  const [titleEditing, setTitleEditing] = useState(false);

  // 正文（块编辑器）：`content` = 初次挂载的内容；`contentRef` = 编辑器最新内容（保存/flush/重试取它，避免闭包旧值）
  const [content, setContent] = useState("");
  const contentRef = useRef("");
  // 编辑器重挂信号（BlockNote 非受控：加载完成 / 导入覆盖后换 key 重挂才能换内容）
  const [editorEpoch, setEditorEpoch] = useState(0);
  // 导入导出的能力出口（md ↔ 块要真实例）：onReady 回调拿到；null = 编辑器未挂载
  const [editorApi, setEditorApi] = useState<DocumentEditorApi | null>(null);
  // 正文保存状态：页头「保存中…/已保存」；失败走错误条 + 重试（不静默丢改动）
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 失败保存的重试动作（自动保存 / 手动保存各自记自己的那份——重试不能变成另一种保存） */
  const retryRef = useRef<(() => void) | null>(null);
  /** 隐藏的文件选择框（导入入口；浏览器与桌面同一套 <input type="file">） */
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 建立关联对话框（两类详情页均含关联面板，源端点预填当前 reference）
  const [relationOpen, setRelationOpen] = useState(false);

  // 标签建议池（详情页独立聚合：datalist 自动补全 + TagSuggest 快捷选择，与列表页一致体验）
  const [tagPool, setTagPool] = useState<string[]>([]);
  // 分类建议池（datalist 建议 = 项目内已用分类，无预置枚举；与 tagPool 同一次拉取聚合）
  const [typePool, setTypePool] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    listEntities("reference", { limit: 200 })
      .then((res) => {
        if (cancelled) return;
        const tagSet = new Set<string>();
        const typeSet = new Set<string>();
        for (const it of res.items) {
          const tags = it.summary?.tags;
          if (Array.isArray(tags))
            for (const t of tags) if (typeof t === "string" && t !== "") tagSet.add(t);
          const t = it.summary?.type;
          if (typeof t === "string" && t !== "") typeSet.add(t);
        }
        setTagPool([...tagSet].sort((a, b) => a.localeCompare(b)));
        setTypePool([...typeSet].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        /* 建议池加载失败不阻塞编辑（仅自动补全缺失） */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 编辑态：加载详情 → 同步填充表单与正文（无竞态：表单在数据就绪后才渲染可编辑）
  useEffect(() => {
    if (draft || id === undefined) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    getEntityDetail("reference", id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        const data = d.data as Record<string, unknown>;
        setForm({
          name: d.name,
          type: (data?.type as string | undefined) ?? DEFAULT_TYPE,
          tagsInput: tagsToInput(data?.tags),
          url: typeof data?.url === "string" ? (data.url as string) : "",
        });
        // 正文：键缺失 / "" / "[]" 一律空文档（块编辑器封装已按此口径容错）
        const initial = typeof data?.content === "string" ? (data.content as string) : "";
        contentRef.current = initial;
        setContent(initial);
        setEditorEpoch((epoch) => epoch + 1); // 换 key 重挂：外部内容只能在挂载时消费
        setSaveState("idle");
        setSaveError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [draft, id, reloadTick]);

  /**
   * 正文自动保存（只提交 `data.content`——名称/分类/标签/URL 的改动走「保存」按钮，
   * 不把半成品元信息自动落盘）。空串 = 服务端「从未写过」（服务端对空串会 400）→ 不发请求。
   */
  async function saveContent(text: string): Promise<void> {
    if (draft || id === undefined || text === "") return;
    setSaveState("saving");
    try {
      await updateEntity("reference", id, { data: { content: text } });
      setSaveError(null);
      setSaveState("saved");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "保存失败，请重试";
      setSaveState("idle");
      setSaveError(message);
      retryRef.current = () => void saveContent(text);
    }
  }

  // 自动保存调度器（跨渲染稳定；save 实现经 ref 取最新闭包）——复用正文页的同一实现（同一套 debounce/flush 语义）
  const saveRef = useRef(saveContent);
  useEffect(() => {
    saveRef.current = saveContent;
  });
  const autosave = useMemo(
    () => createAutosave({ delayMs: AUTOSAVE_DELAY_MS, save: (text) => saveRef.current(text) }),
    [],
  );

  // 卸载 / 切路由前 flush：在途内容立刻落盘，不依赖组件存活（cleanup 内不 await）
  useEffect(() => () => void autosave.flush(), [autosave]);

  /** 编辑器内容变化：记录最新内容（手动保存也取它）+ 排入自动保存（新建态不排——条目还不存在） */
  function handleEditorChange(next: string): void {
    contentRef.current = next;
    if (!draft) autosave.schedule(next);
  }

  const tagSuggestions = suggestTags(form.tagsInput, tagPool);

  /** 详情元信息（来源列 / 页头展示）：只认 url */
  const source = referenceSource(detail?.data as Record<string, unknown> | undefined);

  /** 保存成功后刷新详情元信息（名称/更新时间）；**不碰正文与编辑器**——正文真相 = 本页编辑器内容 */
  async function refreshDetail(): Promise<void> {
    if (id === undefined) return;
    try {
      setDetail(await getEntityDetail("reference", id));
    } catch {
      /* 元信息刷新失败不打断编辑（正文已落盘） */
    }
  }

  /** 标题行内编辑提交（Enter 确认 / 失焦，失败 toast 后保持编辑态） */
  async function commitTitle() {
    const name = form.name.trim();
    if (name === "" || detail === null || name === detail.name) {
      setTitleEditing(false);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await updateEntity("reference", detail.id, { name });
      useUiStore.getState().showToast("已保存");
      setTitleEditing(false);
      void refreshDetail();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  /** 手动保存（编辑态 PUT / 新建态 POST + 跳转）：名称 + 分类/标签/URL + 正文一次提交 */
  async function handleSave() {
    if (saving) return; // 重入门禁（快捷键可绕过「保存」按钮的 disabled）
    const name = form.name.trim();
    if (name === "") {
      setFormError("名称必填");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const data = referenceSaveData(form, contentRef.current);
      if (draft) {
        const res = await createEntity("reference", { name, data });
        useUiStore.getState().showToast(`已创建参考资料《${name}》`);
        useUiStore.getState().notifyDataChanged();
        navigate(`#/references/${res.id}`);
      } else if (detail !== null) {
        await updateEntity("reference", detail.id, { name, data });
        autosave.reset(); // 手动保存已含最新正文：丢弃待存内容（不重复 PUT、不让旧内容回写）
        setSaveError(null);
        setSaveState("saved");
        useUiStore.getState().showToast("已保存");
        useUiStore.getState().notifyDataChanged();
        void refreshDetail();
      }
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/Cmd+S 保存（编辑态 PUT / 新建态 POST 与「保存/创建」按钮同动作）
  useSaveShortcut(() => void handleSave(), draft || detail !== null);

  async function handleDelete() {
    if (detail === null) return;
    try {
      await deleteEntity("reference", detail.id);
      useUiStore.getState().showToast("已移入回收站，可随时还原；推送到云端后，另一台也会同步删除");
      navigate("#/references");
    } catch (e) {
      useUiStore
        .getState()
        .showToast(e instanceof ApiError ? e.message : "删除失败，请重试", "error");
    }
  }

  // ============ 导入 / 导出（纯客户端，范式同 pages/Manuscript.tsx） ============

  /** 导入导出的文件名基名（条目名；未命名回退「参考资料」，与页头标题同口径） */
  function documentTitle(): string {
    return form.name.trim() === "" ? "参考资料" : form.name.trim();
  }

  /** 导出块 JSON（无损，可再导入） */
  function exportBlocksJson(): void {
    const file = exportDocumentJson(contentRef.current, documentTitle());
    downloadTextFile(file);
    useUiStore.getState().showToast(`已导出 ${file.fileName}`);
  }

  /** 导出 markdown：**md 有损**（颜色/对齐/嵌套/媒体无表达）——下载前必须先让用户确认 */
  async function exportMarkdown(): Promise<void> {
    if (editorApi === null) return;
    const ok = await useUiStore.getState().confirm({
      title: "导出 markdown（有损）",
      description: `${MARKDOWN_LOSSY_NOTICE}。需要无损（可再导入）请改用「导出块 JSON」。`,
    });
    if (!ok) return;
    const file = exportDocumentMarkdown(contentRef.current, documentTitle(), (text) =>
      editorApi.toMarkdown(text),
    );
    downloadTextFile(file);
    useUiStore.getState().showToast(`已导出 ${file.fileName}（有损）`);
  }

  /**
   * 导入覆盖正文：md / 块 JSON 解析后**换 key 重挂编辑器**换内容（BlockNote 非受控，外部改写只能重挂），
   * 再交给自动保存落盘（导入 = 一次用户编辑，不新增端点）。有损 md 必须先确认。
   */
  async function importFile(file: File): Promise<void> {
    if (editorApi === null) return;
    let text: string;
    try {
      text = await readTextFile(file);
    } catch {
      useUiStore.getState().showToast("导入失败：文件读取异常", "error");
      return;
    }
    const plan = planDocumentImport(file.name, text, (markdown) =>
      editorApi.parseMarkdown(markdown),
    );
    switch (plan.action) {
      case "error":
        useUiStore.getState().showToast(plan.message, "error");
        return;
      case "confirm-lossy": {
        const ok = await useUiStore.getState().confirm({
          title: "导入 markdown（有损）",
          description: `${markdownImportConfirmMessage(
            plan.unsupportedCount,
          )}；继续将用文件内容覆盖正文。需要无损请改用块 JSON。`,
        });
        if (!ok) return;
        break;
      }
      case "apply":
        break;
    }
    contentRef.current = plan.content;
    setContent(plan.content);
    setEditorEpoch((epoch) => epoch + 1);
    autosave.schedule(plan.content);
    useUiStore.getState().showToast(`已用 ${file.name} 覆盖正文`);
  }

  // ============ 错误 / 加载态（编辑态） ============
  if (!draft && error !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className={cn(errorBannerClass)}>{error}</p>
        <Button onClick={() => setReloadTick((t) => t + 1)}>重试</Button>
        <Button onClick={() => navigate("#/references")}>返回列表</Button>
      </div>
    );
  }

  if (!draft && detail === null) {
    return (
      <div className="space-y-3 p-4">
        <div className={cn(skeletonClass, "h-8 w-1/3")} />
        <div className={cn(skeletonClass, "h-64 w-full")} />
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 页头（统一壳）：标题（可编辑）/ 分类徽标 + 操作区（导入 / 导出 / 建立关联 / 删除）+ 元信息行 + 分割线；
          面包屑已随 B1 移除（返回走左栏 NavRail） */}
      <PageHeader
        titleNode={
          <div className="flex min-w-0 items-center gap-2">
            {titleEditing ? (
              <input
                autoComplete="off"
                autoFocus
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitTitle();
                  } else if (e.key === "Escape") {
                    setTitleEditing(false);
                  }
                }}
                onBlur={() => void commitTitle()}
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-xl focus:border-primary focus:outline-none"
                disabled={saving}
              />
            ) : (
              <PageTitle onClick={() => setTitleEditing(true)} title="点击编辑标题">
                {/* 标题显示 form.name 优先——新建态用户编辑后失焦退出编辑态不再丢失输入；空时回退占位文案 */}
                {form.name.trim() !== ""
                  ? form.name
                  : draft
                    ? "新建参考资料"
                    : (detail?.name ?? "参考资料")}
              </PageTitle>
            )}
            {/* 分类徽标：新建态不显示——新建时分类未定且下方已有分类输入区；编辑态保留 */}
            {!draft && (
              <span className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
                {TYPE_LABELS[form.type] ?? form.type}
              </span>
            )}
          </div>
        }
        action={
          <>
            {!draft && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.json,text/markdown,application/json"
                  className="hidden"
                  aria-label="选择要导入的参考资料文件"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = ""; // 允许重复选择同一文件
                    if (file !== undefined) void importFile(file);
                  }}
                />
                <Button disabled={editorApi === null} onClick={() => fileInputRef.current?.click()}>
                  <ImportOutlined className="text-sm" />
                  导入
                </Button>
                <Dropdown
                  disabled={editorApi === null}
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "json", label: "导出块 JSON（无损）" },
                      { key: "markdown", label: "导出 markdown（有损）" },
                    ],
                    onClick: ({ key }) => {
                      if (key === "json") exportBlocksJson();
                      else void exportMarkdown();
                    },
                  }}
                >
                  <Button disabled={editorApi === null}>
                    <ExportOutlined className="text-sm" />
                    导出
                    <DownOutlined className="text-xs" />
                  </Button>
                </Dropdown>
              </>
            )}
            <Button onClick={() => setRelationOpen(true)} disabled={draft}>
              <LinkOutlined className="text-sm" />
              建立关联
            </Button>
            {!draft && (
              <Button danger onClick={handleDelete}>
                <DeleteOutlined className="text-sm" />
                删除
              </Button>
            )}
          </>
        }
        description={
          /* 元信息：来源（有 url 才显示）+ 创建/更新时间 + 正文保存态 */
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {!draft && source !== "" && (
              <a
                href={/^https?:\/\//.test(source) ? source : undefined}
                target={/^https?:\/\//.test(source) ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {source}
                {/^https?:\/\//.test(source) && <ExportOutlined className="text-xs" />}
              </a>
            )}
            {!draft && detail !== null && (
              <>
                <span>创建 {formatTime(detail.createdAt)}</span>
                <span>更新 {formatTime(detail.updatedAt)}</span>
              </>
            )}
            {saveState === "saving" && <span>保存中…</span>}
            {saveState === "saved" && <span>已保存</span>}
          </div>
        }
      />

      {/* 正文保存失败（可见、不静默）：错误条 + 重试（重发失败时的那份内容/动作） */}
      {saveError !== null && (
        <div className={cn(errorBannerClass, "mb-3 flex items-center gap-3")}>
          <span className="min-w-0 flex-1">{saveError}</span>
          <Button size="small" onClick={() => retryRef.current?.()}>
            重试
          </Button>
        </div>
      )}

      {/* 表单区（编辑态 = 详情页即编辑器；分类/标签/URL + 正文块编辑器）。
          `flex flex-col` 是写作面高度链的第一环（DESIGN.md「写作面高度 = 填满剩余视口」）：
          容器 → 正文本行（flex-1 min-h-0）→ 编辑器包裹层（flex flex-col）三处接通，
          `.bn-container` / `.bn-editor` 的 `flex: 1 1 auto`（blocknote.css）才会生效 */}
      <div className="flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto">
        {/* 分类：文本框 + datalist 自动补全——建议项 = 项目内已用分类（存量回显名），
            不含预置枚举，用户可自由输入任意新分类 */}
        <div className="flex items-start gap-2">
          <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">分类</label>
          <div className="relative min-w-0 flex-1">
            <Input
              className="w-full"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              list="ref-detail-types"
              placeholder="如：素材摘抄、人物设定考据…（可自定义）"
              disabled={saving}
            />
            <datalist id="ref-detail-types">
              {typePool.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </datalist>
          </div>
        </div>
        {/* URL（可选：纯本地笔记不填，外源链接才填） */}
        <div className="flex items-start gap-2">
          <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">URL</label>
          <Input
            className="flex-1"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://…（可选，外源链接才填）"
            disabled={saving}
          />
        </div>
        {/* 标签（datalist 自动补全 + TagSuggest 快捷选择，与列表页一致体验） */}
        <div className="flex items-start gap-2">
          <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">标签</label>
          <div className="relative min-w-0 flex-1">
            <Input
              className="w-full"
              value={form.tagsInput}
              onChange={(e) => setForm((f) => ({ ...f, tagsInput: e.target.value }))}
              onKeyDown={(e) => {
                // Enter 追加逗号继续输入（F8 回车添加下一项 + M1 修复）
                if (
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  form.tagsInput.trim() !== ""
                ) {
                  e.preventDefault();
                  setForm((f) => ({ ...f, tagsInput: `${f.tagsInput},` }));
                }
              }}
              list="ref-detail-tags"
              placeholder="逗号分隔，如：五行, 设定"
              disabled={saving}
            />
            <datalist id="ref-detail-tags">
              {tagPool.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <TagSuggest
              suggestions={tagSuggestions}
              visible={form.tagsInput.trim() !== ""}
              onPick={(t) =>
                setForm((f) => ({ ...f, tagsInput: applyTagSuggestion(f.tagsInput, t) }))
              }
            />
          </div>
        </div>
        {/* 正文（块编辑器；改色只在 components/blocknote/blocknote.css）：编辑态自动保存，
            新建态由「创建」按钮随 POST 一次提交。
            `flex-1 min-h-0` + 包裹层 `flex flex-col` = 高度链第二、三环（短正文也铺满，点空白落文末）。
            本行不写 items-start（默认 stretch）：交叉轴拉伸才让包裹层拿到行高，`flex:1` 才有剩余空间可分配 */}
        <div className="flex flex-1 min-h-0 gap-2">
          <label className="mt-2 w-12 shrink-0 text-sm text-muted-foreground">正文</label>
          <div className="flex min-w-0 flex-1 flex-col">
            <DocumentEditor
              key={editorEpoch}
              initialContent={content}
              onChange={handleEditorChange}
              onReady={setEditorApi}
              /* 手动保存统一到工具条（与章正文页同形同位）：动作 = 整页 handleSave；
                 草稿态不注入 ⇒ 工具条不渲染该按钮（动作是带跳转的「创建」，留在下方操作行） */
              save={draft ? undefined : { onSave: () => void handleSave(), saving }}
            />
          </div>
        </div>
        {formError !== null && <p className="text-xs text-destructive">{formError}</p>}
        {/* 操作行**只在草稿态**渲染：草稿态的创建会跳转，不适合放工具条；
            编辑态的「保存」已移到工具条右端（与章正文页同形同位，页头滚动离开也点得到） */}
        {draft && (
          <div className="flex justify-end gap-1.5 pt-1">
            <Button onClick={() => navigate("#/references")} disabled={saving}>
              取消
            </Button>
            <Button type="primary" onClick={handleSave} disabled={saving}>
              {saving && <LoadingOutlined className="text-sm" spin />}
              创建
            </Button>
          </div>
        )}
      </div>

      {/* 建立关联对话框（源端点预填当前 reference；新建态禁用——条目还不存在） */}
      {relationOpen && detail !== null && (
        <CreateRelationDialog
          source={{ type: "reference", id: detail.id, name: detail.name } as RelationSource}
          onCreated={() => {
            setRelationOpen(false);
            useUiStore.getState().showToast("已建立关联");
          }}
          onClose={() => setRelationOpen(false)}
        />
      )}
    </section>
  );
}

/** 时间显示（同 Sidebar 紧凑格式：当年 MM-DD、跨年 YY-MM-DD） */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : `${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
