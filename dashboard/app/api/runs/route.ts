import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { runIteration } from "@/lib/thinking-engine";

export async function OPTIONS() { return handleOptions(); }

// GET /api/runs — Run一覧
export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const url = new URL(req.url);
    let query = supabase.from("agent_runs").select("*");

    if (url.searchParams.get("status")) query = query.eq("status", url.searchParams.get("status")!);

    const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
    if (error) return apiError(error.message);
    return apiResponse(data);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

// POST /api/runs — Run作成 + 初回イテレーション自動実行
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const supabase = getServiceSupabase();
    const { title, goal, max_iterations, expected_value, estimated_cost, role } = await req.json();

    if (!title || !goal) return apiError("title and goal are required", 400);

    const { data: run, error } = await supabase
      .from("agent_runs")
      .insert({
        title,
        goal,
        max_iterations: max_iterations || 10,
        expected_value: expected_value || 0,
        estimated_cost: estimated_cost || 1,
        role: role || "normal",
        status: "thinking",
      })
      .select()
      .single();

    if (error) return apiError(error.message);

    // 初回イテレーションを自動実行
    let firstResult = null;
    try {
      firstResult = await runIteration(supabase, run.id);
    } catch (iterErr) {
      // イテレーション失敗してもRun自体は作成済み
      firstResult = { error: iterErr instanceof Error ? iterErr.message : "iteration failed" };
    }

    // 最新のRun状態を返す
    const { data: updated } = await supabase.from("agent_runs").select("*").eq("id", run.id).single();

    return apiResponse({ ok: true, run: updated, first_iteration: firstResult });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
