"""
工作流模板管理：存储、查询、执行预配置的 ComfyUI 工作流。

功能：
1. 模板 CRUD（创建、读取、更新、删除）
2. 参数映射：将外部参数注入到 ComfyUI workflow 节点
3. 自动生成 API 文档
4. 执行跟踪：关联到 task_history 表
"""
import json
import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field

from app.config import use_mysql
from app.db import execute, fetchone, fetchall, json_dumps


# ==================== 数据模型 ====================

class WorkflowTemplate(BaseModel):
    """工作流模板数据模型"""
    id: str = Field(default_factory=lambda: f"wf_{uuid.uuid4().hex[:8]}")
    name: str
    description: str = ""
    category: str = "default"  # 文生图/图编辑/图生视频 等
    input_schema: Dict[str, Any]  # JSON Schema 格式的输入定义
    output_schema: Dict[str, Any]  # 输出定义
    comfy_workflow: Dict[str, Any]  # ComfyUI workflow JSON
    param_mapping: Dict[str, str]  # 参数映射: {"prompt": "6.inputs.text"}
    version: int = 1
    enabled: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class WorkflowExecution(BaseModel):
    """工作流执行记录"""
    execution_id: str = Field(default_factory=lambda: f"exec_{uuid.uuid4().hex[:12]}")
    template_id: str
    gateway_job_id: Optional[str] = None
    prompt_id: Optional[str] = None
    worker_id: Optional[str] = None
    input_params: Dict[str, Any]
    status: str = "pending"  # pending/submitted/running/done/failed
    progress: int = 0
    result_json: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    completed_at: Optional[str] = None


# ==================== 数据库操作 ====================

def _mysql_create_tables() -> None:
    """创建数据库表"""
    # 工作流模板表
    execute("""
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

    # 工作流执行记录表
    execute("""
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
            FOREIGN KEY (template_id) REFERENCES workflow_templates(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)


def ensure_tables() -> None:
    """确保表存在（应用启动时调用）"""
    if use_mysql():
        try:
            _mysql_create_tables()
        except Exception as e:
            print(f"创建工作流表失败: {e}")


# ==================== 模板 CRUD ====================

def create_template(template: WorkflowTemplate) -> WorkflowTemplate:
    """创建新工作流模板"""
    if use_mysql():
        execute("""
            INSERT INTO workflow_templates
                (id, name, description, category, input_schema, output_schema,
                 comfy_workflow, param_mapping, version, enabled)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            template.id, template.name, template.description, template.category,
            json_dumps(template.input_schema), json_dumps(template.output_schema),
            json_dumps(template.comfy_workflow), json_dumps(template.param_mapping),
            template.version, template.enabled
        ))
    return template


def get_template(template_id: str) -> Optional[WorkflowTemplate]:
    """获取单个模板"""
    if not use_mysql():
        return None

    row = fetchone("SELECT * FROM workflow_templates WHERE id = %s", (template_id,))
    if not row:
        return None

    return WorkflowTemplate(
        id=row['id'],
        name=row['name'],
        description=row['description'] or "",
        category=row['category'],
        input_schema=json.loads(row['input_schema']) if isinstance(row['input_schema'], str) else row['input_schema'],
        output_schema=json.loads(row['output_schema']) if row.get('output_schema') else {},
        comfy_workflow=json.loads(row['comfy_workflow']),
        param_mapping=json.loads(row['param_mapping']),
        version=row['version'],
        enabled=row['enabled'],
        created_at=str(row['created_at']),
        updated_at=str(row['updated_at'])
    )


def list_templates(category: Optional[str] = None, enabled_only: bool = True) -> List[WorkflowTemplate]:
    """列出所有模板"""
    if not use_mysql():
        return []

    sql = "SELECT * FROM workflow_templates WHERE 1=1"
    params = []

    if enabled_only:
        sql += " AND enabled = TRUE"
    if category:
        sql += " AND category = %s"
        params.append(category)

    sql += " ORDER BY created_at DESC"

    rows = fetchall(sql, params)
    return [
        WorkflowTemplate(
            id=row['id'],
            name=row['name'],
            description=row['description'] or "",
            category=row['category'],
            input_schema=json.loads(row['input_schema']),
            output_schema=json.loads(row['output_schema']) if row.get('output_schema') else {},
            comfy_workflow=json.loads(row['comfy_workflow']),
            param_mapping=json.loads(row['param_mapping']),
            version=row['version'],
            enabled=row['enabled'],
            created_at=str(row['created_at']),
            updated_at=str(row['updated_at'])
        )
        for row in rows
    ]


def update_template(template_id: str, template: WorkflowTemplate) -> bool:
    """更新模板"""
    if not use_mysql():
        return False

    execute("""
        UPDATE workflow_templates
        SET name = %s, description = %s, category = %s,
            input_schema = %s, output_schema = %s,
            comfy_workflow = %s, param_mapping = %s,
            version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
    """, (
        template.name, template.description, template.category,
        json_dumps(template.input_schema), json_dumps(template.output_schema),
        json_dumps(template.comfy_workflow), json_dumps(template.param_mapping),
        template_id
    ))
    return True


def delete_template(template_id: str) -> bool:
    """删除模板"""
    if not use_mysql():
        return False

    execute("DELETE FROM workflow_templates WHERE id = %s", (template_id,))
    return True


# ==================== 参数注入引擎 ====================

def inject_params_to_workflow(template: WorkflowTemplate, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    将外部参数注入到 ComfyUI workflow 中。

    Args:
        template: 工作流模板
        params: 外部参数 {"prompt": "a cat", "width": 1024}

    Returns:
        注入后的 ComfyUI workflow JSON
    """
    workflow = json.loads(json.dumps(template.comfy_workflow))  # 深拷贝

    for param_key, param_value in params.items():
        if param_key not in template.param_mapping:
            continue

        # 解析映射路径: "6.inputs.text" -> workflow["6"]["inputs"]["text"]
        mapping_path = template.param_mapping[param_key]
        path_parts = mapping_path.split(".")

        # 定位目标位置
        target = workflow
        for part in path_parts[:-1]:
            if part.isdigit():
                part = int(part)
            if part not in target:
                raise ValueError(f"映射路径无效: {mapping_path}")
            target = target[part]

        final_key = path_parts[-1]
        target[final_key] = param_value

    return workflow


def validate_params(template: WorkflowTemplate, params: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    """
    根据模板的 input_schema 验证参数。

    Returns:
        (is_valid, error_message)
    """
    schema = template.input_schema

    # 检查必填字段
    for key, defn in schema.items():
        if defn.get("required", False) and key not in params:
            return False, f"缺少必填参数: {key}"

        # 检查类型
        if key in params:
            expected_type = defn.get("type")
            if expected_type == "integer":
                if not isinstance(params[key], int):
                    return False, f"参数 {key} 应为整数"
            elif expected_type == "number":
                if not isinstance(params[key], (int, float)):
                    return False, f"参数 {key} 应为数字"
            elif expected_type == "string":
                if not isinstance(params[key], str):
                    return False, f"参数 {key} 应为字符串"

    return True, None


# ==================== 执行记录 ====================

def create_execution(execution: WorkflowExecution) -> WorkflowExecution:
    """创建执行记录"""
    if use_mysql():
        execute("""
            INSERT INTO workflow_executions
                (execution_id, template_id, input_params, status)
            VALUES (%s, %s, %s, %s)
        """, (
            execution.execution_id, execution.template_id,
            json_dumps(execution.input_params), execution.status
        ))
    return execution


def update_execution(execution_id: str, **updates) -> bool:
    """更新执行记录"""
    if not use_mysql():
        return False

    set_clauses = []
    params = []

    for key, value in updates.items():
        set_clauses.append(f"{key} = %s")
        params.append(value)

    if not set_clauses:
        return False

    params.append(execution_id)
    execute(f"UPDATE workflow_executions SET {', '.join(set_clauses)} WHERE execution_id = %s", params)
    return True


def get_execution(execution_id: str) -> Optional[WorkflowExecution]:
    """获取执行记录"""
    if not use_mysql():
        return None

    row = fetchone("SELECT * FROM workflow_executions WHERE execution_id = %s", (execution_id,))
    if not row:
        return None

    return WorkflowExecution(
        execution_id=row['execution_id'],
        template_id=row['template_id'],
        gateway_job_id=row['gateway_job_id'],
        prompt_id=row['prompt_id'],
        worker_id=row['worker_id'],
        input_params=json.loads(row['input_params']),
        status=row['status'],
        progress=row['progress'],
        result_json=row['result_json'],
        error_message=row['error_message'],
        created_at=str(row['created_at']),
        completed_at=str(row['completed_at']) if row['completed_at'] else None
    )


def list_executions(template_id: Optional[str] = None, limit: int = 100) -> List[WorkflowExecution]:
    """列出执行记录"""
    if not use_mysql():
        return []

    sql = "SELECT * FROM workflow_executions WHERE 1=1"
    params = []

    if template_id:
        sql += " AND template_id = %s"
        params.append(template_id)

    sql += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)

    rows = fetchall(sql, params)
    return [
        WorkflowExecution(
            execution_id=row['execution_id'],
            template_id=row['template_id'],
            gateway_job_id=row['gateway_job_id'],
            prompt_id=row['prompt_id'],
            worker_id=row['worker_id'],
            input_params=json.loads(row['input_params']),
            status=row['status'],
            progress=row['progress'],
            result_json=row['result_json'],
            error_message=row['error_message'],
            created_at=str(row['created_at']),
            completed_at=str(row['completed_at']) if row['completed_at'] else None
        )
        for row in rows
    ]
