"use client";

import { Task, AgentRun } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";

function formatYen(n: number) {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString()}`;
}

type Stream = { id: string; type: string; name: string; status: string; monthly_revenue: number; total_revenue: number; roi: number; task_count: number };
type CeoDecision = { action: string; target: string; reason: string };

export default function DashboardTab({ tasks, runs }: { tasks: Task[]; runs: AgentRun[] }) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [ceoDecisions, setCeoDecisions] = useState<CeoDecision[]>([]);
  const [summary, setSummary] = useState<{ monthly_revenue: number; total_revenue: number; active_streams: number; testing_streams: number; avg_roi: number } | null>(null);

  const loadRevenue = useCallback(async () => {
    const res = await fetch("/api/revenue").then(r => r.json()).catch(() => null);
    if (res) {
      setStreams(res.streams || []);
      setCeoDecisions(res.ceo_decisions || []);
      setSummary(res.summary || null);
    }
  }, []);

  useEffect(() => { loadRevenue(); }, [loadRevenue]);

  const doneTasks = tasks.filter(t => t.status === "done");
  const totalExpected = tasks.reduce((s, t) => s + (t.expected_value || 0), 0);
  const totalActual = doneTasks.reduce((s, t) => s + (t.actual_value || 0), 0);
  const avgRoi = doneTasks.length > 0 ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length : 0;
  const roiRanking = [...doneTasks].filter(t => t.roi > 0).sort((a, b) => b.roi - a.roi).slice(0, 5);

  const actionColor: Record<string, string> = { scale: "text-green-400", stop: "text-red-400", invest: "text-blue-400", test: "text-yellow-400", hold: "text-gray-400" };
  const actionIcon: Record<string, string> = { scale: "📈", stop: "🛑", invest: "💰", test: "🧪", hold: "⏸" };
  const statusColor: Record<string, string> = { active: "bg-green-900 text-green-300", testing: "bg-yellow-900 text-yellow-300", stopped: "bg-red-900 text-red-300" };

  return (
    <div className="space-y-4">
      {/* 収益サマリー */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "月間収益", value: formatYen(summary?.monthly_revenue || 0), color: "text-green-400" },
          { label: "累計収益", value: formatYen(summary?.total_revenue || totalActual), color: "text-emerald-400" },
          { label: "期待収益", value: formatYen(totalExpected), color: "text-yellow-400" },
          { label: "平均ROI", value: `${(summary?.avg_roi || avgRoi).toFixed(1)}x`, color: "text-purple-400" },
          { label: "Active", value: `${summary?.active_streams || 0}`, color: "text-green-400" },
          { label: "Testing", value: `${summary?.testing_streams || 0}`, color: "text-yellow-400" },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 rounded-xl p-3 border border-gray-800">
            <p className="text-[10px] text-gray-500 mb-0.5">{s.label}</p>
            <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* CEO判断 */}
      {ceoDecisions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">🧠 CEO収益判断</p>
          <div className="space-y-1.5">
            {ceoDecisions.map((d, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
                <span>{actionIcon[d.action] || "○"}</span>
                <span className={`text-xs font-medium ${actionColor[d.action] || "text-gray-400"}`}>{d.action.toUpperCase()}</span>
                <span className="text-xs text-gray-400 flex-1 truncate">{d.target}</span>
                <span className="text-[10px] text-gray-600">{d.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 収益ストリーム */}
      {streams.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">💰 収益ストリーム</p>
          <div className="space-y-1.5">
            {streams.map(s => (
              <div key={s.id} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusColor[s.status] || "bg-gray-700"}`}>{s.status}</span>
                <span className="text-xs font-medium flex-1 truncate">{s.name}</span>
                <span className="text-[10px] text-gray-500">{s.type}</span>
                {s.roi > 0 && <span className="text-[10px] text-purple-400">ROI {s.roi.toFixed(1)}x</span>}
                <span className="text-xs text-green-400 font-medium">{formatYen(s.total_revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ROIランキング */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">🏆 ROIランキング</p>
        <div className="space-y-1.5">
          {roiRanking.length === 0 && <p className="text-gray-600 text-center py-3 text-sm">完了タスクなし</p>}
          {roiRanking.map((task, i) => (
            <div key={task.id} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
              <span className={`text-xs font-bold ${i < 3 ? "text-yellow-400" : "text-gray-500"}`}>#{i + 1}</span>
              <span className="flex-1 text-xs truncate">{task.content}</span>
              <span className="text-xs text-purple-400 font-mono">{task.roi.toFixed(1)}x</span>
            </div>
          ))}
        </div>
      </div>

      {/* Run実績 */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
        <p className="text-xs font-semibold text-gray-400 mb-1">思考ループ</p>
        <div className="flex gap-3 text-xs text-gray-500">
          <span>全{runs.length}</span>
          <span className="text-green-400">完了{runs.filter(r => r.status === "done").length}</span>
          <span className="text-purple-400">思考{runs.filter(r => r.status === "thinking").length}</span>
          <span className="text-yellow-400">承認待{runs.filter(r => r.status === "awaiting_approval").length}</span>
        </div>
      </div>
    </div>
  );
}
