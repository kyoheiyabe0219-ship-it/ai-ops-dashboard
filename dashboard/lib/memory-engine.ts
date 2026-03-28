/**
 * AI OS メモリエンジン V4.5 — 判断進化型
 *
 * V4: 記憶が進化する
 * V4.5: 判断が進化する
 *
 * 記憶進化: weight/decay/usage
 * 判断進化: confidence/impact/reuse
 * スコア統合: AI評価×0.5 + memory_weight×0.3 + decision_confidence×0.2
 * 動的explore: パフォーマンスに応じて探索率を変動
 */

import { SupabaseClient } from "@supabase/supabase-js";

const MEMORY_LIMIT = 200;
const DECAY_RATE = 0.95;

// ============================================================
// 型
// ============================================================

export type KnowledgeMemory = {
  id: string;
  type: "strategy" | "task_pattern" | "failure" | "improvement";
  content: string;
  score: number;
  weight: number;
  usage_count: number;
  is_active: boolean;
  last_used_at: string | null;
  tags: string[];
  created_at: string;
};

export type ContextMemory = {
  agent_state: { total: number; running: number; idle: number; error: number };
  avg_roi: number;
  success_rate: number;
  active_runs: number;
};

// ============================================================
// 記憶のライフサイクル
// ============================================================

/** 記憶を使用した（weightとusage更新） */
export async function touchMemory(supabase: SupabaseClient, memoryId: string) {
  const { data } = await supabase.from("knowledge_memory").select("weight, usage_count").eq("id", memoryId).single();
  if (!data) return;

  await supabase.from("knowledge_memory").update({
    weight: Math.min((data.weight || 1) + 0.2, 3.0), // 上限3.0
    usage_count: (data.usage_count || 0) + 1,
    last_used_at: new Date().toISOString(),
  }).eq("id", memoryId);
}

/** 成功フィードバック（weight +0.5） */
export async function reinforceMemory(supabase: SupabaseClient, memoryId: string) {
  const { data } = await supabase.from("knowledge_memory").select("weight").eq("id", memoryId).single();
  if (!data) return;
  await supabase.from("knowledge_memory").update({
    weight: Math.min((data.weight || 1) + 0.5, 3.0),
  }).eq("id", memoryId);
}

/** 失敗フィードバック（weight -0.5） */
export async function weakenMemory(supabase: SupabaseClient, memoryId: string) {
  const { data } = await supabase.from("knowledge_memory").select("weight").eq("id", memoryId).single();
  if (!data) return;
  const newWeight = Math.max((data.weight || 1) - 0.5, 0);
  await supabase.from("knowledge_memory").update({
    weight: newWeight,
    is_active: newWeight >= 0.3,
  }).eq("id", memoryId);
}

/** 全記憶の減衰（定期実行） */
export async function decayAllMemories(supabase: SupabaseClient): Promise<number> {
  const { data: memories } = await supabase
    .from("knowledge_memory")
    .select("id, weight, usage_count, created_at")
    .eq("is_active", true);

  let deactivated = 0;
  for (const m of memories || []) {
    const newWeight = (m.weight || 1) * DECAY_RATE;

    if (newWeight < 0.3) {
      await supabase.from("knowledge_memory").update({ weight: newWeight, is_active: false }).eq("id", m.id);
      deactivated++;
    } else {
      await supabase.from("knowledge_memory").update({ weight: newWeight }).eq("id", m.id);
    }
  }

  // 上限超過時：weight最低のis_active=falseを削除
  const { data: count } = await supabase.from("knowledge_memory").select("id", { count: "exact" });
  if ((count?.length || 0) > MEMORY_LIMIT) {
    const { data: lowest } = await supabase
      .from("knowledge_memory")
      .select("id")
      .eq("is_active", false)
      .order("weight", { ascending: true })
      .limit(20);
    for (const m of lowest || []) {
      await supabase.from("knowledge_memory").delete().eq("id", m.id);
    }
  }

  return deactivated;
}

// ============================================================
// 記憶保存（weight付き）
// ============================================================

export async function saveKnowledge(
  supabase: SupabaseClient,
  type: KnowledgeMemory["type"],
  content: string,
  score: number = 0,
  sourceRunId?: string,
  tags: string[] = []
) {
  await supabase.from("knowledge_memory").insert({
    type, content, score,
    source_run_id: sourceRunId || null,
    tags, weight: 1.0, usage_count: 0, is_active: true,
  });
}

export async function saveDecision(
  supabase: SupabaseClient,
  decisionType: string,
  reason: string,
  outcome: string = "",
  successFlag: boolean | null = null,
  sourceRunId?: string
) {
  await supabase.from("decision_memory").insert({
    decision_type: decisionType, reason, outcome,
    success_flag: successFlag,
    source_run_id: sourceRunId || null,
  });
}

// ============================================================
// Run完了時の記憶化 + weight更新（循環の核心）
// ============================================================

export async function learnFromRun(supabase: SupabaseClient, runId: string) {
  const { data: run } = await supabase.from("agent_runs").select("*").eq("id", runId).single();
  if (!run) return;

  const plan = run.final_plan as { summary?: string; reasoning?: string };

  if (run.status === "done" && run.best_score >= 70) {
    await saveKnowledge(supabase, "strategy",
      `目標「${run.goal}」→「${plan?.summary || run.title}」→ ${run.best_score}点`,
      run.best_score, runId, ["success"]
    );
    // 使用された記憶を強化
    const { data: usedMemories } = await supabase
      .from("knowledge_memory")
      .select("id")
      .eq("is_active", true)
      .gt("last_used_at", new Date(Date.now() - 600000).toISOString()); // 10分以内に使われた
    for (const m of usedMemories || []) {
      await reinforceMemory(supabase, m.id);
    }
  }

  if (run.status === "failed" || run.status === "rejected") {
    const { data: rej } = await supabase.from("approval_requests").select("rejection_reason").eq("run_id", runId).eq("status", "rejected").limit(1);
    await saveKnowledge(supabase, "failure",
      `目標「${run.goal}」→ 失敗（${rej?.[0]?.rejection_reason || "不明"}）`,
      run.best_score, runId, ["failure"]
    );
    // 使用された記憶を弱化
    const { data: usedMemories } = await supabase
      .from("knowledge_memory")
      .select("id")
      .eq("is_active", true)
      .gt("last_used_at", new Date(Date.now() - 600000).toISOString());
    for (const m of usedMemories || []) {
      await weakenMemory(supabase, m.id);
    }
  }

  // 改善点
  const { data: iters } = await supabase.from("thinking_iterations").select("improvements, score").eq("run_id", runId).order("iteration", { ascending: false }).limit(3);
  for (const it of iters || []) {
    if (it.improvements && it.improvements.length > 5) {
      await saveKnowledge(supabase, "improvement", it.improvements, it.score || 0, runId);
    }
  }

  await saveDecision(supabase,
    run.status === "done" ? "approve" : "reject",
    `Run「${run.title}」→ ${run.status}`,
    `${run.best_score}点, ${run.current_iteration}回`,
    run.status === "done", runId
  );

  // 減衰実行（学習のたびに全体を少し忘れる）
  await decayAllMemories(supabase);
}

// ============================================================
// 思考プロンプト構築（制御型）
// ============================================================

export async function buildMemoryPrompt(supabase: SupabaseClient): Promise<string> {
  // 文脈
  const [agentsRes, tasksRes, runsRes] = await Promise.all([
    supabase.from("agents").select("status"),
    supabase.from("tasks").select("status, roi").limit(100),
    supabase.from("agent_runs").select("id").in("status", ["thinking", "executing"]),
  ]);
  const agents = agentsRes.data || [];
  const tasks = tasksRes.data || [];
  const done = tasks.filter((t: { status: string }) => t.status === "done");
  const avgRoi = done.length > 0 ? done.reduce((s: number, t: { roi: number }) => s + (t.roi || 0), 0) / done.length : 0;

  // weight順で活性記憶を取得
  const { data: memories } = await supabase
    .from("knowledge_memory")
    .select("*")
    .eq("is_active", true)
    .order("weight", { ascending: false })
    .limit(10);

  const allMemories = memories || [];

  // 使用記録（touchMemory）
  for (const m of allMemories) {
    await touchMemory(supabase, m.id);
  }

  // 分類
  const strategies = allMemories.filter(m => m.type === "strategy");
  const failures = allMemories.filter(m => m.type === "failure");
  const improvements = allMemories.filter(m => m.type === "improvement");

  // 制御ロジック
  const blockedStrategies = failures.filter(m => (m.weight || 0) > 0.7);
  const priorityStrategies = strategies.filter(m => (m.weight || 0) > 1.5);
  const forcedImprovements = improvements.filter(m => (m.weight || 0) > 1.2);

  let prompt = "\n=== AI OSメモリ（進化型・V4） ===\n\n";

  prompt += `【状態】エージェント${agents.length}人（稼働${agents.filter((a: { status: string }) => a.status === "running").length}）/ 平均ROI ${avgRoi.toFixed(1)}x / Run ${(runsRes.data || []).length}件\n\n`;

  // 禁止事項（failure weight > 0.7）
  if (blockedStrategies.length > 0) {
    prompt += `【🚫 禁止: 以下の戦略は過去に失敗しており使用禁止】\n`;
    blockedStrategies.forEach(m => { prompt += `- ${m.content} (weight:${m.weight.toFixed(2)})\n`; });
    prompt += "\n";
  }

  // 優先戦略（strategy weight > 1.5）
  if (priorityStrategies.length > 0) {
    prompt += `【⭐ 推奨: 以下は高成功率の戦略。優先的に採用すること】\n`;
    priorityStrategies.forEach(m => { prompt += `- ${m.content} (weight:${m.weight.toFixed(2)}, 使用${m.usage_count}回)\n`; });
    prompt += "\n";
  }

  // 通常の参照記憶
  const normalStrategies = strategies.filter(m => (m.weight || 0) <= 1.5);
  if (normalStrategies.length > 0) {
    prompt += `【参考: 過去の成功戦略】\n`;
    normalStrategies.forEach(m => { prompt += `- ${m.content} (w:${m.weight.toFixed(1)})\n`; });
    prompt += "\n";
  }

  const normalFailures = failures.filter(m => (m.weight || 0) <= 0.7);
  if (normalFailures.length > 0) {
    prompt += `【注意: 過去の失敗】\n`;
    normalFailures.forEach(m => { prompt += `- ${m.content}\n`; });
    prompt += "\n";
  }

  // 強制適用改善（improvement weight > 1.2）
  if (forcedImprovements.length > 0) {
    prompt += `【✅ 必須適用: 以下の改善点を必ず計画に反映すること】\n`;
    forcedImprovements.forEach(m => { prompt += `- ${m.content} (weight:${m.weight.toFixed(2)})\n`; });
    prompt += "\n";
  }

  prompt += "=== メモリここまで ===\n";
  return prompt;
}

// ============================================================
// 判断進化（V4.5）
// ============================================================

/** 判断成功フィードバック */
export async function reinforceDecision(supabase: SupabaseClient, decisionId: string, roi: number) {
  const { data } = await supabase.from("decision_memory").select("confidence, impact_score").eq("id", decisionId).single();
  if (!data) return;
  await supabase.from("decision_memory").update({
    confidence: Math.min((data.confidence || 0.5) + 0.1, 1.0),
    impact_score: (data.impact_score || 0) + roi,
  }).eq("id", decisionId);
}

/** 判断失敗フィードバック */
export async function weakenDecision(supabase: SupabaseClient, decisionId: string) {
  const { data } = await supabase.from("decision_memory").select("confidence").eq("id", decisionId).single();
  if (!data) return;
  await supabase.from("decision_memory").update({
    confidence: Math.max((data.confidence || 0.5) - 0.2, 0),
  }).eq("id", decisionId);
}

/** 類似判断を検索（再利用） */
export async function findSimilarDecision(
  supabase: SupabaseClient,
  goalKeywords: string[]
): Promise<{ id: string; confidence: number; reason: string; outcome: string } | null> {
  const { data } = await supabase
    .from("decision_memory")
    .select("id, confidence, reason, outcome, reuse_count")
    .eq("success_flag", true)
    .gt("confidence", 0.6)
    .order("confidence", { ascending: false })
    .limit(20);

  if (!data) return null;

  // キーワードマッチで類似判断を検索
  for (const d of data) {
    const matches = goalKeywords.filter(kw => d.reason.includes(kw));
    if (matches.length >= 1) {
      // 再利用カウント更新
      await supabase.from("decision_memory").update({
        reuse_count: (d.reuse_count || 0) + 1,
      }).eq("id", d.id);
      return { id: d.id, confidence: d.confidence || 0.5, reason: d.reason, outcome: d.outcome };
    }
  }
  return null;
}

// ============================================================
// スコア統合（V4.5）
// AI評価 × 0.5 + memory_weight × 0.3 + decision_confidence × 0.2
// ============================================================

export async function calculateIntegratedScore(
  supabase: SupabaseClient,
  aiScore: number,
  goalKeywords: string[]
): Promise<{ integrated: number; aiComponent: number; memoryComponent: number; decisionComponent: number; reusedDecision: string | null }> {
  // memory_weight: 使用された記憶の平均weight
  const { data: usedMemories } = await supabase
    .from("knowledge_memory")
    .select("weight")
    .eq("is_active", true)
    .gt("weight", 1.0)
    .order("weight", { ascending: false })
    .limit(5);
  const avgWeight = (usedMemories || []).length > 0
    ? (usedMemories || []).reduce((s, m) => s + (m.weight || 1), 0) / (usedMemories || []).length
    : 1.0;
  const memoryScore = Math.min(avgWeight / 3 * 100, 100); // 正規化: weight 3.0 = 100点

  // decision_confidence: 類似判断の信頼度
  const similar = await findSimilarDecision(supabase, goalKeywords);
  const decisionScore = similar ? similar.confidence * 100 : 50; // 0.5デフォルト

  const aiComponent = aiScore * 0.5;
  const memoryComponent = memoryScore * 0.3;
  const decisionComponent = decisionScore * 0.2;
  const integrated = Math.round(aiComponent + memoryComponent + decisionComponent);

  return {
    integrated,
    aiComponent: Math.round(aiComponent),
    memoryComponent: Math.round(memoryComponent),
    decisionComponent: Math.round(decisionComponent),
    reusedDecision: similar ? `${similar.reason} (conf:${similar.confidence.toFixed(2)})` : null,
  };
}

// ============================================================
// 動的explore（V4.5）
// ============================================================

export async function calculateExploreRate(supabase: SupabaseClient): Promise<{ rate: number; reason: string }> {
  // 直近5件のRunスコア推移
  const { data: recentRuns } = await supabase
    .from("agent_runs")
    .select("best_score, status, title")
    .order("created_at", { ascending: false })
    .limit(5);

  if (!recentRuns || recentRuns.length < 3) {
    return { rate: 0.2, reason: "データ不足（デフォルト20%）" };
  }

  const scores = recentRuns.map(r => r.best_score || 0);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const failures = recentRuns.filter(r => r.status === "failed" || r.status === "rejected").length;

  // 停滞検出: スコアが±5以内で3件連続
  const isStagnant = scores.length >= 3 && Math.max(...scores.slice(0, 3)) - Math.min(...scores.slice(0, 3)) < 5;

  // 同一タイトル3回連続
  const titles = recentRuns.map(r => r.title);
  const isRepetitive = titles.length >= 3 && titles[0] === titles[1] && titles[1] === titles[2];

  if (failures >= 3) return { rate: 0.4, reason: `失敗${failures}/5件 → 探索強化40%` };
  if (isStagnant) return { rate: 0.35, reason: `スコア停滞(±5) → 探索35%` };
  if (isRepetitive) return { rate: 0.3, reason: `同一戦略3連続 → 探索30%` };
  if (avgScore > 80) return { rate: 0.1, reason: `高パフォーマンス(avg${avgScore.toFixed(0)}) → 最適化重視10%` };

  return { rate: 0.2, reason: `通常運転 → 探索20%` };
}

export async function shouldExplore(supabase: SupabaseClient): Promise<{ explore: boolean; rate: number; reason: string }> {
  const { rate, reason } = await calculateExploreRate(supabase);
  return { explore: Math.random() < rate, rate, reason };
}

// ============================================================
// メモリ圧縮（同タイプの類似記憶を統合）
// ============================================================

export async function compressMemories(supabase: SupabaseClient): Promise<number> {
  const { data: memories } = await supabase
    .from("knowledge_memory")
    .select("*")
    .eq("is_active", true)
    .order("type", { ascending: true })
    .order("weight", { ascending: false });

  if (!memories || memories.length < 5) return 0;

  let merged = 0;
  const seen = new Map<string, string>(); // type+firstWords → id

  for (const m of memories) {
    const key = `${m.type}:${m.content.substring(0, 20)}`;
    const existing = seen.get(key);

    if (existing && existing !== m.id) {
      // 類似記憶 → weight高い方に統合、低い方を非活性化
      const { data: other } = await supabase.from("knowledge_memory").select("weight").eq("id", existing).single();
      if (other && (other.weight || 0) >= (m.weight || 0)) {
        await supabase.from("knowledge_memory").update({ is_active: false }).eq("id", m.id);
        merged++;
      }
    } else {
      seen.set(key, m.id);
    }
  }

  return merged;
}
