import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { getActiveGoal, proposeGoalUpdate, applyGoalUpdate } from "@/lib/goal-engine";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const [goal, proposal, logsRes] = await Promise.all([
      getActiveGoal(supabase),
      proposeGoalUpdate(supabase),
      supabase.from("goal_logs").select("*").order("created_at", { ascending: false }).limit(5),
    ]);
    return apiResponse({ current: goal, proposal, logs: logsRes.data || [] });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const { proposed } = await req.json();
    if (!proposed) return apiError("proposed is required", 400);
    const result = await applyGoalUpdate(supabase, proposed);
    return apiResponse({ ok: true, goal: result });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
