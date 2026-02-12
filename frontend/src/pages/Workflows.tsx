import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { workflows, type WorkflowTemplate } from "../api";

export default function Workflows() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "enabled">("enabled");

  useEffect(() => {
    loadTemplates();
  }, [filter]);

  async function loadTemplates() {
    try {
      setLoading(true);
      const data = await workflows.list(undefined, filter === "enabled");
      setTemplates(data.templates);
    } catch (err) {
      console.error("Failed to load templates:", err);
      alert("加载失败: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleEnabled(template: WorkflowTemplate) {
    try {
      await workflows.update(template.id, { enabled: !template.enabled });
      loadTemplates();
    } catch (err) {
      alert("更新失败: " + (err as Error).message);
    }
  }

  async function deleteTemplate(id: string, name: string) {
    if (!confirm(`确定要删除工作流 "${name}" 吗？`)) return;
    try {
      await workflows.delete(id);
      loadTemplates();
    } catch (err) {
      alert("删除失败: " + (err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">工作流模板</h1>
        <div className="flex gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "enabled")}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="enabled">仅显示启用</option>
            <option value="all">全部</option>
          </select>
          <Link
            to="/workflows/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            + 新建模板
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 mb-4">还没有工作流模板</p>
          <Link
            to="/workflows/new"
            className="text-blue-600 hover:text-blue-700"
          >
            创建第一个模板 →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">{t.name}</h3>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
                      {t.category}
                    </span>
                    {!t.enabled && (
                      <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded">
                        已禁用
                      </span>
                    )}
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                      v{t.version}
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm mb-3">{t.description || "无描述"}</p>
                  <div className="flex gap-4 text-sm text-gray-500">
                    <span>参数: {Object.keys(t.input_schema).length} 个</span>
                    <span>创建于: {new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex gap-2 ml-4">
                  <Link
                    to={`/workflows/${t.id}/docs`}
                    className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                  >
                    API 文档
                  </Link>
                  <Link
                    to={`/workflows/${t.id}/execute`}
                    className="px-3 py-1.5 text-sm text-green-700 hover:bg-green-50 rounded border border-green-300"
                  >
                    执行
                  </Link>
                  <Link
                    to={`/workflows/${t.id}/edit`}
                    className="px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 rounded border border-blue-300"
                  >
                    编辑
                  </Link>
                  <button
                    onClick={() => toggleEnabled(t)}
                    className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                  >
                    {t.enabled ? "禁用" : "启用"}
                  </button>
                  <button
                    onClick={() => deleteTemplate(t.id, t.name)}
                    className="px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 rounded border border-red-300"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 执行记录入口 */}
      <div className="border-t border-gray-200 pt-6">
        <Link
          to="/workflows/executions"
          className="text-blue-600 hover:text-blue-700"
        >
          查看执行记录 →
        </Link>
      </div>
    </div>
  );
}
