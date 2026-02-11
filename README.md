# ComfyUI 负载均衡网关

可替代 ComfyUI 原生请求的网关：支持多 Worker 注册与按负载分发、任务进度查询、以及便于 n8n 等工具接入的 REST API，并提供前端集群管理页面。

## 功能

- **多 Worker 注册**：注册多个 ComfyUI 实例（Worker），网关按当前队列长度将任务发往负载最小的 Worker。
- **任务进度**：通过 `GET /api/task/{prompt_id}/status` 查询任务状态（queued / running / done / failed）。
- **兼容 ComfyUI API**：`POST /api/prompt`、`GET /api/history/{prompt_id}` 与 ComfyUI 一致，仅需将原 ComfyUI 的 base URL 改为网关地址即可（注意路径加 `/api` 前缀）。
- **前端管理**：访问网关根路径可打开集群管理页，管理 Worker、查看队列与任务、提交测试。
- **Worker 反向代理认证**：若 ComfyUI 节点在 nginx 等反向代理后并启用了 Basic 认证，可在 **配置文件**（`.env`）中设置 `WORKER_AUTH_USERNAME` 与 `WORKER_AUTH_PASSWORD`，则所有 Worker 请求都会带该认证；也可在管理页添加/编辑 Worker 时单独填写「认证用户名」「认证密码」（单 Worker 配置优先于全局配置）。

## 环境

- Python 3.10+
- 可选：**MySQL**（推荐持久化）：Worker 注册、任务映射、队列、全局设置均落库，多实例或重启不丢数据。需先建库并执行 `docs/mysql_schema.sql`，再在 `.env` 中配置 `MYSQL_DATABASE` 等（见下方配置表）。
- 可选：Redis（未配置 MySQL 时用于持久化 Worker 与映射；若已配置 MySQL，Redis 仅作队列缓存等可选用途）

若不配置 MySQL 与 Redis，网关使用内存存储（重启后需重新注册 Worker，历史任务映射会丢失）。

## 配置

通过环境变量（可复制 `env.example` 为 `.env` 后按需填写）：

| 变量 | 说明 |
|------|------|
| `REDIS_URL` | 可选。Redis 连接地址。不填则使用内存存储。格式：`redis://[用户名]:[密码]@host:port/库号`；无用户名时写 `redis://:密码@host:6379/0`；密码含特殊字符需 URL 编码。 |
| `QUEUE_CACHE_TTL_SECONDS` | 队列缓存时间（秒），默认 5。 |
| `WORKER_REQUEST_TIMEOUT` | 请求 Worker 的超时（秒），默认 30。 |
| `WORKER_AUTH_USERNAME` | 可选。所有 Worker 共用的反向代理（如 nginx）Basic 认证用户名，可在 `.env` 中填写。 |
| `WORKER_AUTH_PASSWORD` | 可选。上述认证密码。未设置时仅使用各 Worker 在管理页/API 中单独配置的账密。 |
| `MYSQL_HOST` | 可选。MySQL 主机，默认 `localhost`。 |
| `MYSQL_PORT` | 可选。MySQL 端口，默认 `3306`。 |
| `MYSQL_USER` | 可选。MySQL 用户名。 |
| `MYSQL_PASSWORD` | 可选。MySQL 密码。 |
| `MYSQL_DATABASE` | 可选。**启用 MySQL 持久化的开关**：设置后网关将 Worker、任务映射、队列、全局设置写入 MySQL。需先在 MySQL 中建库并执行 **`docs/mysql_schema.sql`** 建表。 |

**MySQL 建表**：在已有 MySQL 节点上创建数据库后执行：`mysql -h HOST -u USER -p DATABASE < docs/mysql_schema.sql`。

## 安装与运行

### 一键启动（推荐）

在项目根目录执行（会自动创建 venv、安装依赖、构建前端并启动）：

```bash
# macOS / Linux
chmod +x run.sh && ./run.sh

# Windows 命令行
run.bat
```

首次运行会安装 Python 依赖并构建前端；若已配置 `.env`（或环境变量 `REDIS_URL`），会使用 Redis。启动后访问 **http://localhost:8000** 为管理页。

### 手动启动

```bash
cd comfyui-gateway
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# 若使用 Redis，填写地址（可带账密）：
# export REDIS_URL=redis://用户:密码@host:6379/0
# 无用户名: redis://:密码@host:6379/0
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. 前端（开发时可选）

前端已按设计由后端挂载；若需单独开发前端：

```bash
cd frontend
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`，API 会通过 Vite 代理到 `http://127.0.0.1:8000`。

### 3. 生产（后端 + 前端一体）

先构建前端，再由后端挂载静态资源：

```bash
cd frontend && npm install && npm run build && cd ..
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

访问 `http://localhost:8000` 即为管理页，API 为 `http://localhost:8000/api/...`。

## API 摘要

- `GET /api/workers` - Worker 列表与状态  
- `POST /api/workers` - 注册 Worker（body: `url`, 可选 `name`, `weight`）  
- `PATCH /api/workers/{id}` - 更新 Worker  
- `DELETE /api/workers/{id}` - 删除 Worker  
- `POST /api/prompt` - 提交工作流。Body：`prompt`, `client_id?`, **`priority?`**。不传 `priority` 则立即提交并返回 `prompt_id`；传 `priority`（数值越大越优先）则进入网关插队队列，返回 `gateway_job_id`，需轮询 `GET /api/task/gateway/{gateway_job_id}` 拿到 `prompt_id` 后再查 history/status。
- `GET /api/task/gateway/{gateway_job_id}` - 插队任务状态：`queued` | `submitted` | `running` | `done` | `failed`，提交后含 `prompt_id`。  
- `GET /api/history/{prompt_id}` - 任务结果。网关会在响应中为每张图片/每个视频等自动注入 **url** 字段（指向本网关的 `/api/view`），业务侧可直接用 `history.outputs[node_id].images[i].url`，无需再拼接 host + /view。**若任务还没跑完**：ComfyUI 仍返回 200，但 body 多为空 `{}` 或没有 `outputs`，建议先轮询 `GET /api/task/{prompt_id}/status`，等 `status === "done"` 再调本接口。  
- `GET /api/queue` - 聚合队列状态  
- `GET /api/task/{prompt_id}/status` - 单任务状态与进度  
- `GET /api/view?filename=...&subfolder=...&type=...&prompt_id=...` - 代理取图（必须带 `prompt_id`）  

## n8n 接入

将原先请求 ComfyUI 的 HTTP 节点中的「URL」改为网关地址，并加上 `/api` 前缀，例如：

- 提交：`POST http://网关地址/api/prompt`，Body 为 `{ "prompt": <workflow_json>, "client_id": "<uuid>" }`。  
- 查结果：`GET http://网关地址/api/history/{{ $json.prompt_id }}`。  
- 查状态：`GET http://网关地址/api/task/{{ $json.prompt_id }}/status`。  

## 项目结构

```
comfyui-gateway/
├── app/
│   ├── main.py          # FastAPI，挂载 /api 与静态前端
│   ├── config.py        # 环境变量（含可选 REDIS_URL）
│   ├── workers.py       # Worker 注册与负载缓存
│   ├── store.py         # prompt_id -> worker 映射（内存或 Redis）
│   ├── load_balancer.py # 选 Worker 逻辑
│   ├── client.py        # 请求 ComfyUI 的 httpx 封装
│   └── routes/          # /api 下各路由
├── frontend/            # Vite + React + Tailwind 管理页
├── docs/
└── requirements.txt
```
