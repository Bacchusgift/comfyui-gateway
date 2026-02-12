-- 工作流模板系统数据库表创建语句
-- 执行方式: docker compose exec web mysql -u root -p密码 数据库名 < workflow_tables.sql

-- 1. 工作流模板表
CREATE TABLE IF NOT EXISTS workflow_templates (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(64) DEFAULT 'default',
    input_schema JSON NOT NULL,
    output_schema JSON,
    comfy_workflow LONGTEXT NOT NULL,
    param_mapping JSON NOT NULL,
    version INT DEFAULT 1,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 工作流执行记录表
CREATE TABLE IF NOT EXISTS workflow_executions (
    execution_id VARCHAR(64) PRIMARY KEY,
    template_id VARCHAR(64) NOT NULL,
    gateway_job_id VARCHAR(64),
    prompt_id VARCHAR(64),
    worker_id VARCHAR(64),
    input_params JSON,
    status VARCHAR(32) DEFAULT 'pending',
    progress INT DEFAULT 0,
    result_json LONGTEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    INDEX idx_template (template_id),
    INDEX idx_status (status),
    INDEX idx_gateway_job (gateway_job),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 查看表结构
DESC workflow_templates;
DESC workflow_executions;

-- 查看数据
SELECT * FROM workflow_templates;
SELECT * FROM workflow_executions;
