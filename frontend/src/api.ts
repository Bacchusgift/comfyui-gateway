const API = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
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

export const task = {
  status: (promptId: string) => request<TaskStatus>(`/task/${promptId}/status`),
  history: (promptId: string) => request<Record<string, unknown>>(`/history/${promptId}`),
  gatewayStatus: (gatewayJobId: string) =>
    request<{ gateway_job_id: string; status: string; prompt_id: string | null }>(`/task/gateway/${gatewayJobId}`),
};

export type PromptSubmitResponse =
  | { prompt_id: string; number?: number }
  | { gateway_job_id: string; status: "queued" };

export const prompt = {
  submit: (body: { prompt: Record<string, unknown>; client_id?: string; priority?: number }) =>
    request<PromptSubmitResponse>("/prompt", { method: "POST", body: JSON.stringify(body) }),
};
