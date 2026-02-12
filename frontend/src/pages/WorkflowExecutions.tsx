import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { workflows, type WorkflowExecution, type WorkflowTemplate } from "../api";

export default function WorkflowExecutions() {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [templates, setTemplates] = useState<Record<string, WorkflowTemplate>>({});
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadData();

    if (autoRefresh) {
      const interval = setInterval(loadData, 2000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  async function loadData() {
    try {
      const [execData, tmplData] = await Promise.all([
        workflows.listExecutions(),
        workflows.list(),
      ]);

      setExecutions(execData.executions);
      const tmplMap: Record<string, WorkflowTemplate> = {};
      tmplData.templates.forEach((t) => (tmplMap[t.id] = t));
      setTemplates(tmplMap);
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case "done":
        return "bg-green-100 text-green-800";
      case "failed":
        return "bg-red-100 text-red-800";
      case "running":
        return "bg-blue-100 text-blue-800";
      case "queued":
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  }

  function getStatusLabel(status: string) {
    const labels: Record<string, string> = {
      pending: "待处理",
      queued: "队列中",
      submitted: "已提交",
      running: "执行中",
      done: "已完成",
      failed: "失败",
    };
    return labels[status] || status;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">工作流执行记录</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="mr-2"
            />
            自动刷新 (2秒)
          </label>
          <Link to="/workflows" className="text-blue-600 hover:text-blue-700">
            返回模板列表
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : executions.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500">还没有执行记录</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">执行ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">工作流</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">进度</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Worker</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {executions.map((exec) => {
                const tmpl = templates[exec.template_id];
                return (
                  <tr key={exec.execution_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">
                      {exec.execution_id.slice(0, 16)}...
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>
                        <div className="font-medium text-gray-900">{tmpl?.name || exec.template_id}</div>
                        {exec.input_params && Object.keys(exec.input_params).length > 0 && (
                          <div className="text-xs text-gray-500 mt-1">
                            {Object.entries(exec.input_params).slice(0, 2).map(([k, v]) => (
                              <span key={k} className="mr-2">
                                {k}={String(v).slice(0, 20)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(exec.status)}`}>
                        {getStatusLabel(exec.status)}
                      </span>
                      {exec.error_message && (
                        <div className="text-xs text-red-600 mt-1" title={exec.error_message}>
                          {exec.error_message.slice(0, 50)}...
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {exec.status === "running" || exec.status === "done" ? (
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 transition-all"
                              style={{ width: `${exec.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600">{exec.progress}%</span>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {exec.worker_id || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(exec.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {exec.status === "done" && exec.result_json && (
                        <button
                          onClick={() => {
                            alert("结果: " + exec.result_json);
                          }}
                          className="text-blue-600 hover:text-blue-700 mr-3"
                        >
                          查看结果
                        </button>
                      )}
                      {exec.gateway_job_id && (
                        <Link
                          to={`/tasks/${exec.gateway_job_id}`}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          详情
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
