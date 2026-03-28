"use client";

import { useState, FormEvent } from "react";
import { AgentRun, ApprovalRequest, Agent, Task, Alert, ChatMessage } from "@/lib/supabase";

const DISPATCHER = "/api";

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  return `${Math.floor(s / 3600)}時間前`;
}

export default function HomeTab({
  agents, tasks, runs, approvals, alerts, onRefresh,
}: {
  agents: Agent[];
  tasks: Task[];
  runs: AgentRun[];
  approvals: ApprovalRequest[];
  alerts: Alert[];
  onRefresh: () => void;
}) {
  const [chatInput, setChatInput] = useState("");
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || sending) return;
    setSending(true);
    setChatResponse(null);
    try {
      const res = await fetch(`${DISPATCHER}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput.trim() }),
      });
      const data = await res.json();
      setChatResponse(data.response || "エラーが発生しました");
      setChatInput("");
      onRefresh();
    } finally {
      setSending(false);
    }
  }

  async function respondApproval(id: string, action: "approved" | "rejected") {
    await fetch(`${DISPATCHER}/approvals/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    onRefresh();
  }

  async function executeRun(runId: string) {
    await fetch(`${DISPATCHER}/runs/${runId}/execute`, { method: "POST" });
    onRefresh();
  }

  const running = agents.filter(a => a.status === "running").length;
  const errored = agents.filter(a => a.status === "error").length;
  const pendingTasks = tasks.filter(t => t.status === "pending").length;
  const unreadAlerts = alerts.filter(a => !a.is_read).length;
  const pendingApprovals = approvals.filter(a => a.status === "pending");

  return (
    <div className="space-y-4">
      {/* チャット入力（メイン） */}
      <form onSubmit={sendChat} className="flex gap-2">
        <input
          type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
          placeholder="AI組織に指示を出す..."
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-600"
        />
        <button type="submit" disabled={sending || !chatInput.trim()}
          className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-5 py-3 rounded-xl text-sm font-medium transition shrink-0">
          {sending ? "..." : "送信"}
        </button>
      </form>

      {chatResponse && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <pre className="text-sm whitespace-pre-wrap font-sans text-gray-200 leading-relaxed">{chatResponse}</pre>
        </div>
      )}

      {/* 承認待ち（最重要表示） */}
      {pendingApprovals.length > 0 && (
        <div className="bg-yellow-950/50 border border-yellow-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-yellow-400">⏳ {pendingApprovals.length}件の承認待ち</p>
          {pendingApprovals.map(a => {
            const run = runs.find(r => r.id === a.run_id);
            const plan = a.plan as { summary?: string; tasks?: { content: string; priority?: string }[] };
            return (
              <div key={a.id} className="bg-gray-900 rounded-lg p-3 border border-gray-800 space-y-2">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="text-xs text-gray-500">{a.description}</p>
                {plan?.summary && <p className="text-xs text-gray-300">{plan.summary}</p>}
                {plan?.tasks && plan.tasks.length > 0 && (
                  <div className="space-y-1">
                    {plan.tasks.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-gray-400">
                        <span className="text-gray-600">#{i + 1}</span>
                        <span>{t.content}</span>
                        {t.priority && <span className={`px-1 rounded ${t.priority === "high" ? "bg-red-900 text-red-300" : "bg-gray-700 text-gray-400"}`}>{t.priority}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {run && <p className="text-[10px] text-gray-600">スコア: {run.best_score}点 / 目標: {run.dynamic_target_score}点</p>}
                <div className="flex gap-2">
                  <button onClick={async () => { await respondApproval(a.id, "approved"); if (run) await executeRun(run.id); }}
                    className="bg-green-800 hover:bg-green-700 text-green-200 text-xs px-4 py-1.5 rounded-lg transition font-medium">✅ 承認して実行</button>
                  <button onClick={() => respondApproval(a.id, "rejected")}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs px-3 py-1.5 rounded-lg transition">🔄 改善</button>
                  <button onClick={() => respondApproval(a.id, "rejected")}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-500 text-xs px-3 py-1.5 rounded-lg transition">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ステータスサマリー */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "稼働中", value: running, color: "text-green-400" },
          { label: "エラー", value: errored, color: errored > 0 ? "text-red-400" : "text-gray-500" },
          { label: "待機タスク", value: pendingTasks, color: "text-yellow-400" },
          { label: "アラート", value: unreadAlerts, color: unreadAlerts > 0 ? "text-red-400" : "text-gray-500" },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 rounded-xl p-3 border border-gray-800 text-center">
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-600">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 直近アラート */}
      {alerts.filter(a => !a.is_read).slice(0, 3).map(a => (
        <div key={a.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border text-xs ${
          a.type === "error" ? "border-red-800 bg-red-950" : a.type === "warning" ? "border-yellow-800 bg-yellow-950" : "border-gray-800 bg-gray-900"
        }`}>
          <span>{a.type === "error" ? "🔴" : a.type === "warning" ? "🟡" : "🔵"}</span>
          <span className="flex-1">{a.title}</span>
          <span className="text-gray-600">{timeAgo(a.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
