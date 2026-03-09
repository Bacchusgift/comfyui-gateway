import { useState, useEffect } from "react";
import { models, ModelType, ModelItem, ModelStats, DownloadTask } from "../api";
import DownloadModal from "../components/DownloadModal";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function Models() {
  const [types, setTypes] = useState<ModelType[]>([]);
  const [modelList, setModelList] = useState<ModelItem[]>([]);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  useEffect(() => {
    loadTypes();
    loadStats();
    loadDownloads();
  }, []);

  useEffect(() => {
    loadModels();
  }, [selectedType, search]);

  // 轮询下载任务
  useEffect(() => {
    const interval = setInterval(() => {
      loadDownloads();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadTypes = async () => {
    try {
      const data = await models.getTypes();
      setTypes(data.types || []);
    } catch (e) {
      console.error("加载模型类型失败:", e);
      setTypes([]);
    }
  };

  const loadModels = async () => {
    setLoading(true);
    try {
      const data = await models.list({
        model_type_id: selectedType || undefined,
        search: search || undefined,
        limit: 200,
      });
      setModelList(data.models || []);
    } catch (e) {
      console.error("加载模型列表失败:", e);
      setModelList([]);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await models.getStats();
      setStats(data);
    } catch (e) {
      console.error("加载统计信息失败:", e);
    }
  };

  const loadDownloads = async () => {
    try {
      const data = await models.getDownloads();
      setDownloads(data.downloads || []);
    } catch (e) {
      console.error("加载下载任务失败:", e);
      setDownloads([]);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await models.scan();

      // 检查是否有错误
      if ("error" in result) {
        alert("扫描失败: " + result.error);
        return;
      }

      // 显示扫描结果
      const scanned = result.scanned ?? 0;
      const added = result.added ?? 0;
      const updated = result.updated ?? 0;
      const errors = result.errors?.length || 0;

      let message = `扫描完成: 扫描 ${scanned} 个文件，新增 ${added}，更新 ${updated}`;
      if (errors > 0) {
        message += `，${errors} 个错误`;
      }
      alert(message);

      loadModels();
      loadStats();
    } catch (e: unknown) {
      alert("扫描失败: " + (e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async (model: ModelItem) => {
    if (!confirm(`确定删除模型 "${model.filename}"？\n\n选择"取消"仅删除记录，选择"确定"同时删除文件。`)) {
      // 仅删除记录
      try {
        await models.delete(model.id, false);
        loadModels();
        loadStats();
      } catch (e: unknown) {
        alert("删除失败: " + (e as Error).message);
      }
    } else {
      // 删除记录和文件
      try {
        await models.delete(model.id, true);
        loadModels();
        loadStats();
      } catch (e: unknown) {
        alert("删除失败: " + (e as Error).message);
      }
    }
  };

  const activeDownloads = downloads.filter(d => d.status === "downloading" || d.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">模型管理</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDownloadModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            从 Civitai 下载
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {scanning ? "扫描中..." : "扫描模型"}
          </button>
        </div>
      </div>

      {/* 下载任务 */}
      {activeDownloads.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800 mb-2">
            下载中 ({activeDownloads.length})
          </h3>
          <div className="space-y-2">
            {activeDownloads.map(task => (
              <div key={task.download_id} className="flex items-center gap-3">
                <span className="text-sm flex-1 truncate">{task.filename}</span>
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
                <span className="text-sm text-gray-600">
                  {task.progress}%
                </span>
                <button
                  onClick={async () => {
                    await models.cancelDownload(task.download_id);
                    loadDownloads();
                  }}
                  className="text-red-600 text-sm hover:underline"
                >
                  取消
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 统计信息 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-gray-500">总模型数</div>
            <div className="text-2xl font-bold">{stats.total_count || 0}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-gray-500">总大小</div>
            <div className="text-2xl font-bold">{formatBytes(stats.total_size || 0)}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-gray-500">模型类型</div>
            <div className="text-2xl font-bold">{stats.by_type?.length || 0}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-gray-500">下载中</div>
            <div className="text-2xl font-bold">{stats.downloads?.downloading || 0}</div>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex gap-4 items-center">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedType(null)}
            className={`px-3 py-1.5 rounded text-sm ${
              selectedType === null ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            全部
          </button>
          {types.map(type => (
            <button
              key={type.id}
              onClick={() => setSelectedType(type.id)}
              className={`px-3 py-1.5 rounded text-sm ${
                selectedType === type.id ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {type.display_name}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="搜索模型..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 max-w-xs px-3 py-1.5 border rounded text-sm"
        />
      </div>

      {/* 模型列表 */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">加载中...</div>
      ) : modelList.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          暂无模型。点击"扫描模型"或"从 Civitai 下载"添加模型。
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">文件名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">大小</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Civitai</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {modelList.map(model => (
                <tr key={model.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{model.filename}</div>
                    <div className="text-xs text-gray-500">{model.file_path}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {model.model_type_name || model.type_name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatBytes(model.file_size)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {model.civitai_model_name ? (
                      <div>
                        <div className="text-gray-900">{model.civitai_model_name}</div>
                        <div className="text-xs text-gray-500">{model.civitai_base_model}</div>
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(model)}
                      className="text-red-600 text-sm hover:underline"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 下载弹窗 */}
      {showDownloadModal && (
        <DownloadModal
          types={types}
          onClose={() => setShowDownloadModal(false)}
          onSuccess={() => {
            setShowDownloadModal(false);
            loadDownloads();
            loadModels();
          }}
        />
      )}
    </div>
  );
}
