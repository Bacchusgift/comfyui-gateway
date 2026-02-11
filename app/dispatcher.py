"""后台按优先级从队列取任务并提交到 Worker。

优化：批量处理队列中的所有待调度任务，每次循环尽可能多地分发到空闲 Worker。

修复：完善错误处理，避免映射丢失问题。
"""
import asyncio
import logging
from app.priority_queue import pop_highest, re_queue_job
from app.load_balancer import select_worker
from app.client import post_prompt
from app import store
from app import workers as wm

logger = logging.getLogger(__name__)


async def _dispatch_one() -> bool:
    """处理队列中的一项，成功返回 True，队列空返回 False。"""
    job = pop_highest()
    if not job:
        return False

    worker = await select_worker()
    if not worker:
        logger.warning(f"无可用 Worker，任务 {job.gateway_job_id} 被放回队列")
        re_queue_job(job)
        return True

    payload = {"prompt": job.prompt, "client_id": job.client_id}
    data, status = await post_prompt(worker.url, payload, auth=worker.auth())

    # 检查响应是否有效
    if status != 200:
        logger.error(f"Worker {worker.worker_id} 返回错误状态 {status}: {data}")
        # HTTP 错误不应该重新放回队列，直接丢弃并记录
        # 但如果是临时性错误（503），可以重试
        if status == 503:
            re_queue_job(job)
            logger.info(f"任务 {job.gateway_job_id} 因 503 错误被重新放回队列")
        else:
            logger.error(f"任务 {job.gateway_job_id} 提交失败且无法重试，状态: {status}")
        return True

    if not isinstance(data, dict):
        logger.error(f"Worker {worker.worker_id} 返回非 dict 数据: {type(data)}")
        re_queue_job(job)
        return True

    if "prompt_id" not in data:
        logger.error(f"Worker {worker.worker_id} 响应中没有 prompt_id: {data}")
        re_queue_job(job)
        return True

    # 成功：保存映射关系
    prompt_id = data["prompt_id"]
    store.set_task_worker(prompt_id, worker.worker_id)
    store.set_gateway_job(job.gateway_job_id, prompt_id, worker.worker_id)

    # 立即更新 Worker 负载：running + 1
    wm.update_worker_load(worker.worker_id, worker.queue_running + 1, worker.queue_pending, healthy=True)

    logger.info(f"任务 {job.gateway_job_id} (prompt_id: {prompt_id}) 已提交到 Worker {worker.worker_id}")
    return True


async def _dispatch_batch(max_batch: int = 10) -> int:
    """批量处理：一次循环中最多尝试处理 max_batch 个任务。

    返回实际处理数量。
    """
    count = 0
    failed_count = 0

    for _ in range(max_batch):
        job = pop_highest()
        if not job:
            break

        worker = await select_worker()
        if not worker:
            # 没有可用 Worker，放回队列并停止
            logger.warning(f"无可用 Worker，停止批量处理，已处理 {count} 个任务")
            re_queue_job(job)
            break

        payload = {"prompt": job.prompt, "client_id": job.client_id}
        data, status = await post_prompt(worker.url, payload, auth=worker.auth())

        if status != 200 or not isinstance(data, dict) or "prompt_id" not in data:
            # 提交失败，记录并继续下一个
            failed_count += 1
            logger.error(f"任务 {job.gateway_job_id} 提交失败，状态 {status}")
            re_queue_job(job)
            continue

        # 成功：保存映射关系
        prompt_id = data["prompt_id"]
        store.set_task_worker(prompt_id, worker.worker_id)
        store.set_gateway_job(job.gateway_job_id, prompt_id, worker.worker_id)

        # 立即更新 Worker 负载：running + 1
        wm.update_worker_load(worker.worker_id, worker.queue_running + 1, worker.queue_pending, healthy=True)

        count += 1

    if count > 0:
        logger.info(f"批量处理完成：成功 {count} 个，失败 {failed_count} 个")
    else:
        logger.debug("队列为空，无任务处理")

    return count


async def run_dispatcher(interval_seconds: float = 0.5) -> None:
    """循环：每隔 interval_seconds 批量处理队列中的所有任务。"""
    logger.info("Dispatcher 启动，开始处理优先队列任务")
    while True:
        try:
            processed = await _dispatch_batch(max_batch=20)
            if processed == 0:
                # 队列为空，稍长一点的 sleep
                await asyncio.sleep(interval_seconds * 2)
        except Exception as e:
            logger.error(f"Dispatcher 异常: {e}")
        await asyncio.sleep(interval_seconds)
