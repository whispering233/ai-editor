# EntityDetail 实体详情原型

## 路由与数据

- 路由：`#/entities/:type/:id`
- 数据：`GET /api/v1/entity/:type/:id` → `{ id, type, name, data, relations[], deltaCount, createdAt, updatedAt }`
- 编辑：`PUT /api/v1/entity/:type/:id`（partial：只传变更字段）
- 软删：`DELETE /api/v1/entity/:type/:id`
- 关系：`POST /api/v1/relation`（新增）、`DELETE /api/v1/relation/:id`（物理删）

## 布局线框

```
┌──────────────────────────────────────────────────────────────────┐
│ [人物] 张三                      [编辑] [问 AI] [⋯ 移入回收站]     │
│ 创建于 8-01 · 更新于 8-02 · 变更记录 5 条                          │
├────────────────────────────────┬─────────────────────────────────┤
│ 基础信息（data 表单）             │ 关联（1 跳）                     │
│ 角色:   [主角            ]       │ 师徒 → 李四             [删除]  │
│ 性别:   [男              ]       │ 出现于 → 第3章·灵根测试   [删除]  │
│ 年龄:   [16              ]       │ 掌握 → 火球术            [删除]  │
│ 性格:   [坚韧] [谨慎] [多疑] +   │                                 │
│ 动机:   [复仇            ]       │ [+ 新增关联]                     │
│ 能力:   [火球术] [御剑] +         │                                 │
│ 状态:   [活跃            ]       │                                 │
│                        [保存]    │                                 │
└────────────────────────────────┴─────────────────────────────────┘
```

## 信息层级

### data 表单（按类型差异化；data 内部字段原样 snake_case 透传）

| 类型 | 字段与控件 |
|------|-----------|
| character | `role` 文本 · `gender` 文本 · `age` 数字 · `personality[]` 标签列表 · `motivation` 多行 · `abilities[]` 标签列表 · `status` 文本 · `custom_fields` 键值组 |
| setting | `category` 文本 · `parent_id` 文本 · `description` 多行 · `rules[]` 标签列表 · `custom_fields` |
| location | `type` 文本 · `parent_id` 文本 · `description` 多行 · `custom_fields` |
| hook | `status` 下拉（planted/progressing/resolved/abandoned）· `category` 文本 · `expected_payoff` 多行 · `payoff_timing` 下拉 · `half_life` 数字 · `is_core` 开关 · `notes` 多行 · `expected_resolve_node_id` 大纲节点选择器 |

- 字段来源：响应 `data`（Record<string, unknown>，原样透传）；编辑提交 `PUT { data: { 变更字段 } }`（partial 合并，未改字段不提交）。
- 未出现的字段不渲染；`custom_fields` 为空时不显示。

### 关联区（紧邻 1 跳）

| 展示 | API 字段 |
|------|---------|
| 关系行 | `relations[].relationType` + `sourceName`/`targetName`（本实体在任一端都展示，行内标注方向箭头） |
| 计数 | `deltaCount`（仅数字展示；MVP 无按实体查 Delta 的 REST 端点，不提供明细，见冲突点） |
| 时间 | `createdAt` / `updatedAt` |

## 关键交互

- **编辑**：字段直接编辑，[保存] → `PUT` partial → toast「已保存」；保存中禁用按钮。
- **新增关联**：对话框（另一端类型 + 实体搜索选择 + 关系类型下拉，如 ally/rival/appears_in 等）→ `POST /relation`；`RELATION_EXISTS` → 提示「这条关系已经存在」。
- **删关系**：确认框（提示：物理删除不可恢复，可重新建立）→ `DELETE /relation/:id`。
- **软删**：⋯ 菜单 → 确认框展示级联（响应 `cascaded.relations` / `cascaded.deltas`）→ 删除 → 跳回列表 + toast「已移入回收站，可随时还原」。
- **问 AI**：注入右栏 ChatPanel 当前会话 context `{ focus_entity_type, focus_entity_id }`（不再跳独立聊天页，layout.md §4.2）；右栏显示「正在讨论：张三」focus 小条。
- **变更记录**：`deltaCount` 数字点击（可选）→ 展开提示「查看状态变化请在大纲中按节点查看，或在聊天中让 AI 计算」（MVP 无对应 REST 明细端点）。

## 状态

- **错误态（关键）**：`ENTITY_NOT_FOUND`（404）→ 居中「该实体不存在或已被删除」+ [去回收站]（`#/trash`）+ [返回列表]。
- **加载态**：表单骨架。
- **空关联**：「暂无关联，新增一个」+ [新增关联]。
- **保存失败**：`VALIDATION_ERROR` → 表单内联错误（如 name 超长）；`ENTITY_NOT_FOUND` → 提示已删除并引导返回。
