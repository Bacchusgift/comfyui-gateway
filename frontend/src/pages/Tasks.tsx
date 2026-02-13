import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { task as api, type TaskItem, type TaskStatus, type TaskOutputResponse } from "../api";

type GatewayStatus = { gateway_job_id: string; status: string; prompt_id: string | null };

const statusLabel: Record<string, string> = {
  pending: "等待中",
  submitted: "已提交",
  queued: "排队中",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  unknown: "未知",
};

const statusColor: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800",
  submitted: "bg-blue-100 text-blue-800",
  queued: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-800",
};

const PAGE_SIZE = 20;

export default function Tasks() {
  const [searchParams] = useSearchParams();
  const promptIdParam = searchParams.get("prompt_id") || "";
  const gatewayJobIdParam = searchParams.get("gateway_job_id") || "";

  // 任务列表状态
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("");

  // 输出文件状态
  const [outputTaskId, setOutputTaskId] = useState<string | null>(null);
  const [outputData, setOutputData] = useState<TaskOutputResponse | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);

  // 单个任务查询状态
  const [queryInput, setQueryInput] = useState(gatewayJobIdParam || promptIdParam);
  const [result, setResult] = useState<TaskStatus | null>(null);
  const [gatewayResult, setGatewayResult] = useState<GatewayStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, unknown> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.list({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        status: filterStatus || undefined,
      });
      setTasks(res.tasks);
      setTotal(res.total);
    } catch (e) {
      console.error("Failed to load tasks:", e);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // 自动刷新运行中的任务
  useEffect(() => {
    const hasRunning = tasks.some(t => t.status === "running" || t.status === "pending" || t.status === "submitted");
    if (!hasRunning) return;

    const timer = setInterval(() => {
      loadTasks();
    }, 3000);
    return () => clearInterval(timer);
  }, [tasks, loadTasks]);

  // 单个任务查询
  const fetchStatus = (pid: string) => {
    api.status(pid).then(setResult).catch((e) => setErr(e.message));
  };

  const fetchGatewayStatus = (gid: string) => {
    api.gatewayStatus(gid).then((r) => {
      setGatewayResult(r);
      if (r.prompt_id && (r.status === "submitted" || r.status === "running" || r.status === "done" || r.status === "failed")) {
        fetchStatus(r.prompt_id);
      }
    }).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    setQueryInput(gatewayJobIdParam || promptIdParam);
    setResult(null);
    setGatewayResult(null);
    setErr(null);
    setHistory(null);
    if (gatewayJobIdParam) {
      fetchGatewayStatus(gatewayJobIdParam);
    } else if (promptIdParam) {
      fetchStatus(promptIdParam);
    }
  }, [promptIdParam, gatewayJobIdParam]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const needPoll = result && (result.status === "queued" || result.status === "running") || gatewayResult && (gatewayResult.status === "queued" || gatewayResult.status === "submitted" || gatewayResult.status === "running");
    if (!needPoll) return;
    pollRef.current = setInterval(() => {
      if (gatewayJobIdParam) fetchGatewayStatus(gatewayJobIdParam);
      else if (result?.prompt_id) fetchStatus(result.prompt_id);
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [result?.status, gatewayResult?.status, gatewayJobIdParam, result?.prompt_id]);

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    const v = queryInput.trim();
    setErr(null);
    setResult(null);
    setGatewayResult(null);
    setHistory(null);
    if (!v) return;
    if (v.length >= 36 && /^[0-9a-f-]+$/i.test(v)) {
      fetchGatewayStatus(v);
    } else {
      fetchStatus(v);
    }
  };

  const loadHistory = () => {
    const pid = result?.prompt_id;
    if (!pid) return;
    api.history(pid).then(setHistory).catch((e) => setErr(e.message));
  };

  // 加载输出文件
  const loadOutput = async (promptId: string) => {
    setOutputLoading(true);
    setOutputTaskId(promptId);
    setOutputData(null);
    try {
      const data = await api.output(promptId);
      setOutputData(data);
    } catch (e) {
      console.error("Failed to load output:", e);
    } finally {
      setOutputLoading(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const progress = result?.progress ?? null;

  const formatTime = (time: string | null) => {
    if (!time) return "-";
    return new Date(time).toLocaleString("zh-CN");
  };

  return (
    <div className="space-y-6">
      {/* 任务列表 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-900">任务列表</h1>
          <div className="flex items-center gap-4">
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(0);
              }}
              className="border rounded px-3 py-1.5 text-sm"
            >
              <option value="">全部状态</option>
              <option value="pending">等待中</option>
              <option value="submitted">已提交</option>
              <option value="running">运行中</option>
              <option value="done">已完成</option>
              <option value="failed">失败</option>
            </select>
            <button
              onClick={loadTasks}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">暂无任务记录</div>
        ) : (
          <>
            <div className="bg-white rounded-lg border overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">任务 ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prompt ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">进度</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">提交时间</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {tasks.map((task) => (
                    <tr key={task.task_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono text-gray-900" title={task.task_id}>
                        {task.task_id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500" title={task.prompt_id || ""}>
                        {task.prompt_id ? `${task.prompt_id.slice(0, 8)}...` : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500" title={task.worker_id || ""}>
                        {task.worker_name || task.worker_id || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${statusColor[task.status] || "bg-gray-100 text-gray-800"}`}>
                          {statusLabel[task.status] || task.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${task.status === "done" ? "bg-green-500" : task.status === "failed" ? "bg-red-500" : "bg-blue-500"}`}
                              style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{task.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatTime(task.submitted_at)}
                      </td>
                      <td className="px-4 py-3">
                        {task.status === "done" && task.prompt_id && (
                          <button
                            onClick={() => loadOutput(task.prompt_id!)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            查看结果
                          </button>
                        )}
                        {task.status === "failed" && task.error_message && (
                          <span className="text-red-500 text-xs" title={task.error_message}>
                            错误
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-gray-500">
                  共 {total} 条记录，第 {page + 1} / {totalPages} 页
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 输出文件弹窗 */}
      {(outputTaskId || outputData) && (
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">输出文件</h2>
            <button
              onClick={() => { setOutputTaskId(null); setOutputData(null); }}
              className="text-gray-400 hover:text-gray-600"
            >
              关闭
            </button>
          </div>

          {outputLoading ? (
            <div className="text-center py-4 text-gray-500">加载中...</div>
          ) : outputData ? (
            <div className="space-y-4">
              {outputData.outputs.length === 0 ? (
                <div className="text-gray-500">暂无输出文件</div>
              ) : (
                outputData.outputs.map((output) => (
                  <div key={output.node_id} className="border rounded p-3">
                    <div className="text-sm text-gray-500 mb-2">节点 {output.node_id}</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {output.files.map((file, idx) => (
                        <div key={idx} className="border rounded p-2">
                          {file.type === "output" && file.filename.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? (
                            <img
                              src={file.url}
                              alt={file.filename}
                              className="w-full h-24 object-cover rounded mb-2"
                            />
                          ) : file.filename.match(/\.(mp4|webm|mov)$/i) ? (
                            <video
                              src={file.url}
                              className="w-full h-24 object-cover rounded mb-2"
                              controls
                            />
                          ) : (
                            <div className="w-full h-24 bg-gray-100 rounded flex items-center justify-center mb-2">
                              <span className="text-gray-400 text-xs">文件</span>
                            </div>
                          )}
                          <div className="text-xs text-gray-500 truncate" title={file.filename}>
                            {file.filename}
                          </div>
                          <a
                            href={file.url}
                            download={file.filename}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                            target="_blank"
                            rel="noreferrer"
                          >
                            下载
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* 任务查询 */}
      <div className="border-t pt-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">任务查询</h2>
        <form onSubmit={handleQuery} className="flex flex-wrap gap-2 mb-4">
          <input
            type="text"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="输入 prompt_id 或 gateway_job_id"
            className="border rounded px-3 py-2 flex-1 max-w-md font-mono text-sm"
          />
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            查询
          </button>
        </form>

        {err && <div className="text-red-600 mb-4">{err}</div>}

        {gatewayResult && !result && gatewayResult.status === "queued" && (
          <div className="bg-white rounded-lg border p-4 space-y-2">
            <p><span className="text-gray-600">gateway_job_id:</span> <code className="bg-gray-100 px-1">{gatewayResult.gateway_job_id}</code></p>
            <p>
              <span className="text-gray-600">状态:</span>{" "}
              <span className="px-2 py-0.5 rounded text-sm bg-gray-100 text-gray-800">{statusLabel.queued}</span>
            </p>
            <p className="text-sm text-gray-500">正在按优先级排队，提交到 Worker 后将显示 prompt_id 与进度</p>
          </div>
        )}

        {result && (
          <div className="bg-white rounded-lg border p-4 space-y-3">
            {gatewayResult && (
              <p><span className="text-gray-600">gateway_job_id:</span> <code className="bg-gray-100 px-1 text-xs">{gatewayResult.gateway_job_id}</code></p>
            )}
            <p><span className="text-gray-600">prompt_id:</span> <code className="bg-gray-100 px-1">{result.prompt_id}</code></p>
            <p><span className="text-gray-600">Worker:</span> {result.worker_name || result.worker_id}</p>
            <p>
              <span className="text-gray-600">状态:</span>{" "}
              <span className={`px-2 py-0.5 rounded text-sm ${
                result.status === "done" ? "bg-green-100 text-green-800" :
                result.status === "running" ? "bg-blue-100 text-blue-800" :
                result.status === "failed" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"
              }`}>
                {statusLabel[result.status] ?? result.status}
              </span>
              {progress != null && ` (${progress}%)`}
            </p>
            {progress != null && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-blue-600 h-2.5 rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
              </div>
            )}
            {result.status === "running" && progress == null && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div className="h-2.5 rounded-full bg-blue-400 animate-pulse w-1/3" />
              </div>
            )}
            {result.message && <p className="text-sm text-gray-500">{result.message}</p>}
            {result.status === "done" && (
              <div>
                <button onClick={loadHistory} className="text-blue-600 hover:underline text-sm">
                  查看 History 结果
                </button>
                {history && (
                  <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-96">
                    {JSON.stringify(history, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
