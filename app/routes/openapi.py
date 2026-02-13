"""
Open API - 供外部系统调用的 API
只需 X-API-Key 认证，路由前缀 /openapi
"""
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from app.load_balancer import select_worker
from app.client import post_prompt, fetch_queue, get_history, parse_queue_counts
from app import store
from app import workers as wm
from app.priority_queue import add_job, is_queued
from app.task_history import upsert_by_prompt_id

router = APIRouter(prefix="/openapi", tags=["openapi"])


class PromptBody(BaseModel):
    prompt: dict[str, Any]  # workflow API JSON
    client_id: Optional[str] = None
    priority: Optional[int] = None  # 可选。传入后进入网关优先级队列


@router.post("/prompt")
async def submit_prompt(body: PromptBody):
    """
    POST /openapi/prompt - 提交任务
    - 不传 priority：立即转发到 Worker，返回 { prompt_id, number }
    - 传 priority：进入网关优先级队列，返回 { gateway_job_id, status: "queued" }
    """
    client_id = body.client_id or str(uuid.uuid4())
    if body.priority is not None:
        job = add_job(prompt=body.prompt, client_id=client_id, priority=body.priority)
        return {"gateway_job_id": job.gateway_job_id, "status": "queued"}
    worker = await select_worker()
    if not worker:
        raise HTTPException(
            status_code=503,
            detail="No available worker",
        )
    payload = {"prompt": body.prompt, "client_id": client_id}
    data, status = await post_prompt(worker.url, payload, auth=worker.auth())
    if status != 200:
        err = data.get("error") if isinstance(data, dict) else str(data)
        raise HTTPException(status_code=status, detail=err or "Worker request failed")
    if isinstance(data, dict) and "prompt_id" in data:
        prompt_id = data["prompt_id"]
        print(f"[openapi] 任务提交成功: prompt_id={prompt_id}, worker_id={worker.worker_id}")
        store.set_task_worker(prompt_id, worker.worker_id)
        # 记录任务历史
        upsert_by_prompt_id(prompt_id, worker.worker_id, priority=body.priority or 0)
        wm.update_worker_load(worker.worker_id, worker.queue_running + 1, worker.queue_pending, healthy=True)
    else:
        print(f"[openapi] Worker 返回数据中没有 prompt_id: {data}")
    return data


@router.get("/task/{prompt_id}/status")
async def task_status(prompt_id: str):
    """
    GET /openapi/task/{prompt_id}/status
    返回: prompt_id, worker_id, status (submitted|queued|running|done|failed), progress
    """
    worker_id = store.get_task_worker(prompt_id)

    # 如果 store 中找不到，尝试从 task_history 查找
    if not worker_id:
        from app.task_history import get_by_prompt_id
        task_record = get_by_prompt_id(prompt_id)
        if task_record:
            worker_id = task_record.get("worker_id")
            print(f"[openapi] 从 task_history 找到任务: prompt_id={prompt_id}, worker_id={worker_id}")

    if not worker_id:
        raise HTTPException(status_code=404, detail="Task not found")

    worker = wm.get_worker(worker_id)
    if not worker:
        raise HTTPException(status_code=503, detail="Worker no longer registered")

    # 查 history
    hist, hist_status = await get_history(worker.url, prompt_id, auth=worker.auth())
    if hist_status == 200 and isinstance(hist, dict) and prompt_id in hist:
        return {
            "prompt_id": prompt_id,
            "worker_id": worker_id,
            "status": "done",
            "progress": 100,
        }

    # 查 queue
    data = await fetch_queue(worker.url, auth=worker.auth())
    if not data:
        # Worker 不可达，但任务映射存在，返回 submitted
        return {"prompt_id": prompt_id, "worker_id": worker_id, "status": "submitted", "progress": None}

    for item in (data.get("queue_running") or []):
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            from app.client import get_progress
            progress, _ = await get_progress(worker.url, prompt_id, auth=worker.auth())
            return {"prompt_id": prompt_id, "worker_id": worker_id, "status": "running", "progress": progress}

    for item in (data.get("queue_pending") or []):
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            return {"prompt_id": prompt_id, "worker_id": worker_id, "status": "queued", "progress": 0}

    # 任务映射存在但队列中找不到，说明刚提交或正在处理中
    # 返回 submitted 而不是 failed，避免误判
    return {"prompt_id": prompt_id, "worker_id": worker_id, "status": "submitted", "progress": None}


@router.get("/task/gateway/{gateway_job_id}")
async def gateway_job_status(gateway_job_id: str):
    """
    GET /openapi/task/gateway/{gateway_job_id}
    查询插队任务状态
    """
    if is_queued(gateway_job_id):
        return {"gateway_job_id": gateway_job_id, "status": "queued", "prompt_id": None}

    info = store.get_gateway_job(gateway_job_id)
    if not info:
        raise HTTPException(status_code=404, detail="Gateway job not found")

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

    for item in (data.get("queue_running") or []):
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            return {"gateway_job_id": gateway_job_id, "status": "running", "prompt_id": prompt_id}

    for item in (data.get("queue_pending") or []):
        pid = item[0] if isinstance(item, (list, tuple)) and len(item) > 0 else None
        if pid == prompt_id:
            return {"gateway_job_id": gateway_job_id, "status": "submitted", "prompt_id": prompt_id}

    return {"gateway_job_id": gateway_job_id, "status": "failed", "prompt_id": prompt_id}


@router.get("/history/{prompt_id}")
async def get_task_history(prompt_id: str):
    """
    GET /openapi/history/{prompt_id}
    获取任务执行结果
    """
    worker_id = store.get_task_worker(prompt_id)
    if not worker_id:
        raise HTTPException(status_code=404, detail="Task not found")

    worker = wm.get_worker(worker_id)
    if not worker:
        raise HTTPException(status_code=503, detail="Worker no longer registered")

    hist, status = await get_history(worker.url, prompt_id, auth=worker.auth())
    if status == 200 and isinstance(hist, dict) and prompt_id in hist:
        return {"prompt_id": prompt_id, "history": hist[prompt_id]}

    raise HTTPException(status_code=404, detail="History not found")


@router.get("/queue")
async def get_queue():
    """
    GET /openapi/queue
    获取队列状态
    """
    import asyncio

    workers_list = wm.list_workers()
    results = await asyncio.gather(*[
        _fetch_worker_queue(w) for w in workers_list
    ])

    total_running = 0
    total_pending = 0
    workers_status = []

    for w, data in results:
        if data:
            running, pending = parse_queue_counts(data)
            wm.update_worker_load(w.worker_id, running, pending, healthy=True)
            w.queue_running = running
            w.queue_pending = pending
        workers_status.append({
            "worker_id": w.worker_id,
            "name": w.name,
            "queue_running": w.queue_running,
            "queue_pending": w.queue_pending,
            "healthy": w.healthy,
        })
        total_running += w.queue_running
        total_pending += w.queue_pending

    return {
        "workers": workers_status,
        "total_running": total_running,
        "total_pending": total_pending,
    }


async def _fetch_worker_queue(w):
    """获取单个 Worker 队列"""
    if not w.enabled or not w.healthy:
        return w, None
    try:
        import asyncio
        data = await asyncio.wait_for(
            fetch_queue(w.url, auth=w.auth()),
            timeout=5,
        )
        return w, data
    except Exception:
        return w, None
