/**
 * 自律ループエンジン
 *
 * 1分ごとに実行:
 * 1. 収益分析 → 高パフォーマンスパターン抽出
 * 2. 類似タスク/AgentRun自動生成
 * 3. 自動承認（条件満たせば人間不要）
 * 4. フィードバック（success_rate更新）
 * 5. エージェント増殖/削減
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { runIteration, executeApprovedRun } from "./thinking-engine";

type Config = {
  enabled: boolean;
  max_parallel_runs: number;
  max_total_tasks: number;
  max_auto_gen_per_hour: number;
  auto_approve_min_effective: number;
  auto_approve_min_roi: number;
  auto_approve_min_success_rate: number;
  agent_spawn_threshold: number;
  agent_kill_threshold: number;
};

type ActionLog = { action: string; detail: string; status: "ok" | "skip" | "error" };

export async function runAutonomousCycle(supabase: SupabaseClient): Promise<{
  actions: ActionLog[];
  runs_created: number;
  tasks_generated: number;
  agents_spawned: number;
  agents_killed: number;
  auto_approved: number;
  duration_ms: number;
}> {
  const start = Date.now();
  const actions: ActionLog[] = [];
  let runsCreated = 0, tasksGenerated = 0, agentsSpawned = 0, agentsKilled = 0, autoApproved = 0;

  // 設定取得
  const { data: cfgRow } = await supabase.from("autonomous_config").select("*").eq("id", "default").single();
  const cfg: Config = cfgRow || { enabled: false, max_parallel_runs: 10, max_total_tasks: 50, max_auto_gen_per_hour: 20, auto_approve_min_effective: 5, auto_approve_min_roi: 5, auto_approve_min_success_rate: 0.6, agent_spawn_threshold: 10, agent_kill_threshold: 0.3 };

  if (!cfg.enabled) {
    return { actions: [{ action: "skip", detail: "Autonomous mode disabled", status: "skip" }], runs_created: 0, tasks_generated: 0, agents_spawned: 0, agents_killed: 0, auto_approved: 0, duration_ms: Date.now() - start };
  }

  // ============================================================
  // ① ガードレール確認
  // ============================================================
  const { data: activeRuns } = await supabase.from("agent_runs").select("id").in("status", ["thinking", "executing"]);
  if ((activeRuns || []).length >= cfg.max_parallel_runs) {
    actions.push({ action: "guard", detail: `並列Run上限 ${cfg.max_parallel_runs} 到達`, status: "skip" });
    // 自動承認だけは引き続き実行
  }

  const { data: allTasks } = await supabase.from("tasks").select("id").in("status", ["pending", "running"]);
  const taskGuard = (allTasks || []).length >= cfg.max_total_tasks;
  if (taskGuard) {
    actions.push({ action: "guard", detail: `タスク上限 ${cfg.max_total_tasks} 到達`, status: "skip" });
  }

  // 1時間内の自動生成数チェック
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { data: recentLogs } = await supabase.from("autonomous_logs").select("runs_created, tasks_generated").gte("created_at", oneHourAgo);
  const hourlyGenerated = (recentLogs || []).reduce((s, l) => s + (l.runs_created || 0) + (l.tasks_generated || 0), 0);
  const genBudget = cfg.max_auto_gen_per_hour - hourlyGenerated;

  // ============================================================
  // ② 自動承認（常に実行）
  // ============================================================
  try {
    const { data: pendingApprovals } = await supabase
      .from("approval_requests")
      .select("id, run_id, plan")
      .eq("status", "pending");

    for (const approval of pendingApprovals || []) {
      const { data: run } = await supabase.from("agent_runs").select("effective_score, estimated_roi, success_rate").eq("id", approval.run_id).single();
      if (!run) continue;

      const meetsEffective = (run.effective_score || 0) >= cfg.auto_approve_min_effective;
      const meetsRoi = (run.estimated_roi || 0) >= cfg.auto_approve_min_roi;
      const meetsSuccess = (run.success_rate || 0) >= cfg.auto_approve_min_success_rate;

      if (meetsEffective || (meetsRoi && meetsSuccess)) {
        await supabase.from("approval_requests").update({ status: "approved", responded_at: new Date().toISOString() }).eq("id", approval.id);
        await supabase.from("agent_runs").update({ status: "approved" }).eq("id", approval.run_id);

        // 即座に実行
        try {
          const result = await executeApprovedRun(supabase, approval.run_id);
          tasksGenerated += result.created;
          actions.push({ action: "auto_approve+execute", detail: `Run ${approval.run_id.substring(0, 8)}... → ${result.created}タスク生成`, status: "ok" });
        } catch (e) {
          actions.push({ action: "auto_execute_fail", detail: e instanceof Error ? e.message : "error", status: "error" });
        }
        autoApproved++;
      }
    }
  } catch (e) {
    actions.push({ action: "auto_approve_error", detail: e instanceof Error ? e.message : "error", status: "error" });
  }

  // ============================================================
  // ③ 高パフォーマンスタスク分析 → AgentRun自動生成
  // ============================================================
  if (genBudget > 0 && !taskGuard && (activeRuns || []).length < cfg.max_parallel_runs) {
    try {
      const { data: topTasks } = await supabase
        .from("tasks")
        .select("content, roi, expected_value, cost, status")
        .eq("status", "done")
        .gt("roi", 3)
        .order("roi", { ascending: false })
        .limit(5);

      if (topTasks && topTasks.length > 0) {
        // 最高ROIタスクを元にRun生成（最大2件/サイクル）
        const toGenerate = Math.min(2, genBudget);
        for (let i = 0; i < toGenerate && i < topTasks.length; i++) {
          const base = topTasks[i];
          const { data: newRun } = await supabase.from("agent_runs").insert({
            title: `[自動] ${base.content}の拡張`,
            goal: `「${base.content}」（ROI ${base.roi?.toFixed(1)}x）の成功パターンを横展開し、類似タスクを3件生成する`,
            expected_value: base.expected_value || 0,
            estimated_cost: base.cost || 1,
            role: "quick",
            status: "thinking",
            created_by: "autonomous",
          }).select("id").single();

          if (newRun) {
            // 初回イテレーション実行
            try {
              await runIteration(supabase, newRun.id);
              runsCreated++;
              actions.push({ action: "create_run", detail: `「${base.content}」ベースでRun生成 (ROI ${base.roi?.toFixed(1)}x)`, status: "ok" });
            } catch (e) {
              actions.push({ action: "iterate_fail", detail: e instanceof Error ? e.message : "error", status: "error" });
            }
          }
        }
      } else {
        actions.push({ action: "analyze", detail: "高ROIタスクなし（ROI > 3）", status: "skip" });
      }
    } catch (e) {
      actions.push({ action: "analyze_error", detail: e instanceof Error ? e.message : "error", status: "error" });
    }
  }

  // ============================================================
  // ④ thinking中のRunを1イテレーション進める
  // ============================================================
  try {
    const { data: thinkingRuns } = await supabase
      .from("agent_runs")
      .select("id")
      .eq("status", "thinking")
      .order("created_at", { ascending: true })
      .limit(3);

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
  // ⑤ エージェント自己増殖
  // ============================================================
  try {
    const { data: recentDone } = await supabase.from("agent_runs").select("effective_score").eq("status", "done").order("updated_at", { ascending: false }).limit(3);
    if (recentDone && recentDone.length >= 3 && recentDone.every(r => (r.effective_score || 0) >= cfg.agent_spawn_threshold)) {
      const { data: agents } = await supabase.from("agents").select("id");
      const newId = `AUTO_${(agents || []).length + 1}`;
      await supabase.from("agents").upsert({ id: newId, name: `自動生成AI #${(agents || []).length + 1}`, status: "idle", task: "", progress: 0 }, { onConflict: "id" });
      agentsSpawned++;
      actions.push({ action: "spawn_agent", detail: `${newId} を生成（実効スコア3連続 >= ${cfg.agent_spawn_threshold}）`, status: "ok" });
    }
  } catch (e) {
    actions.push({ action: "spawn_error", detail: e instanceof Error ? e.message : "error", status: "error" });
  }

  // ============================================================
  // ⑥ エージェント削減
  // ============================================================
  try {
    const { data: agents } = await supabase.from("agents").select("id, name, status");
    for (const agent of agents || []) {
      const { data: agentTasks } = await supabase.from("tasks").select("status").eq("assigned_to", agent.id).order("created_at", { ascending: false }).limit(10);
      if (!agentTasks || agentTasks.length < 5) continue;
      const doneCount = agentTasks.filter(t => t.status === "done").length;
      const rate = doneCount / agentTasks.length;
      if (rate < cfg.agent_kill_threshold && agent.status !== "running") {
        await supabase.from("agents").update({ status: "idle", task: "[自律停止] 低成功率" }).eq("id", agent.id);
        agentsKilled++;
        actions.push({ action: "kill_agent", detail: `${agent.name} (成功率 ${(rate * 100).toFixed(0)}% < ${cfg.agent_kill_threshold * 100}%)`, status: "ok" });
      }
    }
  } catch (e) {
    actions.push({ action: "kill_error", detail: e instanceof Error ? e.message : "error", status: "error" });
  }

  // ============================================================
  // ⑦ 優先度自動調整
  // ============================================================
  try {
    // 高ROI pending → high
    await supabase.from("tasks").update({ priority: "high" }).eq("status", "pending").gt("roi", 5).neq("priority", "high");
    // 低ROI pending → low
    await supabase.from("tasks").update({ priority: "low" }).eq("status", "pending").lt("roi", 1).neq("priority", "low");
    actions.push({ action: "priority_adjust", detail: "ROIベース優先度調整", status: "ok" });
  } catch (e) {
    actions.push({ action: "priority_error", detail: e instanceof Error ? e.message : "error", status: "error" });
  }

  const durationMs = Date.now() - start;

  // ログ保存
  const { data: lastLog } = await supabase.from("autonomous_logs").select("cycle").order("created_at", { ascending: false }).limit(1);
  const cycle = ((lastLog as { cycle: number }[] | null)?.[0]?.cycle || 0) + 1;

  await supabase.from("autonomous_logs").insert({
    cycle,
    actions_taken: actions,
    runs_created: runsCreated,
    tasks_generated: tasksGenerated,
    agents_spawned: agentsSpawned,
    agents_killed: agentsKilled,
    auto_approved: autoApproved,
    duration_ms: durationMs,
  });

  return { actions, runs_created: runsCreated, tasks_generated: tasksGenerated, agents_spawned: agentsSpawned, agents_killed: agentsKilled, auto_approved: autoApproved, duration_ms: durationMs };
}
