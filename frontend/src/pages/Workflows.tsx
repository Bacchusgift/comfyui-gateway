import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { workflows, type WorkflowTemplate } from "../api";

interface CategoryStats {
  name: string;
  total: number;
  enabled: number;
}

interface WorkflowStats {
  total_templates: number;
  enabled_templates: number;
  total_executions_30d: number;
  success_rate_30d: number;
  success_count_30d: number;
  failed_count_30d: number;
}

export default function Workflows() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [categories, setCategories] = useState<CategoryStats[]>([]);
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "enabled">("enabled");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, [filter, categoryFilter]);

  async function loadData() {
    try {
      setLoading(true);
      const [tmplData, catData, statsData] = await Promise.all([
        workflows.list(categoryFilter === "all" ? undefined : categoryFilter, filter === "enabled"),
        workflows.listCategories(),
        workflows.getStats(),
      ]);
      setTemplates(tmplData.templates);
      setCategories(catData.categories);
      setStats(statsData);
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
      loadData();
    } catch (err) {
      alert("更新失败: " + (err as Error).message);
    }
  }

  async function deleteTemplate(id: string, name: string) {
    if (!confirm(`确定要删除工作流 "${name}" 吗？`)) return;
    try {
      await workflows.delete(id);
      loadData();
    } catch (err) {
      alert("删除失败: " + (err as Error).message);
    }
  }

  async function copyTemplate(id: string) {
    try {
      await workflows.copy(id);
      alert("复制成功！");
      loadData();
    } catch (err) {
      alert("复制失败: " + (err as Error).message);
    }
  }

  async function exportTemplate(id: string) {
    try {
      await workflows.export(id);
    } catch (err) {
      alert("导出失败: " + (err as Error).message);
    }
  }

  async function importTemplate() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await workflows.import(data);
        alert("导入成功！");
        loadData();
      } catch (err) {
        alert("导入失败: " + (err as Error).message);
      }
    };
    input.click();
  }

  async function batchOperation(action: "enable" | "disable" | "delete") {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      alert("请先选择模板");
      return;
    }

    const actionText = action === "enable" ? "启用" : action === "disable" ? "禁用" : "删除";
    if (!confirm(`确定要批量${actionText} ${ids.length} 个模板吗？`)) return;

    try {
      const result = await workflows.batch(ids, action);
      if (result.failed.length > 0) {
        alert(`部分操作失败：${result.failed.map((f) => f.error).join(", ")}`);
      } else {
        alert("操作成功");
      }
      setSelectedIds(new Set());
      loadData();
    } catch (err) {
      alert("操作失败: " + (err as Error).message);
    }
  }

  function toggleSelect(id: string) {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  }

  function toggleSelectAll() {
    if (selectedIds.size === templates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(templates.map((t) => t.id)));
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
      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">总模板数</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{stats.total_templates}</div>
            <div className="text-xs text-gray-500 mt-1">
              启用: {stats.enabled_templates}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">30天执行数</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{stats.total_executions_30d}</div>
            <div className="text-xs text-gray-500 mt-1">
              成功: {stats.success_count_30d} | 失败: {stats.failed_count_30d}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">成功率 (30天)</div>
            <div className="text-2xl font-semibold text-green-600 mt-1">{stats.success_rate_30d}%</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-600">分类数量</div>
            <div className="text-2xl font-semibold text-gray-900 mt-1">{categories.length}</div>
          </div>
        </div>
      )}

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
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="all">所有分类</option>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.enabled}/{c.total})
              </option>
            ))}
          </select>
          <button
            onClick={importTemplate}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
          >
            📥 导入
          </button>
          <Link
            to="/workflows/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            + 新建模板
          </Link>
        </div>
      </div>

      {/* 批量操作 */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3">
          <span className="text-sm text-blue-900">已选择 {selectedIds.size} 个模板</span>
          <div className="flex gap-2">
            <button
              onClick={() => batchOperation("enable")}
              className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
            >
              批量启用
            </button>
            <button
              onClick={() => batchOperation("disable")}
              className="px-3 py-1.5 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm"
            >
              批量禁用
            </button>
            <button
              onClick={() => batchOperation("delete")}
              className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
            >
              批量删除
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-gray-600 hover:text-gray-900 text-sm"
          >
            取消选择
          </button>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 mb-4">还没有工作流模板</p>
          <Link to="/workflows/new" className="text-blue-600 hover:text-blue-700">
            创建第一个模板 →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase">
            <div className="col-span-1">
              <input
                type="checkbox"
                checked={selectedIds.size === templates.length}
                onChange={toggleSelectAll}
                className="rounded"
              />
            </div>
            <div className="col-span-4">名称</div>
            <div className="col-span-2">分类</div>
            <div className="col-span-2">状态</div>
            <div className="col-span-3">操作</div>
          </div>

          {/* 模板列表 */}
          <div className="divide-y divide-gray-200">
            {templates.map((t) => (
              <div key={t.id} className="grid grid-cols-12 gap-4 px-6 py-4 hover:bg-gray-50 items-center">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    className="rounded"
                  />
                </div>
                <div className="col-span-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{t.name}</span>
                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                      v{t.version}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 truncate">{t.description || "无描述"}</p>
                </div>
                <div className="col-span-2">
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                    {t.category}
                  </span>
                </div>
                <div className="col-span-2">
                  {t.enabled ? (
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                      启用
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                      禁用
                    </span>
                  )}
                </div>
                <div className="col-span-3 flex gap-1">
                  <Link
                    to={`/workflows/${t.id}/docs`}
                    className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                  >
                    文档
                  </Link>
                  <Link
                    to={`/workflows/${t.id}/execute`}
                    className="px-2 py-1 text-xs text-green-700 hover:bg-green-50 rounded border border-green-300"
                  >
                    执行
                  </Link>
                  <button
                    onClick={() => exportTemplate(t.id)}
                    className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                  >
                    导出
                  </button>
                  <button
                    onClick={() => copyTemplate(t.id)}
                    className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                  >
                    复制
                  </button>
                  <Link
                    to={`/workflows/${t.id}/edit`}
                    className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded border border-blue-300"
                  >
                    编辑
                  </Link>
                  <button
                    onClick={() => toggleEnabled(t)}
                    className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
                  >
                    {t.enabled ? "禁用" : "启用"}
                  </button>
                  <button
                    onClick={() => deleteTemplate(t.id, t.name)}
                    className="px-2 py-1 text-xs text-red-700 hover:bg-red-50 rounded border border-red-300"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 执行记录入口 */}
      <div className="border-t border-gray-200 pt-6 flex justify-between items-center">
        <Link to="/workflows/executions" className="text-blue-600 hover:text-blue-700">
          查看执行记录 →
        </Link>
        <div className="text-sm text-gray-500">
          共 {templates.length} 个模板
        </div>
      </div>
    </div>
  );
}
