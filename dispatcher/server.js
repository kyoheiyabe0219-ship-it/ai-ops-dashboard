const express = require("express");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "../.env" });

const wordpress = require("./platforms/wordpress");
const affiliate = require("./platforms/affiliate");
const createDecisionEngine = require("./decision-engine");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// アラート生成ヘルパー
// ============================================================

async function createAlert({ type, title, message, related_agent, related_task }) {
  const { data, error } = await supabase
    .from("alerts")
    .insert({ type, title, message: message || "", related_agent: related_agent || null, related_task: related_task || null })
    .select()
    .single();
  if (error) console.error("Alert create error:", error.message);
  return data;
}

// ============================================================
// エージェント API
// ============================================================

app.post("/update", async (req, res) => {
  const { agent_id, name, status, task, progress } = req.body;

  if (!agent_id) {
    return res.status(400).json({ error: "agent_id is required" });
  }

  // 前回の状態を取得（アラート判定用）
  const { data: prev } = await supabase
    .from("agents")
    .select("status, name")
    .eq("id", agent_id)
    .single();

  const { data, error } = await supabase
    .from("agents")
    .upsert(
      {
        id: agent_id,
        name: name || agent_id,
        status: status || "idle",
        task: task || "",
        progress: progress ?? 0,
      },
      { onConflict: "id" }
    )
    .select();

  if (error) {
    console.error("Supabase error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  // 自動アラート: error 遷移
  if (status === "error" && prev?.status !== "error") {
    await createAlert({
      type: "error",
      title: `${name || agent_id} がエラー`,
      message: task || "不明なエラー",
      related_agent: agent_id,
    });
  }

  // 自動アラート: error → 復帰
  if (prev?.status === "error" && status && status !== "error") {
    await createAlert({
      type: "success",
      title: `${name || prev.name || agent_id} が復帰`,
      message: `${prev.status} → ${status}`,
      related_agent: agent_id,
    });
  }

  res.json({ ok: true, agent: data[0] });
});

app.get("/agents", async (_req, res) => {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// ============================================================
// タスク API
// ============================================================

const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };

async function autoAssign(taskId) {
  const { data: idleAgents } = await supabase
    .from("agents")
    .select("id, name")
    .eq("status", "idle");

  if (!idleAgents || idleAgents.length === 0) return null;

  const { data: runningTasks } = await supabase
    .from("tasks")
    .select("assigned_to")
    .eq("status", "running");

  const taskCounts = {};
  (runningTasks || []).forEach((t) => {
    taskCounts[t.assigned_to] = (taskCounts[t.assigned_to] || 0) + 1;
  });

  idleAgents.sort(
    (a, b) => (taskCounts[a.id] || 0) - (taskCounts[b.id] || 0)
  );
  const chosen = idleAgents[0];

  await supabase
    .from("tasks")
    .update({ assigned_to: chosen.id })
    .eq("id", taskId);

  return chosen;
}

async function getNextPendingTask(agentId) {
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("assigned_to", agentId)
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("roi", { ascending: false })
    .order("created_at", { ascending: true });

  if (!data || data.length === 0) return null;

  data.sort((a, b) => {
    const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (pw !== 0) return pw;
    const roiDiff = (b.roi || 0) - (a.roi || 0);
    if (roiDiff !== 0) return roiDiff;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  return data[0];
}

app.post("/task", async (req, res) => {
  const { content, priority, assigned_to, expected_value, cost } = req.body;

  if (!content) {
    return res.status(400).json({ error: "content is required" });
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      content,
      priority: priority || "medium",
      assigned_to: assigned_to || null,
      status: "pending",
      expected_value: expected_value || 0,
      cost: cost || 0,
    })
    .select()
    .single();

  if (error) {
    console.error("Task create error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  let assignedAgent = null;
  if (!assigned_to) {
    assignedAgent = await autoAssign(data.id);
    if (assignedAgent) {
      const { data: updated } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", data.id)
        .single();
      return res.json({
        ok: true,
        task: updated,
        assigned_agent: assignedAgent,
      });
    }
  }

  res.json({ ok: true, task: data, assigned_agent: assignedAgent });
});

app.get("/tasks", async (req, res) => {
  let query = supabase.from("tasks").select("*");

  if (req.query.status) {
    query = query.eq("status", req.query.status);
  }
  if (req.query.assigned_to) {
    query = query.eq("assigned_to", req.query.assigned_to);
  }

  if (req.query.sort === "roi") {
    query = query.order("roi", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

app.get("/tasks/next/:agent_id", async (req, res) => {
  const task = await getNextPendingTask(req.params.agent_id);
  if (!task) {
    return res.json({ ok: true, task: null });
  }
  res.json({ ok: true, task });
});

app.patch("/task/:id", async (req, res) => {
  const { id } = req.params;
  const { status, assigned_to, actual_value, cost } = req.body;

  // 完了前のタスクを取得（アラート用）
  let prevTask = null;
  if (status === "done") {
    const { data } = await supabase.from("tasks").select("*").eq("id", id).single();
    prevTask = data;
  }

  const updates = {};
  if (status) updates.status = status;
  if (assigned_to !== undefined) updates.assigned_to = assigned_to;
  if (actual_value !== undefined) updates.actual_value = actual_value;
  if (cost !== undefined) updates.cost = cost;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Task update error:", error.message);
    return res.status(500).json({ error: error.message });
  }

  // 自動アラート: 高ROIタスク完了（ROI > 5）
  if (status === "done" && data.roi > 5) {
    await createAlert({
      type: "success",
      title: `高ROIタスク完了 (${data.roi.toFixed(1)}x)`,
      message: data.content,
      related_task: id,
      related_agent: data.assigned_to,
    });
  }

  res.json({ ok: true, task: data });
});

app.get("/stats", async (_req, res) => {
  const { data, error } = await supabase.from("tasks").select("*");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const doneTasks = data.filter((t) => t.status === "done");
  const totalExpected = data.reduce((s, t) => s + (t.expected_value || 0), 0);
  const totalActual = doneTasks.reduce((s, t) => s + (t.actual_value || 0), 0);
  const totalCost = doneTasks.reduce((s, t) => s + (t.cost || 0), 0);
  const avgRoi =
    doneTasks.length > 0
      ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length
      : 0;

  res.json({
    total_tasks: data.length,
    done_tasks: doneTasks.length,
    total_expected: totalExpected,
    total_actual: totalActual,
    total_cost: totalCost,
    avg_roi: Math.round(avgRoi * 100) / 100,
    net_profit: totalActual - totalCost,
  });
});

app.post("/task/:id/assign", async (req, res) => {
  const { id } = req.params;
  const { agent_id } = req.body;

  if (agent_id) {
    const { data, error } = await supabase
      .from("tasks")
      .update({ assigned_to: agent_id })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, task: data });
  }

  const assigned = await autoAssign(id);
  if (!assigned) {
    return res.json({ ok: false, message: "No idle agents available" });
  }

  const { data } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .single();
  res.json({ ok: true, task: data, assigned_agent: assigned });
});

// ============================================================
// マネタイゼーション API
// ============================================================

app.post("/execute-monetization", async (req, res) => {
  const { task_id, platform } = req.body;

  if (!task_id || !platform) {
    return res.status(400).json({ error: "task_id and platform are required" });
  }

  try {
    let result;

    if (platform === "wordpress") {
      if (!wordpress.isConfigured()) {
        return res.status(400).json({ error: "WordPress未設定" });
      }

      const { title, content, wp_status, affiliate: affData } = req.body;
      let finalContent = content || "";
      if (affData && affiliate.isConfigured()) {
        finalContent += "\n" + affiliate.generateAffiliateBlock(affData);
      }

      const post = await wordpress.createPost({
        title: title || "自動投稿",
        content: finalContent,
        status: wp_status || "draft",
      });

      result = { external_id: String(post.id), external_url: post.url, meta: { wp_status: post.status } };
    } else if (platform === "affiliate") {
      if (!affiliate.isConfigured()) {
        return res.status(400).json({ error: "アフィリエイト未設定" });
      }

      const { affiliate: affData } = req.body;
      const html = affiliate.generateAffiliateBlock(affData);
      result = { external_id: null, external_url: null, meta: { html, affiliate_data: affData } };
    } else {
      return res.status(400).json({ error: `未対応プラットフォーム: ${platform}` });
    }

    const revenue = req.body.revenue || 0;
    const { data: log, error: logError } = await supabase
      .from("monetization_logs")
      .insert({
        task_id, platform, revenue, status: "success",
        external_id: result.external_id, external_url: result.external_url, meta: result.meta,
      })
      .select()
      .single();

    if (logError) {
      console.error("Monetization log error:", logError.message);
      return res.status(500).json({ error: logError.message });
    }

    if (revenue > 0) {
      const { data: task } = await supabase.from("tasks").select("actual_value").eq("id", task_id).single();
      const newValue = (task?.actual_value || 0) + revenue;
      await supabase.from("tasks").update({ actual_value: newValue }).eq("id", task_id);
    }

    res.json({ ok: true, log, result });
  } catch (err) {
    console.error("Monetization error:", err.message);
    await supabase.from("monetization_logs").insert({
      task_id, platform, revenue: 0, status: "failed", meta: { error: err.message },
    });
    res.status(500).json({ error: err.message });
  }
});

app.get("/monetization-logs", async (req, res) => {
  let query = supabase.from("monetization_logs").select("*");
  if (req.query.platform) query = query.eq("platform", req.query.platform);
  if (req.query.task_id) query = query.eq("task_id", req.query.task_id);
  if (req.query.status) query = query.eq("status", req.query.status);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/monetization-stats", async (_req, res) => {
  const { data, error } = await supabase.from("monetization_logs").select("*").eq("status", "success");
  if (error) return res.status(500).json({ error: error.message });

  const byPlatform = {};
  let totalRevenue = 0;
  (data || []).forEach((log) => {
    if (!byPlatform[log.platform]) byPlatform[log.platform] = { count: 0, revenue: 0 };
    byPlatform[log.platform].count++;
    byPlatform[log.platform].revenue += log.revenue || 0;
    totalRevenue += log.revenue || 0;
  });

  res.json({ total_revenue: totalRevenue, total_executions: (data || []).length, by_platform: byPlatform });
});

app.get("/platforms", (_req, res) => {
  res.json({
    wordpress: { configured: wordpress.isConfigured(), description: "WordPress記事投稿" },
    affiliate: { configured: affiliate.isConfigured(), description: "アフィリエイトリンク生成" },
  });
});

// ============================================================
// アラート API
// ============================================================

// GET /alerts — アラート一覧（フィルタ対応）
app.get("/alerts", async (req, res) => {
  let query = supabase.from("alerts").select("*");

  if (req.query.is_read === "true") query = query.eq("is_read", true);
  if (req.query.is_read === "false") query = query.eq("is_read", false);
  if (req.query.type) query = query.eq("type", req.query.type);
  if (req.query.related_agent) query = query.eq("related_agent", req.query.related_agent);

  const limit = parseInt(req.query.limit) || 50;
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /alerts/:id/read — 既読にする
app.patch("/alerts/:id/read", async (req, res) => {
  const { data, error } = await supabase
    .from("alerts")
    .update({ is_read: true })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, alert: data });
});

// POST /alerts/read-all — 全既読
app.post("/alerts/read-all", async (_req, res) => {
  const { error } = await supabase
    .from("alerts")
    .update({ is_read: true })
    .eq("is_read", false);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /health — ヘルスサマリー
app.get("/health", async (_req, res) => {
  const { data: agents } = await supabase.from("agents").select("*");
  const { data: tasks } = await supabase.from("tasks").select("*");
  const { data: unreadAlerts } = await supabase.from("alerts").select("id").eq("is_read", false);

  const agentList = agents || [];
  const taskList = tasks || [];
  const total = agentList.length || 1;
  const running = agentList.filter((a) => a.status === "running").length;
  const errored = agentList.filter((a) => a.status === "error").length;
  const stale = agentList.filter((a) => {
    const ago = Date.now() - new Date(a.updated_at).getTime();
    return ago > 30000 && a.status === "running";
  });

  const doneTasks = taskList.filter((t) => t.status === "done");
  const avgRoi = doneTasks.length > 0
    ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length
    : 0;

  res.json({
    uptime_pct: Math.round((running / total) * 100),
    running,
    idle: agentList.filter((a) => a.status === "idle").length,
    errored,
    stale_agents: stale.map((a) => a.id),
    active_tasks: taskList.filter((t) => t.status === "running").length,
    pending_tasks: taskList.filter((t) => t.status === "pending").length,
    avg_roi: Math.round(avgRoi * 100) / 100,
    unread_alerts: (unreadAlerts || []).length,
    total_agents: agentList.length,
  });
});

// ============================================================
// Heartbeat モニター（15秒ごとにチェック）
// ============================================================

const HEARTBEAT_TIMEOUT = 30000; // 30秒
const alerted = new Set(); // 重複アラート防止

setInterval(async () => {
  try {
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, status, updated_at")
      .eq("status", "running");

    if (!agents) return;

    const now = Date.now();
    for (const agent of agents) {
      const elapsed = now - new Date(agent.updated_at).getTime();
      if (elapsed > HEARTBEAT_TIMEOUT && !alerted.has(agent.id)) {
        alerted.add(agent.id);
        await createAlert({
          type: "warning",
          title: `${agent.name} のハートビート停止`,
          message: `最終更新: ${Math.round(elapsed / 1000)}秒前`,
          related_agent: agent.id,
        });
        console.log(`[Heartbeat] Alert: ${agent.name} (${Math.round(elapsed / 1000)}s)`);
      }
      // 復帰したらalertedから除去
      if (elapsed <= HEARTBEAT_TIMEOUT && alerted.has(agent.id)) {
        alerted.delete(agent.id);
      }
    }
  } catch (err) {
    console.error("[Heartbeat] Error:", err.message);
  }
}, 15000);

// ============================================================
// 自動意思決定エンジン
// ============================================================

const decisionEngine = createDecisionEngine(supabase, { createAlert, autoAssign });

// POST /auto-decision/run — 手動実行
app.post("/auto-decision/run", async (_req, res) => {
  try {
    const results = await decisionEngine.runAll();
    const totalActions =
      results.scale_up.length +
      results.scale_down.length +
      results.reassign.length +
      results.stop.length;
    res.json({ ok: true, total_actions: totalActions, results });
  } catch (err) {
    console.error("[Decision] Manual run error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /decision-logs — 判断ログ一覧
app.get("/decision-logs", async (req, res) => {
  let query = supabase.from("decision_logs").select("*");

  if (req.query.type) query = query.eq("type", req.query.type);

  const limit = parseInt(req.query.limit) || 50;
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /decision-stats — 判断サマリー
app.get("/decision-stats", async (_req, res) => {
  const { data, error } = await supabase.from("decision_logs").select("*");
  if (error) return res.status(500).json({ error: error.message });

  const byType = {};
  (data || []).forEach((d) => {
    byType[d.type] = (byType[d.type] || 0) + 1;
  });

  res.json({ total: (data || []).length, by_type: byType });
});

// スケジューラー: 30秒ごとに自動実行
const DECISION_INTERVAL = 30000;
setInterval(async () => {
  try {
    const results = await decisionEngine.runAll();
    const total =
      results.scale_up.length +
      results.scale_down.length +
      results.reassign.length +
      results.stop.length;
    if (total > 0) {
      console.log(`[Decision] Auto-run: ${total} action(s)`);
    }
  } catch (err) {
    console.error("[Decision] Scheduler error:", err.message);
  }
}, DECISION_INTERVAL);

const PORT = process.env.DISPATCHER_PORT || 3001;
app.listen(PORT, () => {
  console.log(`Dispatcher API running on http://localhost:${PORT}`);
  console.log(`Platforms: WordPress=${wordpress.isConfigured() ? "✓" : "✗"} Affiliate=${affiliate.isConfigured() ? "✓" : "✗"}`);
  console.log(`Heartbeat monitor: every 15s (timeout: ${HEARTBEAT_TIMEOUT / 1000}s)`);
  console.log(`Decision engine: every ${DECISION_INTERVAL / 1000}s`);
});
