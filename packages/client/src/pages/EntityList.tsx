// 实体列表页（S3.5；替换 T7.1 占位壳；U8 增补第 5 个「关联」tab）
// 路由：#/entities/:type?（type ∈ character|setting|location|hook，缺省 character——main.tsx 归一化；
//   "relations" 由 main.tsx 先拦截传入本页，不参与归一化）；
//   四类 tab 切换即改 hash（useHashRoute 驱动），hash 变化 → main.tsx 传新 type → 本页重置查询状态
// 数据：GET /api/v1/entity/:type?q=&offset=&limit=&sort=&order=（EntitySummary 摘要列表）
// 契约：doc/ui/pages/entity-list.md——tab/搜索防抖 300ms/排序下拉/分页（limit 20、total 驱动）/
//   摘要列按类型（lib/entity-list.ts SUMMARY_COLUMNS）/空态两种文案区分/行点击跳详情（S3.6）；
//   「关联 Tab（U8 增补）」——type==="relations" 渲染 RelationsView（前端过滤全量关系），
//   「+ 新建」变「+ 建立关联」打开共用 CreateRelationDialog（列表模式，源可选）
// 软删：服务端默认过滤（决策 12 修订）；回收站入口 #/trash 由 S4 卡实现，本卡不提供入口
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ENTITY_TYPES } from "@whispering233/ai-editor-shared";
import type { EntitySummary, EntityType } from "@whispering233/ai-editor-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  createEntity,
  listEntities,
  type EntityListRes,
} from "../lib/api";
import { CREATE_FIRST_FIELD, PAGE_LIMIT, pageCount, SUMMARY_COLUMNS, summaryCellText } from "../lib/entity-list";
import { cn } from "../lib/utils";
import { navigate } from "../hooks/use-route";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useUiStore } from "../stores/ui";
import { formatTimestamp } from "@whispering233/ai-editor-shared";
import { CreateRelationDialog } from "../components/entity/create-relation-dialog";
import { RelationsView } from "../components/entity/relations-view";

const TYPE_LABEL: Record<EntityType, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  // C1 类型补全（决策 26 event 时间轴事件；时间轴专属 UI 由 C2 实现）
  event: "事件",
};

/** 排序下拉选项（sort × order 组合；默认更新时间倒序） */
const SORT_OPTIONS: Array<{
  value: string;
  label: string;
  sort: "name" | "created_at" | "updated_at";
  order: "asc" | "desc";
}> = [
  { value: "updated_at:desc", label: "更新时间（新→旧）", sort: "updated_at", order: "desc" },
  { value: "updated_at:asc", label: "更新时间（旧→新）", sort: "updated_at", order: "asc" },
  { value: "name:asc", label: "名称（A→Z）", sort: "name", order: "asc" },
  { value: "name:desc", label: "名称（Z→A）", sort: "name", order: "desc" },
  { value: "created_at:desc", label: "创建时间（新→旧）", sort: "created_at", order: "desc" },
  { value: "created_at:asc", label: "创建时间（旧→新）", sort: "created_at", order: "asc" },
];

export default function EntityList({ type }: { type: string }) {
  /** 关联 tab（U8）：type==="relations" 时渲染关联总览视图，不参与四类实体逻辑 */
  const isRelations = type === "relations";
  // main.tsx 已把未知 type 归一化为 character；此处双保险
  const entityType = (ENTITY_TYPES as readonly string[]).includes(type) ? (type as EntityType) : "character";

  const [items, setItems] = useState<EntitySummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 搜索框即时值（防抖输入） */
  const [qInput, setQInput] = useState("");
  /** 防抖后的查询关键词（空 = 不过滤） */
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<"name" | "created_at" | "updated_at">("updated_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  /** 重试计数（错误后手动重新加载） */
  const [reloadTick, setReloadTick] = useState(0);
  // 数据变更信号（问题 1）：AI 提案确认写库 / InfoBar 刷新按钮 → 重拉列表
  // （关联 tab 的 RelationsView 以 reloadKey={reloadTick} 联动刷新；ref 守卫防首帧重复拉）
  useDataRefresh(() => setReloadTick((t) => t + 1));
  const [createOpen, setCreateOpen] = useState(false);
  // 新建对话框表单状态
  const [createName, setCreateName] = useState("");
  const [firstValue, setFirstValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const col = SUMMARY_COLUMNS[entityType];
  const firstField = CREATE_FIRST_FIELD[entityType];
  const pages = pageCount(total, PAGE_LIMIT);
  const page = Math.floor(offset / PAGE_LIMIT) + 1;

  // tab 切换（type 变化，含进出关联 tab）：重置搜索/分页/排序（原型「MVP 切换时重置搜索与分页」）
  useEffect(() => {
    setQInput("");
    setQ("");
    setOffset(0);
    setSort("updated_at");
    setOrder("desc");
    setItems(null);
    setError(null);
    setCreateOpen(false);
  }, [type]);

  // 搜索防抖 300ms；关键词变化时页码重置 0（同批 setState，只发一次请求）
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // 列表加载：type/q/offset/sort/order 变化驱动；卸载或参数变化时丢弃过期响应
  // 关联 tab：列表请求不发起（RelationsView 自己拉全量关系），进出 tab 由 isRelations 触发兜底
  useEffect(() => {
    if (isRelations) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEntities(entityType, {
      q: q || undefined,
      offset,
      limit: PAGE_LIMIT,
      sort,
      order,
    })
      .then((res: EntityListRes) => {
        if (!cancelled) {
          setItems(res.items);
          setTotal(res.total);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setItems(null);
          setError(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, q, offset, sort, order, reloadTick, isRelations]);

  /** 排序切换：重置页码（原型交互） */
  function handleSortChange(value: string) {
    const opt = SORT_OPTIONS.find((o) => o.value === value);
    if (!opt) return;
    setSort(opt.sort);
    setOrder(opt.order);
    setOffset(0);
  }

  /** 新建对话框提交：POST → toast → 跳详情页（原型「成功跳详情页」） */
  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    // name 必填（服务端 1-100 校验；前端先拦空值）
    const name = createName.trim();
    if (!name) {
      setCreateError("请输入名称");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const first = CREATE_FIRST_FIELD[entityType];
      const data: Record<string, unknown> = {};
      if (firstValue.trim()) data[first.key] = firstValue.trim();
      const res = await createEntity(entityType, { name, data });
      useUiStore.getState().showToast(`已创建${TYPE_LABEL[entityType]}《${name}》`);
      setCreateOpen(false);
      navigate(`/entities/${entityType}/${res.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "创建失败，请重试");
    } finally {
      setCreateSubmitting(false);
    }
  }

  /** 清空搜索（搜索空态操作） */
  function clearSearch() {
    setQInput("");
    setQ("");
    setOffset(0);
  }

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">实体</h1>

      {/* 顶部：五类 tab（四类实体 + 关联，U8）+ 搜索 + 新建/建立关联 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 pb-3">
        <div className="flex gap-1">
          {ENTITY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => navigate(`/entities/${t}`)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                !isRelations && entityType === t
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800",
              )}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
          {/* 关联 tab（第 5 个，token 样式；激活态反相对比 bg-foreground/text-background，同 Breadcrumb） */}
          <button
            type="button"
            onClick={() => navigate("/entities/relations")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              isRelations
                ? "bg-foreground font-medium text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            关联
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isRelations && (
            <Input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={`搜索${TYPE_LABEL[entityType]}名称…`}
              className="w-52"
            />
          )}
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {isRelations ? "+ 建立关联" : "+ 新建"}
          </Button>
        </div>
      </div>

      {/* 关联 tab：关系总览视图（前端过滤全量）；四类实体 tab：原列表视图（行为不变） */}
      {isRelations ? (
        <RelationsView reloadKey={reloadTick} onOpenCreate={() => setCreateOpen(true)} />
      ) : (
        <>
      {/* 排序行 + 总数 */}
      <div className="mb-2 mt-3 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          排序:
          <select
            value={`${sort}:${order}`}
            onChange={(e) => handleSortChange(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-sm text-zinc-400">共 {total} 个</span>
      </div>

      {/* 错误横幅（列表请求失败） */}
      {error !== null && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error === CLIENT_NETWORK_ERROR
            ? "无法连接服务，请确认 ai-editor 服务已启动。"
            : "列表加载失败，请重试。"}
          <Button variant="outline" className="ml-3" type="button" onClick={() => setReloadTick((t) => t + 1)}>
            重试
          </Button>
        </div>
      )}

      {/* 加载骨架（首次加载） */}
      {loading && items === null && error === null && (
        <div className="overflow-hidden rounded-md border border-zinc-200">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-zinc-100 px-3 py-3 last:border-0">
              <div className="h-4 w-1/4 animate-pulse rounded bg-zinc-100" />
              <div className="h-4 w-1/6 animate-pulse rounded bg-zinc-100" />
              {col.key2 && <div className="h-4 w-1/6 animate-pulse rounded bg-zinc-100" />}
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-zinc-100" />
            </div>
          ))}
        </div>
      )}

      {/* 空态（两种文案区分：无实体 vs 搜索无结果） */}
      {!loading && items !== null && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center">
          {q ? (
            <>
              <p className="text-sm text-zinc-600">没有匹配「{q}」的{TYPE_LABEL[entityType]}</p>
              <Button variant="outline" className="mt-4" type="button" onClick={clearSearch}>
                清空搜索
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-600">还没有{TYPE_LABEL[entityType]}，新建一个</p>
              <Button className="mt-4" type="button" onClick={() => setCreateOpen(true)}>
                + 新建{TYPE_LABEL[entityType]}
              </Button>
            </>
          )}
        </div>
      )}

      {/* 列表表格 */}
      {!loading && items !== null && items.length > 0 && (
        <div className="overflow-hidden rounded-md border border-zinc-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-400">
                <th className="px-3 py-2 font-normal">名称</th>
                <th className="px-3 py-2 font-normal">{col.label1}</th>
                {col.key2 && <th className="px-3 py-2 font-normal">{col.label2}</th>}
                <th className="px-3 py-2 text-right font-normal">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50"
                  onClick={() => navigate(`/entities/${entityType}/${item.id}`)}
                  title={`打开《${item.name}》`}
                >
                  <td className="max-w-64 truncate px-3 py-2 font-medium text-zinc-800">{item.name}</td>
                  <td className="max-w-40 truncate px-3 py-2 text-zinc-600">
                    {summaryCellText(entityType, col.key1, item.summary[col.key1])}
                  </td>
                  {col.key2 && (
                    <td className="max-w-40 truncate px-3 py-2 text-zinc-600">
                      {summaryCellText(entityType, col.key2, item.summary[col.key2])}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-zinc-400">
                    {formatTimestamp(item.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页控件（total 驱动；MVP limit 固定 20） */}
      {!loading && items !== null && items.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1 || loading}
            className="rounded-md border border-zinc-300 px-3 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
            onClick={() => setOffset((page - 2) * PAGE_LIMIT)}
          >
            ‹ 上一页
          </button>
          <span className="text-zinc-500">
            第 {page} / {pages} 页
          </span>
          <button
            type="button"
            disabled={page >= pages || loading}
            className="rounded-md border border-zinc-300 px-3 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40"
            onClick={() => setOffset(page * PAGE_LIMIT)}
          >
            下一页 ›
          </button>
        </div>
      )}

      {/* 新建对话框：name 必填 + 该类型首字段（原型交互） */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建{TYPE_LABEL[entityType]}</DialogTitle>
          </DialogHeader>
          <form id="create-entity-form" onSubmit={handleCreate} className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-sm font-medium text-zinc-700">名称（必填）</p>
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={`如：${entityType === "character" ? "张三" : "示例名称"}`} maxLength={100} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-zinc-700">{firstField.label}</p>
              {firstField.input === "select" ? (
                <select
                  value={firstValue}
                  onChange={(e) => setFirstValue(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                >
                  {firstField.options?.map((opt) => (
                    <option key={opt} value={opt}>
                      {summaryCellText(entityType, firstField.key, opt)}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={firstValue}
                  onChange={(e) => setFirstValue(e.target.value)}
                  placeholder={entityType === "character" ? "如：主角 / 配角" : "选填"}
                />
              )}
            </div>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
              取消
            </Button>
            <Button type="submit" form="create-entity-form" disabled={createSubmitting}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}

      {/* 关联 tab 建立关联对话框（列表模式：源实体可选，U8） */}
      {isRelations && createOpen && (
        <CreateRelationDialog
          source={null}
          onCreated={() => setReloadTick((t) => t + 1)}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </section>
  );
}
