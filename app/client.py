"""
请求 ComfyUI Worker 的 HTTP 封装：queue, prompt, history。
支持 Basic 认证：auth=(username, password) 用于 nginx 等反向代理。
"""
import httpx
from typing import Optional

from app.config import WORKER_REQUEST_TIMEOUT

def _client(auth: Optional[tuple[str, str]] = None) -> httpx.AsyncClient:
    kwargs = {"timeout": WORKER_REQUEST_TIMEOUT}
    if auth:
        kwargs["auth"] = httpx.BasicAuth(auth[0], auth[1])
    return httpx.AsyncClient(**kwargs)

async def fetch_queue(base_url: str, auth: Optional[tuple[str, str]] = None) -> Optional[dict]:
    """GET /queue -> { queue_running: [...], queue_pending: [...] }"""
    try:
        async with _client(auth) as c:
            r = await c.get(f"{base_url.rstrip('/')}/queue")
            r.raise_for_status()
            return r.json()
    except Exception:
        return None

def parse_queue_counts(data: Optional[dict]) -> tuple[int, int]:
    running = 0
    pending = 0
    if not data:
        return 0, 0
    for item in data.get("queue_running") or []:
        if isinstance(item, list) and len(item) >= 1:
            running += 1
        else:
            running += 1
    for item in data.get("queue_pending") or []:
        pending += 1
    return running, pending

async def post_prompt(base_url: str, body: dict, auth: Optional[tuple[str, str]] = None) -> tuple[Optional[dict], int]:
    """POST /prompt，返回 (response_json, status_code)。"""
    try:
        async with _client(auth) as c:
            r = await c.post(f"{base_url.rstrip('/')}/prompt", json=body)
            return r.json() if r.content else None, r.status_code
    except Exception as e:
        return {"error": str(e)}, 503

async def get_history(base_url: str, prompt_id: str, auth: Optional[tuple[str, str]] = None) -> tuple[Optional[dict], int]:
    """GET /history/{prompt_id}"""
    try:
        async with _client(auth) as c:
            r = await c.get(f"{base_url.rstrip('/')}/history/{prompt_id}")
            return r.json() if r.content else None, r.status_code
    except Exception as e:
        return {"error": str(e)}, 503

async def get_prompt(base_url: str, auth: Optional[tuple[str, str]] = None) -> tuple[Optional[dict], int]:
    """GET /prompt - 当前执行信息"""
    try:
        async with _client(auth) as c:
            r = await c.get(f"{base_url.rstrip('/')}/prompt")
            return r.json() if r.content else None, r.status_code
    except Exception:
        return None, 503
