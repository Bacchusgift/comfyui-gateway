"""MySQL 连接与通用封装。仅在配置了 MYSQL_DATABASE 时使用。"""
from contextlib import contextmanager
from typing import Any, Optional
import json

from app.config import use_mysql, MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE


def _conn():
    if not use_mysql():
        return None
    import pymysql
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


@contextmanager
def get_cursor():
    """获取游标，自动 commit/close。"""
    conn = _conn()
    if not conn:
        yield None
        return
    try:
        with conn.cursor() as cur:
            yield cur
        conn.commit()
    finally:
        conn.close()


def execute(sql: str, args: Optional[tuple] = None) -> None:
    with get_cursor() as cur:
        if cur:
            cur.execute(sql, args or ())


def fetchone(sql: str, args: Optional[tuple] = None) -> Optional[dict]:
    with get_cursor() as cur:
        if not cur:
            return None
        cur.execute(sql, args or ())
        return cur.fetchone()


def fetchall(sql: str, args: Optional[tuple] = None) -> list:
    with get_cursor() as cur:
        if not cur:
            return []
        cur.execute(sql, args or ())
        return cur.fetchall()


def json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)
