"""
任务历史查询 API - 提供完整的任务生命周期记录。

GET /api/tasks - 查询任务列表（分页、过滤）
GET /api/tasks/{task_id} - 查询单个任务详情
"""
import asyncio
from fastapi import APIRouter, Query
from typing import Optional

from app.task_history import get_by_prompt_id, get_by_task_id, list_tasks, sync_task_status
from app import store
from app import workers as wm
from app.client import fetch_queue, get_history

router = APIRouter(prefix="/tasks", tags=["tasks"])


async def _sync_single_task(prompt_id: str, worker_id: str) -> None:
    """同步单个任务状态（从 Worker 查询并更新数据库）。"""
    worker = wm.get_worker(worker_id)
    if not worker:
        return

    try:
        # 先查 history
        hist, hist_status = await get_history(worker.url, prompt_id, auth=worker.auth())
        if hist_status == 200 and isinstance(hist, dict) and prompt_id in hist:
            import json
            result_data = hist.get(prompt_id, {})
            result_json = json.dumps(result_data, ensure_ascii=False) if isinstance(result_data, dict) else None
            sync_task_status(prompt_id, status="done", progress=100, worker_id=worker_id, result_json=result_json)
            return

        # 查 queue
        data = await fetch_queue(worker.url, auth=worker.auth())
        if not data:
            return

        for item in data.get("queue_running") or []:
            # ComfyUI 队列格式: [序号, prompt_id, workflow, ...]
            pid = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else None
            if pid == prompt_id:
                # 尝试获取进度
                try:
                    from app.client import get_progress
                    progress, _ = await get_progress(worker.url, prompt_id, auth=worker.auth())
                    sync_task_status(prompt_id, status="running", progress=progress or 0, worker_id=worker_id)
                except Exception:
                    sync_task_status(prompt_id, status="running", progress=0, worker_id=worker_id)
                return

        for item in data.get("queue_pending") or []:
            # ComfyUI 队列格式: [序号, prompt_id, workflow, ...]
            pid = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else None
            if pid == prompt_id:
                sync_task_status(prompt_id, status="queued", progress=0, worker_id=worker_id)
                return

        # 不在队列中也没有 history，标记为失败
        sync_task_status(prompt_id, status="failed", worker_id=worker_id, error_message="Not in queue and no history")
    except Exception:
        pass  # 同步失败不影响返回


@router.get("")
async def list_tasks_api(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    worker_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None)
):
    """
    GET /api/tasks - 查询任务历史列表

    支持分页、Worker 过滤、状态过滤。
    对于未完成的任务，会从 Worker 同步最新状态。

    返回：
    {
        "tasks": [...],
        "total": 总数,
        "limit": limit,
        "offset": offset
    }
    """
    tasks = list_tasks(
        limit=limit,
        offset=offset,
        worker_id=worker_id,
        status=status
    )

    # 同步未完成任务的状态（pending, submitted, running, queued）
    pending_tasks = [t for t in tasks if t.get("status") in ("pending", "submitted", "running", "queued")]
    if pending_tasks:
        # 并发同步，最多同时同步 10 个
        async def sync_task(t):
            prompt_id = t.get("prompt_id")
            worker_id = t.get("worker_id")
            if prompt_id and worker_id:
                await _sync_single_task(prompt_id, worker_id)
            elif prompt_id:
                # 没有记录 worker_id，尝试从 store 获取
                w_id = store.get_task_worker(prompt_id)
                if w_id:
                    await _sync_single_task(prompt_id, w_id)

        # 分批同步，避免请求过多
        batch_size = 10
        for i in range(0, len(pending_tasks), batch_size):
            batch = pending_tasks[i:i + batch_size]
            await asyncio.gather(*[sync_task(t) for t in batch])

        # 重新查询获取最新数据
        tasks = list_tasks(
            limit=limit,
            offset=offset,
            worker_id=worker_id,
            status=status
        )

    # 计算总数（简单实现）
    total = len(tasks)

    return {
        "tasks": tasks,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/{task_id}")
async def get_task_detail(task_id: str):
    """
    GET /api/tasks/{task_id} - 查询单个任务的完整历史

    通过 task_id（即 gateway_job_id）查询。
    """
    task = get_by_task_id(task_id)

    if not task:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Task not found")

    return task
