"""
任务历史查询 API - 提供完整的任务生命周期记录。

GET /api/tasks - 查询任务列表（分页、过滤）
GET /api/tasks/{task_id} - 查询单个任务详情
"""
from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional

from app.task_history import get_by_prompt_id, get_by_task_id, list_tasks

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskListQuery(Query):
    limit: int = 100
    offset: int = 0
    worker_id: Optional[str] = None
    status: Optional[str] = None  # pending/submitted/running/done/failed


@router.get("")
async def list_tasks(query: TaskListQuery):
    """
    GET /api/tasks - 查询任务历史列表

    支持分页、Worker 过滤、状态过滤。

    返回：
    {
        "tasks": [...],
        "total": 总数,
        "limit": query.limit,
        "offset": query.offset
    }
    """
    tasks = list_tasks(
        limit=query.limit,
        offset=query.offset,
        worker_id=query.worker_id,
        status=query.status
    )

    # 计算总数（简单实现）
    total = len(tasks)

    return {
        "tasks": tasks,
        "total": total,
        "limit": query.limit,
        "offset": query.offset
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
