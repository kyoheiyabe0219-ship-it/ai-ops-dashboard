/**
 * AI OS メモリエンジン
 *
 * 3層メモリ:
 * - knowledge_memory: 蓄積型（戦略/パターン/失敗/改善）
 * - decision_memory: 判断履歴（成功/失敗フラグ付き）
 * - context: 揮発型（現在状態のスナップショット）
 *
 * 核心: 思考ループ(thinking-engine)に「過去の記憶」を注入する
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 型定義
// ============================================================

export type KnowledgeMemory = {
  id: string;
  type: "strategy" | "task_pattern" | "failure" | "improvement";
  content: string;
  score: number;
  source_run_id: string | null;
  tags: string[];
  access_count: number;
  created_at: string;
};

export type DecisionMemory = {
  id: string;
  decision_type: string;
  reason: string;
  outcome: string;
  success_flag: boolean | null;
  source_run_id: string | null;
  created_at: string;
};

export type ContextMemory = {
  active_runs: { id: string; title: string; status: string; score: number }[];
  agent_state: { total: number; running: number; idle: number; error: number };
  recent_failures: string[];
  top_patterns: string[];
  avg_roi: number;
  success_rate: number;
};

// ============================================================
// 文脈構築（思考ループに注入するデータ）
// ============================================================

export async function buildContext(supabase: SupabaseClient): Promise<ContextMemory> {
  const [agentsRes, runsRes, tasksRes, failuresRes, patternsRes] = await Promise.all([
    supabase.from("agents").select("status"),
    supabase.from("agent_runs").select("id, title, status, best_score").in("status", ["thinking", "executing", "awaiting_approval"]).limit(5),
    supabase.from("tasks").select("status, roi").limit(100),
    supabase.from("knowledge_memory").select("content").eq("type", "failure").order("created_at", { ascending: false }).limit(5),
    supabase.from("knowledge_memory").select("content, score").eq("type", "strategy").order("score", { ascending: false }).limit(5),
  ]);

  const agents = agentsRes.data || [];
  const tasks = tasksRes.data || [];
  const done = tasks.filter((t: { status: string }) => t.status === "done");
  const avgRoi = done.length > 0 ? done.reduce((s: number, t: { roi: number }) => s + (t.roi || 0), 0) / done.length : 0;
  const successRate = tasks.length > 0 ? done.length / tasks.length : 0.5;

  return {
    active_runs: (runsRes.data || []).map(r => ({ id: r.id, title: r.title, status: r.status, score: r.best_score })),
    agent_state: {
      total: agents.length,
      running: agents.filter((a: { status: string }) => a.status === "running").length,
      idle: agents.filter((a: { status: string }) => a.status === "idle").length,
      error: agents.filter((a: { status: string }) => a.status === "error").length,
    },
    recent_failures: (failuresRes.data || []).map(f => f.content),
    top_patterns: (patternsRes.data || []).map(p => `${p.content} (${p.score}点)`),
    avg_roi: Math.round(avgRoi * 100) / 100,
    success_rate: Math.round(successRate * 100) / 100,
  };
}

// ============================================================
// 記憶の保存
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
    tags,
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
    decision_type: decisionType,
    reason, outcome,
    success_flag: successFlag,
    source_run_id: sourceRunId || null,
  });
}

// ============================================================
// Run完了時の記憶化（結果→学習→記憶循環）
// ============================================================

export async function learnFromRun(supabase: SupabaseClient, runId: string) {
  const { data: run } = await supabase.from("agent_runs").select("*").eq("id", runId).single();
  if (!run) return;

  const plan = run.final_plan as { summary?: string; tasks?: { content: string }[]; reasoning?: string };

  // 成功戦略として保存
  if (run.status === "done" && run.best_score >= 70) {
    await saveKnowledge(supabase, "strategy",
      `目標「${run.goal}」→ 計画「${plan?.summary || run.title}」→ スコア${run.best_score}点`,
      run.best_score, runId, ["success"]
    );
  }

  // 失敗として保存
  if (run.status === "failed" || run.status === "rejected") {
    // 失敗理由を取得
    const { data: rejections } = await supabase.from("approval_requests").select("rejection_reason").eq("run_id", runId).eq("status", "rejected").limit(1);
    const reason = rejections?.[0]?.rejection_reason || "不明";

    await saveKnowledge(supabase, "failure",
      `目標「${run.goal}」→ 失敗（${reason}）`,
      run.best_score, runId, ["failure"]
    );
  }

  // 改善点の蓄積（全イテレーションから）
  const { data: iterations } = await supabase.from("thinking_iterations").select("improvements, score").eq("run_id", runId).order("iteration", { ascending: false }).limit(3);
  for (const it of iterations || []) {
    if (it.improvements && it.improvements.length > 5) {
      await saveKnowledge(supabase, "improvement", it.improvements, it.score || 0, runId);
    }
  }

  // 意思決定として記録
  await saveDecision(supabase,
    run.status === "done" ? "approve" : "reject",
    `Run「${run.title}」→ ${run.status}`,
    `スコア${run.best_score}点, ${run.current_iteration}イテレーション`,
    run.status === "done",
    runId
  );
}

// ============================================================
// 思考ループ用の記憶コンテキスト文字列生成
// ============================================================

export async function buildMemoryPrompt(supabase: SupabaseClient): Promise<string> {
  const ctx = await buildContext(supabase);

  // 成功戦略（TOP3）
  const { data: strategies } = await supabase
    .from("knowledge_memory")
    .select("content, score")
    .eq("type", "strategy")
    .order("score", { ascending: false })
    .limit(3);

  // 失敗パターン（TOP3）
  const { data: failures } = await supabase
    .from("knowledge_memory")
    .select("content")
    .eq("type", "failure")
    .order("created_at", { ascending: false })
    .limit(3);

  // 直近の改善提案
  const { data: improvements } = await supabase
    .from("knowledge_memory")
    .select("content")
    .eq("type", "improvement")
    .order("created_at", { ascending: false })
    .limit(3);

  // 直近の意思決定（成功したもの）
  const { data: decisions } = await supabase
    .from("decision_memory")
    .select("reason, outcome")
    .eq("success_flag", true)
    .order("created_at", { ascending: false })
    .limit(3);

  let prompt = "\n=== AI OSメモリ（過去の学習データ） ===\n\n";

  prompt += `【現在の状態】\n`;
  prompt += `- エージェント: ${ctx.agent_state.total}人（稼働${ctx.agent_state.running}/idle${ctx.agent_state.idle}/エラー${ctx.agent_state.error}）\n`;
  prompt += `- 平均ROI: ${ctx.avg_roi}x, 成功率: ${(ctx.success_rate * 100).toFixed(0)}%\n`;
  if (ctx.active_runs.length > 0) {
    prompt += `- 進行中Run: ${ctx.active_runs.map(r => `「${r.title}」(${r.status})`).join(", ")}\n`;
  }

  if (strategies && strategies.length > 0) {
    prompt += `\n【成功した戦略】\n`;
    strategies.forEach(s => { prompt += `- ${s.content}\n`; });
  }

  if (failures && failures.length > 0) {
    prompt += `\n【避けるべきパターン】\n`;
    failures.forEach(f => { prompt += `- ${f.content}\n`; });
  }

  if (improvements && improvements.length > 0) {
    prompt += `\n【過去の改善提案】\n`;
    improvements.forEach(im => { prompt += `- ${im.content}\n`; });
  }

  if (decisions && decisions.length > 0) {
    prompt += `\n【成功した判断】\n`;
    decisions.forEach(d => { prompt += `- ${d.reason} → ${d.outcome}\n`; });
  }

  prompt += "\n=== メモリここまで ===\n";
  return prompt;
}
