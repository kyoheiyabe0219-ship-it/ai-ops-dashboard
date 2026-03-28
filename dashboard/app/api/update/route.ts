import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const supabase = getServiceSupabase();
    const { agent_id, name, status, task, progress } = await req.json();

    if (!agent_id) return apiError("agent_id is required", 400);

    const { data: prev } = await supabase.from("agents").select("status, name").eq("id", agent_id).single();

    const { data, error } = await supabase
      .from("agents")
      .upsert({ id: agent_id, name: name || agent_id, status: status || "idle", task: task || "", progress: progress ?? 0 }, { onConflict: "id" })
      .select();

    if (error) return apiError(error.message);

    // 自動アラート: error遷移
    if (status === "error" && prev?.status !== "error") {
      await supabase.from("alerts").insert({ type: "error", title: `${name || agent_id} がエラー`, message: task || "不明なエラー", related_agent: agent_id });
    }
    // 自動アラート: 復帰
    if (prev?.status === "error" && status && status !== "error") {
      await supabase.from("alerts").insert({ type: "success", title: `${name || prev.name || agent_id} が復帰`, message: `${prev.status} → ${status}`, related_agent: agent_id });
    }

    return apiResponse({ ok: true, agent: data?.[0] });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
