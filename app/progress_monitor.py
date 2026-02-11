"""
进度监听器：定期轮询正在执行的任务，获取进度并更新到 task_history 表。
"""
import asyncio
import logging
from typing import Dict, Optional

from app.store import get_task_worker
from app.workers import get_worker
from app.client import get_progress
from app.task_history import update_progress, update_completed, update_failed

logger = logging.getLogger(__name__)

# 轮询间隔（秒）
PROGRESS_POLL_INTERVAL = 2

# 存储正在监听的任务：{task_id: last_progress, last_check_time}
_active_tasks: Dict[str, Dict[str, float]] = {}


async def start_monitoring(task_id: str, prompt_id: str) -> None:
    """
    开始监听指定任务的进度。

    task_id: gateway_job_id（即任务 ID）
    prompt_id: Worker 返回的执行 ID
    """
    if task_id in _active_tasks:
        logger.debug(f"任务 {task_id} 已经在监听中")
        return

    _active_tasks[task_id] = {
        "prompt_id": prompt_id,
        "last_progress": None,
        "last_check_time": None
    }

    logger.info(f"开始监听任务 {task_id} (prompt_id: {prompt_id}) 的进度")


def stop_monitoring(task_id: str) -> None:
    """
    停止监听指定任务。
    """
    if task_id in _active_tasks:
        del _active_tasks[task_id]
        logger.info(f"停止监听任务 {task_id}")


def is_monitoring(task_id: str) -> bool:
    """检查任务是否正在监听。"""
    return task_id in _active_tasks


async def check_and_update_progress() -> None:
    """
    检查所有正在监听的任务，获取进度并更新到数据库。
    """
    if not _active_tasks:
        return

    logger.debug(f"检查 {_active_tasks.len()} 个正在执行的任务的进度")

    # 收集需要更新的任务（避免在迭代中修改字典）
    tasks_to_update = []

    for task_id, task_info in list(_active_tasks.items()):
        try:
            # 获取 Worker 信息
            worker_id = get_task_worker(task_info["prompt_id"])
            if not worker_id:
                logger.warning(f"任务 {task_id} 的 Worker 映射丢失，停止监听")
                stop_monitoring(task_id)
                continue

            worker = get_worker(worker_id)
            if not worker or not worker.healthy:
                logger.warning(f"任务 {task_id} 的 Worker 不可用，停止监听")
                stop_monitoring(task_id)
                continue

            # 调用 get_progress 获取进度
            progress, status_code = await get_progress(worker.url, task_info["prompt_id"], auth=worker.auth())

            if status_code != 200:
                logger.error(f"获取任务 {task_id} 进度失败，状态码: {status_code}")
                continue

            if progress is None:
                # 无法获取进度，保持监听
                logger.debug(f"任务 {task_id} 进度仍为 None，保持监听")
                continue

            # 进度有变化，更新到数据库
            if progress != task_info["last_progress"]:
                logger.info(f"任务 {task_id} 进度更新: {task_info['last_progress']}% -> {progress}%")
                update_progress(task_id, progress=progress)

                # 更新本地缓存
                task_info["last_progress"] = progress
                task_info["last_check_time"] = asyncio.get_event_loop().time()

                # 如果进度达到 100%，停止监听并标记完成
                if progress >= 100:
                    logger.info(f"任务 {task_id} 已完成 (progress: 100%)，停止监听")
                    result_json = f'{{"progress": {progress}, "completed_at": "{asyncio.get_event_loop().time().isoformat()}"}}'
                    update_completed(task_id, result_json=result_json)
                    stop_monitoring(task_id)
                else:
                    # 检查是否超时（30 秒没有进度更新则停止监听）
                    tasks_to_update.append((task_id, task_info))

        except Exception as e:
            logger.error(f"检查任务 {task_id} 进度时出错: {e}")
            # 出错时停止监听该任务
            stop_monitoring(task_id)

    # 批量更新到数据库
    if tasks_to_update:
        logger.info(f"批量更新 {len(tasks_to_update)} 个任务的进度")


async def progress_monitor_loop(interval_seconds: float = PROGRESS_POLL_INTERVAL) -> None:
    """
    定期循环：检查所有正在执行的任务进度并更新到数据库。
    """
    logger.info("进度监听器启动，间隔: {interval_seconds} 秒")

    while True:
        try:
            await check_and_update_progress()
            await asyncio.sleep(interval_seconds)
        except Exception as e:
            logger.error(f"进度监听器异常: {e}")
            await asyncio.sleep(interval_seconds * 2)  # 出错时等待更长时间
