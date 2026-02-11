"""
GET /api/view - 代理到对应 Worker 的 /view，需要 query 带 prompt_id 以定位 Worker。
支持 Worker 的 Basic 认证（nginx 等反向代理）。
"""
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
import httpx

from app import store
from app import workers as wm
from app.config import WORKER_REQUEST_TIMEOUT

router = APIRouter(prefix="/view", tags=["view"])

@router.get("")
async def proxy_view(
    request: Request,
    filename: str = "",
    subfolder: str = "",
    type: str = "output",
    prompt_id: str = "",
):
    """
    GET /api/view?filename=...&subfolder=...&type=...&prompt_id=...
    根据 prompt_id 找到 Worker，代理到该 Worker 的 /view。
    """
    if not prompt_id:
        raise HTTPException(status_code=400, detail="prompt_id is required for /view proxy")
    worker_id = store.get_task_worker(prompt_id)
    if not worker_id:
        raise HTTPException(status_code=404, detail="Task not found")
    worker = wm.get_worker(worker_id)
    if not worker:
        raise HTTPException(status_code=503, detail="Worker not found")
    base = worker.url.rstrip("/")
    q = {k: v for k, v in request.query_params.items() if k != "prompt_id"}
    url = f"{base}/view?{urlencode(q)}"
    try:
        kwargs: dict = {"timeout": WORKER_REQUEST_TIMEOUT}
        auth = worker.auth()
        if auth:
            kwargs["auth"] = httpx.BasicAuth(auth[0], auth[1])
        async with httpx.AsyncClient(**kwargs) as c:
            r = await c.get(url)
            return Response(content=r.content, status_code=r.status_code, media_type=r.headers.get("content-type"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
