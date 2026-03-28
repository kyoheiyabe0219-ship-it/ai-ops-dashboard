/**
 * 思考ループエンジン (V3 AI OS)
 *
 * 記憶参照 → Claude提案 → ChatGPT評価 → 改善ループ → 記憶保存
 * 循環: 記憶 → 思考 → 判断 → 実行 → 結果 → 記憶
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { buildMemoryPrompt, learnFromRun, saveDecision, calculateIntegratedScore } from "./memory-engine";
import { selfEvaluate, proposeAlgorithmUpdate } from "./meta-engine";
import { calculateGoalScore, proposeGoalUpdate } from "./goal-engine";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

type Iteration = {
  proposal: string;
  evaluation?: string;
  score?: number;
  improvements?: string;
};

// ============================================================
// 現実最適化スコア計算
// effectiveScore = (ROI × successRate) / costWeight
// ============================================================

const BASE_SCORE_MAP: Record<string, number> = {
  ceo: 85,
  normal: 75,
  quick: 65,
};

const SCORE_FLOOR = 60;
const SCORE_CEILING = 95;

export type ScoreContext = {
  estimatedRoi: number;
  successRate: number;
  costWeight: number;
  effectiveScore: number;
  targetScore: number;
};

/**
 * 過去タスクの成功率を算出
 * 同一Run内タスク or 全タスクのdone率
 */
export async function calculateSuccessRate(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("tasks").select("status").limit(200);
  if (!data || data.length < 3) return 0.5; // 履歴不足時のデフォルト

  const done = data.filter((t: { status: string }) => t.status === "done").length;
  return done / data.length;
}

/**
 * 統合スコア計算
 * effectiveScore = (ROI × successRate) / costWeight
 * → 目標スコアに反映
 */
export function calculateTargetScore(
  role: string,
  estimatedRoi: number,
  successRate: number = 0.5,
  estimatedCost: number = 1,
  timeCost: number = 1,
): ScoreContext {
  const base = BASE_SCORE_MAP[role] || BASE_SCORE_MAP.normal;
  const costWeight = Math.max(estimatedCost + timeCost, 1) / 1000; // 千円単位に正規化
  const effectiveScore = (estimatedRoi * successRate) / Math.max(costWeight, 0.1);

  let bonus = 0;
  if (effectiveScore >= 10) bonus = 10;
  else if (effectiveScore >= 5) bonus = 5;
  else if (effectiveScore <= 1) bonus = -10;

  const targetScore = Math.max(SCORE_FLOOR, Math.min(base + bonus, SCORE_CEILING));

  return { estimatedRoi, successRate, costWeight, effectiveScore, targetScore };
}

// ============================================================
// Claude API: 提案生成
// ============================================================

async function callClaude(prompt: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return JSON.stringify({
      summary: "[APIキー未設定] テスト提案",
      tasks: [{ content: "テストタスク", priority: "medium", expected_value: 10000 }],
      reasoning: "ANTHROPIC_API_KEY が未設定のためテストデータを返しています",
    });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.content[0]?.text || "";
}

// ============================================================
// ChatGPT API: 評価
// ============================================================

async function callChatGPT(prompt: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    return JSON.stringify({
      score: 85,
      breakdown: { goal_alignment: 22, feasibility: 20, specificity: 22, roi_potential: 21 },
      improvements: "OPENAI_API_KEY が未設定のためテストスコアを返しています",
    });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ChatGPT API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.choices[0]?.message?.content || "";
}

// ============================================================
// プロンプト生成
// ============================================================

function buildProposalPrompt(goal: string, memoryContext: string, prevIteration?: Iteration): string {
  let prompt = `あなたはAI組織のCEO（カーネル）です。過去の学習データを参照し、最適な計画を立案してください。\n\n`;

  // 記憶注入（核心）
  prompt += memoryContext;

  prompt += `\n目標: ${goal}\n\n`;

  if (prevIteration) {
    prompt += `前回の提案:\n${prevIteration.proposal}\n\n`;
    prompt += `評価スコア: ${prevIteration.score}/100\n`;
    prompt += `改善点: ${prevIteration.improvements}\n\n`;
    prompt += `上記の改善点と過去の記憶を踏まえて、より良い計画を提案してください。\n`;
    prompt += `特に「避けるべきパターン」に該当しないか確認してください。\n`;
  } else {
    prompt += `過去の成功パターンを参考に、具体的な実行計画を提案してください。\n`;
    prompt += `失敗パターンは避けてください。\n`;
  }

  prompt += `\n出力は必ずJSON形式で:\n{"summary":"計画の概要","tasks":[{"content":"タスク名","priority":"high|medium|low","expected_value":数値}],"reasoning":"この計画の根拠（過去の記憶をどう活用したか含む）"}`;
  return prompt;
}

function buildEvalPrompt(goal: string, proposal: string): string {
  return `以下の計画を厳密に評価してください。

目標: ${goal}

計画:
${proposal}

評価基準（各25点満点、合計100点）:
1. goal_alignment: 目標との整合性
2. feasibility: 実行可能性
3. specificity: 具体性・詳細さ
4. roi_potential: 収益見込み

出力は必ずJSON形式:
{"score":0-100,"breakdown":{"goal_alignment":N,"feasibility":N,"specificity":N,"roi_potential":N},"improvements":"100点未満なら改善すべき点を具体的に"}`;
}

// ============================================================
// 1イテレーション実行
// ============================================================

export type IterationResult = {
  done: boolean;
  score: number;
  iteration: number;
  scoring: ScoreContext;
};

export async function runIteration(
  supabase: SupabaseClient,
  runId: string
): Promise<IterationResult> {
  const start = Date.now();

  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (runErr || !run) throw new Error(`Run not found: ${runId}`);
  if (run.status !== "thinking") throw new Error(`Run is not in thinking state: ${run.status}`);

  // 成功率算出（履歴ベース）
  const successRate = run.success_rate > 0 ? run.success_rate : await calculateSuccessRate(supabase);

  // 統合スコア計算
  const estimatedRoi = run.estimated_roi || (run.expected_value || 0) / Math.max(run.estimated_cost || 1, 1);
  const scoring = calculateTargetScore(
    run.role || "normal",
    estimatedRoi,
    successRate,
    run.estimated_cost || 1,
    run.time_cost || 1,
  );

  // success_rate を Run に保存（初回のみ）
  if (run.success_rate === 0.5 || !run.success_rate) {
    await supabase.from("agent_runs").update({ success_rate: successRate, effective_score: scoring.effectiveScore }).eq("id", runId);
  }

  if (run.current_iteration >= run.max_iterations) {
    await supabase.from("agent_runs").update({ status: "awaiting_approval", dynamic_target_score: scoring.targetScore }).eq("id", runId);

    await supabase.from("approval_requests").insert({
      run_id: runId, type: "plan_approval",
      title: `計画承認: ${run.title}（最大ループ到達）`,
      description: `${run.max_iterations}回到達。ベスト${run.best_score}点（目標${scoring.targetScore}点, 実効${scoring.effectiveScore.toFixed(1)}）`,
      plan: run.final_plan,
    });

    return { done: true, score: run.best_score, iteration: run.current_iteration, scoring };
  }

  const nextIteration = run.current_iteration + 1;

  let prevIteration: Iteration | undefined;
  if (run.current_iteration > 0) {
    const { data: prev } = await supabase
      .from("thinking_iterations")
      .select("*")
      .eq("run_id", runId)
      .eq("iteration", run.current_iteration)
      .single();
    if (prev) {
      prevIteration = { proposal: prev.proposal, score: prev.score, improvements: prev.improvements };
    }
  }

  // 記憶参照（AI OS循環の核心）
  const memoryContext = await buildMemoryPrompt(supabase);

  const proposal = await callClaude(buildProposalPrompt(run.goal, memoryContext, prevIteration));
  const evalRaw = await callChatGPT(buildEvalPrompt(run.goal, proposal));

  let aiScore = 0;
  let evaluation = evalRaw;
  let improvements = "";

  try {
    const jsonMatch = evalRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      aiScore = parsed.score || 0;
      evaluation = JSON.stringify(parsed, null, 2);
      improvements = parsed.improvements || "";
    }
  } catch {
    aiScore = 0;
    improvements = "評価結果のパースに失敗";
  }

  // V4.5: decision_score（AI×0.5 + Memory×0.3 + Decision×0.2）
  const goalKeywords = run.goal.split(/[\s　、。]+/).filter((w: string) => w.length >= 2).slice(0, 5);
  const integrated = await calculateIntegratedScore(supabase, aiScore, goalKeywords);
  const decisionScore = integrated.integrated;

  // V7: goal_score（目的関数評価）
  const { data: recentFailures } = await supabase.from("agent_runs").select("status").eq("status", "failed").limit(10);
  const goalBreakdown = await calculateGoalScore(supabase, {
    expectedRoi: scoring.estimatedRoi,
    proposalScore: aiScore,
    isNewStrategy: nextIteration === 1,
    failureCount: (recentFailures || []).length,
    iterationCount: nextIteration,
  });

  // final_score = decision_score × 0.5 + goal_score × 0.5
  const score = Math.round(decisionScore * 0.5 + goalBreakdown.total * 0.5);

  const durationMs = Date.now() - start;
  const reachedTarget = score >= scoring.targetScore;

  // イテレーション記録（統合スコア情報含む）
  await supabase.from("thinking_iterations").insert({
    run_id: runId,
    iteration: nextIteration,
    proposal,
    proposal_model: ANTHROPIC_API_KEY ? "claude-sonnet-4-20250514" : "mock",
    evaluation, score,
    eval_model: OPENAI_API_KEY ? "gpt-4o-mini" : "mock",
    improvements,
    duration_ms: durationMs,
    estimated_roi: scoring.estimatedRoi,
    dynamic_target_score: scoring.targetScore,
    reached_target: reachedTarget,
    success_rate: scoring.successRate,
    cost_weight: scoring.costWeight,
    effective_score: scoring.effectiveScore,
  });

  const newBestScore = Math.max(run.best_score, score);

  let finalPlan = run.final_plan;
  if (score >= newBestScore) {
    try {
      const jsonMatch = proposal.match(/\{[\s\S]*\}/);
      if (jsonMatch) finalPlan = JSON.parse(jsonMatch[0]);
    } catch {
      finalPlan = { raw: proposal };
    }
  }

  if (reachedTarget) {
    await supabase.from("agent_runs").update({
      current_iteration: nextIteration, best_score: newBestScore,
      final_plan: finalPlan, dynamic_target_score: scoring.targetScore,
      effective_score: scoring.effectiveScore, status: "awaiting_approval",
    }).eq("id", runId);

    await supabase.from("approval_requests").insert({
      run_id: runId, type: "plan_approval",
      title: `計画承認: ${run.title}`,
      description: `${nextIteration}回でスコア${score}点到達（目標${scoring.targetScore}, 実効${scoring.effectiveScore.toFixed(1)}, ROI ${scoring.estimatedRoi.toFixed(1)}x, 成功率${(scoring.successRate * 100).toFixed(0)}%）`,
      plan: finalPlan,
    });

    return { done: true, score, iteration: nextIteration, scoring };
  }

  await supabase.from("agent_runs").update({
    current_iteration: nextIteration, best_score: newBestScore,
    final_plan: finalPlan, dynamic_target_score: scoring.targetScore,
    effective_score: scoring.effectiveScore,
  }).eq("id", runId);

  return { done: false, score, iteration: nextIteration, scoring };
}

// ============================================================
// 承認後: Task生成
// ============================================================

export async function executeApprovedRun(
  supabase: SupabaseClient,
  runId: string
): Promise<{ created: number; taskIds: string[] }> {
  const { data: run } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (!run) throw new Error("Run not found");
  if (run.status !== "approved") throw new Error(`Run is not approved: ${run.status}`);

  await supabase.from("agent_runs").update({ status: "executing" }).eq("id", runId);

  const plan = run.final_plan as { tasks?: { content: string; priority?: string; expected_value?: number }[] };
  const tasks = plan?.tasks || [];
  const taskIds: string[] = [];

  for (const t of tasks) {
    const { data: inserted } = await supabase
      .from("tasks")
      .insert({
        content: t.content,
        priority: t.priority || "medium",
        status: "pending",
        expected_value: t.expected_value || 0,
        cost: 0,
        run_id: runId,
      })
      .select("id")
      .single();

    if (inserted) {
      taskIds.push(inserted.id);
      const { data: idle } = await supabase.from("agents").select("id").eq("status", "idle").limit(1);
      if (idle?.[0]) {
        await supabase.from("tasks").update({ assigned_to: idle[0].id }).eq("id", inserted.id);
      }
    }
  }

  const finalStatus = taskIds.length > 0 ? "executing" : "done";
  await supabase.from("agent_runs").update({ status: finalStatus }).eq("id", runId);

  // 記憶化 + 自己評価（V6循環）
  await saveDecision(supabase, "approve", `Run「${run.title}」を承認・実行`, `${taskIds.length}タスク生成`, true, runId);
  await learnFromRun(supabase, runId);
  await selfEvaluate(supabase, runId);

  // アルゴリズム + 目的関数 改善提案チェック
  await proposeAlgorithmUpdate(supabase);
  await proposeGoalUpdate(supabase);

  return { created: taskIds.length, taskIds };
}
