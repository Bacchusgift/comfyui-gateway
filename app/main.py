from contextlib import asynccontextmanager
from pathlib import Path
import asyncio
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.routes import workers, prompt, history, queue, view, settings, task_history
from app.dispatcher import run_dispatcher
from app.health import run_health_loop
from app.progress_monitor import progress_monitor_loop
from app.task_history import ensure_table

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 确保任务历史表存在
    ensure_table()
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 统一前缀 /api
app.include_router(workers.router, prefix="/api")
app.include_router(prompt.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(queue.router, prefix="/api")
app.include_router(view.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(task_history.router, prefix="/api")

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
