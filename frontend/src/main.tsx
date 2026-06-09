import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./styles/index.css";
import { Layout } from "./components/Layout";
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

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
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
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
