# 核心 API 端点设计

所有 API 遵循 REST 风格，由 Hono 框架实现，前端通过 Vite proxy 转发 `/api` 请求到 `localhost:3456`。

## 项目管理

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/v1/project/create` | 创建项目，body: `{path, config}` |
| `POST` | `/api/v1/project/open`   | 打开项目，body: `{path}` |
| `POST` | `/api/v1/project/close`  | 关闭项目 |
| `GET`  | `/api/v1/project/config` | 获取项目配置 |
| `PUT`  | `/api/v1/project/config` | 更新项目配置（名称/类型/提示词） |

## 实体 CRUD

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET`    | `/api/v1/entity/:type`         | 列出实体（`:type` = character/setting/location/hook） |
| `GET`    | `/api/v1/entity/:type?q=关键词` | 搜索实体 |
| `GET`    | `/api/v1/entity/:type/:id`      | 获取实体详情 |
| `POST`   | `/api/v1/entity/:type`          | 创建实体，body: `{name, data}` |
| `PUT`    | `/api/v1/entity/:type/:id`      | 更新实体，body: `{patches}` |
| `DELETE` | `/api/v1/entity/:type/:id`      | 删除实体（级联删除关联关系和 Delta） |

## 关系管理

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET`    | `/api/v1/relation?type=&id=&depth=`      | 查询关系（depth=1 紧邻 / 2 k跳 / 3 全量） |
| `POST`   | `/api/v1/relation`                       | 建立关系 |
| `DELETE` | `/api/v1/relation/:id`                    | 删除关系 |

## Delta 变更追踪

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/v1/delta`                  | 追加变更记录 |
| `GET`  | `/api/v1/delta/node/:nodeId`      | 获取某节点触发的所有 Delta |
| `POST` | `/api/v1/delta/compute`           | 计算实体到达某节点时的状态，body: `{ref, nodeId, pathIds}` |

## 大纲操作

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET`    | `/api/v1/outline`               | 获取完整大纲树 |
| `POST`   | `/api/v1/outline`               | 创建节点，body: `{type, title, parent_id?}` |
| `PUT`    | `/api/v1/outline/:nodeId`       | 更新节点（title/summary） |
| `PUT`    | `/api/v1/outline/:nodeId/move`  | 移动节点，body: `{parentId, order}` |
| `DELETE` | `/api/v1/outline/:nodeId`       | 删除节点（级联删除子节点） |
| `GET`    | `/api/v1/outline/:nodeId/path`  | 获取从根到该节点的路径 ID 列表 |
