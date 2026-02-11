# ComfyUI 网关 - 前端集群管理设计

## 目标

为网关提供一个**前端管理页面**，用于在一个界面内管理整个 ComfyUI 集群：注册/查看/启停 Worker、查看队列与任务状态、必要时提交测试任务。

---

## 技术选型

| 项目 | 选择 | 说明 |
|------|------|------|
| 框架 | **Vite + React** | 开发体验好、构建快，与网关解耦 |
| 样式 | **Tailwind CSS** | 快速实现统一、易维护的界面 |
| 请求 | **fetch** 或 **axios** | 调用网关 REST API，同源部署无需 CORS |
| 状态 | **React 本地 state + 轮询** | 首版不做 Redux；队列/任务状态定时刷新即可 |

前端构建产物（如 `dist/`）由 **FastAPI 静态文件挂载** 提供，访问 `http://网关地址/` 即打开管理页，与 API 同源。

---

## 页面与路由（单页应用）

| 路由 | 页面 | 功能摘要 |
|------|------|----------|
| `/` | 仪表盘 | 集群概览：Worker 数量、健康状态、总队列/运行中任务；各 Worker 队列卡片 |
| `/workers` | Worker 管理 | 列表（含状态、队列长度、启用开关）、新增、编辑、删除 |
| `/queue` | 队列总览 | 聚合所有 Worker 的 running/pending，表格展示 prompt_id、worker、状态、位置 |
| `/tasks` | 任务查询 | 按 prompt_id 查单任务状态（queued/running/done/failed）、进度、所属 Worker；可选近期任务列表 |
| `/submit` | 提交测试 | 表单：粘贴 workflow JSON、可选 client_id，提交后显示 prompt_id 与跳转任务详情 |

顶部导航固定，便于在「仪表盘 / Workers / 队列 / 任务 / 提交」之间切换。

---

## 页面详细设计

### 1. 仪表盘 `/`

- **集群概览卡片**：Worker 总数、健康数、总 pending、总 running。
- **Worker 卡片列表**：每个 Worker 一块卡片，展示：
  - 名称/URL、健康状态（绿/灰/红）、enabled 开关（可点选调用 PATCH）
  - 当前队列：running 数量、pending 数量
  - 快捷操作：「查看队列」「禁用/启用」
- 每 5–10 秒轮询一次 `GET /queue`（或 `GET /workers` 含负载）刷新数据。

### 2. Worker 管理 `/workers`

- **列表表格**：列：名称、URL、状态（健康/不健康）、队列（running + pending）、权重、启用、操作（编辑、删除）。
- **新增 Worker**：表单字段 `url`（必填）、`name`（可选）、`weight`（可选），提交 `POST /workers`。
- **编辑**：弹窗或内联编辑，`PATCH /workers/{id}` 更新 name、weight、enabled。
- **删除**：确认后 `DELETE /workers/{id}`。
- 列表数据来自 `GET /workers`，可定时刷新。

### 3. 队列总览 `/queue`

- **表格**：所有 Worker 的 running + pending 任务聚合。
  - 列：prompt_id、worker_id/名称、状态（running/pending）、队列位置、提交时间（若 API 返回）。
- 数据来源：`GET /queue`（网关聚合接口），定时刷新（如每 5 秒）。

### 4. 任务查询 `/tasks`

- **按 prompt_id 查询**：输入框 + 按钮，请求 `GET /task/{prompt_id}/status`，展示：
  - 状态（queued / running / done / failed）、进度（若有）、所属 Worker、简要 message。
  - 若为 done，提供「查看 History」链接（或直接请求 `GET /history/{prompt_id}` 展示结果摘要/输出节点）。
- **近期任务**（可选）：若网关提供 `GET /tasks?limit=20` 则展示；否则可由前端保留最近查询过的 prompt_id 列表做快捷入口。

### 5. 提交测试 `/submit`

- **表单**：
  - 文本框：粘贴 workflow JSON（与 ComfyUI 一致）。
  - 可选：client_id（默认可前端生成 UUID）。
- 提交后调用 `POST /prompt`，成功则显示返回的 `prompt_id`（及 number），并提供「前往任务详情」链接跳转到 `/tasks?prompt_id=xxx`。

---

## 与网关 API 的对应关系

| 前端能力 | 使用的 API |
|----------|------------|
| Worker 列表与状态 | `GET /workers` |
| 新增 Worker | `POST /workers` |
| 更新 Worker | `PATCH /workers/{id}` |
| 删除 Worker | `DELETE /workers/{id}` |
| 集群/队列概览 | `GET /queue`（聚合） |
| 单任务状态与进度 | `GET /task/{prompt_id}/status` |
| 任务结果 | `GET /history/{prompt_id}` |
| 提交任务 | `POST /prompt` |

前端不直接调用 ComfyUI 原生接口，全部通过网关，便于权限与统一错误处理。

---

## 后端配合

- **静态资源**：FastAPI 将前端构建产物挂载到根路径，例如：
  - 构建输出目录：`frontend/dist`
  - 挂载：`app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")`
  - 这样 `GET /`、`/workers`、`/queue` 等由 SPA 的 index.html 接管。
- **API 前缀**（可选）：若希望 API 与页面分离，可统一使用 `/api` 前缀（如 `/api/workers`、`/api/prompt`），前端请求均带 `/api`；若不加前缀，则需保证前端路由与 API 路径不冲突（当前 API 为 `/workers`、`/prompt`、`/history/...`、`/queue`、`/task/...`，与前端路由 `/workers`、`/submit` 等可通过「API 仅接受 JSON 或特定 Method」区分，或统一加 `/api` 更清晰）。**建议**：网关 API 统一加前缀 `/api`，前端 baseURL 为 `/api`。

---

## 项目结构（前端）

```
comfyui-gateway/
├── app/                    # 后端 FastAPI
│   └── ...
├── frontend/               # 前端 SPA
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts      # 开发时 proxy /api -> 网关
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx         # 路由与布局
│   │   ├── api.ts          # 封装 fetch 调用 /api
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Workers.tsx
│   │   │   ├── Queue.tsx
│   │   │   ├── Tasks.tsx
│   │   │   └── Submit.tsx
│   │   └── components/
│   │       ├── Layout.tsx   # 顶栏 + 导航
│   │       ├── WorkerCard.tsx
│   │       └── ...
│   └── dist/               # 构建输出，由 FastAPI 挂载
└── docs/
    └── FRONTEND_DESIGN.md  # 本文档
```

---

## 实现顺序建议

1. 后端先实现并稳定 `GET /workers`、`GET /queue`、`GET /task/{id}/status`、`POST /prompt`、`POST/PATCH/DELETE /workers`，且 API 统一为 `/api` 前缀。
2. 初始化前端：Vite + React + Tailwind，配置 dev 时 proxy `/api` 到网关。
3. 实现 `api.ts` 与各页面：先仪表盘与 Worker 管理，再队列与任务查询，最后提交测试页。
4. 构建 frontend，在 FastAPI 中挂载 `frontend/dist`，并配置 SPA fallback（所有非 API 的 GET 返回 index.html）。

按此设计即可在同一个网关下通过前端页面管理整个 ComfyUI 集群，并与现有计划中的 REST API 保持一致。
