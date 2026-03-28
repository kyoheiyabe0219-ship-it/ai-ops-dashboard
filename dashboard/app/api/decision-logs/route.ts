import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const url = new URL(req.url);
    let query = supabase.from("decision_logs").select("*");

    if (url.searchParams.get("type")) query = query.eq("type", url.searchParams.get("type")!);

    const limit = parseInt(url.searchParams.get("limit") || "50");
    const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);

    if (error) return apiError(error.message);
    return apiResponse(data);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
