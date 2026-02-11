import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from app.load_balancer import select_worker
from app.client import post_prompt
from app import store
from app import workers as wm
from app.priority_queue import add_job

router = APIRouter(prefix="/prompt", tags=["prompt"])

class PromptBody(BaseModel):
    prompt: dict[str, Any]  # workflow API JSON
    client_id: Optional[str] = None
    priority: Optional[int] = None  # 可选。传入后进入网关优先级队列（插队），数值越大越优先；不传则立即提交（与 ComfyUI 一致）

@router.post("")
async def submit_prompt(body: PromptBody):
    """
    POST /api/prompt - 与 ComfyUI 一致；可选插队。
    - 不传 priority：立即转发到 Worker，返回 { prompt_id, number }。
    - 传 priority：进入网关优先级队列，返回 { gateway_job_id, status: "queued" }；需轮询 GET /api/task/gateway/{gateway_job_id} 拿到 prompt_id 后再查 history/status。
    """
    client_id = body.client_id or str(uuid.uuid4())
    if body.priority is not None:
        job = add_job(prompt=body.prompt, client_id=client_id, priority=body.priority)
        return {"gateway_job_id": job.gateway_job_id, "status": "queued"}
    worker = await select_worker()
    if not worker:
        raise HTTPException(
            status_code=503,
            detail="No available worker (none registered or all unhealthy)",
        )
    payload = {"prompt": body.prompt, "client_id": client_id}
    data, status = await post_prompt(worker.url, payload, auth=worker.auth())
    if status != 200:
        err = data.get("error") if isinstance(data, dict) else str(data)
        raise HTTPException(status_code=status, detail=err or "Worker request failed")
    if isinstance(data, dict) and "prompt_id" in data:
        store.set_task_worker(data["prompt_id"], worker.worker_id)
    return data
