/**
 * 自律ループエンジン v2
 *
 * 成功パターン学習 + モード分岐 + 構造ベース横展開
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { runIteration, executeApprovedRun } from "./thinking-engine";
import { updatePatterns, getExpansionCandidates, calculateRoiTrend } from "./pattern-engine";

type Config = {
  enabled: boolean;
  mode: "safe" | "aggressive";
  auto_mode_switch: boolean;
  roi_switch_up_threshold: number;
  roi_switch_down_threshold: number;
  max_parallel_runs: number;
  max_total_tasks: number;
  max_auto_gen_per_hour: number;
  max_per_pattern_per_hour: number;
  auto_approve_min_effective: number;
  auto_approve_min_roi: number;
  auto_approve_min_success_rate: number;
  agent_spawn_threshold: number;
  agent_kill_threshold: number;
};

// モード別パラメータ
const MODE_PARAMS = {
  safe:       { maxRunsPerCycle: 1, minRoiForGen: 5, approveStrictness: 1.0 },
  aggressive: { maxRunsPerCycle: 3, minRoiForGen: 2, approveStrictness: 0.7 },
};

type ActionLog = { action: string; detail: string; status: "ok" | "skip" | "error" };

export async function runAutonomousCycle(supabase: SupabaseClient) {
  const start = Date.now();
  const actions: ActionLog[] = [];
  let runsCreated = 0, tasksGenerated = 0, agentsSpawned = 0, agentsKilled = 0, autoApproved = 0;

  const { data: cfgRow } = await supabase.from("autonomous_config").select("*").eq("id", "default").single();
  const cfg: Config = cfgRow || {
    enabled: false, mode: "safe", auto_mode_switch: true,
    roi_switch_up_threshold: 5, roi_switch_down_threshold: 2,
    max_parallel_runs: 10, max_total_tasks: 50, max_auto_gen_per_hour: 20,
    max_per_pattern_per_hour: 3,
    auto_approve_min_effective: 5, auto_approve_min_roi: 5,
    auto_approve_min_success_rate: 0.6,
    agent_spawn_threshold: 10, agent_kill_threshold: 0.3,
  };

  if (!cfg.enabled) {
    return { actions: [{ action: "skip", detail: "Autonomous mode disabled", status: "skip" as const }], runs_created: 0, tasks_generated: 0, agents_spawned: 0, agents_killed: 0, auto_approved: 0, duration_ms: Date.now() - start, mode: cfg.mode };
  }

  const modeParams = MODE_PARAMS[cfg.mode] || MODE_PARAMS.safe;
  actions.push({ action: "mode", detail: `${cfg.mode.toUpperCase()} モードで実行`, status: "ok" });

  // ガードレール
  const { data: activeRuns } = await supabase.from("agent_runs").select("id").in("status", ["thinking", "executing"]);
  const runsAtLimit = (activeRuns || []).length >= cfg.max_parallel_runs;

  const { data: allTasks } = await supabase.from("tasks").select("id").in("status", ["pending", "running"]);
  const tasksAtLimit = (allTasks || []).length >= cfg.max_total_tasks;

  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { data: recentLogs } = await supabase.from("autonomous_logs").select("runs_created, tasks_generated").gte("created_at", oneHourAgo);
  const hourlyGenerated = (recentLogs || []).reduce((s, l) => s + (l.runs_created || 0) + (l.tasks_generated || 0), 0);
  const genBudget = cfg.max_auto_gen_per_hour - hourlyGenerated;

  // ============================================================
  // ① パターン更新（フィードバックループ）
  // ============================================================
  try {
    const patternResult = await updatePatterns(supabase);
    if (patternResult.success > 0 || patternResult.failure > 0) {
      actions.push({ action: "pattern_update", detail: `成功${patternResult.success} / 失敗${patternResult.failure}パターン更新`, status: "ok" });
    }
  } catch (e) {
    actions.push({ action: "pattern_error", detail: e instanceof Error ? e.message : "error", status: "error" });
  }

  // ============================================================
  // ② 自動承認
  // ============================================================
  try {
    const { data: pendingApprovals } = await supabase.from("approval_requests").select("id, run_id").eq("status", "pending");

    for (const approval of pendingApprovals || []) {
      const { data: run } = await supabase.from("agent_runs").select("effective_score, estimated_roi, success_rate").eq("id", approval.run_id).single();
      if (!run) continue;

      const threshold = cfg.auto_approve_min_effective * modeParams.approveStrictness;
      const meetsEffective = (run.effective_score || 0) >= threshold;
      const meetsRoi = (run.estimated_roi || 0) >= cfg.auto_approve_min_roi;
      const meetsSuccess = (run.success_rate || 0) >= cfg.auto_approve_min_success_rate;

      if (meetsEffective || (meetsRoi && meetsSuccess)) {
        await supabase.from("approval_requests").update({ status: "approved", responded_at: new Date().toISOString() }).eq("id", approval.id);
        await supabase.from("agent_runs").update({ status: "approved" }).eq("id", approval.run_id);

        try {
          const result = await executeApprovedRun(supabase, approval.run_id);
          tasksGenerated += result.created;
          actions.push({ action: "auto_approve", detail: `Run → ${result.created}タスク (閾値${threshold.toFixed(1)})`, status: "ok" });
        } catch (e) {
          actions.push({ action: "auto_execute_fail", detail: e instanceof Error ? e.message : "error", status: "error" });
        }
        autoApproved++;
      }
    }
  } catch (e) {
    actions.push({ action: "approve_error", detail: e instanceof Error ? e.message : "error", status: "error" });
  }

  // ============================================================
  // ③ パターンベース横展開（核心）
  // ============================================================
  if (genBudget > 0 && !tasksAtLimit && !runsAtLimit) {
    try {
      const candidates = await getExpansionCandidates(supabase, cfg.max_per_pattern_per_hour);
      const maxRuns = Math.min(modeParams.maxRunsPerCycle, genBudget, candidates.length);

      for (let i = 0; i < maxRuns; i++) {
        const c = candidates[i];
        if (c.avg_roi < modeParams.minRoiForGen) continue;

        const { data: newRun } = await supabase.from("agent_runs").insert({
          title: `[自動/${cfg.mode}] ${c.task_type}横展開`,
          goal: `成功パターン「${c.task_type}」（ROI ${c.avg_roi.toFixed(1)}x, 成功率${(c.success_rate * 100).toFixed(0)}%）を別切り口で展開。元: "${c.sample}"`,
          expected_value: Math.round(c.avg_roi * 1000),
          estimated_cost: 1000,
          role: "quick",
          status: "thinking",
          created_by: "autonomous",
        }).select("id").single();

        if (newRun) {
          try {
            await runIteration(supabase, newRun.id);
            runsCreated++;
            actions.push({ action: "expand_pattern", detail: `${c.task_type} (ROI ${c.avg_roi.toFixed(1)}x, 成功${(c.success_rate * 100).toFixed(0)}%)`, status: "ok" });
          } catch (e) {
            actions.push({ action: "expand_fail", detail: e instanceof Error ? e.message : "error", status: "error" });
          }
        }
      }

      if (candidates.length === 0) {
        actions.push({ action: "expand", detail: "展開可能な成功パターンなし", status: "skip" });
      }
    } catch (e) {
      actions.push({ action: "expand_error", detail: e instanceof Error ? e.message : "error", status: "error" });
    }
  }

  // ============================================================
  // ④ thinking中Run進行
  // ============================================================
  try {
    const { data: thinkingRuns } = await supabase.from("agent_runs").select("id").eq("status", "thinking").order("created_at", { ascending: true }).limit(3);
    for (const run of thinkingRuns || []) {
      try {
        await runIteration(supabase, run.id);
        actions.push({ action: "iterate", detail: `Run ${run.id.substring(0, 8)}...`, status: "ok" });
      } catch (e) {
        actions.push({ action: "iterate_fail", detail: e instanceof Error ? e.message : "error", status: "error" });
      }
    }
  } catch (e) {
    actions.push({ action: "iterate_error", detail: e instanceof Error ? e.message : "error", status: "error" });
  }

  // ============================================================
  // ⑤ エージェント増殖/削減
  // ============================================================
  try {
    const { data: recentDone } = await supabase.from("agent_runs").select("effective_score").eq("status", "done").order("updated_at", { ascending: false }).limit(3);
    if (recentDone && recentDone.length >= 3 && recentDone.every(r => (r.effective_score || 0) >= cfg.agent_spawn_threshold)) {
      const { data: agents } = await supabase.from("agents").select("id");
      const newId = `AUTO_${(agents || []).length + 1}`;
      await supabase.from("agents").upsert({ id: newId, name: `自動生成AI #${(agents || []).length + 1}`, status: "idle", task: "", progress: 0 }, { onConflict: "id" });
      agentsSpawned++;
      actions.push({ action: "spawn_agent", detail: newId, status: "ok" });
    }
  } catch { /* skip */ }

  try {
    const { data: agents } = await supabase.from("agents").select("id, name, status");
    for (const agent of agents || []) {
      const { data: agentTasks } = await supabase.from("tasks").select("status").eq("assigned_to", agent.id).order("created_at", { ascending: false }).limit(10);
      if (!agentTasks || agentTasks.length < 5) continue;
      const rate = agentTasks.filter(t => t.status === "done").length / agentTasks.length;
      if (rate < cfg.agent_kill_threshold && agent.status !== "running") {
        await supabase.from("agents").update({ status: "idle", task: "[自律停止]" }).eq("id", agent.id);
        agentsKilled++;
        actions.push({ action: "kill_agent", detail: `${agent.name} (${(rate * 100).toFixed(0)}%)`, status: "ok" });
      }
    }
  } catch { /* skip */ }

  // ============================================================
  // ⑥ 優先度自動調整
  // ============================================================
  try {
    await supabase.from("tasks").update({ priority: "high" }).eq("status", "pending").gt("roi", 5).neq("priority", "high");
    await supabase.from("tasks").update({ priority: "low" }).eq("status", "pending").lt("roi", 1).neq("priority", "low");
    actions.push({ action: "priority", detail: "ROIベース調整", status: "ok" });
  } catch { /* skip */ }

  // ============================================================
  // ⑦ 自動モード切替
  // ============================================================
  if (cfg.auto_mode_switch) {
    try {
      const trend = await calculateRoiTrend(supabase);
      let newMode = cfg.mode;

      if (trend.recent_avg_roi >= cfg.roi_switch_up_threshold && cfg.mode === "safe") {
        newMode = "aggressive";
      } else if (trend.recent_avg_roi <= cfg.roi_switch_down_threshold && cfg.mode === "aggressive") {
        newMode = "safe";
      }

      if (newMode !== cfg.mode) {
        await supabase.from("autonomous_config").update({ mode: newMode }).eq("id", "default");
        actions.push({ action: "mode_switch", detail: `${cfg.mode} → ${newMode} (ROIトレンド: ${trend.recent_avg_roi.toFixed(1)}x ${trend.trend})`, status: "ok" });
      } else {
        actions.push({ action: "mode_check", detail: `${cfg.mode}維持 (ROI ${trend.recent_avg_roi.toFixed(1)}x ${trend.trend})`, status: "ok" });
      }
    } catch { /* skip */ }
  }

  const durationMs = Date.now() - start;

  // ログ保存
  const { data: lastLog } = await supabase.from("autonomous_logs").select("cycle").order("created_at", { ascending: false }).limit(1);
  const cycle = ((lastLog as { cycle: number }[] | null)?.[0]?.cycle || 0) + 1;

  await supabase.from("autonomous_logs").insert({
    cycle, actions_taken: actions, runs_created: runsCreated, tasks_generated: tasksGenerated,
    agents_spawned: agentsSpawned, agents_killed: agentsKilled, auto_approved: autoApproved, duration_ms: durationMs,
  });

  return { actions, runs_created: runsCreated, tasks_generated: tasksGenerated, agents_spawned: agentsSpawned, agents_killed: agentsKilled, auto_approved: autoApproved, duration_ms: durationMs, mode: cfg.mode };
}
