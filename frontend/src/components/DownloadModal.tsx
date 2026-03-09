import { useState } from "react";
import { models, ModelType, CivitaiVersion } from "../api";

interface DownloadModalProps {
  types: ModelType[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function DownloadModal({ types, onClose, onSuccess }: DownloadModalProps) {
  const [versionId, setVersionId] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [versionInfo, setVersionInfo] = useState<CivitaiVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFetchVersion = async () => {
    if (!versionId.trim()) {
      setError("请输入 Civitai Version ID");
      return;
    }

    setLoading(true);
    setError(null);
    setVersionInfo(null);

    try {
      const data = await models.getCivitaiVersion(versionId.trim());
      setVersionInfo(data);
      // 自动选择模型类型
      const modelType = data.model_type?.toLowerCase();
      const matchedType = types.find(t =>
        t.type_name.toLowerCase().includes(modelType) ||
        (modelType === "lora" && t.type_name === "loras") ||
        (modelType === "checkpoint" && t.type_name === "checkpoints")
      );
      if (matchedType) {
        setSelectedTypeId(matchedType.id);
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!versionInfo) {
      setError("请先获取版本信息");
      return;
    }
    if (!selectedTypeId) {
      setError("请选择模型类型");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await models.createDownload({
        civitai_version_id: versionInfo.version_id,
        model_type_id: selectedTypeId,
      });
      onSuccess();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-semibold">从 Civitai 下载模型</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Version ID 输入 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Civitai Version ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={versionId}
                onChange={e => setVersionId(e.target.value)}
                placeholder="例如: 128713"
                className="flex-1 px-3 py-2 border rounded text-sm"
              />
              <button
                onClick={handleFetchVersion}
                disabled={loading}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 text-sm"
              >
                {loading ? "获取中..." : "获取信息"}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              从 Civitai 模型页面的 URL 中获取 Version ID（如 https://civitai.com/models/xxx?modelVersionId=<strong>128713</strong>）
            </p>
          </div>

          {/* 错误信息 */}
          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded">
              {error}
            </div>
          )}

          {/* 版本信息 */}
          {versionInfo && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex gap-4">
                {versionInfo.images[0] && (
                  <img
                    src={versionInfo.images[0].url}
                    alt="Preview"
                    className="w-24 h-24 object-cover rounded"
                  />
                )}
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">{versionInfo.model_name}</h3>
                  <p className="text-sm text-gray-600">{versionInfo.version_name}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                      {versionInfo.model_type}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                      {versionInfo.base_model}
                    </span>
                  </div>
                </div>
              </div>

              {/* 文件列表 */}
              {versionInfo.files.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">文件:</p>
                  <div className="space-y-1">
                    {versionInfo.files.slice(0, 3).map((file, idx) => (
                      <div key={idx} className="text-sm text-gray-600 flex justify-between">
                        <span className="truncate">{file.name}</span>
                        <span className="text-gray-400 ml-2">
                          {(file.size_kb / 1024).toFixed(1)} MB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 模型类型选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  保存到类型
                </label>
                <select
                  value={selectedTypeId || ""}
                  onChange={e => setSelectedTypeId(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded text-sm"
                >
                  <option value="">选择模型类型...</option>
                  {types.map(type => (
                    <option key={type.id} value={type.id}>
                      {type.display_name} ({type.directory}/)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            取消
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !versionInfo || !selectedTypeId}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "创建中..." : "开始下载"}
          </button>
        </div>
      </div>
    </div>
  );
}
