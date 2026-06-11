import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./styles/index.css";
import { AuthProvider, RequireAdmin, RequireAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { TaskList } from "./pages/TaskList";
import { TaskCreate } from "./pages/TaskCreate";
import { TaskDetail } from "./pages/TaskDetail";
import { PromptList } from "./pages/PromptList";
import { PromptCompare } from "./pages/PromptCompare";
import { AnnotateList } from "./pages/AnnotateList";
import { AnnotateTemplates } from "./pages/AnnotateTemplates";
import { AnnotateNew } from "./pages/AnnotateNew";
import { AnnotateWorkspace } from "./pages/AnnotateWorkspace";
import { CleaningWorkspace } from "./pages/CleaningWorkspace";
import { DatasetManage } from "./pages/DatasetManage";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { AdminLoginRecords } from "./pages/admin/AdminLoginRecords";
import { AdminOverview } from "./pages/admin/AdminOverview";

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<TaskList />} />
              <Route path="datasets" element={<DatasetManage />} />
              <Route path="cleaning" element={<CleaningWorkspace />} />
              <Route path="prompts" element={<PromptList />} />
              <Route path="prompts/compare" element={<PromptCompare />} />
              <Route path="new" element={<TaskCreate />} />
              <Route path="tasks/:id" element={<TaskDetail />} />
              <Route path="annotate" element={<AnnotateList />} />
              <Route path="annotate/templates" element={<AnnotateTemplates />} />
              <Route path="annotate/new" element={<AnnotateNew />} />
              <Route path="annotate/jobs/:id" element={<AnnotateWorkspace />} />
              <Route
                path="admin"
                element={
                  <RequireAdmin>
                    <AdminOverview />
                  </RequireAdmin>
                }
              />
              <Route
                path="admin/users"
                element={
                  <RequireAdmin>
                    <AdminUsers />
                  </RequireAdmin>
                }
              />
              <Route
                path="admin/logins"
                element={
                  <RequireAdmin>
                    <AdminLoginRecords />
                  </RequireAdmin>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
