/**
 * 自動意思決定エンジン
 *
 * 4つのルールを評価し、判断を実行 → decision_logs に記録
 * 30秒ごとにスケジューラーから呼ばれる
 */

module.exports = function createDecisionEngine(supabase, { createAlert, autoAssign }) {

  async function logDecision({ type, reason, target, meta }) {
    const { data, error } = await supabase
      .from("decision_logs")
      .insert({ type, reason, target, meta: meta || {} })
      .select()
      .single();
    if (error) console.error("[Decision] Log error:", error.message);
    return data;
  }

  // ============================================================
  // ルール①: スケールアップ（高ROIタスク連続3回 → 同種タスク+2生成）
  // ============================================================
  async function ruleScaleUp() {
    const actions = [];

    const { data: recentDone } = await supabase
      .from("tasks")
      .select("*")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(10);

    if (!recentDone || recentDone.length < 3) return actions;

    // 直近3件が全てROI > 5 かチェック
    const top3 = recentDone.slice(0, 3);
    const allHighRoi = top3.every((t) => (t.roi || 0) > 5);

    if (!allHighRoi) return actions;

    // 直近1時間に同ルールで生成済みか確認（重複防止）
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: recentDecisions } = await supabase
      .from("decision_logs")
      .select("id")
      .eq("type", "scale_up")
      .gte("created_at", oneHourAgo)
      .limit(1);

    if (recentDecisions && recentDecisions.length > 0) return actions;

    // 最高ROIタスクを元に2件生成
    const baseTask = top3[0];
    for (let i = 0; i < 2; i++) {
      const { data: newTask } = await supabase
        .from("tasks")
        .insert({
          content: `[自動生成] ${baseTask.content} #${i + 1}`,
          priority: "high",
          status: "pending",
          expected_value: baseTask.expected_value || 0,
          cost: baseTask.cost || 0,
        })
        .select()
        .single();

      if (newTask) {
        await autoAssign(newTask.id);
      }
    }

    const avgRoi = (top3.reduce((s, t) => s + (t.roi || 0), 0) / 3).toFixed(1);
    const decision = await logDecision({
      type: "scale_up",
      reason: `直近3タスクの平均ROI=${avgRoi}x (>5)。同種タスクを2件自動生成`,
      target: baseTask.content,
      meta: { base_task_id: baseTask.id, avg_roi: parseFloat(avgRoi), generated: 2 },
    });

    await createAlert({
      type: "info",
      title: `🧠 スケールアップ: +2タスク生成`,
      message: `ROI ${avgRoi}x の「${baseTask.content}」を増産`,
    });

    actions.push(decision);
    return actions;
  }

  // ============================================================
  // ルール②: スケールダウン（低ROIタスク連続3回 → priority=low）
  // ============================================================
  async function ruleScaleDown() {
    const actions = [];

    const { data: recentDone } = await supabase
      .from("tasks")
      .select("*")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(10);

    if (!recentDone || recentDone.length < 3) return actions;

    const top3 = recentDone.slice(0, 3);
    const allLowRoi = top3.every((t) => (t.roi || 0) < 1 && (t.roi || 0) >= 0);

    if (!allLowRoi) return actions;

    // 同種のpendingタスクをlowに変更
    const { data: pendingTasks } = await supabase
      .from("tasks")
      .select("id, content, priority")
      .eq("status", "pending")
      .neq("priority", "low");

    if (!pendingTasks || pendingTasks.length === 0) return actions;

    const downgraded = [];
    for (const task of pendingTasks) {
      await supabase
        .from("tasks")
        .update({ priority: "low" })
        .eq("id", task.id);
      downgraded.push(task.id);
    }

    if (downgraded.length === 0) return actions;

    const avgRoi = (top3.reduce((s, t) => s + (t.roi || 0), 0) / 3).toFixed(1);
    const decision = await logDecision({
      type: "scale_down",
      reason: `直近3タスクの平均ROI=${avgRoi}x (<1)。待機中${downgraded.length}件をlow優先度に変更`,
      target: `${downgraded.length} tasks`,
      meta: { avg_roi: parseFloat(avgRoi), downgraded_ids: downgraded },
    });

    await createAlert({
      type: "warning",
      title: `🧠 スケールダウン: ${downgraded.length}件をlow化`,
      message: `低ROI (${avgRoi}x) が続いたため優先度を下げました`,
    });

    actions.push(decision);
    return actions;
  }

  // ============================================================
  // ルール③: 再割り振り（処理時間が平均の2倍 → 別エージェントに再assign）
  // ============================================================
  async function ruleReassign() {
    const actions = [];

    // 完了タスクから平均処理時間を算出
    const { data: doneTasks } = await supabase
      .from("tasks")
      .select("created_at, updated_at")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (!doneTasks || doneTasks.length < 3) return actions;

    const durations = doneTasks.map((t) =>
      new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()
    );
    const avgDuration = durations.reduce((s, d) => s + d, 0) / durations.length;
    const threshold = avgDuration * 2;

    // running中で閾値超過のタスクを検出
    const { data: runningTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("status", "running");

    if (!runningTasks) return actions;

    const now = Date.now();
    for (const task of runningTasks) {
      const elapsed = now - new Date(task.created_at).getTime();
      if (elapsed <= threshold) continue;
      if (!task.assigned_to) continue;

      // 別のidleエージェントを探す
      const { data: idleAgents } = await supabase
        .from("agents")
        .select("id, name")
        .eq("status", "idle")
        .neq("id", task.assigned_to)
        .limit(1);

      if (!idleAgents || idleAgents.length === 0) continue;

      const newAgent = idleAgents[0];
      const oldAgent = task.assigned_to;

      await supabase
        .from("tasks")
        .update({ assigned_to: newAgent.id })
        .eq("id", task.id);

      const decision = await logDecision({
        type: "reassign",
        reason: `処理時間 ${Math.round(elapsed / 1000)}秒 (平均${Math.round(avgDuration / 1000)}秒の${(elapsed / avgDuration).toFixed(1)}倍)。${oldAgent}→${newAgent.id}に再割当`,
        target: task.id,
        meta: { task_content: task.content, elapsed_sec: Math.round(elapsed / 1000), avg_sec: Math.round(avgDuration / 1000), from: oldAgent, to: newAgent.id },
      });

      await createAlert({
        type: "info",
        title: `🧠 タスク再割当`,
        message: `「${task.content}」を${newAgent.name}に移管 (${Math.round(elapsed / 1000)}秒超過)`,
        related_task: task.id,
        related_agent: newAgent.id,
      });

      actions.push(decision);
    }

    return actions;
  }

  // ============================================================
  // ルール④: 停止（同一エージェント3回連続error → idle化）
  // ============================================================
  async function ruleStop() {
    const actions = [];

    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, status");

    if (!agents) return actions;

    for (const agent of agents) {
      // 直近のアラートを確認
      const { data: errorAlerts } = await supabase
        .from("alerts")
        .select("id, created_at")
        .eq("type", "error")
        .eq("related_agent", agent.id)
        .order("created_at", { ascending: false })
        .limit(3);

      if (!errorAlerts || errorAlerts.length < 3) continue;

      // 直近3件が1時間以内か
      const oneHourAgo = Date.now() - 3600000;
      const allRecent = errorAlerts.every(
        (a) => new Date(a.created_at).getTime() > oneHourAgo
      );

      if (!allRecent) continue;

      // 既にstop判定済みか（重複防止）
      const { data: recentStops } = await supabase
        .from("decision_logs")
        .select("id")
        .eq("type", "stop")
        .eq("target", agent.id)
        .gte("created_at", new Date(oneHourAgo).toISOString())
        .limit(1);

      if (recentStops && recentStops.length > 0) continue;

      // エージェントをidle（強制停止）に
      await supabase
        .from("agents")
        .update({ status: "idle", task: "[自動停止] エラー連続", progress: 0 })
        .eq("id", agent.id);

      // 割当タスクをpendingに戻して再割り振り
      const { data: assignedTasks } = await supabase
        .from("tasks")
        .select("id")
        .eq("assigned_to", agent.id)
        .in("status", ["pending", "running"]);

      for (const t of assignedTasks || []) {
        await supabase
          .from("tasks")
          .update({ assigned_to: null, status: "pending" })
          .eq("id", t.id);
        await autoAssign(t.id);
      }

      const decision = await logDecision({
        type: "stop",
        reason: `1時間以内にエラー3回連続。強制idle化 + タスク${(assignedTasks || []).length}件を再割当`,
        target: agent.id,
        meta: { agent_name: agent.name, reassigned_tasks: (assignedTasks || []).length },
      });

      await createAlert({
        type: "error",
        title: `🧠 ${agent.name} を自動停止`,
        message: `エラー3回連続のため強制idle化。タスクは再割当済み`,
        related_agent: agent.id,
      });

      actions.push(decision);
    }

    return actions;
  }

  // ============================================================
  // 全ルール実行
  // ============================================================
  async function runAll() {
    const results = { scale_up: [], scale_down: [], reassign: [], stop: [], errors: [] };

    const rules = [
      { name: "scale_up", fn: ruleScaleUp },
      { name: "scale_down", fn: ruleScaleDown },
      { name: "reassign", fn: ruleReassign },
      { name: "stop", fn: ruleStop },
    ];

    for (const rule of rules) {
      try {
        const actions = await rule.fn();
        results[rule.name] = actions;
        if (actions.length > 0) {
          console.log(`[Decision] ${rule.name}: ${actions.length} action(s)`);
        }
      } catch (err) {
        console.error(`[Decision] ${rule.name} error:`, err.message);
        results.errors.push({ rule: rule.name, error: err.message });
      }
    }

    return results;
  }

  return { runAll, ruleScaleUp, ruleScaleDown, ruleReassign, ruleStop, logDecision };
};
