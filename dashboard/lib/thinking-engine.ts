/**
 * 思考ループエンジン
 * Claude: 提案生成 → ChatGPT: 評価 → 動的スコアで改善ループ
 */

import { SupabaseClient } from "@supabase/supabase-js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

type Iteration = {
  proposal: string;
  evaluation?: string;
  score?: number;
  improvements?: string;
};

// ============================================================
// 動的スコア計算
// ============================================================

const BASE_SCORE_MAP: Record<string, number> = {
  ceo: 85,
  normal: 75,
  quick: 65,
};

const SCORE_FLOOR = 60;
const SCORE_CEILING = 95;

export function calculateTargetScore(role: string, estimatedRoi: number): number {
  const base = BASE_SCORE_MAP[role] || BASE_SCORE_MAP.normal;

  let bonus = 0;
  if (estimatedRoi >= 10) bonus = 10;
  else if (estimatedRoi >= 5) bonus = 5;
  else if (estimatedRoi <= 1 && estimatedRoi > 0) bonus = -5;

  return Math.max(SCORE_FLOOR, Math.min(base + bonus, SCORE_CEILING));
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

function buildProposalPrompt(goal: string, prevIteration?: Iteration): string {
  let prompt = `あなたはAI組織のCEOです。以下の目標を達成する計画を立案してください。\n\n目標: ${goal}\n\n`;

  if (prevIteration) {
    prompt += `前回の提案:\n${prevIteration.proposal}\n\n`;
    prompt += `評価スコア: ${prevIteration.score}/100\n`;
    prompt += `改善点: ${prevIteration.improvements}\n\n`;
    prompt += `上記の改善点を踏まえて、より良い計画を提案してください。\n`;
  } else {
    prompt += `具体的な実行計画を提案してください。\n`;
  }

  prompt += `\n出力は必ずJSON形式で:\n{"summary":"計画の概要","tasks":[{"content":"タスク名","priority":"high|medium|low","expected_value":数値}],"reasoning":"この計画の根拠"}`;
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

export async function runIteration(
  supabase: SupabaseClient,
  runId: string
): Promise<{ done: boolean; score: number; iteration: number; targetScore: number; estimatedRoi: number }> {
  const start = Date.now();

  // Run取得
  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (runErr || !run) throw new Error(`Run not found: ${runId}`);
  if (run.status !== "thinking") throw new Error(`Run is not in thinking state: ${run.status}`);

  // 動的スコア計算
  const estimatedRoi = run.estimated_roi || (run.expected_value || 0) / Math.max(run.estimated_cost || 1, 1);
  const targetScore = calculateTargetScore(run.role || "normal", estimatedRoi);

  if (run.current_iteration >= run.max_iterations) {
    await supabase.from("agent_runs").update({ status: "awaiting_approval", dynamic_target_score: targetScore }).eq("id", runId);

    await supabase.from("approval_requests").insert({
      run_id: runId, type: "plan_approval",
      title: `計画承認: ${run.title}（最大ループ到達）`,
      description: `${run.max_iterations}回到達。ベストスコア${run.best_score}点（目標${targetScore}点）`,
      plan: run.final_plan,
    });

    return { done: true, score: run.best_score, iteration: run.current_iteration, targetScore, estimatedRoi };
  }

  const nextIteration = run.current_iteration + 1;

  // 前回のイテレーション取得
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

  // Step 1: Claude で提案生成
  const proposal = await callClaude(buildProposalPrompt(run.goal, prevIteration));

  // Step 2: ChatGPT で評価
  const evalRaw = await callChatGPT(buildEvalPrompt(run.goal, proposal));

  let score = 0;
  let evaluation = evalRaw;
  let improvements = "";

  try {
    const jsonMatch = evalRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      score = parsed.score || 0;
      evaluation = JSON.stringify(parsed, null, 2);
      improvements = parsed.improvements || "";
    }
  } catch {
    score = 0;
    improvements = "評価結果のパースに失敗";
  }

  const durationMs = Date.now() - start;
  const reachedTarget = score >= targetScore;

  // Step 3: イテレーション記録（ROI + 動的スコア情報含む）
  await supabase.from("thinking_iterations").insert({
    run_id: runId,
    iteration: nextIteration,
    proposal,
    proposal_model: ANTHROPIC_API_KEY ? "claude-sonnet-4-20250514" : "mock",
    evaluation,
    score,
    eval_model: OPENAI_API_KEY ? "gpt-4o-mini" : "mock",
    improvements,
    duration_ms: durationMs,
    estimated_roi: estimatedRoi,
    dynamic_target_score: targetScore,
    reached_target: reachedTarget,
  });

  // Step 4: Run更新
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
      current_iteration: nextIteration,
      best_score: newBestScore,
      final_plan: finalPlan,
      dynamic_target_score: targetScore,
      status: "awaiting_approval",
    }).eq("id", runId);

    await supabase.from("approval_requests").insert({
      run_id: runId, type: "plan_approval",
      title: `計画承認: ${run.title}`,
      description: `${nextIteration}回の思考ループでスコア${score}点に到達（目標${targetScore}点, ROI ${estimatedRoi.toFixed(1)}x）`,
      plan: finalPlan,
    });

    return { done: true, score, iteration: nextIteration, targetScore, estimatedRoi };
  }

  await supabase.from("agent_runs").update({
    current_iteration: nextIteration,
    best_score: newBestScore,
    final_plan: finalPlan,
    dynamic_target_score: targetScore,
  }).eq("id", runId);

  return { done: false, score, iteration: nextIteration, targetScore, estimatedRoi };
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

  await supabase.from("agent_runs").update({
    status: taskIds.length > 0 ? "executing" : "done",
  }).eq("id", runId);

  return { created: taskIds.length, taskIds };
}
