"""
请求 ComfyUI Worker 的 HTTP 封装：queue, prompt, history, health。
支持 Basic 认证：auth=(username, password) 用于 nginx 等反向代理。
"""
import httpx
from typing import Optional

from app.config import WORKER_REQUEST_TIMEOUT

# 健康探测专用短超时（秒）
_HEALTH_TIMEOUT = 5

def _client(auth: Optional[tuple[str, str]] = None, timeout: float = WORKER_REQUEST_TIMEOUT) -> httpx.AsyncClient:
    kwargs: dict = {"timeout": timeout}
    if auth:
        kwargs["auth"] = httpx.BasicAuth(auth[0], auth[1])
    return httpx.AsyncClient(**kwargs)


async def health_check(base_url: str, auth: Optional[tuple[str, str]] = None) -> tuple[bool, str]:
    """
    探测 ComfyUI Worker 是否可达。
    依次尝试 GET /system_stats（ComfyUI 内置），回退 GET /queue。
    返回 (healthy: bool, detail: str)。
    """
    url = base_url.rstrip("/")
    try:
        async with _client(auth, timeout=_HEALTH_TIMEOUT) as c:
            r = await c.get(f"{url}/system_stats")
            if r.status_code == 200:
                return True, "ok"
    except Exception:
        pass
    # 回退到 /queue
    try:
        async with _client(auth, timeout=_HEALTH_TIMEOUT) as c:
            r = await c.get(f"{url}/queue")
            if r.status_code == 200:
                return True, "ok (via /queue)"
    except httpx.ConnectError:
        return False, "Connection refused"
    except httpx.ConnectTimeout:
        return False, "Connection timeout"
    except httpx.HTTPStatusError as e:
        return False, f"HTTP {e.response.status_code}"
    except Exception as e:
        return False, str(e)
    return False, "Unreachable"

async def fetch_queue(base_url: str, auth: Optional[tuple[str, str]] = None, timeout: float = 8) -> Optional[dict]:
    """GET /queue -> { queue_running: [...], queue_pending: [...] }。默认 8 秒超时。"""
    try:
        async with _client(auth, timeout=timeout) as c:
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
