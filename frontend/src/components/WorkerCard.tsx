import { Link } from "react-router-dom";
import type { WorkerItem } from "../api";

export default function WorkerCard({ w }: { w: WorkerItem }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-gray-900">{w.name || w.url}</span>
          <span className={`ml-2 inline-block w-2 h-2 rounded-full ${w.healthy ? "bg-green-500" : "bg-red-500"}`} title={w.healthy ? "健康" : "异常"} />
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${w.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
          {w.enabled ? "启用" : "禁用"}
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1 truncate">{w.url}</p>
      <div className="mt-3 flex items-center gap-4 text-sm">
        <span className="text-gray-600">运行中: <strong>{w.queue_running}</strong></span>
        <span className="text-gray-600">等待: <strong>{w.queue_pending}</strong></span>
        <Link to="/queue" className="text-blue-600 hover:underline">查看队列</Link>
      </div>
    </div>
  );
}
