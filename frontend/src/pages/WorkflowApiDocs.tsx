import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { workflows, type WorkflowApiDocs } from "../api";

export default function WorkflowApiDocs() {
  const { id } = useParams();
  const [docs, setDocs] = useState<WorkflowApiDocs | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"curl" | "python" | "javascript">("curl");

  useEffect(() => {
    loadDocs();
  }, [id]);

  async function loadDocs() {
    try {
      setLoading(true);
      const data = await workflows.getApiDocs(id!);
      setDocs(data);
    } catch (err) {
      alert("加载失败: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    alert("已复制到剪贴板");
  }

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  if (!docs) {
    return <div className="text-center py-12 text-red-600">加载失败</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{docs.template_name} - API 文档</h1>
          <p className="text-gray-600 mt-1">{docs.description}</p>
        </div>
        <Link to="/workflows" className="text-blue-600 hover:text-blue-700">
          返回
        </Link>
      </div>

      {/* 基本信息 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">基本信息</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600">模板ID:</span>
            <span className="ml-2 font-mono">{docs.template_id}</span>
          </div>
          <div>
            <span className="text-gray-600">分类:</span>
            <span className="ml-2">{docs.category}</span>
          </div>
        </div>
      </div>

      {/* API 端点 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">API 端点</h2>

        <div className="space-y-6">
          {/* 执行端点 */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded">
                POST
              </span>
              <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                /api/workflows/{docs.template_id}/execute
              </code>
            </div>

            <h3 className="font-medium text-gray-900 mb-2">请求参数</h3>
            <div className="bg-gray-50 rounded p-3 mb-3">
              <pre className="text-sm">{JSON.stringify({ params: {}, client_id: "string (可选)", priority: 0 }, null, 2)}</pre>
            </div>

            <h3 className="font-medium text-gray-900 mb-2">响应</h3>
            <div className="bg-gray-50 rounded p-3">
              <pre className="text-sm">{JSON.stringify({ execution_id: "exec_abc123", template_id: docs.template_id, status: "queued" }, null, 2)}</pre>
            </div>
          </div>

          {/* 查询状态端点 */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded">
                GET
              </span>
              <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                /api/workflows/executions/{'{'}execution_id{'}'}
              </code>
            </div>

            <h3 className="font-medium text-gray-900 mb-2">响应</h3>
            <div className="bg-gray-50 rounded p-3">
              <pre className="text-sm">{JSON.stringify({ execution_id: "exec_abc123", status: "running", progress: 45 }, null, 2)}</pre>
            </div>
          </div>
        </div>
      </div>

      {/* 输入参数 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">输入参数</h2>

        {docs.parameters.length === 0 ? (
          <p className="text-gray-500">无需参数</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">参数名</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">类型</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">必填</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">默认值</th>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">说明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {docs.parameters.map((param) => (
                  <tr key={param.name}>
                    <td className="px-3 py-2 text-sm font-mono">{param.name}</td>
                    <td className="px-3 py-2 text-sm">{param.type}</td>
                    <td className="px-3 py-2 text-sm">
                      {param.required ? (
                        <span className="text-red-600">是</span>
                      ) : (
                        <span className="text-gray-400">否</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600">
                      {param.default !== undefined ? String(param.default) : "-"}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600">{param.description || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 代码示例 */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">代码示例</h2>

        <div className="flex gap-2 mb-4">
          {["curl", "python", "javascript"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              className={`px-3 py-1.5 text-sm rounded ${
                activeTab === tab
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {tab === "curl" ? "cURL" : tab === "python" ? "Python" : "JavaScript"}
            </button>
          ))}
        </div>

        <div className="relative">
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
            <code>{activeTab === "curl" ? docs.examples.curl : activeTab === "python" ? docs.examples.python : docs.examples.javascript}</code>
          </pre>
          <button
            onClick={() => copyCode(activeTab === "curl" ? docs.examples.curl : activeTab === "python" ? docs.examples.python : docs.examples.javascript)}
            className="absolute top-2 right-2 px-3 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600"
          >
            复制
          </button>
        </div>
      </div>

      {/* 快速测试 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">快速测试</h2>
        <p className="text-sm text-gray-700 mb-4">
          想要在浏览器中快速测试这个工作流吗？
        </p>
        <Link
          to={`/workflows/${docs.template_id}/execute`}
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          前往执行页面
        </Link>
      </div>
    </div>
  );
}
