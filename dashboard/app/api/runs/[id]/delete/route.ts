import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(_req)) return rateLimitResponse();
  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    // CASCADE: thinking_iterations, approval_requests も削除
    const { error } = await supabase.from("agent_runs").delete().eq("id", id);
    if (error) return apiError(error.message);
    return apiResponse({ ok: true });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
