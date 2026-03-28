import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { getRevenueSummary, ceoRevenueDecision, generateScalePlan, executeScalePlan, ScalePlan } from "@/lib/revenue-engine";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const [summary, decisions, streamsRes, scalePlan] = await Promise.all([
      getRevenueSummary(supabase),
      ceoRevenueDecision(supabase),
      supabase.from("revenue_streams").select("*").order("roi", { ascending: false }),
      generateScalePlan(supabase),
    ]);
    return apiResponse({
      summary, ceo_decisions: decisions,
      streams: streamsRes.data || [],
      scale: scalePlan,
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

// POST: スケールプラン実行
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();
  try {
    const supabase = getServiceSupabase();
    const { plan } = await req.json() as { plan: ScalePlan };
    if (!plan) return apiError("plan is required", 400);
    const result = await executeScalePlan(supabase, plan);
    return apiResponse({ ok: true, ...result });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
