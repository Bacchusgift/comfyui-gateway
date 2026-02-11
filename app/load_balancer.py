"""
负载均衡：优先选择「完全空闲」的 Worker（queue_running == 0），
若没有空闲 Worker，则选择负载最小的 enabled 且健康的 Worker。

重要：不信任缓存，每次选择时都实时调用 Worker 的 /queue API。
"""
from typing import Optional, List, Tuple

from app import workers as wm
from app.client import fetch_queue, parse_queue_counts, health_check
from app.workers import WorkerInfo


async def _get_real_time_load(worker: WorkerInfo) -> Tuple[int, int, bool]:
    """实时获取 Worker 的真实负载：返回 (running, pending, healthy)。"""
    data = await fetch_queue(worker.url, auth=worker.auth())
    if data is not None:
        running, pending = parse_queue_counts(data)
        return running, pending, True
    else:
        # fetch_queue 失败，用健康检查确认
        healthy, _ = await health_check(worker.url, auth=worker.auth())
        return 0, 0, healthy


async def refresh_worker_load(worker_id: str) -> None:
    """后台刷新 Worker 负载缓存（供 UI 使用）。"""
    info = wm.get_worker(worker_id)
    if not info:
        return
    running, pending, healthy = await _get_real_time_load(info)
    wm.update_worker_load(worker_id, running, pending, healthy=healthy)


def _select_idle_worker(candidates: List[WorkerInfo], realtime_data: dict) -> Optional[WorkerInfo]:
    """从实时数据中选出完全空闲的 Worker（running == 0）。"""
    idle_workers = []
    for w in candidates:
        if w.worker_id in realtime_data:
            running, pending, healthy = realtime_data[w.worker_id]
            if healthy and running == 0:
                idle_workers.append((w, running, pending, healthy))
        else:
            # 无法获取实时数据的 Worker，跳过（当作不可用）
            continue

    if not idle_workers:
        return None

    # 有空闲 Worker：按 weight 降序选择（weight 高的优先）
    idle_workers.sort(key=lambda x: (-x[0].weight, -x[0].queue_pending))
    return idle_workers[0][0]


def _select_by_load(candidates: List[WorkerInfo], realtime_data: dict) -> Optional[WorkerInfo]:
    """没有空闲 Worker 时，选择负载最小的。"""
    available_workers = []
    for w in candidates:
        if w.worker_id in realtime_data:
            running, pending, healthy = realtime_data[w.worker_id]
            if healthy:
                available_workers.append((w, running, pending, healthy))
        else:
            continue

    if not available_workers:
        return None

    # 按 (running + pending) 升序，再按 weight 降序
    available_workers.sort(key=lambda x: (x[1] + x[2], -x[0].weight))
    return available_workers[0][0]


async def select_worker() -> Optional[WorkerInfo]:
    """
    实时选择 Worker 的策略：
    1. 对所有 enabled Worker 并发调用 /queue 获取真实负载
    2. 优先选择完全空闲（running == 0）的 Worker
    3. 若没有空闲 Worker，选择负载最小的

    不信任缓存，每次都实时获取。
    """
    candidates = [w for w in wm.list_workers() if w.enabled]
    if not candidates:
        return None

    # 并发获取所有 Worker 的真实负载
    import asyncio
    tasks = [_get_real_time_load(w) for w in candidates]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # 构建实时负载数据
    realtime_data = {}
    for i, w in enumerate(candidates):
        if i < len(results) and not isinstance(results[i], Exception):
            running, pending, healthy = results[i]
            realtime_data[w.worker_id] = (running, pending, healthy)
            # 更新缓存（供 UI 使用）
            wm.update_worker_load(w.worker_id, running, pending, healthy=healthy)

    # 过滤出健康的 Worker
    healthy_workers = [w for w in candidates if w.worker_id in realtime_data and realtime_data[w.worker_id][2]]
    if not healthy_workers:
        return None

    # 第一步：优先选择完全空闲的 Worker
    idle = _select_idle_worker(healthy_workers, realtime_data)
    if idle:
        return idle

    # 第二步：没有空闲 Worker，按负载选择
    return _select_by_load(healthy_workers, realtime_data)
