import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

// GET /api/runs/[id] — Run詳細 + iterations
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const { id } = await params;
    const supabase = getServiceSupabase();

    const [runRes, iterRes, approvalRes, taskRes] = await Promise.all([
      supabase.from("agent_runs").select("*").eq("id", id).single(),
      supabase.from("thinking_iterations").select("*").eq("run_id", id).order("iteration", { ascending: true }),
      supabase.from("approval_requests").select("*").eq("run_id", id).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, content, status, priority, assigned_to, roi").eq("run_id", id),
    ]);

    if (runRes.error) return apiError(runRes.error.message);

    return apiResponse({
      run: runRes.data,
      iterations: iterRes.data || [],
      approvals: approvalRes.data || [],
      tasks: taskRes.data || [],
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
