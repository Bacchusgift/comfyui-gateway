import { useEffect, useState } from "react";
import { settings as api, type SettingsResponse } from "../api";

export default function Settings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ worker_auth_username: "", worker_auth_password: "" });
  const [saved, setSaved] = useState(false);

  const load = () => api.get().then((r) => {
    setData(r);
    setForm((f) => ({ ...f, worker_auth_username: r.worker_auth_username || "" }));
  }).catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    api
      .update({
        worker_auth_username: form.worker_auth_username.trim() || undefined,
        worker_auth_password: form.worker_auth_password || undefined,
      })
      .then((r) => {
        setData(r);
        setForm((f) => ({ ...f, worker_auth_password: "" }));
        setSaved(true);
      })
      .catch((e) => setErr(e.message));
  };

  if (err) return <div className="text-red-600">加载失败: {err}</div>;

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">网关设置</h1>

      <div className="bg-white rounded-lg border p-6 max-w-lg">
        <h2 className="text-lg font-medium text-gray-800 mb-2">全局 Worker 认证</h2>
        <p className="text-sm text-gray-500 mb-4">
          用于所有未单独配置认证的 Worker（如 nginx 反向代理的 Basic 认证）。也可在 .env 中配置 WORKER_AUTH_USERNAME / WORKER_AUTH_PASSWORD。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={form.worker_auth_username}
              onChange={(e) => setForm((f) => ({ ...f, worker_auth_username: e.target.value }))}
              placeholder="留空则仅使用各 Worker 单独配置或 .env"
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={form.worker_auth_password}
              onChange={(e) => setForm((f) => ({ ...f, worker_auth_password: e.target.value }))}
              placeholder="留空则不修改当前密码"
              className="border rounded px-3 py-2 w-full"
            />
            {data?.worker_auth_has_password && (
              <p className="text-xs text-gray-500 mt-1">已配置密码，填写上方可修改</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              保存
            </button>
            {saved && <span className="text-green-600 text-sm">已保存</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
