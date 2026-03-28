/**
 * 収益エンジン V8.5 — 増殖して稼ぐAI
 *
 * V8: 稼ぐ
 * V8.5: 成功を10倍にする
 *
 * スケールロジック: ROI>5 & success>60% → 横展開
 * 投資配分: 高ROI +50% / 低ROI -50%
 * ボトルネック検出: agent不足/コンテンツ不足/投稿頻度
 */

import { SupabaseClient } from "@supabase/supabase-js";

export type RevenueStream = {
  id: string;
  type: "blog" | "affiliate" | "sns" | "video" | "tool";
  name: string;
  status: "active" | "testing" | "stopped";
  monthly_revenue: number;
  total_revenue: number;
  growth_rate: number;
  roi: number;
  task_count: number;
  created_at: string;
};

export type BusinessScore = {
  revenue: number;
  scalability: number;
  repeatability: number;
  automation: number;
  total: number;
};

// ============================================================
// ビジネススコア計算
// ============================================================

export async function calculateBusinessScore(
  supabase: SupabaseClient,
  context: {
    expectedRevenue: number;
    revenueType: string;
    isRepeatable: boolean;
    taskCount: number;
  }
): Promise<BusinessScore> {
  // 同タイプの過去実績
  const { data: streams } = await supabase
    .from("revenue_streams")
    .select("*")
    .eq("type", context.revenueType)
    .eq("status", "active");

  const activeStreams = streams || [];
  const avgRevenue = activeStreams.length > 0
    ? activeStreams.reduce((s, r) => s + (r.monthly_revenue || 0), 0) / activeStreams.length
    : 0;

  // 収益性（0-100）: 期待収益を正規化
  const revenue = Math.min(context.expectedRevenue / 100, 100);

  // 拡張性（0-100）: 同タイプのactive streamsが多いほど実証済み
  const scalability = Math.min(activeStreams.length * 20 + (avgRevenue > 0 ? 30 : 0), 100);

  // 再現性（0-100）: 過去に同タイプで成功しているか
  const repeatability = context.isRepeatable
    ? Math.min(60 + activeStreams.length * 10, 100)
    : 30;

  // 自動化可能性（0-100）: タスク数が少ないほど自動化しやすい
  const automation = context.taskCount <= 3 ? 80 : context.taskCount <= 5 ? 60 : 40;

  const total = Math.round(
    revenue * 0.4 + scalability * 0.3 + repeatability * 0.2 + automation * 0.1
  );

  return { revenue: Math.round(revenue), scalability: Math.round(scalability), repeatability: Math.round(repeatability), automation: Math.round(automation), total };
}

// ============================================================
// 収益ストリーム管理
// ============================================================

export async function createRevenueStream(
  supabase: SupabaseClient,
  type: RevenueStream["type"],
  name: string
): Promise<RevenueStream | null> {
  const { data } = await supabase.from("revenue_streams").insert({
    type, name, status: "testing",
  }).select().single();
  return data as RevenueStream;
}

export async function updateStreamRevenue(
  supabase: SupabaseClient,
  streamId: string,
  newRevenue: number
) {
  const { data: stream } = await supabase.from("revenue_streams").select("*").eq("id", streamId).single();
  if (!stream) return;

  const totalRevenue = (stream.total_revenue || 0) + newRevenue;
  const taskCount = (stream.task_count || 0) + 1;
  const roi = totalRevenue / Math.max(taskCount, 1);

  // testing → active に昇格（収益が発生したら）
  const newStatus = stream.status === "testing" && newRevenue > 0 ? "active" : stream.status;

  await supabase.from("revenue_streams").update({
    monthly_revenue: newRevenue,
    total_revenue: totalRevenue,
    task_count: taskCount,
    roi,
    status: newStatus,
  }).eq("id", streamId);
}

// ============================================================
// CEO収益判断ロジック
// ============================================================

export async function ceoRevenueDecision(supabase: SupabaseClient): Promise<{
  action: "scale" | "stop" | "invest" | "test" | "hold";
  target: string;
  reason: string;
}[]> {
  const { data: streams } = await supabase.from("revenue_streams").select("*").order("roi", { ascending: false });
  const decisions: { action: "scale" | "stop" | "invest" | "test" | "hold"; target: string; reason: string }[] = [];

  for (const s of streams || []) {
    if (s.roi > 5 && s.status === "active") {
      decisions.push({ action: "scale", target: s.name, reason: `ROI ${s.roi.toFixed(1)}x → 横展開` });
    } else if (s.roi < 1 && s.task_count >= 3 && s.status !== "stopped") {
      decisions.push({ action: "stop", target: s.name, reason: `ROI ${s.roi.toFixed(1)}x, ${s.task_count}タスク消化 → 撤退` });
    } else if (s.growth_rate > 0.1 && s.status === "active") {
      decisions.push({ action: "invest", target: s.name, reason: `成長率${(s.growth_rate * 100).toFixed(0)}% → 追加投資` });
    } else if (s.status === "testing") {
      decisions.push({ action: "test", target: s.name, reason: "テスト中 → 継続観察" });
    }
  }

  // 新規機会がない場合
  if (decisions.length === 0) {
    decisions.push({ action: "test", target: "新規収益源", reason: "アクティブ戦略なし → 新規テスト推奨" });
  }

  return decisions;
}

// ============================================================
// 収益サマリー
// ============================================================

export async function getRevenueSummary(supabase: SupabaseClient) {
  const { data: streams } = await supabase.from("revenue_streams").select("*");
  const all = streams || [];
  const active = all.filter(s => s.status === "active");
  const testing = all.filter(s => s.status === "testing");

  const totalMonthly = active.reduce((s, r) => s + (r.monthly_revenue || 0), 0);
  const totalAll = all.reduce((s, r) => s + (r.total_revenue || 0), 0);
  const avgRoi = active.length > 0 ? active.reduce((s, r) => s + (r.roi || 0), 0) / active.length : 0;

  const byType: Record<string, { count: number; revenue: number }> = {};
  for (const s of all) {
    if (!byType[s.type]) byType[s.type] = { count: 0, revenue: 0 };
    byType[s.type].count++;
    byType[s.type].revenue += s.total_revenue || 0;
  }

  return {
    total_streams: all.length,
    active_streams: active.length,
    testing_streams: testing.length,
    monthly_revenue: totalMonthly,
    total_revenue: totalAll,
    avg_roi: Math.round(avgRoi * 100) / 100,
    by_type: byType,
  };
}

// ============================================================
// スケールエンジン（V8.5）
// ============================================================

const SCALE_NICHES = ["クレジットカード", "転職", "投資", "ガジェット", "副業", "プログラミング", "英語学習", "ダイエット", "旅行", "ペット"];

export type ScalePlan = {
  action: "scale" | "diversify" | "replicate" | "stop" | "optimize";
  stream_id: string;
  stream_name: string;
  details: string;
  expected_multiplier: number;
  tasks_to_generate: { content: string; priority: string; revenue_type: string }[];
};

export async function generateScalePlan(supabase: SupabaseClient): Promise<{
  plans: ScalePlan[];
  bottlenecks: string[];
  investment: { high_roi: number; mid_roi: number; low_roi: number };
}> {
  const { data: streams } = await supabase.from("revenue_streams").select("*").order("roi", { ascending: false });
  const { data: agents } = await supabase.from("agents").select("status, role");
  const { data: tasks } = await supabase.from("tasks").select("status").in("status", ["pending", "running"]);

  const all = streams || [];
  const plans: ScalePlan[] = [];

  // 投資配分計算
  const highRoi = all.filter(s => s.roi > 5 && s.status === "active");
  const midRoi = all.filter(s => s.roi >= 1 && s.roi <= 5);
  const lowRoi = all.filter(s => s.roi < 1 && s.status !== "stopped");
  const investment = {
    high_roi: highRoi.length > 0 ? 50 : 0,  // +50%
    mid_roi: midRoi.length > 0 ? 0 : 0,     // 維持
    low_roi: lowRoi.length > 0 ? -50 : 0,   // -50%
  };

  // SCALE: 高ROIストリームを横展開
  for (const s of highRoi) {
    // 使用済みニッチを除外
    const usedNiches = all.map(st => st.name);
    const availableNiches = SCALE_NICHES.filter(n => !usedNiches.some(u => u.includes(n)));
    const targetNiches = availableNiches.slice(0, 3);

    if (targetNiches.length > 0) {
      const tasks = targetNiches.map(niche => ({
        content: `${s.type === "blog" ? "SEO記事" : s.type}:${niche}`,
        priority: "high" as const,
        revenue_type: s.type,
      }));

      plans.push({
        action: "scale",
        stream_id: s.id,
        stream_name: s.name,
        details: `ROI ${s.roi.toFixed(1)}x → ${targetNiches.join("/")}に横展開`,
        expected_multiplier: Math.min(targetNiches.length, 3),
        tasks_to_generate: tasks,
      });
    }

    // 同ジャンル量産（10倍）
    plans.push({
      action: "replicate",
      stream_id: s.id,
      stream_name: s.name,
      details: `成功パターンを${Math.min(s.task_count * 2, 10)}件複製`,
      expected_multiplier: 2,
      tasks_to_generate: Array.from({ length: Math.min(s.task_count, 5) }, (_, i) => ({
        content: `[量産#${i + 1}] ${s.name}の派生コンテンツ`,
        priority: "medium" as const,
        revenue_type: s.type,
      })),
    });
  }

  // DIVERSIFY: 新ジャンルテスト
  const types: RevenueStream["type"][] = ["blog", "affiliate", "sns", "video", "tool"];
  const activeTypes = new Set(all.filter(s => s.status === "active").map(s => s.type));
  const missingTypes = types.filter(t => !activeTypes.has(t));

  if (missingTypes.length > 0 && all.length < 10) {
    const testType = missingTypes[0];
    plans.push({
      action: "diversify",
      stream_id: "",
      stream_name: `新規: ${testType}`,
      details: `未開拓の${testType}カテゴリをテスト`,
      expected_multiplier: 1,
      tasks_to_generate: [{ content: `${testType}収益化テスト`, priority: "medium", revenue_type: testType }],
    });
  }

  // STOP: 低ROIを停止
  for (const s of lowRoi) {
    if (s.task_count >= 3) {
      plans.push({
        action: "stop",
        stream_id: s.id,
        stream_name: s.name,
        details: `ROI ${s.roi.toFixed(1)}x, ${s.task_count}タスク消化済み → 撤退`,
        expected_multiplier: 0,
        tasks_to_generate: [],
      });
    }
  }

  // ボトルネック検出
  const bottlenecks: string[] = [];
  const idleAgents = (agents || []).filter(a => a.status === "idle").length;
  const runningAgents = (agents || []).filter(a => a.status === "running").length;
  const pendingTasks = (tasks || []).filter(t => t.status === "pending").length;
  const runningTasks = (tasks || []).filter(t => t.status === "running").length;

  if (idleAgents === 0 && pendingTasks > 3) {
    bottlenecks.push(`Agent不足: ${pendingTasks}タスク待機中、idle Agent 0人`);
  }
  if (runningAgents === 0) {
    bottlenecks.push("稼働Agent 0: 全員idle or error");
  }
  if (highRoi.length > 0 && pendingTasks < 3) {
    bottlenecks.push(`コンテンツ不足: 高ROIストリーム${highRoi.length}本あるがタスク${pendingTasks}件のみ`);
  }
  if (all.filter(s => s.status === "active").length < 2) {
    bottlenecks.push("収益分散不足: アクティブストリーム2未満");
  }

  return { plans, bottlenecks, investment };
}

// ============================================================
// スケールプラン実行（タスク生成）
// ============================================================

export async function executeScalePlan(
  supabase: SupabaseClient,
  plan: ScalePlan
): Promise<{ created: number; streamId: string | null }> {
  let streamId = plan.stream_id;

  // 新規ストリーム作成（diversify時）
  if (plan.action === "diversify" && !streamId) {
    const type = plan.tasks_to_generate[0]?.revenue_type || "blog";
    const stream = await createRevenueStream(supabase, type as RevenueStream["type"], plan.stream_name);
    if (stream) streamId = stream.id;
  }

  // STOP
  if (plan.action === "stop" && streamId) {
    await supabase.from("revenue_streams").update({ status: "stopped" }).eq("id", streamId);
    return { created: 0, streamId };
  }

  // タスク生成
  let created = 0;
  for (const t of plan.tasks_to_generate) {
    const { error } = await supabase.from("tasks").insert({
      content: t.content,
      priority: t.priority,
      status: "pending",
      revenue_type: t.revenue_type,
    });
    if (!error) created++;
  }

  // ストリームのタスクカウント更新
  if (streamId && created > 0) {
    const { data: s } = await supabase.from("revenue_streams").select("task_count").eq("id", streamId).single();
    if (s) {
      await supabase.from("revenue_streams").update({ task_count: (s.task_count || 0) + created }).eq("id", streamId);
    }
  }

  return { created, streamId };
}
