import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { calculateRoiTrend } from "@/lib/pattern-engine";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();

    const [successRes, failureRes, configRes, trend] = await Promise.all([
      supabase.from("success_patterns").select("*").order("avg_roi", { ascending: false }).limit(20),
      supabase.from("failure_patterns").select("*").order("failure_rate", { ascending: false }).limit(10),
      supabase.from("autonomous_config").select("mode").eq("id", "default").single(),
      calculateRoiTrend(supabase),
    ]);

    return apiResponse({
      success_patterns: successRes.data || [],
      failure_patterns: failureRes.data || [],
      mode: configRes.data?.mode || "safe",
      trend,
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
