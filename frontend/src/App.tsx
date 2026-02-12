import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Workers from "./pages/Workers";
import Queue from "./pages/Queue";
import Tasks from "./pages/Tasks";
import Submit from "./pages/Submit";
import Settings from "./pages/Settings";
import Workflows from "./pages/Workflows";
import WorkflowEditor from "./pages/WorkflowEditor";
import WorkflowExecute from "./pages/WorkflowExecute";
import WorkflowApiDocs from "./pages/WorkflowApiDocs";
import WorkflowExecutions from "./pages/WorkflowExecutions";

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
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/new" element={<WorkflowEditor />} />
        <Route path="/workflows/:id/edit" element={<WorkflowEditor />} />
        <Route path="/workflows/:id/execute" element={<WorkflowExecute />} />
        <Route path="/workflows/:id/docs" element={<WorkflowApiDocs />} />
        <Route path="/workflows/executions" element={<WorkflowExecutions />} />
      </Routes>
    </Layout>
  );
}
