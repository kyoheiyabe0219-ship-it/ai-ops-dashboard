"use client";

import { Task, AgentRun } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";

function formatYen(n: number) {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString()}`;
}

type Stream = { id: string; type: string; name: string; status: string; monthly_revenue: number; total_revenue: number; roi: number; task_count: number };
type CeoDecision = { action: string; target: string; reason: string };
type ScalePlanItem = { action: string; stream_name: string; details: string; expected_multiplier: number; tasks_to_generate: { content: string }[] };
type LeverageData = { total_assets: number; total_deployments: number; total_reuse: number; current_strategy: string; by_channel: Record<string, { count: number; published: number; revenue: number }>; top_assets: { title: string; reuse: number; revenue: number }[] };

export default function DashboardTab({ tasks, runs }: { tasks: Task[]; runs: AgentRun[] }) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [ceoDecisions, setCeoDecisions] = useState<CeoDecision[]>([]);
  const [summary, setSummary] = useState<{ monthly_revenue: number; total_revenue: number; active_streams: number; testing_streams: number; avg_roi: number } | null>(null);
  const [scalePlans, setScalePlans] = useState<ScalePlanItem[]>([]);
  const [bottlenecks, setBottlenecks] = useState<string[]>([]);
  const [investment, setInvestment] = useState<{ high_roi: number; mid_roi: number; low_roi: number }>({ high_roi: 0, mid_roi: 0, low_roi: 0 });
  const [leverage, setLeverage] = useState<LeverageData | null>(null);

  const loadRevenue = useCallback(async () => {
    const [revRes, levRes] = await Promise.all([
      fetch("/api/revenue").then(r => r.json()).catch(() => null),
      fetch("/api/leverage").then(r => r.json()).catch(() => null),
    ]);
    if (revRes) {
      setStreams(revRes.streams || []);
      setCeoDecisions(revRes.ceo_decisions || []);
      setSummary(revRes.summary || null);
      if (revRes.scale) {
        setScalePlans(revRes.scale.plans || []);
        setBottlenecks(revRes.scale.bottlenecks || []);
        setInvestment(revRes.scale.investment || { high_roi: 0, mid_roi: 0, low_roi: 0 });
      }
    }
    if (levRes) setLeverage(levRes);
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

      {/* ボトルネック */}
      {bottlenecks.length > 0 && (
        <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-3">
          <p className="text-xs font-semibold text-red-400 mb-1.5">⚠️ ボトルネック</p>
          {bottlenecks.map((b, i) => (
            <p key={i} className="text-[10px] text-red-300 mb-0.5">• {b}</p>
          ))}
        </div>
      )}

      {/* 投資配分 */}
      {(investment.high_roi !== 0 || investment.low_roi !== 0) && (
        <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
          <p className="text-xs font-semibold text-gray-400 mb-1">📊 投資配分</p>
          <div className="flex gap-3 text-xs">
            {investment.high_roi > 0 && <span className="text-green-400">高ROI: +{investment.high_roi}%</span>}
            {investment.mid_roi === 0 && <span className="text-gray-500">中ROI: 維持</span>}
            {investment.low_roi < 0 && <span className="text-red-400">低ROI: {investment.low_roi}%</span>}
          </div>
        </div>
      )}

      {/* スケールプラン */}
      {scalePlans.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">🚀 スケールプラン</p>
          <div className="space-y-1.5">
            {scalePlans.map((p, i) => {
              const icon = p.action === "scale" ? "📈" : p.action === "replicate" ? "📋" : p.action === "diversify" ? "🌱" : p.action === "stop" ? "🛑" : "⚡";
              const color = p.action === "scale" ? "border-green-900/50" : p.action === "stop" ? "border-red-900/50" : "border-gray-800";
              return (
                <div key={i} className={`bg-gray-900 rounded-lg px-3 py-2 border ${color}`}>
                  <div className="flex items-center gap-2">
                    <span>{icon}</span>
                    <span className="text-xs font-medium flex-1">{p.stream_name}</span>
                    {p.expected_multiplier > 1 && <span className="text-[10px] text-green-400">×{p.expected_multiplier}</span>}
                    <span className="text-[10px] text-gray-600">{p.tasks_to_generate.length}タスク</span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5">{p.details}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* レバレッジ（V9） */}
      {leverage && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">🔀 レバレッジ（1→N展開）</p>
          <div className="bg-gray-900 rounded-xl p-3 border border-purple-900/30 space-y-2">
            <div className="flex gap-3 text-xs">
              <span>コンテンツ: {leverage.total_assets}</span>
              <span className="text-purple-400">展開: {leverage.total_deployments}</span>
              <span className="text-green-400">再利用: {leverage.total_reuse}回</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${leverage.current_strategy === "revenue" ? "bg-green-900 text-green-300" : leverage.current_strategy === "spread" ? "bg-blue-900 text-blue-300" : "bg-purple-900 text-purple-300"}`}>
                {leverage.current_strategy === "revenue" ? "💰収益重視" : leverage.current_strategy === "spread" ? "📢拡散重視" : "🌱全展開"}
              </span>
            </div>

            {/* チャネル別 */}
            {Object.keys(leverage.by_channel).length > 0 && (
              <div className="space-y-1">
                {Object.entries(leverage.by_channel).map(([ch, data]) => (
                  <div key={ch} className="flex items-center gap-2 text-[10px]">
                    <span className="text-gray-500 w-20 truncate">{ch}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-purple-500" style={{ width: `${Math.min(data.count * 20, 100)}%` }} />
                    </div>
                    <span className="text-gray-600">{data.published}/{data.count}</span>
                    {data.revenue > 0 && <span className="text-green-400">{formatYen(data.revenue)}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* TOPコンテンツ */}
            {leverage.top_assets.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 mb-1">TOP コンテンツ</p>
                {leverage.top_assets.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] mb-0.5">
                    <span className="text-gray-600">#{i + 1}</span>
                    <span className="text-gray-400 flex-1 truncate">{a.title}</span>
                    <span className="text-purple-400">×{a.reuse}</span>
                    {a.revenue > 0 && <span className="text-green-400">{formatYen(a.revenue)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Run実績 */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
        <p className="text-xs font-semibold text-gray-400 mb-1">思考ループ</p>
        <div className="flex gap-3 text-xs text-gray-500">
          <span>全{runs.length}</span>
          <span className="text-green-400">完了{runs.filter(r => r.status === "done").length}</span>
          <span className="text-purple-400">思考{runs.filter(r => r.status === "thinking").length}</span>
        </div>
      </div>
    </div>
  );
}
