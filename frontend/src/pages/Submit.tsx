import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { prompt as api, type PromptSubmitResponse } from "../api";

export default function Submit() {
  const navigate = useNavigate();
  const [workflowJson, setWorkflowJson] = useState("");
  const [clientId, setClientId] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [result, setResult] = useState<PromptSubmitResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let promptObj: Record<string, unknown>;
    try {
      promptObj = JSON.parse(workflowJson);
    } catch {
      setErr("Workflow 不是合法 JSON");
      return;
    }
    setErr(null);
    setResult(null);
    const body: { prompt: Record<string, unknown>; client_id?: string; priority?: number } = { prompt: promptObj };
    if (clientId.trim()) body.client_id = clientId.trim();
    const p = priority.trim();
    if (p !== "") {
      const n = parseInt(p, 10);
      if (!Number.isNaN(n)) body.priority = n;
    }
    api
      .submit(body)
      .then((res) => {
        setResult(res);
      })
      .catch((e) => setErr(e.message));
  };

  const isQueued = (r: PromptSubmitResponse): r is { gateway_job_id: string; status: "queued" } =>
    "gateway_job_id" in r;

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">提交测试</h1>
      <p className="text-sm text-gray-600 mb-4">
        粘贴 ComfyUI 工作流 API JSON（在 ComfyUI 中启用 Dev 模式，使用 Save (API format) 导出）。
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Workflow JSON *</label>
          <textarea
            value={workflowJson}
            onChange={(e) => setWorkflowJson(e.target.value)}
            placeholder='{"3": {"class_type": "KSampler", ...}, ...}'
            className="border rounded px-3 py-2 w-full font-mono text-sm h-48"
            required
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">client_id（可选）</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="留空将自动生成 UUID"
              className="border rounded px-3 py-2 w-64 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">优先级/权重（可选，插队）</label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="留空立即提交；填数字则进队列，数值越大越优先"
              className="border rounded px-3 py-2 w-72 text-sm"
            />
          </div>
        </div>
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          提交
        </button>
      </form>

      {err && <div className="mt-4 text-red-600">{err}</div>}

      {result && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded">
          <p className="font-medium text-green-800">已提交</p>
          {isQueued(result) ? (
            <>
              <p className="text-sm text-green-700 mt-1">gateway_job_id: <code className="bg-white px-1">{result.gateway_job_id}</code></p>
              <p className="text-sm text-gray-600 mt-1">已进入优先级队列，将按权重依次提交到 Worker</p>
              <button
                onClick={() => navigate(`/tasks?gateway_job_id=${result.gateway_job_id}`)}
                className="mt-2 text-blue-600 hover:underline"
              >
                前往任务详情（查进度）
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-green-700 mt-1">prompt_id: <code className="bg-white px-1">{result.prompt_id}</code></p>
              {result.number != null && <p className="text-sm text-green-700">队列位置: {result.number}</p>}
              <button
                onClick={() => navigate(`/tasks?prompt_id=${result.prompt_id}`)}
                className="mt-2 text-blue-600 hover:underline"
              >
                前往任务详情
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
