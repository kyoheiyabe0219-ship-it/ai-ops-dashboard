"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { AgentRun, ApprovalRequest, Agent, Task, Alert } from "@/lib/supabase";

const API = "/api";

function formatYen(n: number) {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString()}`;
}

// ============================================================
// 「次にやること」自動生成
// ============================================================

type NextAction = {
  type: "approve" | "stop" | "test" | "iterate" | "alert";
  title: string;
  detail: string;
  priority: number; // 高いほど上
  runId?: string;
  approvalId?: string;
};

function generateNextActions(runs: AgentRun[], approvals: ApprovalRequest[], alerts: Alert[], tasks: Task[]): NextAction[] {
  const actions: NextAction[] = [];

  // 承認待ち
  for (const a of approvals.filter(x => x.status === "pending")) {
    const run = runs.find(r => r.id === a.run_id);
    const plan = a.plan as { summary?: string } | null;
    actions.push({
      type: "approve",
      title: `「${run?.title || "戦略"}」を承認してください`,
      detail: plan?.summary || a.description || "",
      priority: 100,
      runId: run?.id,
      approvalId: a.id,
    });
  }

  // thinking中（改善可能）
  for (const r of runs.filter(x => x.status === "thinking").slice(0, 1)) {
    actions.push({
      type: "iterate",
      title: `「${r.title}」が思考中（${r.best_score}点）`,
      detail: "イテレーションを進めてスコアを上げましょう",
      priority: 50,
      runId: r.id,
    });
  }

  // エラーアラート
  const errorAlerts = alerts.filter(a => !a.is_read && a.type === "error");
  if (errorAlerts.length > 0) {
    actions.push({
      type: "alert",
      title: `${errorAlerts.length}件のエラーを確認してください`,
      detail: errorAlerts[0].title,
      priority: 90,
    });
  }

  // 低ROI停止推奨
  const lowRoiRunning = tasks.filter(t => t.status === "running" && t.roi < 1 && t.roi > 0);
  if (lowRoiRunning.length > 0) {
    actions.push({
      type: "stop",
      title: `低ROIタスクが${lowRoiRunning.length}件実行中`,
      detail: "停止を検討してください",
      priority: 60,
    });
  }

  return actions.sort((a, b) => b.priority - a.priority).slice(0, 3);
}

// ============================================================
// メインコンポーネント
// ============================================================

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
  const [revenue, setRevenue] = useState<{ monthly: number; total: number }>({ monthly: 0, total: 0 });

  const loadRevenue = useCallback(async () => {
    const res = await fetch(`${API}/revenue`).then(r => r.json()).catch(() => null);
    if (res?.summary) setRevenue({ monthly: res.summary.monthly_revenue || 0, total: res.summary.total_revenue || 0 });
  }, []);
  useEffect(() => { loadRevenue(); }, [loadRevenue]);

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || sending) return;
    setSending(true); setChatResponse(null);
    try {
      const res = await fetch(`${API}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: chatInput.trim() }) });
      const data = await res.json();
      setChatResponse(data.response || "エラーが発生しました");
      setChatInput(""); onRefresh();
    } finally { setSending(false); }
  }

  async function handleApprove(approvalId: string, runId?: string) {
    await fetch(`${API}/approvals/${approvalId}/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approved" }) });
    if (runId) await fetch(`${API}/runs/${runId}/execute`, { method: "POST" });
    onRefresh();
  }

  async function handleReject(approvalId: string) {
    await fetch(`${API}/approvals/${approvalId}/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rejected" }) });
    onRefresh();
  }

  async function handleIterate(runId: string) {
    await fetch(`${API}/runs/${runId}/iterate`, { method: "POST" });
    onRefresh();
  }

  // 計算
  const running = agents.filter(a => a.status === "running").length;
  const errored = agents.filter(a => a.status === "error").length;
  const doneTasks = tasks.filter(t => t.status === "done");
  const totalTasks = tasks.length;
  const aiConfidence = totalTasks >= 3 ? Math.round(doneTasks.length / totalTasks * 100) : null;
  const healthStatus = errored > 0 ? "異常" : running > 0 ? "良好" : "待機";
  const healthColor = errored > 0 ? "text-red-400" : running > 0 ? "text-green-400" : "text-gray-400";
  const riskLevel = errored > 1 ? "高" : errored > 0 ? "中" : "低";
  const riskColor = errored > 1 ? "text-red-400" : errored > 0 ? "text-yellow-400" : "text-green-400";
  const nextActions = generateNextActions(runs, approvals, alerts, tasks);
  const pendingCount = approvals.filter(a => a.status === "pending").length;
  const runningTasks = tasks.filter(t => t.status === "running").length;

  const actionIcon: Record<string, string> = { approve: "✅", stop: "🛑", test: "🧪", iterate: "🔄", alert: "🔴" };
  const actionBorder: Record<string, string> = { approve: "border-green-800", stop: "border-red-800", test: "border-yellow-800", iterate: "border-purple-800", alert: "border-red-800" };

  return (
    <div className="space-y-4">
      {/* =============================== */}
      {/* STEP1: 状態サマリー              */}
      {/* =============================== */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">今日の状態</h2>
          {/* STEP4: AI信頼度 */}
          {aiConfidence !== null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500">AI信頼度</span>
              <span className={`text-sm font-bold ${aiConfidence >= 80 ? "text-green-400" : aiConfidence >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                {aiConfidence}%
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2 text-center">
          <div>
            <p className="text-base font-bold text-green-400">{formatYen(revenue.monthly)}</p>
            <p className="text-[9px] text-gray-600">月間収益</p>
          </div>
          <div>
            <p className={`text-base font-bold ${healthColor}`}>{healthStatus}</p>
            <p className="text-[9px] text-gray-600">AI状態</p>
          </div>
          <div>
            <p className={`text-base font-bold ${riskColor}`}>{riskLevel}</p>
            <p className="text-[9px] text-gray-600">リスク</p>
          </div>
          <div>
            <p className="text-base font-bold text-blue-400">{runningTasks}</p>
            <p className="text-[9px] text-gray-600">実行中</p>
          </div>
          <div>
            <p className={`text-base font-bold ${pendingCount > 0 ? "text-yellow-400" : "text-gray-500"}`}>{pendingCount}</p>
            <p className="text-[9px] text-gray-600">承認待ち</p>
          </div>
        </div>
      </div>

      {/* =============================== */}
      {/* STEP1: 次にやること              */}
      {/* =============================== */}
      {nextActions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">次にやること</p>
          <div className="space-y-2">
            {nextActions.map((action, i) => (
              <div key={i} className={`bg-gray-900 rounded-xl p-3 border ${actionBorder[action.type] || "border-gray-800"}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg mt-0.5">{actionIcon[action.type] || "📌"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{action.title}</p>
                    {action.detail && <p className="text-[11px] text-gray-500 mt-0.5">{action.detail.substring(0, 80)}</p>}
                  </div>
                </div>

                {/* STEP2: 承認UX（意思決定体験） */}
                {action.type === "approve" && action.approvalId && (() => {
                  const run = runs.find(r => r.id === action.runId);
                  const approval = approvals.find(a => a.id === action.approvalId);
                  const plan = (approval?.plan || {}) as { summary?: string; tasks?: { content: string; priority?: string; expected_value?: number }[] };
                  const expectedRevenue = (plan.tasks || []).reduce((s, t) => s + (t.expected_value || 0), 0);

                  return (
                    <div className="mt-3 space-y-2">
                      {/* 判断材料 */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-gray-800 rounded-lg p-2 text-center">
                          <p className="text-xs font-bold text-green-400">{formatYen(expectedRevenue)}</p>
                          <p className="text-[9px] text-gray-600">期待収益</p>
                        </div>
                        <div className="bg-gray-800 rounded-lg p-2 text-center">
                          <p className="text-xs font-bold text-blue-400">{run?.best_score || 0}点</p>
                          <p className="text-[9px] text-gray-600">品質スコア</p>
                        </div>
                        <div className="bg-gray-800 rounded-lg p-2 text-center">
                          <p className="text-xs font-bold text-green-400">低</p>
                          <p className="text-[9px] text-gray-600">リスク</p>
                        </div>
                      </div>

                      {/* タスクプレビュー */}
                      {plan.tasks && plan.tasks.length > 0 && (
                        <div className="space-y-1">
                          {plan.tasks.slice(0, 3).map((t, j) => (
                            <div key={j} className="flex items-center gap-2 text-[10px] text-gray-400">
                              <span className="text-gray-600">#{j + 1}</span>
                              <span className="flex-1 truncate">{t.content}</span>
                              {(t.expected_value || 0) > 0 && <span className="text-yellow-500">{formatYen(t.expected_value || 0)}</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 3ボタン */}
                      <div className="flex gap-2">
                        <button onClick={() => handleApprove(action.approvalId!, action.runId)}
                          className="flex-1 bg-green-800 hover:bg-green-700 text-green-100 text-xs py-2.5 rounded-lg transition font-bold">
                          ✅ 実行する
                        </button>
                        <button onClick={() => { if (action.runId) handleIterate(action.runId); else handleReject(action.approvalId!); }}
                          className="bg-purple-900 hover:bg-purple-800 text-purple-200 text-xs px-4 py-2.5 rounded-lg transition">
                          🔄 改善
                        </button>
                        <button onClick={() => handleReject(action.approvalId!)}
                          className="bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs px-4 py-2.5 rounded-lg transition">
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {action.type === "iterate" && action.runId && (
                  <button onClick={() => handleIterate(action.runId!)}
                    className="mt-2 bg-purple-900 hover:bg-purple-800 text-purple-200 text-xs px-3 py-1.5 rounded-lg transition">
                    🔄 次のイテレーション
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =============================== */}
      {/* チャット入力                     */}
      {/* =============================== */}
      <form onSubmit={sendChat} className="flex gap-2">
        <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="AI組織に指示を出す..."
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-600" />
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
    </div>
  );
}
