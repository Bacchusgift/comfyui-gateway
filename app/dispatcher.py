"""后台按优先级从队列取任务并提交到 Worker。

优化：批量处理队列中的所有待调度任务，每次循环尽可能多地分发到空闲 Worker。
"""
import asyncio
from app.priority_queue import pop_highest, re_queue_job
from app.load_balancer import select_worker
from app.client import post_prompt
from app import store
from app import workers as wm


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
    # 立即更新 Worker 负载：running + 1
    wm.update_worker_load(worker.worker_id, worker.queue_running + 1, worker.queue_pending, healthy=True)
    return True


async def _dispatch_batch(max_batch: int = 10) -> int:
    """批量处理：一次循环中最多尝试处理 max_batch 个任务。

    返回实际处理数量。
    """
    count = 0
    for _ in range(max_batch):
        job = pop_highest()
        if not job:
            break
        worker = await select_worker()
        if not worker:
            # 没有可用 Worker，放回队列并停止
            re_queue_job(job)
            break
        payload = {"prompt": job.prompt, "client_id": job.client_id}
        data, status = await post_prompt(worker.url, payload, auth=worker.auth())
        if status != 200 or not isinstance(data, dict) or "prompt_id" not in data:
            # 提交失败，放回队列并继续尝试下一个
            re_queue_job(job)
            continue
        store.set_task_worker(data["prompt_id"], worker.worker_id)
        store.set_gateway_job(job.gateway_job_id, data["prompt_id"], worker.worker_id)
        # 立即更新 Worker 负载：running + 1
        wm.update_worker_load(worker.worker_id, worker.queue_running + 1, worker.queue_pending, healthy=True)
        count += 1
    return count


async def run_dispatcher(interval_seconds: float = 0.5) -> None:
    """循环：每隔 interval_seconds 批量处理队列中的所有任务。"""
    while True:
        try:
            await _dispatch_batch(max_batch=20)
        except Exception:
            pass
        await asyncio.sleep(interval_seconds)
