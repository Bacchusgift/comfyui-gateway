"""
负载均衡：选择「当前队列长度」最小的 enabled 且健康的 Worker。
会刷新各 Worker 的 queue 缓存（若过期）。
"""
from typing import Optional

from app import workers as wm
from app.client import fetch_queue, parse_queue_counts, health_check
from app.workers import WorkerInfo

async def refresh_worker_load(worker_id: str) -> None:
    info = wm.get_worker(worker_id)
    if not info:
        return
    data = await fetch_queue(info.url, auth=info.auth())
    if data is not None:
        running, pending = parse_queue_counts(data)
        wm.update_worker_load(worker_id, running, pending, healthy=True)
    else:
        # fetch_queue 失败时做一次 health_check 确认是否真不可达
        healthy, _ = await health_check(info.url, auth=info.auth())
        wm.update_worker_load(worker_id, info.queue_running, info.queue_pending, healthy=healthy)

async def refresh_all_loads() -> None:
    for w in wm.list_workers():
        if w.enabled:
            await refresh_worker_load(w.worker_id)

async def select_worker() -> Optional[WorkerInfo]:
    """
    选择负载最小的 enabled 且 healthy 的 Worker。
    若缓存过期会先刷新。
    """
    candidates = [w for w in wm.list_workers() if w.enabled]
    if not candidates:
        return None
    # 若任一缓存过期，刷新所有
    need_refresh = any(not w.cache_valid() for w in candidates)
    if need_refresh:
        await refresh_all_loads()
        candidates = [w for w in wm.list_workers() if w.enabled]
    healthy = [w for w in candidates if w.healthy]
    if not healthy:
        return None
    # 按 load_score 升序，再按 weight 降序（同负载时优先 weight 高）
    best = min(healthy, key=lambda w: (w.load_score(), -w.weight))
    return best
