import { useState, useEffect } from "react";
import { useToast } from "../components/Toast";
import { useConfirm } from "../hooks/useConfirm";
import { usePrompt } from "../hooks/usePrompt";

interface ApiKey {
  key_id: string;
  api_key_masked: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

interface NewKeyResponse {
  key_id: string;
  api_key: string;
  name: string;
  created_at: number;
  message: string;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState<NewKeyResponse | null>(null);
  const { success, error } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();

  const loadKeys = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("auth_token");
      const response = await fetch("/api/auth/apikeys", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("加载失败");
      const data = await response.json();
      setKeys(data.keys);
    } catch (err) {
      error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreate = async () => {
    const name = await prompt({
      title: "创建 API Key",
      message: "请输入 API Key 的名称（用于标识用途）：",
      placeholder: "例如：n8n 集成",
    });
    if (!name) return;

    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch("/api/auth/apikeys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("创建失败");
      const data: NewKeyResponse = await response.json();
      setNewKey(data);
      loadKeys();
    } catch (err) {
      error((err as Error).message);
    }
  };

  const handleDelete = async (keyId: string, name: string) => {
    const ok = await confirm({
      title: "删除确认",
      message: `确定要删除 API Key "${name}" 吗？删除后使用该 Key 的应用将无法继续访问。`,
      variant: "danger",
    });
    if (!ok) return;

    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`/api/auth/apikeys/${keyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("删除失败");
      success("删除成功");
      loadKeys();
    } catch (err) {
      error((err as Error).message);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    success("已复制到剪贴板");
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      {promptDialog}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">API Key 管理</h1>
          <p className="text-gray-600 mt-1">管理用于访问 API 的密钥</p>
        </div>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + 创建 API Key
        </button>
      </div>

      {/* 新创建的 Key 显示 */}
      {newKey && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <h3 className="font-medium text-green-800">API Key 创建成功</h3>
              <p className="text-sm text-green-700 mt-1">{newKey.message}</p>
              <div className="mt-3 flex items-center gap-2">
                <code className="bg-white px-3 py-2 rounded border border-green-300 text-sm font-mono flex-1 select-all">
                  {newKey.api_key}
                </code>
                <button
                  onClick={() => copyToClipboard(newKey.api_key)}
                  className="px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  复制
                </button>
              </div>
            </div>
            <button
              onClick={() => setNewKey(null)}
              className="text-green-600 hover:text-green-800"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 使用说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">使用说明</h3>
        <p className="text-sm text-blue-800">
          在调用 API 时，将 API Key 放入请求头 <code className="bg-blue-100 px-1 rounded">X-API-Key</code> 中。
        </p>
        <pre className="mt-2 bg-blue-100 p-2 rounded text-sm overflow-x-auto">
          {`curl -H "X-API-Key: cg_your_api_key" http://localhost:8188/api/prompt`}
        </pre>
      </div>

      {/* API Key 列表 */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : keys.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500">还没有创建 API Key</p>
          <button
            onClick={handleCreate}
            className="mt-4 text-blue-600 hover:text-blue-700"
          >
            创建第一个 API Key →
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">名称</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">API Key</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最后使用</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {keys.map((key) => (
                <tr key={key.key_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">{key.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded font-mono">
                      {key.api_key_masked}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDate(key.created_at)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {key.last_used_at ? formatDate(key.last_used_at) : "从未使用"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(key.key_id, key.name)}
                      className="text-red-600 hover:text-red-700 text-sm"
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
    </div>
  );
}
