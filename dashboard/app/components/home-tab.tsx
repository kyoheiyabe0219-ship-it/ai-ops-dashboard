"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { AgentRun, ApprovalRequest, Agent, Task, Alert } from "@/lib/supabase";

const API = "/api";

function formatYen(n: number) {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString()}`;
}

// ============================================================
// 推奨アクション生成（変更①: 推奨/代替/非推奨）
// ============================================================

type ActionItem = {
  type: "approve" | "stop" | "test" | "iterate" | "alert" | "scale";
  rank: "recommended" | "alternative" | "not_recommended";
  title: string;
  reason: string;
  successRate?: string;
  memoryBasis?: string;
  priority: number;
  runId?: string;
  approvalId?: string;
};

function generateActions(runs: AgentRun[], approvals: ApprovalRequest[], alerts: Alert[], tasks: Task[]): ActionItem[] {
  const items: ActionItem[] = [];

  // 承認待ち → 推奨
  for (const a of approvals.filter(x => x.status === "pending")) {
    const run = runs.find(r => r.id === a.run_id);
    items.push({
      type: "approve", rank: "recommended",
      title: `「${run?.title || "戦略"}」を承認して実行`,
      reason: `スコア${run?.best_score || 0}点で承認基準到達`,
      successRate: run ? `${Math.round(run.success_rate * 100)}%` : undefined,
      memoryBasis: run?.effective_score ? `実効スコア${run.effective_score.toFixed(1)}` : undefined,
      priority: 100, runId: run?.id, approvalId: a.id,
    });
  }

  // 高ROI active → SCALE推奨
  const highRoiDone = tasks.filter(t => t.status === "done" && t.roi > 5);
  if (highRoiDone.length > 0) {
    items.push({
      type: "scale", rank: items.length === 0 ? "recommended" : "alternative",
      title: `高ROIタスクを横展開`,
      reason: `ROI ${highRoiDone[0].roi.toFixed(1)}x の「${highRoiDone[0].content.substring(0, 20)}」を拡大`,
      priority: 80,
    });
  }

  // thinking → 代替
  for (const r of runs.filter(x => x.status === "thinking").slice(0, 1)) {
    items.push({
      type: "iterate", rank: "alternative",
      title: `「${r.title}」を改善中 (${r.best_score}点)`,
      reason: `${r.current_iteration}/${r.max_iterations}回目。もう少しスコアを上げられます`,
      priority: 50, runId: r.id,
    });
  }

  // エラー → 非推奨行動として表示
  const errors = alerts.filter(a => !a.is_read && a.type === "error");
  if (errors.length > 0) {
    items.push({
      type: "alert", rank: "not_recommended",
      title: `エラー${errors.length}件 — 放置はリスク`,
      reason: errors[0].title,
      priority: 90,
    });
  }

  // 低ROI → 非推奨
  const lowRoi = tasks.filter(t => t.status === "running" && t.roi > 0 && t.roi < 1);
  if (lowRoi.length > 0) {
    items.push({
      type: "stop", rank: "not_recommended",
      title: `低ROIタスク${lowRoi.length}件を停止推奨`,
      reason: `ROI < 1x。リソースを高ROIに移すべき`,
      priority: 60,
    });
  }

  return items.sort((a, b) => b.priority - a.priority).slice(0, 3);
}

// ============================================================
// メイン
// ============================================================

type RevData = { monthly: number; total: number; avgRoi: number; activeStreams: number; topStream: string };

export default function HomeTab({
  agents, tasks, runs, approvals, alerts, onRefresh,
}: {
  agents: Agent[]; tasks: Task[]; runs: AgentRun[];
  approvals: ApprovalRequest[]; alerts: Alert[];
  onRefresh: () => void;
}) {
  const [chatInput, setChatInput] = useState("");
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [rev, setRev] = useState<RevData>({ monthly: 0, total: 0, avgRoi: 0, activeStreams: 0, topStream: "" });

  const loadRev = useCallback(async () => {
    const res = await fetch(`${API}/revenue`).then(r => r.json()).catch(() => null);
    if (res?.summary) {
      const top = (res.streams || []).find((s: { status: string }) => s.status === "active");
      setRev({
        monthly: res.summary.monthly_revenue || 0,
        total: res.summary.total_revenue || 0,
        avgRoi: res.summary.avg_roi || 0,
        activeStreams: res.summary.active_streams || 0,
        topStream: top?.name || "",
      });
    }
  }, []);
  useEffect(() => { loadRev(); }, [loadRev]);

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || sending) return;
    setSending(true); setChatResponse(null);
    try {
      const res = await fetch(`${API}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: chatInput.trim() }) });
      const data = await res.json();
      setChatResponse(data.response || "エラー"); setChatInput(""); onRefresh(); loadRev();
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
  const errored = agents.filter(a => a.status === "error").length;
  const running = agents.filter(a => a.status === "running").length;
  const doneTasks = tasks.filter(t => t.status === "done");
  const totalTasks = tasks.length;
  const aiConf = totalTasks >= 3 ? Math.round(doneTasks.length / totalTasks * 100) : null;
  const actions = generateActions(runs, approvals, alerts, tasks);
  const pendingCount = approvals.filter(a => a.status === "pending").length;
  const runningTasks = tasks.filter(t => t.status === "running").length;

  const rankStyle = { recommended: { label: "推奨", bg: "bg-green-900/50", border: "border-green-700", text: "text-green-400" }, alternative: { label: "代替", bg: "bg-blue-900/30", border: "border-blue-800", text: "text-blue-400" }, not_recommended: { label: "注意", bg: "bg-red-900/30", border: "border-red-800", text: "text-red-400" } };
  const actionIcon: Record<string, string> = { approve: "✅", stop: "🛑", test: "🧪", iterate: "🔄", alert: "⚠️", scale: "📈" };

  return (
    <div className="space-y-4">
      {/* =============================== */}
      {/* 状態 + 勝ってる感（変更③）       */}
      {/* =============================== */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-2xl font-black text-green-400">{formatYen(rev.monthly)}<span className="text-xs text-gray-500 font-normal">/月</span></p>
            <p className="text-[10px] text-gray-500">累計 {formatYen(rev.total)} • 平均ROI {rev.avgRoi}x</p>
          </div>
          {aiConf !== null && (
            <div className="text-right">
              <p className={`text-2xl font-black ${aiConf >= 80 ? "text-green-400" : aiConf >= 50 ? "text-yellow-400" : "text-red-400"}`}>{aiConf}%</p>
              <p className="text-[10px] text-gray-500">AI信頼度</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="bg-gray-800 rounded-lg py-1.5">
            <p className={`text-sm font-bold ${errored > 0 ? "text-red-400" : running > 0 ? "text-green-400" : "text-gray-500"}`}>{errored > 0 ? "⚠️" : running > 0 ? "✅" : "⏸"}</p>
            <p className="text-[9px] text-gray-600">AI状態</p>
          </div>
          <div className="bg-gray-800 rounded-lg py-1.5">
            <p className="text-sm font-bold text-blue-400">{runningTasks}</p>
            <p className="text-[9px] text-gray-600">実行中</p>
          </div>
          <div className="bg-gray-800 rounded-lg py-1.5">
            <p className={`text-sm font-bold ${pendingCount > 0 ? "text-yellow-400" : "text-gray-500"}`}>{pendingCount}</p>
            <p className="text-[9px] text-gray-600">承認待ち</p>
          </div>
          <div className="bg-gray-800 rounded-lg py-1.5">
            <p className="text-sm font-bold text-purple-400">{rev.activeStreams}</p>
            <p className="text-[9px] text-gray-600">収益源</p>
          </div>
        </div>

        {rev.topStream && (
          <p className="text-[10px] text-gray-500 mt-2">🏆 トップ戦略: {rev.topStream}</p>
        )}
      </div>

      {/* =============================== */}
      {/* 推奨アクション（変更①②⑤）       */}
      {/* =============================== */}
      {actions.length > 0 && (
        <div className="space-y-2">
          {actions.map((action, i) => {
            const style = rankStyle[action.rank];
            return (
              <div key={i} className={`rounded-xl p-3 border ${style.border} ${style.bg}`}>
                {/* ヘッダー */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{actionIcon[action.type]}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${style.text} bg-gray-900/50`}>{style.label}</span>
                  <p className="text-sm font-semibold flex-1">{action.title}</p>
                </div>

                {/* 判断理由（変更⑤） */}
                <p className="text-[11px] text-gray-400 ml-8">{action.reason}</p>
                {(action.successRate || action.memoryBasis) && (
                  <div className="flex gap-3 ml-8 mt-1 text-[10px]">
                    {action.successRate && <span className="text-blue-400">成功率 {action.successRate}</span>}
                    {action.memoryBasis && <span className="text-purple-400">根拠: {action.memoryBasis}</span>}
                  </div>
                )}

                {/* 承認UX（変更②） */}
                {action.type === "approve" && action.approvalId && (() => {
                  const run = runs.find(r => r.id === action.runId);
                  const approval = approvals.find(a => a.id === action.approvalId);
                  const plan = (approval?.plan || {}) as { tasks?: { content: string; expected_value?: number }[] };
                  const expectedRev = (plan.tasks || []).reduce((s, t) => s + (t.expected_value || 0), 0);

                  return (
                    <div className="mt-2 ml-8 space-y-2">
                      <div className="flex gap-2">
                        <div className="bg-gray-900 rounded-lg px-3 py-1.5 text-center flex-1">
                          <p className="text-xs font-bold text-green-400">{formatYen(expectedRev)}</p>
                          <p className="text-[8px] text-gray-600">期待収益</p>
                        </div>
                        <div className="bg-gray-900 rounded-lg px-3 py-1.5 text-center flex-1">
                          <p className="text-xs font-bold text-blue-400">{run?.best_score || 0}点</p>
                          <p className="text-[8px] text-gray-600">スコア</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleApprove(action.approvalId!, action.runId)}
                          className="flex-1 bg-green-700 hover:bg-green-600 text-white text-xs py-2.5 rounded-lg transition font-bold">
                          ✅ 実行
                        </button>
                        <button onClick={() => { if (action.runId) handleIterate(action.runId); else handleReject(action.approvalId!); }}
                          className="bg-purple-900 hover:bg-purple-800 text-purple-200 text-xs px-3 py-2.5 rounded-lg transition">🔄</button>
                        <button onClick={() => handleReject(action.approvalId!)}
                          className="bg-gray-800 hover:bg-gray-700 text-gray-500 text-xs px-3 py-2.5 rounded-lg transition">✕</button>
                      </div>
                    </div>
                  );
                })()}

                {/* 即操作ボタン（変更④） */}
                {action.type === "iterate" && action.runId && (
                  <button onClick={() => handleIterate(action.runId!)}
                    className="mt-2 ml-8 bg-purple-900 hover:bg-purple-800 text-purple-200 text-xs px-3 py-1.5 rounded-lg transition">🔄 改善する</button>
                )}
                {action.type === "scale" && (
                  <button onClick={() => { setChatInput("成功パターンを横展開して"); }}
                    className="mt-2 ml-8 bg-green-900 hover:bg-green-800 text-green-200 text-xs px-3 py-1.5 rounded-lg transition">📈 SCALE</button>
                )}
                {action.type === "stop" && (
                  <button onClick={() => { setChatInput("低ROIタスクを停止して"); }}
                    className="mt-2 ml-8 bg-red-900 hover:bg-red-800 text-red-200 text-xs px-3 py-1.5 rounded-lg transition">🛑 STOP</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* =============================== */}
      {/* チャット                         */}
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
