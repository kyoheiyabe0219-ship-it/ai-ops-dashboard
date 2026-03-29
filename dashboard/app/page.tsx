"use client";

import { useEffect, useState, useCallback } from "react";
import { Agent, Task, AgentRun, ApprovalRequest, Alert } from "@/lib/supabase";
import HomeTab from "./components/home-tab";
import TasksTab from "./components/tasks-tab";
import MonitorTab from "./components/monitor-tab";
import DashboardTab from "./components/dashboard-tab";

type Tab = "home" | "tasks" | "monitor" | "dashboard";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "home", icon: "🏠", label: "Home" },
  { key: "tasks", icon: "📌", label: "Tasks" },
  { key: "monitor", icon: "👁", label: "Monitor" },
  { key: "dashboard", icon: "📊", label: "分析" },
];

// cache-busted fetch（モバイルキャッシュ対策）
async function apiFetch(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const loadAll = useCallback(async () => {
    try {
      const [a, t, r, ap, al] = await Promise.all([
        apiFetch("/api/agents"),
        apiFetch("/api/tasks"),
        apiFetch("/api/runs"),
        apiFetch("/api/approvals?status=pending"),
        apiFetch("/api/alerts"),
      ]);
      if (Array.isArray(a)) setAgents(a);
      if (Array.isArray(t)) setTasks(t);
      if (Array.isArray(r)) setRuns(r);
      if (Array.isArray(ap)) setApprovals(ap);
      if (Array.isArray(al)) setAlerts(al);
    } catch {
      // ネットワークエラー時はリトライ
      setTimeout(loadAll, 3000);
    }
  }, []);

  useEffect(() => {
    loadAll();
    // ポーリング: 15秒ごとに再取得（Realtime不要）
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const pendingCount = approvals.filter(a => a.status === "pending").length;
  const errorCount = agents.filter(a => a.status === "error").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold">AI Ops</h1>
        <div className="flex gap-2 text-xs text-gray-400">
          <span className="text-green-400">{agents.filter(a => a.status === "running").length} 稼働</span>
          {errorCount > 0 && <span className="text-red-400">{errorCount} 🔴</span>}
          {pendingCount > 0 && <span className="text-yellow-400">{pendingCount} ⏳</span>}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 pb-20">
        {tab === "home" && <HomeTab agents={agents} tasks={tasks} runs={runs} approvals={approvals} alerts={alerts} onRefresh={loadAll} />}
        {tab === "tasks" && <TasksTab tasks={tasks} agents={agents} onRefresh={loadAll} />}
        {tab === "monitor" && <MonitorTab agents={agents} tasks={tasks} runs={runs} alerts={alerts} onRefresh={loadAll} />}
        {tab === "dashboard" && <DashboardTab tasks={tasks} runs={runs} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex flex-col items-center py-2 relative transition ${tab === t.key ? "text-white" : "text-gray-500"}`}>
              <span className="text-lg">{t.icon}</span>
              <span className="text-[10px] mt-0.5">{t.label}</span>
              {t.key === "home" && pendingCount > 0 && (
                <span className="absolute top-0.5 right-1/4 bg-red-600 text-[9px] text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
