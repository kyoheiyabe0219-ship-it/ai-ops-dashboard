"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase, Agent, Task, AgentRun, ApprovalRequest, Alert } from "@/lib/supabase";
import HomeTab from "./components/home-tab";
import TasksTab from "./components/tasks-tab";
import MonitorTab from "./components/monitor-tab";
import DashboardTab from "./components/dashboard-tab";

// ============================================================
// 4タブ構成
// ============================================================

type Tab = "home" | "tasks" | "monitor" | "dashboard";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "home", icon: "🏠", label: "Home" },
  { key: "tasks", icon: "📌", label: "Tasks" },
  { key: "monitor", icon: "👁", label: "Monitor" },
  { key: "dashboard", icon: "📊", label: "分析" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const loadAll = useCallback(async () => {
    const api = "/api";
    const [agentsRes, tasksRes, runsRes, approvalsRes, alertsRes] = await Promise.all([
      fetch(`${api}/agents`).then(r => r.json()).catch(() => []),
      fetch(`${api}/tasks`).then(r => r.json()).catch(() => []),
      fetch(`${api}/runs`).then(r => r.json()).catch(() => []),
      fetch(`${api}/approvals?status=pending`).then(r => r.json()).catch(() => []),
      fetch(`${api}/alerts`).then(r => r.json()).catch(() => []),
    ]);
    if (Array.isArray(agentsRes)) setAgents(agentsRes);
    if (Array.isArray(tasksRes)) setTasks(tasksRes);
    if (Array.isArray(runsRes)) setRuns(runsRes);
    if (Array.isArray(approvalsRes)) setApprovals(approvalsRes);
    if (Array.isArray(alertsRes)) setAlerts(alertsRes);
  }, []);

  useEffect(() => {
    loadAll();

    // Supabase Realtimeで主要テーブルの変更を監視
    const supabase = getSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel("main-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_runs" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => loadAll())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadAll]);

  // 承認待ちバッジ
  const pendingCount = approvals.filter(a => a.status === "pending").length;
  const errorCount = agents.filter(a => a.status === "error").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* ヘッダー */}
      <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold">AI Ops</h1>
        <div className="flex gap-2 text-xs text-gray-400">
          <span className="text-green-400">{agents.filter(a => a.status === "running").length} 稼働</span>
          {errorCount > 0 && <span className="text-red-400">{errorCount} 🔴</span>}
          {pendingCount > 0 && <span className="text-yellow-400">{pendingCount} ⏳</span>}
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-20">
        {tab === "home" && (
          <HomeTab agents={agents} tasks={tasks} runs={runs} approvals={approvals} alerts={alerts} onRefresh={loadAll} />
        )}
        {tab === "tasks" && (
          <TasksTab tasks={tasks} agents={agents} onRefresh={loadAll} />
        )}
        {tab === "monitor" && (
          <MonitorTab agents={agents} tasks={tasks} runs={runs} alerts={alerts} onRefresh={loadAll} />
        )}
        {tab === "dashboard" && (
          <DashboardTab tasks={tasks} runs={runs} />
        )}
      </main>

      {/* 下部ナビ */}
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
