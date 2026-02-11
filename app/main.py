from contextlib import asynccontextmanager
from pathlib import Path
import asyncio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.routes import workers, prompt, history, queue, view, settings
from app.dispatcher import run_dispatcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(run_dispatcher(interval_seconds=1.0))
    yield
    task.cancel()
    try:
        await task
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

# 前端静态：若存在 frontend/dist 则挂载到根，SPA 由 index.html 接管
_frontend = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend.exists():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")
