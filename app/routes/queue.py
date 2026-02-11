"""
GET /api/queue - 聚合所有 Worker 的队列状态
GET /api/task/{prompt_id}/status - 单任务状态与进度（queued|running|done|failed）
GET /api/task/gateway/{gateway_job_id} - 插队任务状态（queued|submitted|running|done|failed），提交后含 prompt_id
"""
import asyncio
from fastapi import APIRouter, HTTPException

from app import store
from app import workers as wm
from app.client import fetch_queue, get_history, parse_queue_counts
from app.priority_queue import is_queued

router = APIRouter(tags=["queue"])

# 聚合 queue 时使用的短超时（秒），避免不可达 Worker 拖垮整个请求
_QUEUE_FETCH_TIMEOUT = 5


async def _fetch_worker_queue(w):
    """对单个 Worker 拉取 queue，超时或异常返回 None。"""
    if not w.enabled or not w.healthy:
        return w, None
    try:
        data = await asyncio.wait_for(
            fetch_queue(w.url, auth=w.auth()),
            timeout=_QUEUE_FETCH_TIMEOUT,
        )
        return w, data
    except Exception:
        return w, None


@router.get("/task/gateway/{gateway_job_id}")
async def gateway_job_status(gateway_job_id: str):
    """
    查询通过 priority 提交的插队任务状态。
    - queued: 仍在网关队列等待提交
    - submitted: 已提交到 Worker，返回 prompt_id，后续用 GET /api/task/{prompt_id}/status 与 GET /api/history/{prompt_id}
    - running / done / failed: 由 prompt 状态推导
    """
    if is_queued(gateway_job_id):
        return {"gateway_job_id": gateway_job_id, "status": "queued", "prompt_id": None}
    info = store.get_gateway_job(gateway_job_id)
    if not info:
        raise HTTPException(status_code=404, detail="Gateway job not found or not yet submitted")
    prompt_id = info["prompt_id"]
    worker_id = info["worker_id"]
    worker = wm.get_worker(worker_id)
    if not worker:
        return {"gateway_job_id": gateway_job_id, "status": "unknown", "prompt_id": prompt_id}
    hist, hist_status = await get_history(worker.url, prompt_id, auth=worker.auth())
    if hist_status == 200 and isinstance(hist, dict) and prompt_id in hist:
        return {"gateway_job_id": gateway_job_id, "status": "done", "prompt_id": prompt_id}
    data = await fetch_queue(worker.url, auth=worker.auth())
    if not data:
        return {"gateway_job_id": gateway_job_id, "status": "submitted", "prompt_id": prompt_id}
    for item in data.get("queue_running") or []:
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            return {"gateway_job_id": gateway_job_id, "status": "running", "prompt_id": prompt_id}
    for item in data.get("queue_pending") or []:
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            return {"gateway_job_id": gateway_job_id, "status": "submitted", "prompt_id": prompt_id}
    return {"gateway_job_id": gateway_job_id, "status": "failed", "prompt_id": prompt_id}

@router.get("/queue")
async def aggregated_queue():
    """
    GET /api/queue - 聚合各 Worker 的 running/pending，便于前端与 n8n 查看。
    并发请求所有 Worker，跳过不健康的，单个超时 5s 不拖慢整体。
    """
    workers = wm.list_workers()

    # 并发拉取所有 Worker 的 queue
    tasks = [_fetch_worker_queue(w) for w in workers]
    results = await asyncio.gather(*tasks)

    worker_list = []
    gateway_queue = []
    total_running = 0
    total_pending = 0

    for w, data in results:
        if data is not None:
            running, pending = parse_queue_counts(data)
            wm.update_worker_load(w.worker_id, running, pending, healthy=True)
            w.queue_running = running
            w.queue_pending = pending
        elif w.enabled and w.healthy:
            # 拉取失败但之前健康 → 标记不健康
            wm.update_worker_load(w.worker_id, w.queue_running, w.queue_pending, healthy=False)
            w.healthy = False

        worker_list.append({
            "worker_id": w.worker_id,
            "name": w.name,
            "url": w.url,
            "healthy": w.healthy,
            "enabled": w.enabled,
            "queue_running": w.queue_running,
            "queue_pending": w.queue_pending,
        })
        total_running += w.queue_running
        total_pending += w.queue_pending

        # 解析具体任务列表
        if data:
            for i, item in enumerate(data.get("queue_running") or []):
                pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
                if pid:
                    gateway_queue.append({
                        "prompt_id": pid,
                        "worker_id": w.worker_id,
                        "worker_name": w.name,
                        "status": "running",
                        "position": i + 1,
                    })
            for i, item in enumerate(data.get("queue_pending") or []):
                pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
                if pid:
                    gateway_queue.append({
                        "prompt_id": pid,
                        "worker_id": w.worker_id,
                        "worker_name": w.name,
                        "status": "pending",
                        "position": i + 1,
                    })
    return {
        "workers": worker_list,
        "gateway_queue": gateway_queue,
        "total_running": total_running,
        "total_pending": total_pending,
    }

@router.get("/task/{prompt_id}/status")
async def task_status(prompt_id: str):
    """
    GET /api/task/{prompt_id}/status
    返回: prompt_id, worker_id, status (queued|running|done|failed), progress, message
    """
    worker_id = store.get_task_worker(prompt_id)
    if not worker_id:
        raise HTTPException(
            status_code=404,
            detail="Task not found or mapping lost",
        )
    worker = wm.get_worker(worker_id)
    if not worker:
        raise HTTPException(status_code=503, detail="Worker no longer registered")
    # 查 history：有结果则为 done
    hist, hist_status = await get_history(worker.url, prompt_id, auth=worker.auth())
    if hist_status == 200 and isinstance(hist, dict) and prompt_id in hist:
        return {
            "prompt_id": prompt_id,
            "worker_id": worker_id,
            "worker_name": worker.name,
            "status": "done",
            "progress": 100,
            "message": "Completed",
            "history": hist,
        }
    # 查 queue：在 running 则为 running，在 pending 则为 queued
    data = await fetch_queue(worker.url, auth=worker.auth())
    if not data:
        return {
            "prompt_id": prompt_id,
            "worker_id": worker_id,
            "worker_name": worker.name,
            "status": "unknown",
            "progress": None,
            "message": "Worker unreachable",
        }
    running = data.get("queue_running") or []
    pending = data.get("queue_pending") or []
    for item in running:
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            return {
                "prompt_id": prompt_id,
                "worker_id": worker_id,
                "worker_name": worker.name,
                "status": "running",
                "progress": None,
                "message": "Executing",
            }
    for item in pending:
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            return {
                "prompt_id": prompt_id,
                "worker_id": worker_id,
                "worker_name": worker.name,
                "status": "queued",
                "progress": None,
                "message": "Waiting in queue",
            }
    # 不在 queue 且 history 没有 -> 可能失败或已清理
    return {
        "prompt_id": prompt_id,
        "worker_id": worker_id,
        "worker_name": worker.name,
        "status": "failed",
        "progress": None,
        "message": "Not in queue and no history (may have failed or been cleared)",
    }
