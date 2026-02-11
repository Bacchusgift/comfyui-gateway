"""后台按优先级从队列取任务并提交到 Worker。"""
import asyncio
from app.priority_queue import pop_highest, re_queue_job
from app.load_balancer import select_worker
from app.client import post_prompt
from app import store


async def _dispatch_one() -> bool:
    """处理队列中的一项，成功返回 True，队列空返回 False。"""
    job = pop_highest()
    if not job:
        return False
    worker = await select_worker()
    if not worker:
        re_queue_job(job)
        return True
    payload = {"prompt": job.prompt, "client_id": job.client_id}
    data, status = await post_prompt(worker.url, payload, auth=worker.auth())
    if status != 200 or not isinstance(data, dict) or "prompt_id" not in data:
        re_queue_job(job)
        return True
    store.set_task_worker(data["prompt_id"], worker.worker_id)
    store.set_gateway_job(job.gateway_job_id, data["prompt_id"], worker.worker_id)
    return True


async def run_dispatcher(interval_seconds: float = 1.0) -> None:
    """循环：每隔 interval_seconds 尝试从队列取一项并提交。"""
    while True:
        try:
            await _dispatch_one()
        except Exception:
            pass
        await asyncio.sleep(interval_seconds)
