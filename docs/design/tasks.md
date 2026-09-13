# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

---

## 当前任务卡

- [ ] **5.5 最后两条建议（卡 5.4 oracle）**
  - (a) **executor 层对 character 已移除字段兜底**：`packages/tools/src/executor/delta.ts` 的手工构造路径同样拒绝 character 的 `status`/`abilities`（与提案层同源），补齐"两层同口径"。
  - (b) **白名单去重**：`SET_ONLY_FIELDS`（hook.status 仅 set）与 `REMOVED_CHARACTER_FIELDS`（character 已移除字段）现为 **client 与 tools 两份手抄**（client 不能 import tools）→ 移到 `packages/shared`（纯常量，无 schema/TypeBox）作为**单一定义**，client 与 tools 各自消费；容器类型统一为数组（tools 内部再转 Set 或用 `includes`）。
  - 测试：(a) 补边界用例；(b) 既有用例全绿 + 可选加一条"shared 常量被两侧引用"的守卫断言。

## 延期项（远期，未排期）

- **能力面板模板库**（跨书复用/命名管理）：现只有「内置 3 套模板 + 从角色复制结构」；升级路径 = 把派生函数的"源"从角色记录换成模板记录（零返工）。
- **自定义关系类型**：`RELATION_TYPES` 是前后端共享常量 + `z.enum` 校验，加类型要动存储校验与工具契约；需要额外语义先用 `metadata`。
- **面板相关 AI 一致性规则**（如"等级不得下降"）：自由结构硬编码规则会大量误报，YAGNI。
- **人物页 Delta 时间线**（该角色跨章节的变更记录列表）：现由 AI 的 `get_delta_history` 覆盖。
- **关系星形图**（纯展示 SVG，零依赖）：需要时再加，不引入布局库。
- **人物页 vs 泛型详情页抽公共层**（`entity-fields.tsx`）：当前口径 = 泛型页冻结、人物页独立演化；批次 4 再评估。
- **卡 3.6 视觉打磨**：其他关联收起态卡片体为空（仅标题 + 条数）；合并行删除后可选 toast 补一句「另一方向的关系仍在」。
- `status` 字段的服务端彻底清理：character 侧已删（`filters.status` 保留给 hook 生命周期，属有意保留）。
