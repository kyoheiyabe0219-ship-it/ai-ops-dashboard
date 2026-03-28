import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { getRevenueSummary, ceoRevenueDecision } from "@/lib/revenue-engine";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const [summary, decisions, streamsRes] = await Promise.all([
      getRevenueSummary(supabase),
      ceoRevenueDecision(supabase),
      supabase.from("revenue_streams").select("*").order("roi", { ascending: false }),
    ]);
    return apiResponse({ summary, ceo_decisions: decisions, streams: streamsRes.data || [] });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
