/**
 * 目的関数エンジン V7
 *
 * goal_score = short_term × w1 + long_term × w2 + learning × w3 + stability × w4 - risk × w5
 *
 * CEOは「何を目指すか」を持ち、目的自体も進化する
 */

import { SupabaseClient } from "@supabase/supabase-js";

export type GoalFunction = {
  id: string;
  short_term_weight: number;
  long_term_weight: number;
  learning_weight: number;
  stability_weight: number;
  risk_weight: number;
  version: number;
  status: string;
  change_reason: string;
  created_at: string;
};

export type GoalScoreBreakdown = {
  short_term: number;
  long_term: number;
  learning: number;
  stability: number;
  risk: number;
  total: number;
};

const DEFAULT_GOAL: GoalFunction = {
  id: "", short_term_weight: 0.3, long_term_weight: 0.3,
  learning_weight: 0.2, stability_weight: 0.1, risk_weight: 0.1,
  version: 1, status: "active", change_reason: "", created_at: "",
};

// ============================================================
// 現在の目的関数取得
// ============================================================

export async function getActiveGoal(supabase: SupabaseClient): Promise<GoalFunction> {
  const { data } = await supabase
    .from("goal_function")
    .select("*")
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1);
  return (data?.[0] as GoalFunction) || DEFAULT_GOAL;
}

// ============================================================
// goal_score計算
// ============================================================

export async function calculateGoalScore(
  supabase: SupabaseClient,
  context: {
    expectedRoi: number;       // 即時ROI見込み
    proposalScore: number;     // AI評価スコア (0-100)
    isNewStrategy: boolean;    // 新戦略か
    failureCount: number;      // 直近の失敗数
    iterationCount: number;    // 思考ループ回数
  }
): Promise<GoalScoreBreakdown> {
  const goal = await getActiveGoal(supabase);

  // 各指標の算出（0-100に正規化）

  // 短期利益: ROI見込みを正規化（ROI 10x = 100点）
  const shortTerm = Math.min(context.expectedRoi * 10, 100);

  // 長期成長: 高スコア提案 = 将来の収益基盤（AI評価が高いほど良い）
  const longTerm = context.proposalScore;

  // 学習速度: 新戦略ほど学習価値が高い
  const learning = context.isNewStrategy ? 80 : 30 + Math.min(context.iterationCount * 10, 40);

  // 安定性: 失敗が少ないほど高い
  const stability = Math.max(100 - context.failureCount * 20, 0);

  // リスク: 新戦略 + 低スコア = 高リスク
  const risk = context.isNewStrategy && context.proposalScore < 60
    ? 70
    : context.failureCount > 2 ? 50 : 20;

  const total = Math.round(
    shortTerm * goal.short_term_weight +
    longTerm * goal.long_term_weight +
    learning * goal.learning_weight +
    stability * goal.stability_weight -
    risk * goal.risk_weight
  );

  return {
    short_term: Math.round(shortTerm),
    long_term: Math.round(longTerm),
    learning: Math.round(learning),
    stability: Math.round(stability),
    risk: Math.round(risk),
    total: Math.max(total, 0),
  };
}

// ============================================================
// 目的関数の自己進化
// ============================================================

export async function proposeGoalUpdate(supabase: SupabaseClient): Promise<{
  shouldUpdate: boolean;
  reason: string;
  proposed: Partial<GoalFunction> | null;
}> {
  const current = await getActiveGoal(supabase);

  // パフォーマンス分析
  const { data: recentRuns } = await supabase
    .from("agent_runs")
    .select("best_score, status, estimated_roi")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!recentRuns || recentRuns.length < 5) {
    return { shouldUpdate: false, reason: "データ不足", proposed: null };
  }

  const scores = recentRuns.map(r => r.best_score || 0);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const failures = recentRuns.filter(r => r.status === "failed" || r.status === "rejected").length;
  const avgRoi = recentRuns.reduce((s, r) => s + (r.estimated_roi || 0), 0) / recentRuns.length;

  // スコア停滞判定
  const isStagnant = scores.length >= 3 && Math.max(...scores.slice(0, 3)) - Math.min(...scores.slice(0, 3)) < 5;

  const newWeights = {
    short_term_weight: current.short_term_weight,
    long_term_weight: current.long_term_weight,
    learning_weight: current.learning_weight,
    stability_weight: current.stability_weight,
    risk_weight: current.risk_weight,
  };

  let reason = "";
  let shouldUpdate = false;
  const MAX_SHIFT = 0.1; // 1回の変動上限

  if (avgRoi < 2 && avgScore > 70) {
    // ROI低いがスコアは高い → 短期利益重視に
    newWeights.short_term_weight = Math.min(newWeights.short_term_weight + MAX_SHIFT, 0.5);
    newWeights.long_term_weight = Math.max(newWeights.long_term_weight - MAX_SHIFT / 2, 0.1);
    reason = `ROI停滞(${avgRoi.toFixed(1)}x) → 短期利益重視にシフト`;
    shouldUpdate = true;
  } else if (failures >= 3) {
    // 失敗多発 → 安定性重視に
    newWeights.stability_weight = Math.min(newWeights.stability_weight + MAX_SHIFT, 0.3);
    newWeights.risk_weight = Math.min(newWeights.risk_weight + MAX_SHIFT / 2, 0.2);
    reason = `失敗${failures}/10件 → 安定性・リスク回避重視にシフト`;
    shouldUpdate = true;
  } else if (isStagnant) {
    // 停滞 → 学習重視に
    newWeights.learning_weight = Math.min(newWeights.learning_weight + MAX_SHIFT, 0.4);
    newWeights.short_term_weight = Math.max(newWeights.short_term_weight - MAX_SHIFT / 2, 0.1);
    reason = `スコア停滞 → 学習・探索重視にシフト`;
    shouldUpdate = true;
  } else if (avgScore > 80 && avgRoi > 5) {
    // 好調 → 短期利益強化
    newWeights.short_term_weight = Math.min(newWeights.short_term_weight + MAX_SHIFT / 2, 0.5);
    reason = `好調(score${avgScore.toFixed(0)}, ROI${avgRoi.toFixed(1)}x) → 短期利益追求強化`;
    shouldUpdate = true;
  }

  if (!shouldUpdate) {
    return { shouldUpdate: false, reason: "目的関数の変更不要（パフォーマンス安定）", proposed: null };
  }

  // 正規化（合計=1.0、risk_weightは別）
  const positiveTotal = newWeights.short_term_weight + newWeights.long_term_weight + newWeights.learning_weight + newWeights.stability_weight;
  const targetTotal = 1.0 - newWeights.risk_weight;
  const scale = targetTotal / positiveTotal;

  return {
    shouldUpdate: true,
    reason,
    proposed: {
      short_term_weight: Math.round(newWeights.short_term_weight * scale * 100) / 100,
      long_term_weight: Math.round(newWeights.long_term_weight * scale * 100) / 100,
      learning_weight: Math.round(newWeights.learning_weight * scale * 100) / 100,
      stability_weight: Math.round(newWeights.stability_weight * scale * 100) / 100,
      risk_weight: Math.round(newWeights.risk_weight * 100) / 100,
      version: current.version + 1,
      change_reason: reason,
    },
  };
}

// ============================================================
// 目的関数更新（承認後）
// ============================================================

export async function applyGoalUpdate(
  supabase: SupabaseClient,
  proposed: Partial<GoalFunction>
): Promise<GoalFunction | null> {
  const current = await getActiveGoal(supabase);

  // ログ記録
  await supabase.from("goal_logs").insert({
    previous_weights: {
      short_term: current.short_term_weight,
      long_term: current.long_term_weight,
      learning: current.learning_weight,
      stability: current.stability_weight,
      risk: current.risk_weight,
    },
    new_weights: {
      short_term: proposed.short_term_weight,
      long_term: proposed.long_term_weight,
      learning: proposed.learning_weight,
      stability: proposed.stability_weight,
      risk: proposed.risk_weight,
    },
    reason: proposed.change_reason || "Manual",
  });

  await supabase.from("goal_function").update({ status: "archived" }).eq("status", "active");

  const { data } = await supabase.from("goal_function").insert({
    short_term_weight: proposed.short_term_weight ?? 0.3,
    long_term_weight: proposed.long_term_weight ?? 0.3,
    learning_weight: proposed.learning_weight ?? 0.2,
    stability_weight: proposed.stability_weight ?? 0.1,
    risk_weight: proposed.risk_weight ?? 0.1,
    version: proposed.version || 2,
    status: "active",
    change_reason: proposed.change_reason || "Updated",
  }).select().single();

  return data as GoalFunction;
}
