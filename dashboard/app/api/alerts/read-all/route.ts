import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const { error } = await supabase.from("alerts").update({ is_read: true }).eq("is_read", false);
    if (error) return apiError(error.message);
    return apiResponse({ ok: true });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
