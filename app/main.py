from contextlib import asynccontextmanager
from pathlib import Path
import asyncio
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.routes import workers, prompt, history, queue, view, settings, task_history, workflows, auth, openapi
from app.routes.auth import _verify_token
from app.dispatcher import run_dispatcher
from app.health import run_health_loop
from app.progress_monitor import progress_monitor_loop
from app.task_history import ensure_table
from app.workflow_template import ensure_tables as ensure_workflow_tables
from app.store import ensure_tables as ensure_store_tables
from app import apikeys


class AuthMiddleware(BaseHTTPMiddleware):
    """认证中间件：分离 UI API 和 OpenAPI"""

    # 不需要认证的路径
    PUBLIC_PATHS = [
        "/api/auth/login",
    ]

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 静态资源、前端路由不需要认证
        if not path.startswith("/api") and not path.startswith("/openapi"):
            return await call_next(request)

        # 公开 API 不需要认证
        if path in self.PUBLIC_PATHS:
            return await call_next(request)

        # OPTIONS 请求直接放行（CORS 预检）
        if request.method == "OPTIONS":
            return await call_next(request)

        # OpenAPI (/openapi/*): 只检查 X-API-Key
        if path.startswith("/openapi"):
            api_key = request.headers.get("X-API-Key")
            if api_key:
                key_info = apikeys.verify_key(api_key)
                if key_info:
                    return await call_next(request)
            return JSONResponse(
                status_code=401,
                content={"detail": "需要有效的 X-API-Key"}
            )

        # UI API (/api/*): 检查 Admin Token（也支持 API Key）
        authorization = request.headers.get("Authorization")
        if authorization:
            if authorization.startswith("Bearer "):
                token = authorization[7:]
            else:
                token = authorization

            username = _verify_token(token)
            if username:
                return await call_next(request)

        # 也支持用 API Key 访问 UI API
        api_key = request.headers.get("X-API-Key")
        if api_key:
            key_info = apikeys.verify_key(api_key)
            if key_info:
                return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={"detail": "需要认证：请提供有效的管理员 Token 或 X-API-Key"}
        )

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 打印配置信息
    from app.config import (
        use_mysql, MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_DATABASE,
        REDIS_URL, ADMIN_USERNAME, JWT_SECRET
    )

    print("\n" + "=" * 60)
    print("ComfyUI Gateway 启动配置")
    print("=" * 60)

    if use_mysql():
        print(f"存储方式: MySQL")
        print(f"  - Host: {MYSQL_HOST}:{MYSQL_PORT}")
        print(f"  - Database: {MYSQL_DATABASE}")
        print(f"  - User: {MYSQL_USER}")
    elif REDIS_URL:
        print(f"存储方式: Redis")
        print(f"  - URL: {REDIS_URL}")
    else:
        print(f"存储方式: 内存 (重启后数据丢失)")

    print(f"管理员账户: {ADMIN_USERNAME}")
    print(f"JWT 密钥: {'已配置' if JWT_SECRET != 'your-secret-key-change-in-production' else '使用默认值(不安全)'}")
    print("=" * 60 + "\n")

    # 确保数据库表存在
    ensure_store_tables()  # task_worker, gateway_job
    ensure_table()  # task_history
    ensure_workflow_tables()  # workflow templates
    apikeys.ensure_table()  # api_keys
    dispatch_task = asyncio.create_task(run_dispatcher(interval_seconds=1.0))
    health_task = asyncio.create_task(run_health_loop(interval_seconds=30.0))
    progress_task = asyncio.create_task(progress_monitor_loop(interval_seconds=2.0))
    yield
    dispatch_task.cancel()
    health_task.cancel()
    progress_task.cancel()
    for t in (dispatch_task, health_task, progress_task):
        try:
            await t
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="ComfyUI Gateway",
    description="Load-balancing gateway for ComfyUI workers; drop-in replacement for ComfyUI API.",
    lifespan=lifespan,
)

# 添加认证中间件（注意顺序：先 CORS，后 Auth）
app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 统一前缀 /api (UI 使用，需要管理员 Token)
app.include_router(auth.router, prefix="/api")
app.include_router(workers.router, prefix="/api")
app.include_router(prompt.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(queue.router, prefix="/api")
app.include_router(view.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(task_history.router, prefix="/api")
app.include_router(workflows.router, prefix="/api")

# OpenAPI (外部系统使用，只需 X-API-Key)
app.include_router(openapi.router)

# 前端静态文件目录
_frontend = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend.exists():
    # 挂载静态资源文件（js, css, images 等）
    app.mount("/assets", StaticFiles(directory=str(_frontend / "assets")), name="frontend-assets")

    # SPA fallback: 对于所有非 API 请求，返回 index.html
    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """处理前端路由，将所有非 API 请求返回 index.html"""
        file_path = _frontend / full_path
        # 如果请求的是具体文件且存在，直接返回
        if file_path.is_file():
            return FileResponse(file_path)
        # 否则返回 index.html，让前端路由处理
        return FileResponse(_frontend / "index.html")
