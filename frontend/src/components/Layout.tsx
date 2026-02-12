import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const nav = [
  { path: "/", label: "仪表盘" },
  { path: "/workers", label: "Workers" },
  { path: "/queue", label: "队列" },
  { path: "/tasks", label: "任务" },
  { path: "/workflows", label: "工作流" },
  { path: "/submit", label: "提交测试" },
  { path: "/apikeys", label: "API Keys" },
  { path: "/settings", label: "设置" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { username, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

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
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">{username}</span>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  );
}
