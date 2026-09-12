// 人物工作台（卡 3.1）：master-detail 宿主——左栏 = 人物列表本身（人物不再有独立列表页），右栏 = 角色详情。
// 契约：docs/ui/DESIGN.md §数据展示 `character-workbench`（左栏 240px + 行样式 + 窄屏两级 + 自动选首个 + 空列表）；
// 路由：`#/characters`（无 id → 推导选中后重定向到 `#/characters/<id>`）/ `#/characters/:id`（选中该角色）。
// 数据：GET /api/v1/entity/character（摘要列表：name/role）+ 右栏复用既有 EntityDetail（受控 {type,id}，本卡不改其内部）。
// 响应式：<1024px 退化为两级——列表全宽 → 点进详情全宽（详情顶部给返回入口）；与「不另立移动端规则」一致。
// 边界：软删当前选中 → EntityDetail 跳回 `#/characters`，本页在「详情 → 列表」跃迁时强制重拉列表并按
//       resolveListRouteSelection 推导「下一个」选中（旧列表快照 + 丢失的 id 都取自 ref，绕开过期列表）。
import { useEffect, useRef, useState } from "react";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { CharacterRail } from "../components/character/character-rail";
import { CharacterDetail } from "../components/character/character-detail";
import { EmptyState } from "../components/ui/empty-state";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { useMediaQuery } from "../hooks/use-media-query";
import { navigate } from "../hooks/use-route";
import { ApiError, CLIENT_NETWORK_ERROR, listEntities } from "../lib/api";
import {
  RAIL_DEFAULT_SORT,
  RAIL_LIMIT,
  railOverflowHint,
  resolveListRouteSelection,
  resolveRailSort,
  toRailItems,
  type CharacterRailItem,
} from "../lib/character-workbench";
import { entityDetailPath, entityListPath } from "../lib/entity-paths";

const LIST_ROUTE = entityListPath("character");

/** 错误码 → 左栏错误文案（与列表页同款映射；网络错误单列） */
function railErrorText(code: string): string {
  return code === CLIENT_NETWORK_ERROR ? "无法连接服务，请重试" : "人物列表加载失败，请重试";
}

export default function CharacterWorkbench({ id }: { id?: string }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [items, setItems] = useState<CharacterRailItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [sortValue, setSortValue] = useState<string>(RAIL_DEFAULT_SORT);
  const [reloadTick, setReloadTick] = useState(0);

  /** 上一次选中（详情路由时更新；回到列表路由后仍保留——软删推导「下一个」的依据） */
  const previousIdRef = useRef<string | null>(null);
  /** 上一次列表快照（软删推导用：已删项已不在新列表，需在旧列表里定位其相邻项） */
  const previousItemsRef = useRef<CharacterRailItem[]>([]);
  /** 最新 id prop（异步加载回调里读最新路由，不引入渲染期依赖） */
  const idRef = useRef<string | undefined>(id);
  idRef.current = id;
  /** 最新桌面态标记（同上：加载回调里判定「是否自动选首个」） */
  const isDesktopRef = useRef(isDesktop);
  isDesktopRef.current = isDesktop;

  // 路由 id ↔ 选中记忆：进入详情 → 记住；详情 → 列表跃迁 → 列表可能已过期（软删），强制重拉
  const prevIdPropRef = useRef<string | undefined>(id);
  useEffect(() => {
    const prev = prevIdPropRef.current;
    prevIdPropRef.current = id;
    if (id !== undefined) {
      previousIdRef.current = id;
      return;
    }
    if (prev !== undefined) setReloadTick((t) => t + 1);
  }, [id]);

  // 搜索防抖 300ms（与泛型列表页同语义）
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  const { sort, order } = resolveRailSort(sortValue);

  // 列表加载：q / 排序 / reloadTick 驱动；过期响应丢弃
  useEffect(() => {
    let cancelled = false;
    const preItems = previousItemsRef.current; // 本次加载前的快照（选中推导用）
    setLoading(true);
    setError(null);
    listEntities("character", { q: q || undefined, limit: RAIL_LIMIT, sort, order })
      .then((res) => {
        if (cancelled) return;
        const railItems = toRailItems(res.items);
        previousItemsRef.current = railItems;
        setItems(railItems);
        setTotal(res.total);
        // 仅在「桌面态 + 列表路由（无 id）」时推导选中并重定向：
        // 窄屏是两级导航（列表 ↔ 详情互斥），若也自动选首个，返回按钮会被立即弹回详情（闭环卡死）
        if (idRef.current !== undefined || !isDesktopRef.current) return;
        const next = resolveListRouteSelection({
          items: railItems,
          previousId: previousIdRef.current,
          previousItems: preItems,
        });
        if (next !== null) navigate(entityDetailPath("character", next));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setItems(null);
        setError(railErrorText(err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, sort, order, reloadTick]);

  // 全局数据刷新（InfoBar 刷新按钮 / AI 提案确认写库）→ 重拉左栏
  useDataRefresh(() => setReloadTick((t) => t + 1));

  const railItems = items ?? [];
  const selectedId = id ?? null;

  const rail = (
    <CharacterRail
      className={isDesktop ? undefined : "w-full border-r-0"}
      items={railItems}
      selectedId={selectedId}
      loading={loading}
      error={error}
      qInput={qInput}
      onQInputChange={setQInput}
      sortValue={sortValue}
      onSortChange={setSortValue}
      overflowHint={railOverflowHint(total, railItems.length)}
      onSelect={(nextId) => navigate(entityDetailPath("character", nextId))}
      onRetry={() => setReloadTick((t) => t + 1)}
    />
  );

  // 窄屏：列表与详情互斥（两级导航）；桌面：并排
  const showRail = isDesktop || id === undefined;
  const showDetail = isDesktop || id !== undefined;

  return (
    // -m-6 / h-[calc(100%+3rem)]：抵消中栏内容区的 p-6（MainPanel 统一内边距），
    // 让本页自己成为「两条独立滚动区」的全高布局（左栏与右栏各自滚动）
    <section className="-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden">
      {showRail && rail}
      {showDetail && (
        <div className="flex min-w-0 flex-1 flex-col">
          {!isDesktop && id !== undefined && (
            <div className="flex shrink-0 items-center border-b border-border px-2 py-1">
              <Button
                color="default"
                variant="text"
                size="small"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate(LIST_ROUTE)}
              >
                人物列表
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {id !== undefined ? (
              // key = id：切角色强制卸载重挂（详情表单按角色重置，既有纪律）；
              // 卡 3.2：右栏改为人物专用详情（双视图 tab）——泛型 EntityDetail 仍服务 setting/location/hook/timepoint
              <CharacterDetail
                key={`character:${id}`}
                id={id}
                onSaved={() => setReloadTick((t) => t + 1)}
              />
            ) : items !== null && items.length === 0 && error === null ? (
              <EmptyState>
                {q.trim() === "" ? "还没有人物" : "没有匹配的人物——换个关键词试试"}
              </EmptyState>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
