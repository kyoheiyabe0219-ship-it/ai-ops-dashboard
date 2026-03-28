"use client";

import { Task, AgentRun } from "@/lib/supabase";

function formatYen(n: number) {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString()}`;
}

export default function DashboardTab({
  tasks, runs,
}: {
  tasks: Task[];
  runs: AgentRun[];
}) {
  const doneTasks = tasks.filter(t => t.status === "done");
  const totalExpected = tasks.reduce((s, t) => s + (t.expected_value || 0), 0);
  const totalActual = doneTasks.reduce((s, t) => s + (t.actual_value || 0), 0);
  const totalCost = doneTasks.reduce((s, t) => s + (t.cost || 0), 0);
  const avgRoi = doneTasks.length > 0
    ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length : 0;
  const netProfit = totalActual - totalCost;

  const roiRanking = [...doneTasks].filter(t => t.roi > 0).sort((a, b) => b.roi - a.roi).slice(0, 10);
  const completedRuns = runs.filter(r => r.status === "done").length;
  const totalRuns = runs.length;

  return (
    <div className="space-y-4">
      {/* 収益サマリー */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "期待収益", value: formatYen(totalExpected), color: "text-yellow-400" },
          { label: "実績収益", value: formatYen(totalActual), color: "text-green-400" },
          { label: "コスト", value: formatYen(totalCost), color: "text-red-400" },
          { label: "純利益", value: formatYen(netProfit), color: netProfit >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "平均ROI", value: `${avgRoi.toFixed(1)}x`, color: "text-purple-400" },
          { label: "完了タスク", value: `${doneTasks.length}/${tasks.length}`, color: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 rounded-xl p-3 border border-gray-800">
            <p className="text-[10px] text-gray-500 mb-0.5">{s.label}</p>
            <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Run実績 */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
        <p className="text-xs font-semibold text-gray-400 mb-2">思考ループ実績</p>
        <div className="flex gap-4 text-xs">
          <span>全Run: {totalRuns}</span>
          <span className="text-green-400">完了: {completedRuns}</span>
          <span className="text-purple-400">思考中: {runs.filter(r => r.status === "thinking").length}</span>
          <span className="text-yellow-400">承認待: {runs.filter(r => r.status === "awaiting_approval").length}</span>
        </div>
      </div>

      {/* ROIランキング */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">🏆 ROIランキング</p>
        <div className="space-y-1.5">
          {roiRanking.length === 0 && <p className="text-gray-600 text-center py-4 text-sm">完了タスクなし</p>}
          {roiRanking.map((task, i) => (
            <div key={task.id} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
              <span className={`text-xs font-bold ${i < 3 ? "text-yellow-400" : "text-gray-500"}`}>#{i + 1}</span>
              <span className="flex-1 text-xs truncate">{task.content}</span>
              <span className="text-xs text-purple-400 font-mono">{task.roi.toFixed(1)}x</span>
              <span className="text-[10px] text-green-400">{formatYen(task.actual_value || 0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
