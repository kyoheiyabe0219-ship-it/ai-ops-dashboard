"use client";

import { Agent, Task, AgentRun, ThinkingIteration, Alert, KnowledgeMemory, DecisionMemory, CeoAlgorithm, MetaLog, GoalFunction } from "@/lib/supabase";
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
  const [simpleMode, setSimpleMode] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<{ iterations: ThinkingIteration[] } | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeMemory[]>([]);
  const [decisions, setDecisions] = useState<DecisionMemory[]>([]);
  const [commands, setCommands] = useState<{ strategy: string | null; constraints: string[]; goal: string | null; raw_input: string; created_at: string }[]>([]);
  const [algorithm, setAlgorithm] = useState<CeoAlgorithm | null>(null);
  const [metaLogs, setMetaLogs] = useState<MetaLog[]>([]);
  const [algoProposal, setAlgoProposal] = useState<{ shouldUpdate: boolean; reason: string; proposed: Partial<CeoAlgorithm> | null } | null>(null);
  const [goal, setGoal] = useState<GoalFunction | null>(null);
  const [goalProposal, setGoalProposal] = useState<{ shouldUpdate: boolean; reason: string; proposed: Partial<GoalFunction> | null } | null>(null);

  const loadRunDetail = useCallback(async (runId: string) => {
    if (expandedRun === runId) { setExpandedRun(null); return; }
    setExpandedRun(runId);
    const res = await fetch(`${DISPATCHER}/runs/${runId}`);
    const data = await res.json();
    setRunDetail({ iterations: data.iterations || [] });
  }, [expandedRun]);

  // メモリ読み込み + 自動リフレッシュ（10秒ごと）
  const loadMemory = useCallback(async () => {
    const [kRes, algoRes, goalRes, cmdRes] = await Promise.all([
      fetch("/api/memory?type=all&limit=10").then(r => r.json()).catch(() => ({ knowledge: [], decisions: [] })),
      fetch("/api/algorithm").then(r => r.json()).catch(() => null),
      fetch("/api/goal").then(r => r.json()).catch(() => null),
      fetch("/api/commands").then(r => r.json()).catch(() => []),
    ]);
    if (Array.isArray(cmdRes)) setCommands(cmdRes);
    if (kRes.knowledge) setKnowledge(kRes.knowledge);
    if (kRes.decisions) setDecisions(kRes.decisions);
    if (algoRes) {
      setAlgorithm(algoRes.current || null);
      setMetaLogs(algoRes.meta_logs || []);
      setAlgoProposal(algoRes.proposal || null);
    }
    if (goalRes) {
      setGoal(goalRes.current || null);
      setGoalProposal(goalRes.proposal || null);
    }
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
      {/* モード切替 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{simpleMode ? "シンプル" : "詳細"}モード</p>
        <button onClick={() => setSimpleMode(!simpleMode)}
          className="text-[10px] bg-gray-800 text-gray-400 px-2.5 py-1 rounded-lg hover:text-white transition">
          {simpleMode ? "詳細を表示 →" : "← シンプル"}
        </button>
      </div>

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

      {/* 直近の構造化指示（詳細モードのみ） */}
      {!simpleMode && commands.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">📝 指示解釈</p>
          {commands.slice(0, 3).map((cmd, i) => (
            <div key={i} className="bg-gray-900 rounded-lg px-3 py-2 border border-gray-800 mb-1.5 text-[10px]">
              <p className="text-gray-400 mb-1">「{cmd.raw_input.substring(0, 40)}」</p>
              <div className="flex flex-wrap gap-2">
                {cmd.strategy && <span className="bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">戦略: {cmd.strategy}</span>}
                {(cmd.constraints || []).map((c, j) => <span key={j} className="bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">制約: {c}</span>)}
                {cmd.goal && <span className="bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded">目標: {cmd.goal}</span>}
                {!cmd.strategy && (cmd.constraints || []).length === 0 && !cmd.goal && <span className="text-gray-600">自由判断</span>}
              </div>
            </div>
          ))}
        </div>
      )}

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

      {/* メモリ（V4: 進化型） */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">🧠 メモリ（進化型）</p>

        {/* 記憶一覧（weight順） */}
        <div className="space-y-1.5">
          {knowledge.length === 0 && <p className="text-[10px] text-gray-600 text-center py-3">記憶なし</p>}
          {knowledge.filter(k => k.is_active !== false).map(k => {
            const w = k.weight || 1;
            const isBlocked = k.type === "failure" && w > 0.7;
            const isPriority = k.type === "strategy" && w > 1.5;
            const isForced = k.type === "improvement" && w > 1.2;
            const isDying = w < 0.5;

            const borderColor = isBlocked ? "border-red-700" : isPriority ? "border-green-700" : isForced ? "border-blue-700" : isDying ? "border-gray-700 opacity-50" : "border-gray-800";
            const typeIcon = k.type === "strategy" ? "⭐" : k.type === "failure" ? "🚫" : k.type === "improvement" ? "💡" : "📝";
            const badge = isBlocked ? "🔴禁止" : isPriority ? "⭐推奨" : isForced ? "✅必須" : isDying ? "💀減衰" : null;

            return (
              <div key={k.id} className={`flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 border ${borderColor}`}>
                <span className="text-xs">{typeIcon}</span>
                <span className="flex-1 text-[10px] text-gray-400 truncate">{k.content}</span>
                {badge && <span className="text-[9px] shrink-0">{badge}</span>}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="w-10 bg-gray-800 rounded-full h-1">
                    <div className={`h-1 rounded-full ${w > 1.5 ? "bg-green-500" : w > 0.7 ? "bg-blue-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(w / 3 * 100, 100)}%` }} />
                  </div>
                  <span className="text-[9px] text-gray-600 w-6 text-right">{w.toFixed(1)}</span>
                </div>
              </div>
            );
          })}
        </div>

      {/* Goal Function（詳細モードのみ） */}
      {!simpleMode && goal && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">🎯 目的関数 v{goal.version}</p>
          <div className="bg-gray-900 rounded-xl p-3 border border-blue-900/30 space-y-2">
            <div className="flex gap-1 h-5">
              {[
                { label: "短期", w: goal.short_term_weight, color: "bg-orange-500" },
                { label: "長期", w: goal.long_term_weight, color: "bg-blue-500" },
                { label: "学習", w: goal.learning_weight, color: "bg-green-500" },
                { label: "安定", w: goal.stability_weight, color: "bg-gray-500" },
              ].map(g => (
                <div key={g.label} className={`${g.color} flex items-center justify-center rounded`} style={{ width: `${g.w * 100}%` }}>
                  <span className="text-[8px] text-white font-medium">{g.label} {(g.w * 100).toFixed(0)}%</span>
                </div>
              ))}
              <div className="bg-red-500 flex items-center justify-center rounded" style={{ width: `${goal.risk_weight * 100}%` }}>
                <span className="text-[8px] text-white">-Risk {(goal.risk_weight * 100).toFixed(0)}%</span>
              </div>
            </div>

            {goalProposal?.shouldUpdate && goalProposal.proposed && (
              <div className="bg-blue-950/50 border border-blue-800 rounded-lg p-2">
                <p className="text-[10px] text-blue-400 font-medium mb-1">🎯 目的関数の進化提案</p>
                <p className="text-[10px] text-gray-400 mb-1">{goalProposal.reason}</p>
                <button onClick={async () => {
                  await fetch("/api/goal", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ proposed: goalProposal.proposed }),
                  });
                  loadMemory();
                }} className="bg-blue-800 text-blue-200 text-[10px] px-2 py-1 rounded hover:bg-blue-700">✅ 適用</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CEO Brain（詳細モードのみ） */}
      {!simpleMode && algorithm && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">🧬 CEO Brain v{algorithm.version}</p>
          <div className="bg-gray-900 rounded-xl p-3 border border-purple-900/30 space-y-2">
            {/* スコアリングweights */}
            <div>
              <p className="text-[10px] text-gray-500 mb-1">スコア配分</p>
              <div className="flex gap-1 h-4">
                <div className="bg-blue-600 rounded-l" style={{ width: `${algorithm.scoring_weights.ai * 100}%` }}>
                  <span className="text-[8px] text-white px-1">AI {(algorithm.scoring_weights.ai * 100).toFixed(0)}%</span>
                </div>
                <div className="bg-green-600" style={{ width: `${algorithm.scoring_weights.memory * 100}%` }}>
                  <span className="text-[8px] text-white px-1">Mem {(algorithm.scoring_weights.memory * 100).toFixed(0)}%</span>
                </div>
                <div className="bg-purple-600 rounded-r" style={{ width: `${algorithm.scoring_weights.decision * 100}%` }}>
                  <span className="text-[8px] text-white px-1">Dec {(algorithm.scoring_weights.decision * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>

            {/* Explore */}
            <div className="flex gap-3 text-[10px] text-gray-500">
              <span>探索率: {(algorithm.explore_rules.base_rate * 100).toFixed(0)}%</span>
              <span>停滞時: {(algorithm.explore_rules.stagnation_rate * 100).toFixed(0)}%</span>
              <span>失敗時: {(algorithm.explore_rules.failure_rate * 100).toFixed(0)}%</span>
            </div>

            {/* 改善提案 */}
            {algoProposal?.shouldUpdate && algoProposal.proposed && (
              <div className="bg-yellow-950/50 border border-yellow-800 rounded-lg p-2 mt-2">
                <p className="text-[10px] text-yellow-400 font-medium mb-1">⚡ アルゴリズム改善提案</p>
                <p className="text-[10px] text-gray-400 mb-2">{algoProposal.reason}</p>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    await fetch("/api/algorithm", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "apply", proposed: algoProposal.proposed }),
                    });
                    loadMemory();
                  }}
                    className="bg-green-800 text-green-200 text-[10px] px-2 py-1 rounded transition hover:bg-green-700">✅ 適用</button>
                  <button onClick={async () => {
                    await fetch("/api/algorithm", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "rollback" }),
                    });
                    loadMemory();
                  }}
                    className="bg-gray-800 text-gray-400 text-[10px] px-2 py-1 rounded transition hover:bg-gray-700">↩ ロールバック</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* メタログ（詳細モードのみ） */}
      {!simpleMode && metaLogs.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-500 mb-1">自己評価</p>
          {metaLogs.slice(0, 3).map(m => (
            <div key={m.id} className={`flex items-start gap-1.5 text-[10px] mb-1 ${m.outcome === "success" ? "text-green-600" : "text-red-600"}`}>
              <span>{m.outcome === "success" ? "✓" : "✗"}</span>
              <div className="flex-1">
                <span className="text-gray-500">{m.original_decision}</span>
                {m.improvement_suggestion && <p className="text-gray-600 text-[9px]">→ {m.improvement_suggestion}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

        {/* 判断履歴（詳細モードのみ） */}
        {!simpleMode && decisions.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-gray-500 mb-1">判断進化</p>
            {decisions.slice(0, 5).map(d => {
              const conf = d.confidence || 0.5;
              return (
                <div key={d.id} className="flex items-center gap-1.5 text-[10px] mb-1">
                  <span className={d.success_flag ? "text-green-500" : d.success_flag === false ? "text-red-500" : "text-gray-600"}>
                    {d.success_flag ? "✓" : d.success_flag === false ? "✗" : "○"}
                  </span>
                  <span className="text-gray-500 truncate flex-1">{d.reason}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="w-8 bg-gray-800 rounded-full h-1">
                      <div className={`h-1 rounded-full ${conf > 0.7 ? "bg-green-500" : conf > 0.4 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${conf * 100}%` }} />
                    </div>
                    <span className="text-[9px] text-gray-600">{conf.toFixed(1)}</span>
                    {(d.reuse_count || 0) > 0 && <span className="text-[9px] text-purple-500">×{d.reuse_count}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
