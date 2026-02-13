"""
WebSocket 进度监听器：连接到 ComfyUI Worker 的 WebSocket，实时获取任务进度。
"""
import asyncio
import json
import logging
from typing import Dict, Optional, Set
from datetime import datetime

try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False

from app import workers as wm
from app.task_history import update_progress, update_completed, update_failed
from app.store import get_task_worker

logger = logging.getLogger(__name__)

# 每个 Worker 的 WebSocket 连接
_worker_connections: Dict[str, any] = {}

# 正在执行的任务: {prompt_id: {"worker_id": str, "client_id": str, "progress": int}}
_active_tasks: Dict[str, dict] = {}

# 订阅某个 prompt_id 进度的 client_id 集合
_subscribed_clients: Dict[str, Set[str]] = {}


async def connect_worker(worker_id: str, worker_url: str, auth: tuple = None) -> bool:
    """
    连接到 Worker 的 WebSocket。
    """
    if not WEBSOCKETS_AVAILABLE:
        logger.warning("websockets 库未安装，WebSocket 进度监听不可用")
        return False

    if worker_id in _worker_connections:
        return True

    try:
        # 将 HTTP URL 转换为 WebSocket URL
        ws_url = worker_url.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_url.rstrip('/')}/ws"

        logger.info(f"正在连接 Worker WebSocket: {ws_url}")

        # 建立连接
        extra_headers = {}
        if auth:
            import base64
            credentials = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
            extra_headers["Authorization"] = f"Basic {credentials}"

        ws = await websockets.connect(ws_url, extra_headers=extra_headers if extra_headers else None)
        _worker_connections[worker_id] = ws

        # 启动消息处理循环
        asyncio.create_task(_handle_worker_messages(worker_id, ws))

        logger.info(f"Worker {worker_id} WebSocket 连接成功")
        return True

    except Exception as e:
        logger.error(f"连接 Worker {worker_id} WebSocket 失败: {e}")
        return False


async def disconnect_worker(worker_id: str) -> None:
    """
    断开与 Worker 的 WebSocket 连接。
    """
    if worker_id in _worker_connections:
        try:
            await _worker_connections[worker_id].close()
        except Exception:
            pass
        del _worker_connections[worker_id]
        logger.info(f"已断开 Worker {worker_id} 的 WebSocket 连接")


async def _handle_worker_messages(worker_id: str, ws) -> None:
    """
    处理 Worker 发送的 WebSocket 消息。
    """
    try:
        async for message in ws:
            try:
                data = json.loads(message)
                await _process_message(worker_id, data)
            except json.JSONDecodeError:
                logger.warning(f"无效的 JSON 消息: {message[:100]}")
            except Exception as e:
                logger.error(f"处理消息时出错: {e}")

    except websockets.exceptions.ConnectionClosed:
        logger.warning(f"Worker {worker_id} WebSocket 连接已关闭")
    except Exception as e:
        logger.error(f"Worker {worker_id} WebSocket 异常: {e}")
    finally:
        if worker_id in _worker_connections:
            del _worker_connections[worker_id]


async def _process_message(worker_id: str, data: dict) -> None:
    """
    处理单条 WebSocket 消息。
    """
    msg_type = data.get("type")

    if msg_type == "status":
        # 状态更新
        status = data.get("data", {}).get("status", {})
        exec_info = status.get("exec_info", {})
        logger.debug(f"Worker {worker_id} 状态: {status}")

    elif msg_type == "progress":
        # 进度更新: {type: "progress", data: {value: int, max: int, prompt_id: str}}
        progress_data = data.get("data", {})
        prompt_id = progress_data.get("prompt_id")
        value = progress_data.get("value", 0)
        max_value = progress_data.get("max", 100)

        if prompt_id:
            progress = int(value / max_value * 100) if max_value > 0 else 0
            logger.info(f"任务 {prompt_id} 进度: {progress}% ({value}/{max_value})")

            # 更新数据库
            update_progress(prompt_id, progress=progress)

            # 更新本地缓存
            if prompt_id in _active_tasks:
                _active_tasks[prompt_id]["progress"] = progress

    elif msg_type == "executing":
        # 正在执行节点: {type: "executing", data: {node: str, prompt_id: str}}
        exec_data = data.get("data", {})
        prompt_id = exec_data.get("prompt_id")
        node = exec_data.get("node")

        if prompt_id:
            if prompt_id not in _active_tasks:
                _active_tasks[prompt_id] = {
                    "worker_id": worker_id,
                    "progress": 0,
                    "started_at": datetime.now().isoformat()
                }
            logger.debug(f"任务 {prompt_id} 正在执行节点: {node}")

    elif msg_type == "executed":
        # 节点执行完成: {type: "executed", data: {node: str, prompt_id: str, output: {...}}}
        exec_data = data.get("data", {})
        prompt_id = exec_data.get("prompt_id")

        if prompt_id:
            logger.info(f"任务 {prompt_id} 节点执行完成")

    elif msg_type == "execution_start":
        # 执行开始
        exec_data = data.get("data", {})
        prompt_id = exec_data.get("prompt_id")
        if prompt_id:
            logger.info(f"任务 {prompt_id} 开始执行")
            update_progress(prompt_id, progress=0)

    elif msg_type == "execution_cached":
        # 使用缓存执行
        exec_data = data.get("data", {})
        prompt_id = exec_data.get("prompt_id")
        if prompt_id:
            logger.info(f"任务 {prompt_id} 使用缓存执行")

    elif msg_type == "execution_error":
        # 执行错误
        exec_data = data.get("data", {})
        prompt_id = exec_data.get("prompt_id")
        error_msg = exec_data.get("exception_message", "Unknown error")
        if prompt_id:
            logger.error(f"任务 {prompt_id} 执行错误: {error_msg}")
            update_failed(prompt_id, error_message=error_msg)
            if prompt_id in _active_tasks:
                del _active_tasks[prompt_id]


async def subscribe_task(prompt_id: str, client_id: str = None) -> None:
    """
    订阅任务的进度更新。
    """
    if prompt_id not in _subscribed_clients:
        _subscribed_clients[prompt_id] = set()
    if client_id:
        _subscribed_clients[prompt_id].add(client_id)

    # 获取任务对应的 Worker 并确保连接
    worker_id = get_task_worker(prompt_id)
    if worker_id:
        worker = wm.get_worker(worker_id)
        if worker:
            await connect_worker(worker_id, worker.url, worker.auth())

    logger.debug(f"订阅任务 {prompt_id} 的进度更新")


async def connect_all_workers() -> None:
    """
    连接所有已注册的 Worker 的 WebSocket。
    """
    if not WEBSOCKETS_AVAILABLE:
        logger.warning("websockets 库未安装，跳过 WebSocket 连接")
        return

    workers = wm.list_workers()
    for worker in workers:
        if worker.enabled and worker.healthy:
            await connect_worker(worker.worker_id, worker.url, worker.auth())

    logger.info(f"已连接 {len(_worker_connections)} 个 Worker 的 WebSocket")


async def websocket_monitor_loop() -> None:
    """
    WebSocket 监听主循环：定期检查连接状态并重连。
    """
    if not WEBSOCKETS_AVAILABLE:
        logger.warning("websockets 库未安装，WebSocket 进度监听不可用，使用 HTTP 轮询")
        return

    logger.info("WebSocket 进度监听器启动")

    while True:
        try:
            # 检查并重连断开的 Worker
            workers = wm.list_workers()
            for worker in workers:
                if worker.enabled and worker.healthy:
                    if worker.worker_id not in _worker_connections:
                        logger.info(f"尝试重新连接 Worker {worker.worker_id} 的 WebSocket")
                        await connect_worker(worker.worker_id, worker.url, worker.auth())

            await asyncio.sleep(30)  # 每 30 秒检查一次

        except Exception as e:
            logger.error(f"WebSocket 监听器异常: {e}")
            await asyncio.sleep(10)


def get_task_progress(prompt_id: str) -> Optional[int]:
    """
    获取任务的当前进度。
    """
    if prompt_id in _active_tasks:
        return _active_tasks[prompt_id].get("progress")
    return None
