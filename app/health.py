"""
后台定时健康探测：每隔 N 秒对所有 enabled Worker 做联通检查，更新 healthy 状态。
"""
import asyncio

from app import workers as wm
from app.client import health_check


async def _check_all() -> None:
    for w in wm.list_workers():
        if not w.enabled:
            continue
        try:
            healthy, _detail = await health_check(w.url, auth=w.auth())
        except Exception:
            healthy = False
        wm.update_worker_load(w.worker_id, w.queue_running, w.queue_pending, healthy=healthy)


async def run_health_loop(interval_seconds: float = 30.0) -> None:
    """每 interval_seconds 秒检查一次所有 Worker 的联通性。"""
    while True:
        try:
            await _check_all()
        except Exception:
            pass
        await asyncio.sleep(interval_seconds)
