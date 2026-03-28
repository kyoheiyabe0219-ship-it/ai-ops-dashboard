import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from("commands").select("*").order("created_at", { ascending: false }).limit(10);
    if (error) return apiError(error.message);
    return apiResponse(data || []);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
