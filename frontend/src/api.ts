const API = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  // Add auth token if available
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const r = await fetch(API + path, {
    ...options,
    headers,
  });

  // Handle 401 - redirect to login
  if (r.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_username");
    window.location.href = "/login";
    throw new Error("认证已过期，请重新登录");
  }

  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err));
  }
  return r.json();
}

export interface WorkerItem {
  worker_id: string;
  url: string;
  name: string | null;
  weight: number;
  enabled: boolean;
  is_gray: boolean;
  healthy: boolean;
  queue_running: number;
  queue_pending: number;
  auth_username?: string | null;
  auth_has_password?: boolean;
}

export const workers = {
  list: () => request<{ workers: WorkerItem[] }>("/workers"),
  create: (body: { url: string; name?: string; weight?: number; auth_username?: string; auth_password?: string }) =>
    request<WorkerItem>("/workers", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: { name?: string; weight?: number; enabled?: boolean; auth_username?: string; auth_password?: string }) =>
    request<WorkerItem>(`/workers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => request<{ ok: boolean }>(`/workers/${id}`, { method: "DELETE" }),
};

export interface SettingsResponse {
  worker_auth_username: string | null;
  worker_auth_has_password: boolean;
}

export const settings = {
  get: () => request<SettingsResponse>("/settings"),
  update: (body: { worker_auth_username?: string; worker_auth_password?: string }) =>
    request<SettingsResponse>("/settings", { method: "PATCH", body: JSON.stringify(body) }),
};

export interface QueueItem {
  prompt_id: string;
  worker_id: string;
  worker_name: string;
  status: "running" | "pending";
  position: number;
}

export interface QueueResponse {
  workers: { worker_id: string; name: string; url: string; healthy: boolean; enabled: boolean; queue_running: number; queue_pending: number }[];
  gateway_queue: QueueItem[];
  total_running: number;
  total_pending: number;
}

export const queue = {
  get: () => request<QueueResponse>("/queue"),
};

export interface TaskStatus {
  prompt_id: string;
  worker_id: string;
  worker_name: string;
  status: "queued" | "running" | "done" | "failed" | "unknown";
  progress: number | null;
  message: string;
  history?: Record<string, unknown>;
}

export interface TaskItem {
  task_id: string;
  prompt_id: string | null;
  worker_id: string | null;
  worker_name: string | null;
  priority: number;
  status: "pending" | "submitted" | "running" | "done" | "failed";
  progress: number;
  error_message: string | null;
  submitted_at: string;
  started_at: string | null;
  completed_at: string | null;
  result_json: string | null;
}

export interface OutputFile {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
}

export interface TaskOutput {
  node_id: string;
  files: OutputFile[];
}

export interface TaskOutputResponse {
  prompt_id: string;
  status: string;
  outputs: TaskOutput[];
}

export interface TaskListResponse {
  tasks: TaskItem[];
  total: number;
  limit: number;
  offset: number;
}

export const task = {
  list: (params?: { limit?: number; offset?: number; worker_id?: string; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    if (params?.worker_id) searchParams.set("worker_id", params.worker_id);
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    return request<TaskListResponse>(`/tasks${query ? `?${query}` : ""}`);
  },
  get: (taskId: string) => request<TaskItem>(`/tasks/${taskId}`),
  status: (promptId: string) => request<TaskStatus>(`/task/${promptId}/status`),
  history: (promptId: string) => request<Record<string, unknown>>(`/history/${promptId}`),
  gatewayStatus: (gatewayJobId: string) =>
    request<{ gateway_job_id: string; status: string; prompt_id: string | null }>(`/task/gateway/${gatewayJobId}`),
  output: (promptId: string) => request<TaskOutputResponse>(`/output/${promptId}`),
};

export type PromptSubmitResponse =
  | { prompt_id: string; number?: number }
  | { gateway_job_id: string; status: "queued" };

export const prompt = {
  submit: (body: { prompt: Record<string, unknown>; client_id?: string; priority?: number }) =>
    request<PromptSubmitResponse>("/prompt", { method: "POST", body: JSON.stringify(body) }),
};

// ==================== Workflows ====================

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  input_schema: Record<string, { type: string; required?: boolean; default?: unknown; description?: string }>;
  output_schema: Record<string, unknown>;
  comfy_workflow: Record<string, unknown>;
  param_mapping: Record<string, string>;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowExecution {
  execution_id: string;
  template_id: string;
  gateway_job_id: string | null;
  prompt_id: string | null;
  worker_id: string | null;
  input_params: Record<string, unknown>;
  status: "pending" | "queued" | "submitted" | "running" | "done" | "failed";
  progress: number;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WorkflowApiDocs {
  template_id: string;
  template_name: string;
  description: string;
  category: string;
  endpoints: Record<string, unknown>;
  parameters: Array<{ name: string; type: string; required: boolean; description: string; default: unknown }>;
  examples: {
    curl: string;
    python: string;
    javascript: string;
  };
}

export const workflows = {
  // 模板管理
  list: (category?: string, enabledOnly?: boolean) =>
    request<{ templates: WorkflowTemplate[]; total: number }>(
      `/workflows${category ? `?category=${category}` : ""}${enabledOnly !== false ? "" : "&enabled_only=false"}`
    ),
  get: (id: string) => request<WorkflowTemplate>(`/workflows/${id}`),
  create: (body: {
    name: string;
    description?: string;
    category?: string;
    input_schema: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    comfy_workflow: Record<string, unknown>;
    param_mapping: Record<string, string>;
  }) => request<WorkflowTemplate>("/workflows", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<WorkflowTemplate>) =>
    request<WorkflowTemplate>(`/workflows/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  delete: (id: string) => request<{ message: string }>(`/workflows/${id}`, { method: "DELETE" }),

  // 复制模板
  copy: (id: string) => request<WorkflowTemplate>(`/workflows/${id}/copy`, { method: "POST" }),

  // 导出/导入
  export: async (id: string) => {
    const response = await fetch(`/api/workflows/${id}/export`);
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow_${id}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  },
  import: (data: Record<string, unknown>) =>
    request<{ message: string; template_id: string; template_name: string }>(
      "/workflows/import",
      { method: "POST", body: JSON.stringify({ data }) }
    ),

  // 批量操作
  batch: (templateIds: string[], action: "enable" | "disable" | "delete") =>
    request<{ success: string[]; failed: Array<{ id: string; error: string }> }>(
      "/workflows/batch",
      { method: "POST", body: JSON.stringify({ template_ids: templateIds, action }) }
    ),

  // 分类
  listCategories: () =>
    request<{ categories: Array<{ name: string; total: number; enabled: number }> }>("/workflows/categories/list"),

  // 统计
  getStats: () =>
    request<{
      total_templates: number;
      enabled_templates: number;
      total_executions_30d: number;
      success_rate_30d: number;
      success_count_30d: number;
      failed_count_30d: number;
    }>("/workflows/stats/summary"),

  // 执行
  execute: (id: string, body: { params: Record<string, unknown>; client_id?: string; priority?: number }) =>
    request<{ execution_id: string; template_id: string; status: string; message: string }>(
      `/workflows/${id}/execute`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  // 执行记录
  getExecution: (executionId: string) => request<WorkflowExecution>(`/workflows/executions/${executionId}`),
  listExecutions: (templateId?: string, limit = 100) =>
    request<{ executions: WorkflowExecution[]; total: number }>(
      `/workflows/executions${templateId ? `?template_id=${templateId}` : ""}&limit=${limit}`
    ),
  getTemplateHistory: (templateId: string, limit = 20) =>
    request<{ executions: Array<{ execution_id: string; status: string; created_at: string }> }>(
      `/workflows/${templateId}/executions/history?limit=${limit}`
    ),

  // API 文档
  getApiDocs: (id: string) => request<WorkflowApiDocs>(`/workflows/${id}/api-docs`),
};

// ==================== Models ====================

export interface ModelType {
  id: number;
  type_name: string;
  display_name: string;
  directory: string;
  file_extensions: string[];
  icon: string | null;
  sort_order: number;
  enabled: boolean;
}

export interface ModelItem {
  id: number;
  model_type_id: number;
  filename: string;
  file_path: string;
  file_size: number;
  civitai_model_id: string | null;
  civitai_version_id: string | null;
  civitai_model_name: string | null;
  civitai_preview_url: string | null;
  civitai_base_model: string | null;
  is_scanned: boolean;
  model_type_name?: string;
  type_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ModelSettings {
  comfyui_models_root: string | null;
  civitai_api_token: string | null;
  civitai_has_token: boolean;
}

export interface DownloadTask {
  id: number;
  download_id: string;
  model_type_id: number;
  civitai_version_id: string;
  download_url: string;
  filename: string;
  status: "pending" | "downloading" | "completed" | "failed" | "cancelled";
  progress: number;
  bytes_downloaded: number;
  total_bytes: number;
  error_message: string | null;
  result_model_id: number | null;
  created_at: string;
  completed_at: string | null;
  model_type_name?: string;
}

export interface CivitaiVersion {
  version_id: string;
  version_name: string;
  model_id: string;
  model_name: string;
  model_type: string;
  base_model: string;
  download_url: string;
  files: Array<{
    name: string;
    size_kb: number;
    type: string;
    download_url: string;
  }>;
  images: Array<{
    url: string;
    nsfw: boolean;
  }>;
}

export interface ModelStats {
  by_type: Array<{
    display_name: string;
    type_name: string;
    count: number;
    total_size: number;
  }>;
  total_count: number;
  total_size: number;
  downloads: {
    total: number;
    pending: number;
    downloading: number;
    completed: number;
    failed: number;
  };
}

export const models = {
  // 设置
  getSettings: () => request<ModelSettings>("/models/settings"),
  updateSettings: (body: { comfyui_models_root?: string; civitai_api_token?: string }) =>
    request<ModelSettings>("/models/settings", { method: "PATCH", body: JSON.stringify(body) }),

  // 模型类型
  getTypes: () => request<{ types: ModelType[] }>("/models/types"),

  // 模型列表
  list: (params?: { model_type_id?: number; search?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.model_type_id) searchParams.set("model_type_id", String(params.model_type_id));
    if (params?.search) searchParams.set("search", params.search);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    const query = searchParams.toString();
    return request<{ models: ModelItem[]; total: number }>(`/models${query ? `?${query}` : ""}`);
  },

  // 扫描
  scan: (modelTypeId?: number) =>
    request<{ scanned: number; added: number; updated: number; errors: string[] }>(
      `/models/scan`,
      { method: "POST", body: JSON.stringify({ model_type_id: modelTypeId }) }
    ),

  // 统计
  getStats: () => request<ModelStats>("/models/stats"),

  // 删除
  delete: (modelId: number, deleteFile = false) =>
    request<{ message: string }>(`/models/${modelId}?delete_file=${deleteFile}`, { method: "DELETE" }),

  // Civitai
  getCivitaiVersion: (versionId: string) =>
    request<CivitaiVersion>(`/models/civitai/versions/${versionId}`),

  // 下载
  getDownloads: () => request<{ downloads: DownloadTask[] }>("/models/downloads"),
  createDownload: (body: { civitai_version_id: string; model_type_id: number; filename?: string }) =>
    request<DownloadTask>("/models/downloads", { method: "POST", body: JSON.stringify(body) }),
  getDownload: (downloadId: string) => request<DownloadTask>(`/models/downloads/${downloadId}`),
  cancelDownload: (downloadId: string) =>
    request<{ message: string }>(`/models/downloads/${downloadId}`, { method: "DELETE" }),
};
