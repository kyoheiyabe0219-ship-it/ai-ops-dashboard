import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

// POST /api/runs/bulk — 一括操作
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const { action } = await req.json();

    if (action === "stop_all_thinking") {
      const { data } = await supabase.from("agent_runs").update({ status: "failed" }).eq("status", "thinking").select("id");
      return apiResponse({ ok: true, stopped: (data || []).length });
    }

    if (action === "delete_stopped") {
      const { data } = await supabase.from("agent_runs").delete().in("status", ["failed", "rejected"]).select("id");
      return apiResponse({ ok: true, deleted: (data || []).length });
    }

    if (action === "cleanup") {
      // 24h未更新のthinkingを停止
      const cutoff = new Date(Date.now() - 86400000).toISOString();
      const { data: stale } = await supabase.from("agent_runs").update({ status: "failed" }).eq("status", "thinking").lt("updated_at", cutoff).select("id");
      // 48h前のfailed/rejectedを削除
      const cutoff48 = new Date(Date.now() - 172800000).toISOString();
      const { data: old } = await supabase.from("agent_runs").delete().in("status", ["failed", "rejected"]).lt("updated_at", cutoff48).select("id");
      return apiResponse({ ok: true, stopped: (stale || []).length, deleted: (old || []).length });
    }

    return apiError("action: stop_all_thinking | delete_stopped | cleanup", 400);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
