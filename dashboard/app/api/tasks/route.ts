import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const url = new URL(req.url);
    let query = supabase.from("tasks").select("*");

    if (url.searchParams.get("status")) query = query.eq("status", url.searchParams.get("status")!);
    if (url.searchParams.get("assigned_to")) query = query.eq("assigned_to", url.searchParams.get("assigned_to")!);

    if (url.searchParams.get("sort") === "roi") {
      query = query.order("roi", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error) return apiError(error.message);
    return apiResponse(data);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
