from fastapi import APIRouter, HTTPException, Request

from app import store
from app import workers as wm
from app.client import get_history
from app.history_rewrite import inject_history_urls

router = APIRouter(prefix="/history", tags=["history"])

@router.get("/{prompt_id}")
async def get_task_history(request: Request, prompt_id: str):
    """
    GET /api/history/{prompt_id} - 与 ComfyUI 一致，转发到对应 Worker。
    响应中会为每张图片/每个视频等资源自动注入 url 字段，指向网关的 /api/view，
    业务侧可直接用 history.outputs[node_id].images[i].url，无需再拼接 host + /view。

    若任务尚未执行完成：ComfyUI 仍返回 200，但 body 多为空 {} 或该 prompt_id 下无 outputs。
    建议先轮询 GET /api/task/{prompt_id}/status，当 status 为 done 后再调本接口取结果。
    """
    worker_id = store.get_task_worker(prompt_id)
    if not worker_id:
        raise HTTPException(
            status_code=404,
            detail="Task not found or mapping lost (gateway may have restarted)",
        )
    worker = wm.get_worker(worker_id)
    if not worker:
        raise HTTPException(status_code=503, detail="Worker no longer registered")
    data, status = await get_history(worker.url, prompt_id, auth=worker.auth())
    if status != 200:
        detail = (data.get("error", "Worker request failed") if isinstance(data, dict) and data else "Worker request failed")
        raise HTTPException(status_code=status, detail=detail)
    view_base = str(request.base_url).rstrip("/") + "/api/view"
    return inject_history_urls(data, prompt_id, view_base)
