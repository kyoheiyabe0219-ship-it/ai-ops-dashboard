/**
 * 成功/失敗パターンエンジン
 *
 * 完了タスクからパターンを抽出・統計更新・横展開制御
 */

import { SupabaseClient } from "@supabase/supabase-js";

// タスク内容からタイプを推定（キーワードベース）
const TYPE_KEYWORDS: Record<string, string[]> = {
  youtube_script: ["youtube", "動画", "台本", "スクリプト"],
  blog_article:  ["ブログ", "記事", "SEO", "コンテンツ"],
  sns_content:   ["SNS", "Twitter", "Instagram", "TikTok", "投稿"],
  market_research: ["リサーチ", "調査", "分析", "競合"],
  ad_copy:       ["広告", "コピー", "LP", "ランディング"],
  email:         ["メール", "メルマガ", "ニュースレター"],
  product:       ["商品", "プロダクト", "サービス"],
};

export function classifyTaskType(content: string): string {
  const lower = content.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) return type;
  }
  return "general";
}

/**
 * 完了タスクからパターンを抽出・更新
 */
export async function updatePatterns(supabase: SupabaseClient): Promise<{ success: number; failure: number }> {
  const { data: doneTasks } = await supabase
    .from("tasks")
    .select("id, content, status, roi, actual_value, expected_value, cost")
    .eq("status", "done")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (!doneTasks || doneTasks.length === 0) return { success: 0, failure: 0 };

  // タイプ別に集計
  const byType: Record<string, { success: number; total: number; rois: number[]; revenue: number; sample: string }> = {};

  for (const task of doneTasks) {
    const type = classifyTaskType(task.content);
    if (!byType[type]) byType[type] = { success: 0, total: 0, rois: [], revenue: 0, sample: task.content };

    byType[type].total++;
    byType[type].rois.push(task.roi || 0);
    byType[type].revenue += task.actual_value || 0;

    const isSuccess = (task.actual_value || 0) > 0 || (task.roi || 0) > 1;
    if (isSuccess) byType[type].success++;
  }

  let successUpdated = 0, failureUpdated = 0;

  for (const [type, stats] of Object.entries(byType)) {
    const successRate = stats.total > 0 ? stats.success / stats.total : 0;
    const avgRoi = stats.rois.length > 0 ? stats.rois.reduce((a, b) => a + b, 0) / stats.rois.length : 0;

    if (successRate >= 0.5 && avgRoi > 1) {
      // 成功パターンとして upsert
      const { data: existing } = await supabase.from("success_patterns").select("id").eq("task_type", type).limit(1);

      if (existing && existing.length > 0) {
        await supabase.from("success_patterns").update({
          success_count: stats.success, total_count: stats.total,
          success_rate: Math.round(successRate * 100) / 100,
          avg_roi: Math.round(avgRoi * 100) / 100,
          total_revenue: stats.revenue,
          sample_content: stats.sample,
          updated_at: new Date().toISOString(),
        }).eq("id", existing[0].id);
      } else {
        await supabase.from("success_patterns").insert({
          task_type: type,
          pattern: { keywords: TYPE_KEYWORDS[type] || [], sample: stats.sample },
          sample_content: stats.sample,
          success_count: stats.success, total_count: stats.total,
          success_rate: Math.round(successRate * 100) / 100,
          avg_roi: Math.round(avgRoi * 100) / 100,
          total_revenue: stats.revenue,
        });
      }
      successUpdated++;
    }

    if (successRate < 0.3 && stats.total >= 3) {
      // 失敗パターン
      const { data: existing } = await supabase.from("failure_patterns").select("id").eq("task_type", type).limit(1);

      if (existing && existing.length > 0) {
        await supabase.from("failure_patterns").update({
          failure_count: stats.total - stats.success, total_count: stats.total,
          failure_rate: Math.round((1 - successRate) * 100) / 100,
          avg_roi: Math.round(avgRoi * 100) / 100,
          blocked: successRate < 0.2,
        }).eq("id", existing[0].id);
      } else {
        await supabase.from("failure_patterns").insert({
          task_type: type,
          pattern: { keywords: TYPE_KEYWORDS[type] || [] },
          failure_count: stats.total - stats.success, total_count: stats.total,
          failure_rate: Math.round((1 - successRate) * 100) / 100,
          avg_roi: Math.round(avgRoi * 100) / 100,
          blocked: successRate < 0.2,
        });
      }
      failureUpdated++;
    }
  }

  return { success: successUpdated, failure: failureUpdated };
}

/**
 * 成功パターンから横展開候補を取得（ブロック済みパターン除外）
 */
export async function getExpansionCandidates(
  supabase: SupabaseClient,
  maxPerPatternPerHour: number
): Promise<{ task_type: string; pattern_id: string; sample: string; avg_roi: number; success_rate: number }[]> {

  // 成功パターン取得（ROI順）
  const { data: patterns } = await supabase
    .from("success_patterns")
    .select("*")
    .gt("avg_roi", 1)
    .gt("success_rate", 0.4)
    .order("avg_roi", { ascending: false })
    .limit(10);

  if (!patterns || patterns.length === 0) return [];

  // ブロック済みパターンタイプ取得
  const { data: blocked } = await supabase.from("failure_patterns").select("task_type").eq("blocked", true);
  const blockedTypes = new Set((blocked || []).map(b => b.task_type));

  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const candidates = [];

  for (const p of patterns) {
    if (blockedTypes.has(p.task_type)) continue;

    // 1時間内の同パターン生成数チェック
    const { data: recentRuns } = await supabase
      .from("agent_runs")
      .select("id")
      .ilike("title", `%${p.task_type}%`)
      .gte("created_at", oneHourAgo);

    if ((recentRuns || []).length >= maxPerPatternPerHour) continue;

    candidates.push({
      task_type: p.task_type,
      pattern_id: p.id,
      sample: p.sample_content || p.task_type,
      avg_roi: p.avg_roi,
      success_rate: p.success_rate,
    });
  }

  return candidates;
}

/**
 * 現在のROIトレンドを計算（自動モード切替用）
 */
export async function calculateRoiTrend(supabase: SupabaseClient): Promise<{
  recent_avg_roi: number;
  overall_avg_roi: number;
  trend: "up" | "down" | "stable";
}> {
  const { data: recent } = await supabase.from("tasks").select("roi").eq("status", "done").order("updated_at", { ascending: false }).limit(10);
  const { data: overall } = await supabase.from("tasks").select("roi").eq("status", "done").limit(50);

  const recentAvg = (recent || []).length > 0
    ? (recent || []).reduce((s, t) => s + (t.roi || 0), 0) / (recent || []).length : 0;
  const overallAvg = (overall || []).length > 0
    ? (overall || []).reduce((s, t) => s + (t.roi || 0), 0) / (overall || []).length : 0;

  const trend = recentAvg > overallAvg * 1.2 ? "up" : recentAvg < overallAvg * 0.8 ? "down" : "stable";

  return {
    recent_avg_roi: Math.round(recentAvg * 100) / 100,
    overall_avg_roi: Math.round(overallAvg * 100) / 100,
    trend,
  };
}
