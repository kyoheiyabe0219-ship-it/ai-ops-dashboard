import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(_req)) return rateLimitResponse();

  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from("alerts").update({ is_read: true }).eq("id", id).select().single();
    if (error) return apiError(error.message);
    return apiResponse({ ok: true, alert: data });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
