import { Link, useLocation } from "react-router-dom";

const nav = [
  { path: "/", label: "仪表盘" },
  { path: "/workers", label: "Workers" },
  { path: "/queue", label: "队列" },
  { path: "/tasks", label: "任务" },
  { path: "/submit", label: "提交测试" },
  { path: "/settings", label: "设置" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14 items-center">
            <span className="font-semibold text-gray-800">ComfyUI 网关</span>
            <nav className="flex gap-4">
              {nav.map(({ path, label }) => (
                <Link
                  key={path}
                  to={path}
                  className={`px-3 py-1.5 rounded text-sm ${
                    loc.pathname === path ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  );
}
