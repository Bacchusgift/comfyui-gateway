import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { task as api, type TaskStatus } from "../api";

type GatewayStatus = { gateway_job_id: string; status: string; prompt_id: string | null };

const statusLabel: Record<string, string> = {
  queued: "排队中",
  submitted: "已提交",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  unknown: "未知",
};

export default function Tasks() {
  const [searchParams] = useSearchParams();
  const promptIdParam = searchParams.get("prompt_id") || "";
  const gatewayJobIdParam = searchParams.get("gateway_job_id") || "";
  const [queryInput, setQueryInput] = useState(gatewayJobIdParam || promptIdParam);
  const [result, setResult] = useState<TaskStatus | null>(null);
  const [gatewayResult, setGatewayResult] = useState<GatewayStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, unknown> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const progress = result?.progress ?? null;

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">任务查询</h1>
      <form onSubmit={handleQuery} className="flex flex-wrap gap-2 mb-6">
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
  );
}
