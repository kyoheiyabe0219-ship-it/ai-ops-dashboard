/**
 * メタ思考エンジン V6 — 自己改変AI
 *
 * 通常: context → memory → scoring → decision
 * メタ: decision結果 → 自己評価 → アルゴリズム改善 → 次回反映
 *
 * CEOは自分の判断ロジックを評価し、改善提案を生成する。
 * 変更は必ずユーザー承認を経てから反映される。
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 型
// ============================================================

export type CeoAlgorithm = {
  id: string;
  version: number;
  scoring_weights: { ai: number; memory: number; decision: number };
  explore_rules: { base_rate: number; stagnation_rate: number; failure_rate: number; high_perf_rate: number };
  decision_rules: { auto_approve_confidence: number; failure_block_weight: number; priority_weight: number };
  performance: { avg_roi?: number; success_rate?: number; total_runs?: number; measured_at?: string };
  status: "active" | "pending" | "rollback" | "archived";
  change_reason: string;
  created_at: string;
};

export type MetaLog = {
  id: string;
  run_id: string | null;
  original_decision: string;
  outcome: string;
  error_reason: string | null;
  improvement_suggestion: string | null;
  applied: boolean;
  created_at: string;
};

// ============================================================
// 現在のアルゴリズム取得
// ============================================================

const DEFAULT_ALGO: CeoAlgorithm = {
  id: "", version: 1,
  scoring_weights: { ai: 0.5, memory: 0.3, decision: 0.2 },
  explore_rules: { base_rate: 0.2, stagnation_rate: 0.35, failure_rate: 0.4, high_perf_rate: 0.1 },
  decision_rules: { auto_approve_confidence: 0.8, failure_block_weight: 0.7, priority_weight: 1.5 },
  performance: {}, status: "active", change_reason: "", created_at: "",
};

export async function getActiveAlgorithm(supabase: SupabaseClient): Promise<CeoAlgorithm> {
  const { data } = await supabase
    .from("ceo_algorithm")
    .select("*")
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1);
  return (data?.[0] as CeoAlgorithm) || DEFAULT_ALGO;
}

// ============================================================
// 自己評価（Run完了後に呼ばれる）
// ============================================================

export async function selfEvaluate(supabase: SupabaseClient, runId: string): Promise<MetaLog | null> {
  const { data: run } = await supabase.from("agent_runs").select("*").eq("id", runId).single();
  if (!run) return null;

  const isSuccess = run.status === "done" && run.best_score >= 70;
  const outcome = isSuccess ? "success" : "failure";

  let errorReason: string | null = null;
  let suggestion: string | null = null;

  if (!isSuccess) {
    // 失敗原因分析
    const { data: iterations } = await supabase
      .from("thinking_iterations")
      .select("score, improvements")
      .eq("run_id", runId)
      .order("iteration", { ascending: false })
      .limit(3);

    const scores = (iterations || []).map(i => i.score || 0);
    const lastImprovement = iterations?.[0]?.improvements || "";

    if (scores.length >= 2 && Math.abs(scores[0] - scores[1]) < 3) {
      errorReason = "スコア停滞: 改善ループが収束しなかった";
      suggestion = "explore_rules.stagnation_rate を上げて新戦略を試すべき";
    } else if (run.best_score < 50) {
      errorReason = "低スコア: 根本的に戦略が不適切";
      suggestion = "scoring_weights.memory を上げて過去の成功パターンへの依存度を高めるべき";
    } else {
      errorReason = lastImprovement || "改善点が特定できず";
      suggestion = "decision_rules.failure_block_weight を下げて柔軟性を上げるべき";
    }
  } else {
    suggestion = run.best_score >= 90
      ? "高スコア達成。現在のアルゴリズムを維持"
      : "成功だが最適化余地あり。scoring_weights.ai を微増させてAI評価の比重を上げるべき";
  }

  const { data: log } = await supabase.from("meta_logs").insert({
    run_id: runId,
    original_decision: `Run「${run.title}」→ ${run.status} (score:${run.best_score})`,
    outcome,
    error_reason: errorReason,
    improvement_suggestion: suggestion,
  }).select().single();

  return log as MetaLog;
}

// ============================================================
// アルゴリズム改善提案（3回以上失敗時に発動）
// ============================================================

export async function proposeAlgorithmUpdate(supabase: SupabaseClient): Promise<{
  shouldUpdate: boolean;
  reason: string;
  proposed: Partial<CeoAlgorithm> | null;
} | null> {
  const current = await getActiveAlgorithm(supabase);

  // 直近のメタログを分析
  const { data: recentMeta } = await supabase
    .from("meta_logs")
    .select("outcome, improvement_suggestion")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!recentMeta || recentMeta.length < 3) {
    return { shouldUpdate: false, reason: "データ不足（3件未満）", proposed: null };
  }

  const failures = recentMeta.filter(m => m.outcome === "failure");
  const successes = recentMeta.filter(m => m.outcome === "success");
  const failureRate = failures.length / recentMeta.length;

  // 条件: 失敗率30%以上、または3回連続失敗
  const consecutive = recentMeta.slice(0, 3).every(m => m.outcome === "failure");

  if (failureRate < 0.3 && !consecutive) {
    return { shouldUpdate: false, reason: `失敗率${(failureRate * 100).toFixed(0)}%（閾値30%未満）`, proposed: null };
  }

  // 改善提案を集約
  const suggestions = failures
    .map(f => f.improvement_suggestion)
    .filter(Boolean)
    .slice(0, 3);

  // 新しいweightsを計算
  const newWeights = { ...current.scoring_weights };
  const newExplore = { ...current.explore_rules };
  const newDecision = { ...current.decision_rules };

  // 提案に基づく調整
  for (const s of suggestions) {
    if (s?.includes("memory") && s?.includes("上げ")) {
      newWeights.memory = Math.min(newWeights.memory + 0.05, 0.5);
      newWeights.ai = Math.max(newWeights.ai - 0.05, 0.3);
    }
    if (s?.includes("explore") || s?.includes("stagnation")) {
      newExplore.stagnation_rate = Math.min(newExplore.stagnation_rate + 0.05, 0.5);
      newExplore.base_rate = Math.min(newExplore.base_rate + 0.02, 0.35);
    }
    if (s?.includes("柔軟")) {
      newDecision.failure_block_weight = Math.max(newDecision.failure_block_weight - 0.05, 0.5);
    }
    if (s?.includes("ai") && s?.includes("上げ")) {
      newWeights.ai = Math.min(newWeights.ai + 0.05, 0.7);
      newWeights.decision = Math.max(newWeights.decision - 0.05, 0.1);
    }
  }

  // weights合計を1.0に正規化
  const totalW = newWeights.ai + newWeights.memory + newWeights.decision;
  newWeights.ai = Math.round(newWeights.ai / totalW * 100) / 100;
  newWeights.memory = Math.round(newWeights.memory / totalW * 100) / 100;
  newWeights.decision = Math.round((1 - newWeights.ai - newWeights.memory) * 100) / 100;

  return {
    shouldUpdate: true,
    reason: consecutive
      ? `3回連続失敗。改善提案: ${suggestions.join("; ")}`
      : `失敗率${(failureRate * 100).toFixed(0)}%。改善提案: ${suggestions.join("; ")}`,
    proposed: {
      version: current.version + 1,
      scoring_weights: newWeights,
      explore_rules: newExplore,
      decision_rules: newDecision,
      change_reason: `自己改善: 失敗率${(failureRate * 100).toFixed(0)}%に基づく自動調整`,
    },
  };
}

// ============================================================
// アルゴリズム更新（承認後に呼ばれる）
// ============================================================

export async function applyAlgorithmUpdate(
  supabase: SupabaseClient,
  proposed: Partial<CeoAlgorithm>
): Promise<CeoAlgorithm | null> {
  // 現在のactiveをarchived
  await supabase.from("ceo_algorithm").update({ status: "archived" }).eq("status", "active");

  // パフォーマンス計測
  const { data: tasks } = await supabase.from("tasks").select("status, roi").eq("status", "done").limit(50);
  const doneTasks = tasks || [];
  const avgRoi = doneTasks.length > 0 ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length : 0;
  const successRate = doneTasks.length > 0 ? doneTasks.length / (tasks || []).length : 0;

  const { data: newAlgo } = await supabase.from("ceo_algorithm").insert({
    version: proposed.version || 2,
    scoring_weights: proposed.scoring_weights || { ai: 0.5, memory: 0.3, decision: 0.2 },
    explore_rules: proposed.explore_rules || { base_rate: 0.2, stagnation_rate: 0.35, failure_rate: 0.4, high_perf_rate: 0.1 },
    decision_rules: proposed.decision_rules || { auto_approve_confidence: 0.8, failure_block_weight: 0.7, priority_weight: 1.5 },
    performance: { avg_roi: Math.round(avgRoi * 100) / 100, success_rate: Math.round(successRate * 100) / 100, total_runs: doneTasks.length, measured_at: new Date().toISOString() },
    status: "active",
    change_reason: proposed.change_reason || "Manual update",
  }).select().single();

  return newAlgo as CeoAlgorithm;
}

// ============================================================
// ロールバック
// ============================================================

export async function rollbackAlgorithm(supabase: SupabaseClient): Promise<CeoAlgorithm | null> {
  // 現在のactiveをrollback
  await supabase.from("ceo_algorithm").update({ status: "rollback" }).eq("status", "active");

  // 直前のarchivedをactive
  const { data: prev } = await supabase
    .from("ceo_algorithm")
    .select("*")
    .eq("status", "archived")
    .order("version", { ascending: false })
    .limit(1);

  if (prev?.[0]) {
    await supabase.from("ceo_algorithm").update({ status: "active" }).eq("id", prev[0].id);
    return prev[0] as CeoAlgorithm;
  }

  return null;
}
