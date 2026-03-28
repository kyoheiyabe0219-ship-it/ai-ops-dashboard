import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    const { status, assigned_to, actual_value, cost } = await req.json();

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (actual_value !== undefined) updates.actual_value = actual_value;
    if (cost !== undefined) updates.cost = cost;

    if (Object.keys(updates).length === 0) return apiError("No fields to update", 400);

    const { data, error } = await supabase.from("tasks").update(updates).eq("id", id).select().single();
    if (error) return apiError(error.message);

    // 高ROIタスク完了アラート
    if (status === "done" && data && data.roi > 5) {
      await supabase.from("alerts").insert({
        type: "success",
        title: `高ROIタスク完了 (${data.roi.toFixed(1)}x)`,
        message: data.content,
        related_task: id,
        related_agent: data.assigned_to,
      });
    }

    return apiResponse({ ok: true, task: data });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
