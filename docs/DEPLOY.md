# ComfyUI Gateway 部署说明

支持 Docker 一键部署，也可在服务器上直接跑 Python。

## 一、Docker 一键部署（推荐）

### 1. 环境要求

- 已安装 [Docker](https://docs.docker.com/get-docker/) 与 [Docker Compose](https://docs.docker.com/compose/install/)（或 Compose V2 插件）

### 2. 部署步骤

```bash
# 克隆或上传项目到服务器
cd comfyui-gateway

# 首次运行会从 env.example 生成 .env，按需修改
./deploy.sh
```

若未配置 `.env`，首次执行会复制 `env.example` 为 `.env`，请编辑后再执行一次 `./deploy.sh`。

### 3. 配置 .env（重要）

| 变量 | 说明 | 默认 / 示例 |
|------|------|----------------|
| `PORT` | 网关对外端口 | `8000` |
| `REDIS_URL` | Redis 地址（持久化 Worker/队列等） | 使用 compose 内 Redis 时为 `redis://redis:6379/0` |
| `MYSQL_DATABASE` | 启用 MySQL 持久化时填写 | 如 `comfyui_gateway` |
| `MYSQL_HOST` | MySQL 主机（用 MySQL 时） | 宿主机访问容器用 `host.docker.internal` 或实际 IP |
| `MYSQL_PORT` | MySQL 端口 | `3306` |
| `MYSQL_USER` / `MYSQL_PASSWORD` | MySQL 账号 | - |
| `WORKER_AUTH_USERNAME` / `WORKER_AUTH_PASSWORD` | 全局 Worker 反向代理 Basic 认证 | 可选 |
| `NAS_PATH` | NAS 挂载路径（宿主机） | `/data/spciyai` |
| `COMFYUI_MODELS_ROOT` | 容器内模型存储路径 | `/data/models` |
| `CIVITAI_API_TOKEN` | Civitai API Token（下载模型） | 从 https://civitai.com/user/account 获取 |

- **仅用 Redis**：保持 `REDIS_URL=redis://redis:6379/0`，compose 会一起启动 Redis。
- **使用外部 Redis**：在 `.env` 中设置 `REDIS_URL=redis://你的Redis主机:6379/0`，并修改 `docker-compose.yml`，去掉 `gateway` 的 `depends_on: redis`，且不再启动 `redis` 服务。
- **使用 MySQL**：在 MySQL 中建库并执行 `docs/mysql_schema.sql`，在 `.env` 中配置 `MYSQL_*`；MySQL 一般部署在宿主机或其它容器，`MYSQL_HOST` 填宿主机 IP 或 `host.docker.internal`（Mac/Windows Docker）。

### 5. NAS 存储配置（推荐）

使用 NAS 存储模型文件可以避免容器重启后模型丢失，并在多个 ComfyUI 实例间共享模型。

1. **在宿主机创建模型目录**（如果不存在）：
   ```bash
   sudo mkdir -p /data/spciyai
   ```

2. **在 `.env` 中配置**（已包含在 env.example 中）：
   ```bash
   NAS_PATH=/data/spciyai              # 宿主机 NAS 路径
   COMFYUI_MODELS_ROOT=/data/models    # 容器内挂载点
   ```

3. **Docker Compose 会自动挂载**：
   - 宿主机的 `/data/spciyai` 会被挂载到容器的 `/data/models`
   - 下载的模型会按类型存储：
     - `/data/models/checkpoints/` - 主模型
     - `/data/models/loras/` - LoRA 模型
     - `/data/models/embeddings/` - 嵌入模型
     - `/data/models/vae/` - VAE 模型
     - 等等...

4. **在管理页面配置**：
   - 登录后台管理页面
   - 进入"模型管理"→"设置"
   - 确认"模型根目录"显示为 `/data/models`
   - 配置 Civitai API Token 以便下载模型

5. **权限设置**（重要）：
   ```bash
   # 确保 Docker 容器有读写权限
   sudo chmod -R 755 /data/spciyai
   # 如果容器以特定用户运行，可能需要调整所有者
   sudo chown -R 1000:1000 /data/spciyai  # 使用容器内的 UID/GID
   ```

### 6. 常用命令

```bash
# 构建并启动（前台看日志）
docker compose up -d

# 查看网关日志
docker compose logs -f gateway

# 停止
docker compose down

# 仅重新构建网关镜像
docker compose build gateway && docker compose up -d gateway
```

---

## 二、仅构建镜像、不启用 Redis（单容器）

适合已有 Redis/MySQL，只跑网关：

```bash
# 构建
docker build -t comfyui-gateway:latest .

# 运行（请把 REDIS_URL 等改为你的环境）
docker run -d --name comfyui-gateway \
  -p 8000:8000 \
  -e REDIS_URL=redis://your-redis-host:6379/0 \
  -e MYSQL_DATABASE=comfyui_gateway \
  -e MYSQL_HOST=host.docker.internal \
  -e MYSQL_USER=gateway \
  -e MYSQL_PASSWORD=your_password \
  --restart unless-stopped \
  comfyui-gateway:latest
```

或用 `--env-file .env` 传入 `.env` 文件。

---

## 三、生产环境建议

1. **反向代理**：在网关前加 Nginx/Caddy，做 HTTPS、限流、域名。
2. **持久化**：线上建议配置 Redis 或 MySQL，避免重启后 Worker 与任务映射丢失。
3. **资源**：根据 Worker 数量与并发适当调大容器内存；如需长时间跑大工作流，可提高 `WORKER_REQUEST_TIMEOUT`。
4. **安全**：`.env` 不要提交到仓库；若网关对外，可配合 Nginx 做 IP 白名单或鉴权。

---

## 四、非 Docker 部署（直接 Python）

```bash
cd comfyui-gateway
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# 前端：cd frontend && npm ci && npm run build && cd ..
export REDIS_URL=redis://...
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

或使用项目自带的 `./run.sh`（会自动创建 venv、安装依赖并构建前端）。
