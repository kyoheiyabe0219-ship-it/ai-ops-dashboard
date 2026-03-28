import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

async function autoAssign(supabase: ReturnType<typeof getServiceSupabase>, taskId: string) {
  const { data: idleAgents } = await supabase.from("agents").select("id, name").eq("status", "idle");
  if (!idleAgents || idleAgents.length === 0) return null;
  const { data: runningTasks } = await supabase.from("tasks").select("assigned_to").eq("status", "running");
  const taskCounts: Record<string, number> = {};
  (runningTasks || []).forEach((t) => { taskCounts[t.assigned_to] = (taskCounts[t.assigned_to] || 0) + 1; });
  idleAgents.sort((a, b) => (taskCounts[a.id] || 0) - (taskCounts[b.id] || 0));
  const chosen = idleAgents[0];
  await supabase.from("tasks").update({ assigned_to: chosen.id }).eq("id", taskId);
  return chosen;
}

async function createAlert(supabase: ReturnType<typeof getServiceSupabase>, alert: Record<string, unknown>) {
  await supabase.from("alerts").insert(alert);
}

// 意思決定エンジン（インライン版）
async function runDecisionEngine(supabase: ReturnType<typeof getServiceSupabase>) {
  const results = { scale_up: 0, scale_down: 0, reassign: 0, stop: 0, errors: [] as string[] };

  // ルール①: スケールアップ
  try {
    const { data: recentDone } = await supabase.from("tasks").select("*").eq("status", "done").order("updated_at", { ascending: false }).limit(3);
    if (recentDone && recentDone.length >= 3 && recentDone.every((t) => (t.roi || 0) > 5)) {
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const { data: recent } = await supabase.from("decision_logs").select("id").eq("type", "scale_up").gte("created_at", oneHourAgo).limit(1);
      if (!recent || recent.length === 0) {
        const base = recentDone[0];
        for (let i = 0; i < 2; i++) {
          const { data: t } = await supabase.from("tasks").insert({ content: `[自動生成] ${base.content} #${i + 1}`, priority: "high", status: "pending", expected_value: base.expected_value || 0, cost: base.cost || 0 }).select().single();
          if (t) await autoAssign(supabase, t.id);
        }
        const avgRoi = (recentDone.reduce((s, t) => s + (t.roi || 0), 0) / 3).toFixed(1);
        await supabase.from("decision_logs").insert({ type: "scale_up", reason: `平均ROI=${avgRoi}x。同種+2生成`, target: base.content });
        await createAlert(supabase, { type: "info", title: `🧠 スケールアップ: +2タスク`, message: `ROI ${avgRoi}x` });
        results.scale_up++;
      }
    }
  } catch (e) { results.errors.push(`scale_up: ${e instanceof Error ? e.message : "error"}`); }

  // ルール④: 停止
  try {
    const { data: agents } = await supabase.from("agents").select("id, name");
    for (const agent of agents || []) {
      const { data: errs } = await supabase.from("alerts").select("created_at").eq("type", "error").eq("related_agent", agent.id).order("created_at", { ascending: false }).limit(3);
      if (!errs || errs.length < 3) continue;
      const oneHourAgo = Date.now() - 3600000;
      if (!errs.every((a) => new Date(a.created_at).getTime() > oneHourAgo)) continue;
      const { data: stops } = await supabase.from("decision_logs").select("id").eq("type", "stop").eq("target", agent.id).gte("created_at", new Date(oneHourAgo).toISOString()).limit(1);
      if (stops && stops.length > 0) continue;
      await supabase.from("agents").update({ status: "idle", task: "[自動停止]", progress: 0 }).eq("id", agent.id);
      await supabase.from("decision_logs").insert({ type: "stop", reason: `エラー3回連続。強制idle化`, target: agent.id });
      await createAlert(supabase, { type: "error", title: `🧠 ${agent.name} を自動停止`, message: "エラー3回連続", related_agent: agent.id });
      results.stop++;
    }
  } catch (e) { results.errors.push(`stop: ${e instanceof Error ? e.message : "error"}`); }

  return results;
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const supabase = getServiceSupabase();
    const results = await runDecisionEngine(supabase);
    const total = results.scale_up + results.scale_down + results.reassign + results.stop;
    return apiResponse({ ok: true, total_actions: total, results });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
