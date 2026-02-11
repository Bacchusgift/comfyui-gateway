"""
GET /api/queue - 聚合所有 Worker 的队列状态
GET /api/task/{prompt_id}/status - 单任务状态与进度（queued|running|done|failed）
GET /api/task/gateway/{gateway_job_id} - 插队任务状态（queued|submitted|running|done|failed），提交后含 prompt_id
"""
from fastapi import APIRouter, HTTPException

from app import store
from app import workers as wm
from app.client import fetch_queue, get_history, parse_queue_counts
from app.load_balancer import refresh_worker_load
from app.priority_queue import is_queued

router = APIRouter(tags=["queue"])


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
    """
    for w in wm.list_workers():
        if w.enabled:
            await refresh_worker_load(w.worker_id)
    workers = wm.list_workers()
    worker_list = []
    gateway_queue = []
    total_running = 0
    total_pending = 0
    for w in workers:
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
        data = await fetch_queue(w.url, auth=w.auth())
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
