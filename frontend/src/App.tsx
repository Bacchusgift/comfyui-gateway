import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Workers from "./pages/Workers";
import Queue from "./pages/Queue";
import Tasks from "./pages/Tasks";
import Submit from "./pages/Submit";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/workers" element={<Workers />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}
