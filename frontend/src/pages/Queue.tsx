import { useEffect, useState } from "react";
import { queue as api, type QueueResponse } from "../api";
import { Link } from "react-router-dom";

export default function Queue() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.get().then(setData).catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="text-red-600">加载失败: {err}</div>;
  if (!data) return <div className="text-gray-500">加载中...</div>;

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">队列总览</h1>
      <p className="text-sm text-gray-600 mb-4">
        运行中 {data.total_running}，等待中 {data.total_pending}（每 5 秒刷新）
      </p>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">prompt_id</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Worker</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">状态</th>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.gateway_queue.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  队列为空
                </td>
              </tr>
            ) : (
              data.gateway_queue.map((q) => (
                <tr key={`${q.worker_id}-${q.prompt_id}-${q.status}-${q.position}`}>
                  <td className="px-4 py-2 text-sm font-mono text-gray-900">{q.prompt_id}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{q.worker_name || q.worker_id}</td>
                  <td>
                    <span className={`text-sm px-2 py-0.5 rounded ${q.status === "running" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"}`}>
                      {q.status === "running" ? "运行中" : "等待中"}
                    </span>
                  </td>
                  <td>
                    <Link to={`/tasks?prompt_id=${q.prompt_id}`} className="text-blue-600 hover:underline text-sm">
                      查看状态
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
