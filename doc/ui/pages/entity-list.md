# EntityList 实体列表原型

## 路由与数据

- 路由：`#/entities/:type?`（type ∈ character|setting|location|hook，缺省 character；tab 切换即改 hash）
- 数据：`GET /api/v1/entity/:type?q=&offset=&limit=&sort=&order=`
- 新建：`POST /api/v1/entity/:type`

## 布局线框

```
┌──────────────────────────────────────────────────────────┐
│ [人物] [设定] [地点] [伏笔]        [🔍 搜索名称…]  [+ 新建]  │
├──────────────────────────────────────────────────────────┤
│ 排序: [更新时间 ▾]                        共 24 个         │
├──────────────────────────────────────────────────────────┤
│ 名称          角色       状态      更新时间                 │
│ 张三          主角       活跃      8-01                    │
│ 李四          配角       退场      7-28                    │
│ …                                                        │
├──────────────────────────────────────────────────────────┤
│               ‹ 上一页   第 2 / 3 页   下一页 ›             │
└──────────────────────────────────────────────────────────┘
```

## 信息层级

列表接口返回 `EntitySummary`（不含完整 data），各类型摘要列取自 `summary`：

| 列 | character | setting | location | hook |
|----|-----------|---------|----------|------|
| 名称 | `name` | `name` | `name` | `name` |
| 摘要列 1 | `summary.role` | `summary.category` | `summary.type` | `summary.status` |
| 摘要列 2 | `summary.status` | — | — | `summary.payoff_timing` |
| 时间 | `updatedAt`（相对时间） | 同左 | 同左 | 同左 |

分页元数据：`total` / `offset` / `limit`。

## 关键交互

- **Tab 切换**：改 hash（`#/entities/location`）；MVP 切换时重置搜索与分页（保持简单）。
- **搜索**：`q` 输入防抖 300ms 发请求；空关键词跳过请求直接显示列表。
- **排序**：`sort`（name / created_at / updated_at）× `order`（asc / desc）下拉。
- **分页**：limit 固定 20（MVP）；前端按页码换算 `offset` 提交，用返回的 `total` 算总页数。
- **新建**：对话框（`name` 必填 + 该类型首字段，如 character 的 `role`）→ `POST /entity/:type` → 成功跳详情页。
- **行点击** → `#/entities/:type/:id`。

## 状态

- **空态（两种，文案区分）**：
  - 该类型无任何实体：「还没有人物，新建一个」+ [新建]。
  - 搜索无结果：「没有匹配「xxx」的实体」+ [清空搜索]。
- **加载态**：列表骨架。
- **错误态**：列表请求失败 → 区块内重试；`VALIDATION_ERROR`（如 limit 超 200）→ toast。
