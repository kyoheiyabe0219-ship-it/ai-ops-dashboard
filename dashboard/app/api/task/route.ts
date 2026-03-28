import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

async function autoAssign(supabase: ReturnType<typeof getServiceSupabase>, taskId: string) {
  const { data: idleAgents } = await supabase.from("agents").select("id, name").eq("status", "idle");
  if (!idleAgents || idleAgents.length === 0) return null;

  const { data: runningTasks } = await supabase.from("tasks").select("assigned_to").eq("status", "running");
  const taskCounts: Record<string, number> = {};
  (runningTasks || []).forEach((t) => { taskCounts[t.assigned_to] = (taskCounts[t.assigned_to] || 0) + 1; });

  idleAgents.sort((a, b) => (taskCounts[a.id] || 0) - (taskCounts[b.id] || 0));
  const chosen = idleAgents[0];

  await supabase.from("tasks").update({ assigned_to: chosen.id }).eq("id", taskId);
  return chosen;
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const supabase = getServiceSupabase();
    const { content, priority, assigned_to, expected_value, cost } = await req.json();

    if (!content) return apiError("content is required", 400);

    const { data, error } = await supabase
      .from("tasks")
      .insert({ content, priority: priority || "medium", assigned_to: assigned_to || null, status: "pending", expected_value: expected_value || 0, cost: cost || 0 })
      .select()
      .single();

    if (error) return apiError(error.message);

    let assignedAgent = null;
    if (!assigned_to && data) {
      assignedAgent = await autoAssign(supabase, data.id);
      if (assignedAgent) {
        const { data: updated } = await supabase.from("tasks").select("*").eq("id", data.id).single();
        return apiResponse({ ok: true, task: updated, assigned_agent: assignedAgent });
      }
    }

    return apiResponse({ ok: true, task: data, assigned_agent: assignedAgent });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
