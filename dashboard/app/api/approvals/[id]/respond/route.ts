import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

// POST /api/approvals/[id]/respond — 承認 or 却下
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    const { action, reason } = await req.json();

    if (!action || !["approved", "rejected"].includes(action)) {
      return apiError("action must be 'approved' or 'rejected'", 400);
    }

    // 承認リクエスト更新
    const { data: approval, error } = await supabase
      .from("approval_requests")
      .update({
        status: action,
        rejection_reason: action === "rejected" ? reason || null : null,
        responded_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return apiError(error.message);

    // Run ステータス更新
    if (action === "approved") {
      await supabase.from("agent_runs").update({ status: "approved" }).eq("id", approval.run_id);
    } else {
      // 却下 → thinking に戻して再ループ可能にする
      await supabase.from("agent_runs").update({ status: "thinking" }).eq("id", approval.run_id);
    }

    return apiResponse({ ok: true, approval });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
