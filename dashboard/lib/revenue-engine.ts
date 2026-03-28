/**
 * 収益エンジン V8 — 稼ぎ続けるAI
 *
 * 戦略生成 → コンテンツ作成 → 投稿 → 収益発生 → ログ → memory → 次戦略
 *
 * business_score = revenue×0.4 + scalability×0.3 + repeatability×0.2 + automation×0.1
 * final_score = decision×0.3 + goal×0.3 + business×0.4
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
