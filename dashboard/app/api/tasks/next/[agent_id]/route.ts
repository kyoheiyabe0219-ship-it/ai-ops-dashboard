import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

const PRIORITY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ agent_id: string }> }) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const { agent_id } = await params;
    const supabase = getServiceSupabase();

    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("assigned_to", agent_id)
      .eq("status", "pending")
      .order("priority", { ascending: true })
      .order("roi", { ascending: false })
      .order("created_at", { ascending: true });

    if (!data || data.length === 0) return apiResponse({ ok: true, task: null });

    data.sort((a, b) => {
      const pw = (PRIORITY_WEIGHT[a.priority] || 1) - (PRIORITY_WEIGHT[b.priority] || 1);
      if (pw !== 0) return pw;
      const roiDiff = (b.roi || 0) - (a.roi || 0);
      if (roiDiff !== 0) return roiDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    return apiResponse({ ok: true, task: data[0] });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
