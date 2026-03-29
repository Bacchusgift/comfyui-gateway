from contextlib import asynccontextmanager
from pathlib import Path
import asyncio
import traceback
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.routes import workers, prompt, history, queue, view, settings, task_history, workflows, auth, openapi, output, models
from app.routes.auth import _verify_token
from app.dispatcher import run_dispatcher
from app.health import run_health_loop
from app.progress_monitor import progress_monitor_loop
from app.websocket_monitor import websocket_monitor_loop, connect_all_workers
from app.task_history import ensure_table
from app.workflow_template import ensure_tables as ensure_workflow_tables
from app.store import ensure_tables as ensure_store_tables
from app import apikeys


class DebugMiddleware(BaseHTTPMiddleware):
    """调试中间件：记录请求详情"""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 只记录 openapi/prompt 请求
        if path == "/openapi/prompt" and request.method == "POST":
            content_type = request.headers.get("content-type", "")
            content_length = request.headers.get("content-length", "")
            print(f"[debug] POST /openapi/prompt")
            print(f"[debug] Content-Type: {content_type}")
            print(f"[debug] Content-Length: {content_length}")

            # 尝试读取 body
            try:
                body = await request.body()
                print(f"[debug] Body 长度: {len(body)}")
                if len(body) < 500:
                    print(f"[debug] Body 内容: {body[:500]}")
            except Exception as e:
                print(f"[debug] 读取 Body 失败: {e}")

        return await call_next(request)


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
    from app.model_manager import ensure_tables as ensure_model_tables
    ensure_model_tables()  # model manager tables

    # 连接所有 Worker 的 WebSocket（用于实时进度）
    await connect_all_workers()

    dispatch_task = asyncio.create_task(run_dispatcher(interval_seconds=1.0))
    health_task = asyncio.create_task(run_health_loop(interval_seconds=30.0))
    progress_task = asyncio.create_task(progress_monitor_loop(interval_seconds=2.0))
    websocket_task = asyncio.create_task(websocket_monitor_loop())
    yield
    dispatch_task.cancel()
    health_task.cancel()
    progress_task.cancel()
    websocket_task.cancel()
    for t in (dispatch_task, health_task, progress_task, websocket_task):
        try:
            await t
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="ComfyUI Gateway",
    description="Load-balancing gateway for ComfyUI workers; drop-in replacement for ComfyUI API.",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """捕获 Pydantic 验证错误并返回详细信息"""
    print(f"[validation_error] 请求验证失败: {request.url.path}")
    print(f"[validation_error] 错误详情: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """捕获 HTTP 异常并记录日志"""
    print(f"[http_error] HTTP {exc.status_code}: {request.url.path} - {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """捕获所有未处理的异常"""
    print(f"[unhandled_error] 未处理的异常: {request.url.path}")
    print(f"[unhandled_error] 异常类型: {type(exc).__name__}")
    print(f"[unhandled_error] 异常信息: {exc}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"},
    )


# 添加中间件（注意顺序：后添加的先执行）
app.add_middleware(AuthMiddleware)
app.add_middleware(DebugMiddleware)  # 调试中间件
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
app.include_router(output.router, prefix="/api")
app.include_router(models.router, prefix="/api")

# OpenAPI (外部系统使用，只需 X-API-Key)
app.include_router(openapi.router)
# 灰度 API (路由到灰度节点)
app.include_router(openapi.gray_router, prefix="/openapi")

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
