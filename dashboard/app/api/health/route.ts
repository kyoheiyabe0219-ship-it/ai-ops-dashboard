import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const start = Date.now();

    const [agentsRes, tasksRes, alertsRes] = await Promise.all([
      supabase.from("agents").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("alerts").select("id").eq("is_read", false),
    ]);

    const dbLatency = Date.now() - start;
    const agents = agentsRes.data || [];
    const tasks = tasksRes.data || [];
    const total = agents.length || 1;
    const running = agents.filter((a) => a.status === "running").length;
    const errored = agents.filter((a) => a.status === "error").length;
    const stale = agents.filter((a) => {
      return Date.now() - new Date(a.updated_at).getTime() > 30000 && a.status === "running";
    });
    const doneTasks = tasks.filter((t) => t.status === "done");
    const avgRoi = doneTasks.length > 0
      ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length : 0;

    return apiResponse({
      status: errored === 0 && stale.length === 0 ? "healthy" : "degraded",
      db_connected: !agentsRes.error,
      db_latency_ms: dbLatency,
      uptime_pct: Math.round((running / total) * 100),
      running,
      idle: agents.filter((a) => a.status === "idle").length,
      errored,
      stale_agents: stale.map((a) => a.id),
      active_tasks: tasks.filter((t) => t.status === "running").length,
      pending_tasks: tasks.filter((t) => t.status === "pending").length,
      avg_roi: Math.round(avgRoi * 100) / 100,
      unread_alerts: (alertsRes.data || []).length,
      total_agents: agents.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
