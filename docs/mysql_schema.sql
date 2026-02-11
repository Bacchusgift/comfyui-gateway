-- ComfyUI Gateway 持久化表结构（MySQL 5.7+ / 8.0+）
-- 在已有数据库中执行本文件即可建表；如需单独建库：CREATE DATABASE comfyui_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE comfyui_gateway;

-- 1. Worker 注册表
CREATE TABLE IF NOT EXISTS workers (
    worker_id   VARCHAR(64)  NOT NULL PRIMARY KEY,
    url         VARCHAR(512) NOT NULL,
    name        VARCHAR(256) DEFAULT NULL,
    weight      INT          NOT NULL DEFAULT 1,
    enabled     TINYINT(1)   NOT NULL DEFAULT 1,
    auth_username VARCHAR(256) DEFAULT NULL,
    auth_password VARCHAR(512) DEFAULT NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_workers_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 任务与 Worker 映射（prompt_id -> worker_id）
CREATE TABLE IF NOT EXISTS task_worker (
    prompt_id   VARCHAR(64)  NOT NULL PRIMARY KEY,
    worker_id   VARCHAR(64)  NOT NULL,
    created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_task_worker_worker (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 插队任务提交后的 gateway_job_id -> prompt_id, worker_id
CREATE TABLE IF NOT EXISTS gateway_job (
    gateway_job_id VARCHAR(64)  NOT NULL PRIMARY KEY,
    prompt_id      VARCHAR(64)  NOT NULL,
    worker_id      VARCHAR(64)  NOT NULL,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_gateway_job_prompt (prompt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 优先级待提交队列（插队用）
CREATE TABLE IF NOT EXISTS pending_queue (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    gateway_job_id VARCHAR(64)  NOT NULL,
    prompt         JSON         NOT NULL COMMENT 'workflow JSON',
    client_id      VARCHAR(128) NOT NULL,
    priority       INT          NOT NULL DEFAULT 0,
    created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_pending_gateway_job (gateway_job_id),
    INDEX idx_pending_priority (priority DESC, created_at ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 网关全局设置（如全局 Worker 认证）
CREATE TABLE IF NOT EXISTS settings (
    k   VARCHAR(64)  NOT NULL PRIMARY KEY,
    v   TEXT         DEFAULT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
