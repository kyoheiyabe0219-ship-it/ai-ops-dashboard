"use client";

import { Agent, Task, AgentRun, ThinkingIteration, Alert, KnowledgeMemory, DecisionMemory } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";

const DISPATCHER = "/api";

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  return `${Math.floor(s / 3600)}時間前`;
}

// 組織ツリーノード
function OrgNode({ agent, allAgents, tasks, alerts, depth = 0 }: {
  agent: Agent; allAgents: Agent[]; tasks: Task[]; alerts: Alert[]; depth?: number;
}) {
  const children = allAgents.filter(a => a.parent_id === agent.id);
  const agentTasks = tasks.filter(t => t.assigned_to === agent.id && t.status !== "done");
  const recentAlerts = alerts.filter(a => a.related_agent === agent.id).slice(0, 2);
  const stale = agent.status === "running" && Date.now() - new Date(agent.updated_at).getTime() > 30000;

  const roleBadge = agent.role === "ceo" ? "bg-purple-900 text-purple-300" : agent.role === "manager" ? "bg-blue-900 text-blue-300" : "bg-gray-700 text-gray-400";
  const statusIcon = agent.status === "running" ? "🟢" : agent.status === "error" ? "🔴" : agent.status === "idle" ? "⚪" : "🔵";
  const borderColor = stale ? "border-yellow-700" : agent.status === "error" ? "border-red-800" : agent.status === "running" ? "border-green-800" : "border-gray-800";

  return (
    <div className={`${depth > 0 ? "ml-4 border-l border-gray-800 pl-3" : ""}`}>
      <div className={`bg-gray-900 rounded-xl p-3 border ${borderColor} mb-2`}>
        <div className="flex items-center gap-2 mb-1">
          <span>{stale ? "⚠️" : statusIcon}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${roleBadge}`}>{agent.role.toUpperCase()}</span>
          <span className="text-sm font-medium flex-1 truncate">{agent.name}</span>
          <span className="text-[10px] text-gray-600">{agent.id}</span>
        </div>

        {agent.task && <p className="text-xs text-gray-400 truncate">{agent.task}</p>}

        {(agent.status === "running" || agent.status === "done") && (
          <div className="w-full bg-gray-800 rounded-full h-1.5 mt-1.5">
            <div className={`h-1.5 rounded-full transition-all duration-500 ${agent.status === "done" ? "bg-blue-500" : "bg-green-500"}`}
              style={{ width: `${agent.progress}%` }} />
          </div>
        )}

        {/* 割当タスク */}
        {agentTasks.length > 0 && (
          <div className="mt-2 space-y-1">
            {agentTasks.map(t => (
              <div key={t.id} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                <span>{t.status === "running" ? "⚡" : "⏳"}</span>
                <span className="truncate flex-1">{t.content}</span>
              </div>
            ))}
          </div>
        )}

        {/* アラート */}
        {recentAlerts.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {recentAlerts.map(a => (
              <div key={a.id} className="text-[10px] text-red-400">{a.type === "error" ? "🔴" : "🟡"} {a.title}</div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-gray-700 mt-1">{timeAgo(agent.updated_at)}</p>
      </div>

      {/* 子エージェント（再帰） */}
      {children.length > 0 && (
        <div>
          {children.map(child => (
            <OrgNode key={child.id} agent={child} allAgents={allAgents} tasks={tasks} alerts={alerts} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MonitorTab({
  agents, tasks, runs, alerts, onRefresh,
}: {
  agents: Agent[];
  tasks: Task[];
  runs: AgentRun[];
  alerts: Alert[];
  onRefresh: () => void;
}) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<{ iterations: ThinkingIteration[] } | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeMemory[]>([]);
  const [decisions, setDecisions] = useState<DecisionMemory[]>([]);

  const loadRunDetail = useCallback(async (runId: string) => {
    if (expandedRun === runId) { setExpandedRun(null); return; }
    setExpandedRun(runId);
    const res = await fetch(`${DISPATCHER}/runs/${runId}`);
    const data = await res.json();
    setRunDetail({ iterations: data.iterations || [] });
  }, [expandedRun]);

  // メモリ読み込み + 自動リフレッシュ（10秒ごと）
  const loadMemory = useCallback(async () => {
    const [kRes, dRes] = await Promise.all([
      fetch("/api/memory?type=all&limit=10").then(r => r.json()).catch(() => ({ knowledge: [], decisions: [] })),
      Promise.resolve(null),
    ]);
    if (kRes.knowledge) setKnowledge(kRes.knowledge);
    if (kRes.decisions) setDecisions(kRes.decisions);
  }, []);

  useEffect(() => {
    loadMemory();
    const interval = setInterval(() => { onRefresh(); loadMemory(); }, 10000);
    return () => clearInterval(interval);
  }, [onRefresh, loadMemory]);

  // ルートエージェント（parent_idなし or CEO）
  const roots = agents.filter(a => !a.parent_id || a.role === "ceo");
  const orphans = agents.filter(a => a.parent_id && !agents.find(p => p.id === a.parent_id));

  // アクティブRun
  const activeRuns = runs.filter(r => ["thinking", "awaiting_approval", "executing"].includes(r.status));

  return (
    <div className="space-y-4">
      {/* ヘッダーサマリー */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="bg-gray-900 px-2.5 py-1 rounded-full border border-gray-800">
          🤖 {agents.length}
        </span>
        <span className="bg-gray-900 px-2.5 py-1 rounded-full border border-green-900 text-green-400">
          {agents.filter(a => a.status === "running").length} 稼働
        </span>
        <span className="bg-gray-900 px-2.5 py-1 rounded-full border border-gray-800">
          📌 {tasks.filter(t => t.status === "running").length} 実行中
        </span>
        <span className="bg-gray-900 px-2.5 py-1 rounded-full border border-purple-900 text-purple-400">
          🔄 {activeRuns.length} Run
        </span>
      </div>

      {/* 組織ツリー */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">組織構造</p>
        {roots.length === 0 && orphans.length === 0 && (
          <p className="text-gray-600 text-center py-4 text-sm">エージェントなし</p>
        )}
        {roots.map(agent => (
          <OrgNode key={agent.id} agent={agent} allAgents={agents} tasks={tasks} alerts={alerts} />
        ))}
        {orphans.map(agent => (
          <OrgNode key={agent.id} agent={agent} allAgents={agents} tasks={tasks} alerts={alerts} />
        ))}
      </div>

      {/* アクティブRun（実行ログ） */}
      {activeRuns.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">思考ループ</p>
          <div className="space-y-2">
            {activeRuns.map(run => {
              const isExpanded = expandedRun === run.id;
              const statusCfg: Record<string, { icon: string; color: string }> = {
                thinking: { icon: "🔄", color: "text-purple-400" },
                awaiting_approval: { icon: "⏳", color: "text-yellow-400" },
                executing: { icon: "⚡", color: "text-blue-400" },
              };
              const cfg = statusCfg[run.status] || { icon: "🔄", color: "text-gray-400" };

              return (
                <div key={run.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                  <button onClick={() => loadRunDetail(run.id)} className="w-full text-left p-3">
                    <div className="flex items-center gap-2">
                      <span>{cfg.icon}</span>
                      <span className="text-sm font-medium flex-1 truncate">{run.title}</span>
                      <span className={`text-[10px] ${cfg.color}`}>{run.status}</span>
                    </div>
                    <div className="flex gap-3 mt-1 text-[10px] text-gray-600">
                      <span>#{run.current_iteration}/{run.max_iterations}</span>
                      <span>ベスト: {run.best_score}点</span>
                      <span>目標: {run.dynamic_target_score}点</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1 mt-1.5">
                      <div className="h-1 rounded-full bg-purple-500 transition-all" style={{ width: `${run.best_score}%` }} />
                    </div>
                  </button>

                  {isExpanded && runDetail && (
                    <div className="border-t border-gray-800 p-3 space-y-2">
                      {runDetail.iterations.map(it => (
                        <div key={it.id} className="bg-gray-800 rounded-lg p-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">#{it.iteration}</span>
                            <span className={`font-bold ${it.reached_target ? "text-green-400" : (it.score || 0) >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                              {it.score ?? "?"}点
                            </span>
                            <span className="text-gray-600">/ {it.dynamic_target_score}点</span>
                            {it.reached_target && <span className="text-green-500">✓</span>}
                            <span className="text-gray-700">{it.duration_ms}ms</span>
                          </div>
                          {it.improvements && <p className="text-yellow-600 mt-1 text-[10px]">{it.improvements}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* メモリ（AI OSの記憶） */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">🧠 メモリ</p>
        <div className="grid grid-cols-2 gap-2">
          {/* 成功戦略 */}
          <div className="bg-gray-900 rounded-xl p-3 border border-green-900/30">
            <p className="text-[10px] text-green-400 font-medium mb-1.5">成功戦略</p>
            {knowledge.filter(k => k.type === "strategy").length === 0 && (
              <p className="text-[10px] text-gray-600">蓄積なし</p>
            )}
            {knowledge.filter(k => k.type === "strategy").slice(0, 3).map(k => (
              <p key={k.id} className="text-[10px] text-gray-400 truncate mb-0.5">{k.content}</p>
            ))}
          </div>

          {/* 失敗パターン */}
          <div className="bg-gray-900 rounded-xl p-3 border border-red-900/30">
            <p className="text-[10px] text-red-400 font-medium mb-1.5">失敗パターン</p>
            {knowledge.filter(k => k.type === "failure").length === 0 && (
              <p className="text-[10px] text-gray-600">蓄積なし</p>
            )}
            {knowledge.filter(k => k.type === "failure").slice(0, 3).map(k => (
              <p key={k.id} className="text-[10px] text-gray-400 truncate mb-0.5">{k.content}</p>
            ))}
          </div>
        </div>

        {/* 直近の意思決定 */}
        {decisions.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-gray-500 mb-1">直近の判断</p>
            {decisions.slice(0, 5).map(d => (
              <div key={d.id} className="flex items-center gap-1.5 text-[10px] mb-0.5">
                <span className={d.success_flag ? "text-green-500" : d.success_flag === false ? "text-red-500" : "text-gray-600"}>
                  {d.success_flag ? "✓" : d.success_flag === false ? "✗" : "○"}
                </span>
                <span className="text-gray-500 truncate">{d.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
