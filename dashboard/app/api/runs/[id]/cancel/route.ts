import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

// POST /api/runs/[id]/cancel — Runをキャンセル
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(_req)) return rateLimitResponse();

  try {
    const { id } = await params;
    const supabase = getServiceSupabase();

    const { data: run } = await supabase.from("agent_runs").select("status").eq("id", id).single();
    if (!run) return apiError("Run not found", 404);
    if (run.status === "done" || run.status === "failed") return apiError("Cannot cancel completed run", 400);

    await supabase.from("agent_runs").update({ status: "failed" }).eq("id", id);

    // 関連する承認リクエストもキャンセル
    await supabase.from("approval_requests").update({ status: "rejected", rejection_reason: "Run cancelled" }).eq("run_id", id).eq("status", "pending");

    return apiResponse({ ok: true });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
