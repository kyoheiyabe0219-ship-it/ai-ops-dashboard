import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

// GET /api/approvals — 承認リクエスト一覧
export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const url = new URL(req.url);
    let query = supabase.from("approval_requests").select("*");

    if (url.searchParams.get("status")) query = query.eq("status", url.searchParams.get("status")!);

    const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
    if (error) return apiError(error.message);
    return apiResponse(data);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
