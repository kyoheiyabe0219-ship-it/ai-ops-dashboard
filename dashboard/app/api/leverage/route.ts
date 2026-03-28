import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { getLeverageSummary, createAndDeploy, selectChannelStrategy, generateDeployPlan } from "@/lib/leverage-engine";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const [summary, strategy] = await Promise.all([
      getLeverageSummary(supabase),
      selectChannelStrategy(supabase),
    ]);
    return apiResponse({ ...summary, current_strategy: strategy });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

// POST: コンテンツ作成+全チャネル展開
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const { title, body } = await req.json();
    if (!title) return apiError("title is required", 400);
    const result = await createAndDeploy(supabase, title, body || "");
    return apiResponse({ ok: true, ...result });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
