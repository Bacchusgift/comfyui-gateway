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

// 模态框组件
function OutputModal({
  promptId,
  onClose
}: {
  promptId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<TaskOutputResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ url: string; filename: string; type: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.output(promptId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [promptId]);

  // 按 ESC 关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  // 获取 token 用于 URL
  const token = localStorage.getItem("auth_token");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* 模态框内容 */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col m-4">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">任务输出</h2>
            <p className="text-sm text-gray-500 mt-1">Prompt ID: {promptId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <span className="ml-3 text-gray-500">加载中...</span>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <div className="text-red-500 mb-2">加载失败</div>
              <div className="text-gray-500 text-sm">{error}</div>
            </div>
          )}

          {data && (
            <div className="space-y-6">
              {/* 文件网格 */}
              {data.outputs.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  暂无输出文件
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {data.outputs.flatMap((output) =>
                    output.files.map((file, idx) => {
                      const isImage = file.filename.match(/\.(png|jpg|jpeg|gif|webp)$/i);
                      const isVideo = file.filename.match(/\.(mp4|webm|mov)$/i);
                      const fileUrl = token ? `${file.url}&token=${token}` : file.url;

                      return (
                        <div
                          key={`${output.node_id}-${idx}`}
                          className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                          onClick={() => setSelectedFile({ url: fileUrl, filename: file.filename, type: isImage ? 'image' : isVideo ? 'video' : 'file' })}
                        >
                          {/* 缩略图 */}
                          <div className="aspect-square bg-gray-100 flex items-center justify-center">
                            {isImage ? (
                              <img
                                src={fileUrl}
                                alt={file.filename}
                                className="w-full h-full object-cover"
                              />
                            ) : isVideo ? (
                              <div className="w-full h-full flex items-center justify-center bg-gray-800">
                                <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              </div>
                            ) : (
                              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            )}
                          </div>
                          {/* 文件名 */}
                          <div className="p-2">
                            <div className="text-xs text-gray-500">节点 {output.node_id}</div>
                            <div className="text-sm text-gray-900 truncate" title={file.filename}>
                              {file.filename}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:text-gray-900"
          >
            关闭
          </button>
        </div>

        {/* 预览弹窗 */}
        {selectedFile && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/75" onClick={() => setSelectedFile(null)}>
            <div className="relative max-w-full max-h-full p-4" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setSelectedFile(null)}
                className="absolute -top-2 -right-2 bg-white rounded-full p-2 shadow-lg hover:bg-gray-100"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {selectedFile.type === 'image' && (
                <img
                  src={selectedFile.url}
                  alt={selectedFile.filename}
                  className="max-w-[80vw] max-h-[80vh] object-contain rounded-lg"
                />
              )}
              {selectedFile.type === 'video' && (
                <video
                  src={selectedFile.url}
                  controls
                  autoPlay
                  className="max-w-[80vw] max-h-[80vh] rounded-lg"
                />
              )}
              {selectedFile.type === 'file' && (
                <div className="bg-white rounded-lg p-8 text-center">
                  <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="text-gray-900 mb-2">{selectedFile.filename}</div>
                  <a
                    href={selectedFile.url}
                    download={selectedFile.filename}
                    className="text-blue-600 hover:text-blue-800"
                    target="_blank"
                    rel="noreferrer"
                  >
                    点击下载
                  </a>
                </div>
              )}
              <div className="text-center text-white mt-2 text-sm">{selectedFile.filename}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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

  // 模态框状态
  const [modalPromptId, setModalPromptId] = useState<string | null>(null);

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
                            onClick={() => setModalPromptId(task.prompt_id!)}
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
              <div className="flex gap-4">
                <button
                  onClick={() => setModalPromptId(result.prompt_id)}
                  className="text-blue-600 hover:underline text-sm"
                >
                  查看结果
                </button>
                <button onClick={loadHistory} className="text-blue-600 hover:underline text-sm">
                  查看 History
                </button>
              </div>
            )}
            {history && (
              <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-96">
                {JSON.stringify(history, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* 模态框 */}
      {modalPromptId && (
        <OutputModal
          promptId={modalPromptId}
          onClose={() => setModalPromptId(null)}
        />
      )}
    </div>
  );
}
