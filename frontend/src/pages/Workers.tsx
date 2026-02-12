import { useEffect, useState } from "react";
import { workers as api, type WorkerItem } from "../api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../hooks/useConfirm";

export default function Workers() {
  const [list, setList] = useState<WorkerItem[]>([]);
  const [form, setForm] = useState({ url: "", name: "", weight: 1, auth_username: "", auth_password: "" });
  const [editing, setEditing] = useState<WorkerItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", weight: 1, enabled: true, auth_username: "", auth_password: "" });
  const { error } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = () => api.list().then((r) => setList(r.workers)).catch((e) => error(e.message));

  useEffect(() => {
    load();
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.url.trim()) return;
    api
      .create({
        url: form.url.trim(),
        name: form.name.trim() || undefined,
        weight: form.weight,
        auth_username: form.auth_username.trim() || undefined,
        auth_password: form.auth_password || undefined,
      })
      .then(() => {
        setForm({ url: "", name: "", weight: 1, auth_username: "", auth_password: "" });
        load();
      })
      .catch((e) => error(e.message));
  };

  const handleUpdate = (w: WorkerItem) => {
    setEditing(w);
    setEditForm({ name: w.name || "", weight: w.weight, enabled: w.enabled, auth_username: w.auth_username || "", auth_password: "" });
  };

  const saveEdit = () => {
    if (!editing) return;
    const body: { name?: string; weight?: number; enabled?: boolean; auth_username?: string; auth_password?: string } = {
      name: editForm.name || undefined,
      weight: editForm.weight,
      enabled: editForm.enabled,
      auth_username: editForm.auth_username.trim() || undefined,
    };
    if (editForm.auth_password) body.auth_password = editForm.auth_password;
    api
      .update(editing.worker_id, body)
      .then(() => {
        setEditing(null);
        load();
      })
      .catch((e) => error(e.message));
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "删除确认",
      message: "确定删除该 Worker？",
      variant: "danger",
    });
    if (!ok) return;
    api.delete(id).then(load).catch((e) => error(e.message));
  };

  return (
    <>
      {confirmDialog}

      <div>
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Worker 管理</h1>

      <form onSubmit={handleCreate} className="bg-white rounded-lg border p-4 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm text-gray-600 mb-1">URL *</label>
          <input
            type="url"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="http://192.168.1.10:8188"
            className="border rounded px-3 py-2 w-64"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">名称</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="可选"
            className="border rounded px-3 py-2 w-40"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">权重</label>
          <input
            type="number"
            min={1}
            value={form.weight}
            onChange={(e) => setForm((f) => ({ ...f, weight: parseInt(e.target.value, 10) || 1 }))}
            className="border rounded px-3 py-2 w-20"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">认证用户名</label>
          <input
            type="text"
            value={form.auth_username}
            onChange={(e) => setForm((f) => ({ ...f, auth_username: e.target.value }))}
            placeholder="nginx 等反向代理 Basic 认证"
            className="border rounded px-3 py-2 w-40"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">认证密码</label>
          <input
            type="password"
            value={form.auth_password}
            onChange={(e) => setForm((f) => ({ ...f, auth_password: e.target.value }))}
            placeholder="可选"
            className="border rounded px-3 py-2 w-40"
          />
        </div>
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          添加 Worker
        </button>
      </form>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">名称</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">URL</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">状态</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">队列</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">权重</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">启用</th>
              <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {list.map((w) => (
              <tr key={w.worker_id}>
                <td className="px-4 py-2 text-sm text-gray-900">{w.name || "-"}</td>
                <td className="px-4 py-2 text-sm text-gray-600 font-mono truncate max-w-xs">{w.url}</td>
                <td>
                  <span className={`inline-block w-2 h-2 rounded-full ${w.healthy ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="ml-1 text-sm">{w.healthy ? "健康" : "异常"}</span>
                </td>
                <td className="px-4 py-2 text-sm">运行 {w.queue_running} / 等待 {w.queue_pending}</td>
                <td className="px-4 py-2 text-sm">{w.weight}</td>
                <td className="px-4 py-2 text-sm">{w.enabled ? "是" : "否"}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => handleUpdate(w)} className="text-blue-600 hover:underline mr-2">编辑</button>
                  <button onClick={() => handleDelete(w.worker_id)} className="text-red-600 hover:underline">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && (
          <p className="p-4 text-gray-500 text-center">暂无 Worker，请在上方表单添加。</p>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-10" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium mb-4">编辑 Worker</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600">名称</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600">权重</label>
                <input
                  type="number"
                  min={1}
                  value={editForm.weight}
                  onChange={(e) => setEditForm((f) => ({ ...f, weight: parseInt(e.target.value, 10) || 1 }))}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={editForm.enabled}
                  onChange={(e) => setEditForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                <label htmlFor="enabled">启用</label>
              </div>
              <div>
                <label className="block text-sm text-gray-600">认证用户名</label>
                <input
                  type="text"
                  value={editForm.auth_username}
                  onChange={(e) => setEditForm((f) => ({ ...f, auth_username: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                  placeholder="nginx Basic 认证"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600">认证密码</label>
                <input
                  type="password"
                  value={editForm.auth_password}
                  onChange={(e) => setEditForm((f) => ({ ...f, auth_password: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                  placeholder="留空则不修改"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded">取消</button>
              <button onClick={saveEdit} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
