import { useEffect, useState } from "react";
import { queue } from "../api";
import WorkerCard from "../components/WorkerCard";
import type { QueueResponse, WorkerItem } from "../api";

export default function Dashboard() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    queue.get().then(setData).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (err) return <div className="text-red-600">加载失败: {err}</div>;
  if (!data) return <div className="text-gray-500">加载中...</div>;

  const workers = data.workers as WorkerItem[];
  const healthyCount = workers.filter((w) => w.healthy).length;

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">集群概览</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">Worker 总数</p>
          <p className="text-2xl font-semibold">{workers.length}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">健康</p>
          <p className="text-2xl font-semibold text-green-600">{healthyCount}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">运行中任务</p>
          <p className="text-2xl font-semibold">{data.total_running}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-sm text-gray-500">等待中任务</p>
          <p className="text-2xl font-semibold">{data.total_pending}</p>
        </div>
      </div>
      <h2 className="text-lg font-medium text-gray-800 mb-3">Worker 列表</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workers.length === 0 ? (
          <p className="text-gray-500">暂无 Worker，请到 Workers 页添加。</p>
        ) : (
          workers.map((w) => <WorkerCard key={w.worker_id} w={w} />)
        )}
      </div>
    </div>
  );
}
