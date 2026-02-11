"""后台按优先级从队列取任务并提交到 Worker。

优化：批量处理队列中的所有待调度任务，每次循环尽可能多地分发到空闲 Worker。

修复：完善错误处理，避免映射丢失问题。

改进：记录完整的任务历史（提交、开始、进度、完成）。
改进：任务完成后从队列删除，而不是重新放回队列（修复位置自增问题）。
"""
import asyncio
import logging
from app.priority_queue import pop_highest, remove_job
from app.load_balancer import select_worker
from app.client import post_prompt
from app import store
from app import workers as wm
from app.task_history import create_task, update_submitted, update_progress, update_completed, update_failed

logger = logging.getLogger(__name__)


async def _dispatch_one() -> bool:
    """处理队列中的一项，成功返回 True，队列空返回 False。"""
    job = pop_highest()
    if not job:
        return False

    # 创建任务历史记录（pending 状态）
    create_task(task_id=job.gateway_job_id, priority=job.priority)

    worker = await select_worker()
    if not worker:
        logger.warning(f"无可用 Worker，任务 {job.gateway_job_id} 被放回队列")
        # 任务重新放回队列，不删除历史记录
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
        # 记录失败
        update_failed(job.gateway_job_id, error_message=f"Worker 返回错误: {status}")
        return True

    if not isinstance(data, dict):
        logger.error(f"Worker {worker.worker_id} 返回非 dict 数据: {type(data)}")
        re_queue_job(job)
        update_failed(job.gateway_job_id, error_message=f"Worker 返回非 dict 数据: {type(data)}")
        return True

    if "prompt_id" not in data:
        logger.error(f"Worker {worker.worker_id} 响应中没有 prompt_id: {data}")
        re_queue_job(job)
        update_failed(job.gateway_job_id, error_message=f"Worker 响应缺少 prompt_id: {data}")
        return True

    # 成功：更新为 submitted 状态，并记录 Worker 分配
    prompt_id = data["prompt_id"]
    update_submitted(job.gateway_job_id, prompt_id=prompt_id, worker_id=worker.worker_id)

    # 启动进度监听
    from app.progress_monitor import start_monitoring
    start_monitoring(job.gateway_job_id, prompt_id)

    logger.info(f"任务 {job.gateway_job_id} (prompt_id: {prompt_id}) 已提交到 Worker {worker.worker_id}，开始进度监听")
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
            break

        payload = {"prompt": job.prompt, "client_id": job.client_id}
        data, status = await post_prompt(worker.url, payload, auth=worker.auth())

        if status != 200 or not isinstance(data, dict) or "prompt_id" not in data:
            # 提交失败，记录并继续下一个
            failed_count += 1
            logger.error(f"任务 {job.gateway_job_id} 提交失败，状态 {status}")
            # 重新放回队列（不删除历史，因为还未成功提交）
            re_queue_job(job)
            continue

        # 成功：更新为 submitted 状态
        prompt_id = data["prompt_id"]
        update_submitted(job.gateway_job_id, prompt_id=prompt_id, worker_id=worker.worker_id)

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
