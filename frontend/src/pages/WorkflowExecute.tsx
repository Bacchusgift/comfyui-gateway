import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { workflows, type WorkflowTemplate, type WorkflowExecution } from "../api";

export default function WorkflowExecute() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [executing, setExecuting] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execution, setExecution] = useState<WorkflowExecution | null>(null);

  useEffect(() => {
    loadTemplate();
  }, [id]);

  useEffect(() => {
    if (executionId && execution?.status === "running") {
      const interval = setInterval(checkStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [executionId, execution?.status]);

  async function loadTemplate() {
    try {
      const data = await workflows.get(id!);
      setTemplate(data);

      // 设置默认值
      const defaults: Record<string, unknown> = {};
      Object.entries(data.input_schema).forEach(([key, def]) => {
        if (def.default !== undefined) {
          defaults[key] = def.default;
        }
      });
      setParams(defaults);
    } catch (err) {
      alert("加载失败: " + (err as Error).message);
      navigate("/workflows");
    }
  }

  async function executeWorkflow() {
    if (!template) return;

    // 验证必填参数
    for (const [key, def] of Object.entries(template.input_schema)) {
      if (def.required && !params[key]) {
        alert(`请填写必填参数: ${key}`);
        return;
      }
    }

    try {
      setExecuting(true);
      const result = await workflows.execute(id!, { params });
      setExecutionId(result.execution_id);
      await checkStatus();
    } catch (err) {
      alert("执行失败: " + (err as Error).message);
    } finally {
      setExecuting(false);
    }
  }

  async function checkStatus() {
    if (!executionId) return;

    try {
      const data = await workflows.getExecution(executionId);
      setExecution(data);

      if (data.status === "done" || data.status === "failed") {
        setExecutionId(null);
      }
    } catch (err) {
      console.error("Failed to check status:", err);
    }
  }

  function updateParam(key: string, value: unknown) {
    setParams({ ...params, [key]: value });
  }

  if (!template) {
    return <div className="text-center py-12">加载中...</div>;
  }

  const isRunning = execution?.status === "running";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{template.name}</h1>
          <p className="text-gray-600 mt-1">{template.description}</p>
        </div>
        <button
          onClick={() => navigate("/workflows")}
          className="text-gray-600 hover:text-gray-900"
        >
          返回
        </button>
      </div>

      {/* 参数表单 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">执行参数</h2>

        {Object.keys(template.input_schema).length === 0 ? (
          <p className="text-gray-500">此工作流无需参数</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(template.input_schema).map(([key, def]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {key}
                  {def.required && <span className="text-red-500 ml-1">*</span>}
                </label>

                {def.description && (
                  <p className="text-xs text-gray-500 mb-2">{def.description}</p>
                )}

                {def.type === "boolean" ? (
                  <select
                    value={String(params[key] ?? false)}
                    onChange={(e) => updateParam(key, e.target.value === "true")}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    disabled={isRunning}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                ) : def.type === "integer" || def.type === "number" ? (
                  <input
                    type="number"
                    value={String(params[key] ?? "")}
                    onChange={(e) =>
                      updateParam(
                        key,
                        def.type === "integer" ? parseInt(e.target.value) : parseFloat(e.target.value)
                      )
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    disabled={isRunning}
                  />
                ) : (
                  <input
                    type="text"
                    value={String(params[key] ?? "")}
                    onChange={(e) => updateParam(key, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    disabled={isRunning}
                  />
                )}

                <p className="text-xs text-gray-400 mt-1">类型: {def.type}</p>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={executeWorkflow}
          disabled={executing || isRunning}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {executing ? "提交中..." : isRunning ? "执行中..." : "执行工作流"}
        </button>
      </div>

      {/* 执行状态 */}
      {execution && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">执行状态</h2>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">执行ID:</span>
              <span className="font-mono">{execution.execution_id}</span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-gray-600">状态:</span>
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  execution.status === "done"
                    ? "bg-green-100 text-green-800"
                    : execution.status === "failed"
                    ? "bg-red-100 text-red-800"
                    : execution.status === "running"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-yellow-100 text-yellow-800"
                }`}
              >
                {execution.status === "done"
                  ? "已完成"
                  : execution.status === "failed"
                  ? "失败"
                  : execution.status === "running"
                  ? "执行中"
                  : "队列中"}
              </span>
            </div>

            {execution.status === "running" && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">进度:</span>
                  <span>{execution.progress}%</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${execution.progress}%` }}
                  />
                </div>
              </div>
            )}

            {execution.worker_id && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Worker:</span>
                <span>{execution.worker_id}</span>
              </div>
            )}

            {execution.error_message && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-sm text-red-700">{execution.error_message}</p>
              </div>
            )}

            {execution.status === "done" && execution.result_json && (
              <div className="bg-green-50 border border-green-200 rounded p-3">
                <p className="text-sm text-green-700 mb-2">执行完成！</p>
                <button
                  onClick={() => alert("结果: " + execution.result_json)}
                  className="text-sm text-green-700 underline"
                >
                  查看完整结果
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
